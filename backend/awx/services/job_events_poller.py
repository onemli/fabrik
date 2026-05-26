# awx/services/job_events_poller.py
#
# Polls AWX for individual job_event records, persists them to JobOutputChunk,
# and pushes them to the frontend via WebSocket. Runs as a dedicated Celery
# task (stream_job_output) — one instance per active execution.
#
# Reliability design:
#   Cursor in Redis  — tracks last counter seen; survives worker restart without
#                      re-sending all events to the frontend.
#   Keepalive key    — updated every poll cycle (TTL=30s); watchdog in
#                      sync_running_jobs detects dead tasks and restarts them.
#   AWX error budget — MAX_AWX_ERRORS consecutive failures before graceful stop.
#   Full pagination  — if >100 events arrive between polls, all pages are fetched.
#   Deduplication    — counter-based unique_together in JobOutputChunk; safe on
#                      acks_late re-delivery.
#   WS heartbeat     — sent every HEARTBEAT_INTERVAL so the frontend can detect
#                      a stuck stream without waiting for new events.

import time
import random
import logging
from typing import Dict, Any

from django.utils import timezone

from awx.services.awx_client import AWXClient
from awx.services.websocket_service import get_websocket_service
from awx.models import AutomationExecution

logger = logging.getLogger(__name__)

# ── Redis key configuration ────────────────────────────────────────────────────
CURSOR_KEY_PREFIX = 'awx:stream:cursor:'  # Stores last_counter per execution
KEEPALIVE_KEY_PREFIX = 'awx:stream:alive:'  # Heartbeat for watchdog detection
CURSOR_TTL = 7200  # 2 hours — longer than any realistic job
KEEPALIVE_TTL = 30  # 30 seconds — watchdog checks this; poller updates every poll cycle
HEARTBEAT_INTERVAL = 5.0  # seconds between WS heartbeats to frontend


class JobEventsPoller:
    """
    Polls AWX for job output events and publishes to WebSocket + DB.

    One poller instance per AutomationExecution, running in a dedicated Celery task.
    """

    # Exponential backoff constants for transient errors
    MAX_BACKOFF = 30.0
    BACKOFF_BASE = 2.0
    JITTER_FRACTION = 0.25

    # Stop after this many consecutive AWX connectivity failures
    MAX_AWX_ERRORS = 10

    def __init__(self, execution_id: str, poll_interval: float = 0.5):
        """
        Initialize poller for a specific execution.

        Args:
            execution_id: AutomationExecution UUID (string)
            poll_interval: Polling interval in seconds (default: 0.5)
        """
        self.execution_id = execution_id
        self.poll_interval = poll_interval
        self.should_stop = False
        self._consecutive_awx_errors = 0

        try:
            self.execution = AutomationExecution.objects.get(id=execution_id)
            self.awx_job_id = self.execution.awx_job_id

            if not self.awx_job_id:
                raise ValueError(f'Execution {execution_id} has no AWX job ID')

            awx_connection = self.execution.awx_connection
            self.awx_client = AWXClient.for_connection(awx_connection)

            # Restore cursor from Redis for restart recovery
            self.last_counter = self._load_cursor()

            logger.info(
                f'Poller initialized: execution={execution_id}, job={self.awx_job_id}, '
                f'cursor={self.last_counter}, interval={poll_interval}s'
            )

        except AutomationExecution.DoesNotExist:
            logger.error(f'Execution not found: {execution_id}')
            raise
        except Exception as e:
            logger.exception(f'Failed to initialize poller: {e}')
            raise

    # ── Redis helpers ──────────────────────────────────────────────────────────

    def _get_cache(self):
        """Get Django cache backend; returns None if unavailable."""
        try:
            from django.core.cache import cache

            return cache
        except Exception:
            return None

    def _load_cursor(self) -> int:
        """Load last_counter from Redis. Returns 0 if not found or Redis unavailable."""
        cache = self._get_cache()
        if cache is None:
            return 0
        try:
            val = cache.get(f'{CURSOR_KEY_PREFIX}{self.execution_id}')
            if val is not None:
                counter = int(val)
                logger.info(f'Restored cursor={counter} for execution {self.execution_id}')
                return counter
        except Exception as e:
            logger.debug(f'Cursor load failed (non-critical): {e}')
        return 0

    def _save_cursor(self):
        """Persist current last_counter to Redis."""
        cache = self._get_cache()
        if cache is None:
            return
        try:
            cache.set(
                f'{CURSOR_KEY_PREFIX}{self.execution_id}',
                self.last_counter,
                timeout=CURSOR_TTL,
            )
        except Exception as e:
            logger.debug(f'Cursor save failed (non-critical): {e}')

    def _update_keepalive(self):
        """Refresh keepalive key so watchdog knows we're alive."""
        cache = self._get_cache()
        if cache is None:
            return
        try:
            cache.set(
                f'{KEEPALIVE_KEY_PREFIX}{self.execution_id}',
                '1',
                timeout=KEEPALIVE_TTL,
            )
        except Exception:
            pass  # Redis down — watchdog will restart us, which is fine

    def _clear_redis_keys(self):
        """Remove cursor and keepalive keys on clean exit."""
        cache = self._get_cache()
        if cache is None:
            return
        try:
            cache.delete(f'{CURSOR_KEY_PREFIX}{self.execution_id}')
            cache.delete(f'{KEEPALIVE_KEY_PREFIX}{self.execution_id}')
        except Exception:
            pass

    # ── Main polling loop ──────────────────────────────────────────────────────

    def start(self):
        """
        Start polling loop.

        Loop invariants:
        - Always updates keepalive before each cycle
        - Sends WS heartbeat every HEARTBEAT_INTERVAL seconds
        - Saves cursor to Redis after each successful fetch
        - Stops cleanly on: job finished, MAX_AWX_ERRORS reached, KeyboardInterrupt, fatal error
        """
        logger.info(f'Starting poller for execution {self.execution_id}')

        consecutive_loop_errors = 0
        last_heartbeat_time = time.time()

        try:
            while not self.should_stop:
                # Keep the watchdog from triggering on us
                self._update_keepalive()

                try:
                    # ── Check if AWX job is still running ──────────────────
                    job_running = self._is_job_running()

                    if not job_running:
                        if self._consecutive_awx_errors >= self.MAX_AWX_ERRORS:
                            # AWX unreachable for too long — give up
                            logger.error(
                                f'Stopping poller for {self.execution_id}: '
                                f'{self._consecutive_awx_errors} consecutive AWX errors'
                            )
                        else:
                            # Job cleanly finished — do a final fetch to capture trailing events
                            logger.info(f'Job {self.awx_job_id} finished; doing final event fetch')
                            self._fetch_and_publish_events()
                            self._save_cursor()
                            logger.info(
                                f'Poller finished cleanly for execution {self.execution_id}'
                            )
                        break

                    # ── Fetch new events ───────────────────────────────────
                    events_count = self._fetch_and_publish_events()
                    self._save_cursor()

                    if events_count > 0:
                        logger.debug(
                            f'Processed {events_count} events '
                            f'(job={self.awx_job_id}, counter={self.last_counter})'
                        )

                    consecutive_loop_errors = 0

                    # ── Heartbeat ──────────────────────────────────────────
                    now = time.time()
                    if now - last_heartbeat_time >= HEARTBEAT_INTERVAL:
                        self._publish_heartbeat()
                        last_heartbeat_time = now

                    time.sleep(self.poll_interval)

                except Exception as e:
                    consecutive_loop_errors += 1
                    logger.exception(
                        f'Error in polling loop (attempt {consecutive_loop_errors}): {e}'
                    )
                    # Exponential backoff with jitter
                    backoff = min(
                        self.poll_interval * (self.BACKOFF_BASE**consecutive_loop_errors),
                        self.MAX_BACKOFF,
                    )
                    jitter = backoff * self.JITTER_FRACTION * random.random()
                    time.sleep(backoff + jitter)

        except KeyboardInterrupt:
            logger.info(f'Poller interrupted for execution {self.execution_id}')
        except Exception as e:
            logger.exception(f'Fatal error in poller for {self.execution_id}: {e}')
        finally:
            self.stop()
            self._clear_redis_keys()

    def stop(self):
        """Signal polling loop to stop."""
        self.should_stop = True
        logger.info(f'Poller stopped for execution {self.execution_id}')

    # ── AWX interaction ────────────────────────────────────────────────────────

    def _is_job_running(self) -> bool:
        """
        Check if the AWX job is still in a running state.

        Tracks consecutive AWX errors. After MAX_AWX_ERRORS failures in a row,
        returns False to let the caller exit the loop (prevents infinite loop when
        AWX is permanently unreachable).

        Returns:
            True  → job is running (or we're in transient error grace period)
            False → job finished cleanly, OR error limit exceeded
        """
        try:
            url = f'{self.awx_client.base_url}/api/v2/jobs/{self.awx_job_id}/'
            response = self.awx_client.session.get(
                url,
                verify=self.awx_client.verify_ssl,
                timeout=self.awx_client.timeout,
            )
            response.raise_for_status()
            job_status = response.json().get('status')

            running_statuses = {'pending', 'waiting', 'running'}
            is_running = job_status in running_statuses

            # Reset error counter on successful AWX contact
            self._consecutive_awx_errors = 0

            return is_running

        except Exception as e:
            self._consecutive_awx_errors += 1
            logger.warning(
                f'AWX connectivity error {self._consecutive_awx_errors}/{self.MAX_AWX_ERRORS} '
                f'for job {self.awx_job_id}: {e}'
            )

            if self._consecutive_awx_errors >= self.MAX_AWX_ERRORS:
                # Signal the loop to exit
                return False

            # Assume still running — will retry next cycle
            return True

    def _fetch_and_publish_events(self) -> int:
        """
        Fetch ALL new events from AWX since last_counter (handles pagination).

        AWX paginates job_events at page_size=100. If a large playbook emits >100
        events between two poll cycles, this method follows the 'next' link to
        fetch every page before returning.

        Returns:
            Total number of events processed in this call.
        """
        total_events = 0
        current_cursor = self.last_counter

        try:
            base_url = f'{self.awx_client.base_url}/api/v2/jobs/{self.awx_job_id}/job_events/'

            while True:
                params = {
                    'order_by': 'counter',
                    'counter__gt': current_cursor,
                    'page_size': 100,
                }

                response = self.awx_client.session.get(
                    base_url,
                    params=params,
                    verify=self.awx_client.verify_ssl,
                    timeout=self.awx_client.timeout,
                )
                response.raise_for_status()
                data = response.json()
                events = data.get('results', [])

                if not events:
                    break

                for event in events:
                    self._publish_event(event)
                    counter = event.get('counter', 0)
                    if counter > self.last_counter:
                        self.last_counter = counter
                    current_cursor = self.last_counter

                total_events += len(events)

                # If AWX says there are more pages, keep fetching
                if not data.get('next'):
                    break
                # (next iteration uses updated current_cursor, so we get the next page)

        except Exception as e:
            logger.exception(f'Failed to fetch job events: {e}')

        return total_events

    def _publish_event(self, event: Dict[str, Any]):
        """
        Process a single AWX job_event:
          1. Persist to JobOutputChunk (historical playback, late-joiners)
          2. Emit via WebSocket (live streaming)
        """
        try:
            event_payload = {
                'awx_job_id': self.awx_job_id,
                'execution_id': str(self.execution_id),
                'counter': event.get('counter'),
                'event_type': event.get('event', 'unknown'),
                'stdout': event.get('stdout', ''),
                'stderr': event.get('stderr', ''),
                'created': event.get('created'),
                'task': event.get('task', ''),
                'play': event.get('play', ''),
                'role': event.get('role', ''),
                'host_name': event.get('host_name', ''),
                'event_data': event.get('event_data', {}),
            }

            # 1. Persist to DB ────────────────────────────────────────────
            self._save_to_db(event)

            # 2. Direct WebSocket emission ─────────────────────────────────
            try:
                ws_service = get_websocket_service()
                ws_service.emit_execution_output(
                    str(self.execution_id),
                    event_payload,
                )
            except Exception as ws_err:
                logger.debug(f'WS emit failed (non-critical): {ws_err}')

        except Exception as e:
            logger.exception(f'Error publishing event counter={event.get("counter")}: {e}')

    def _save_to_db(self, event: Dict[str, Any]):
        """
        Persist AWX event to JobOutputChunk for historical playback.

        Uses update_or_create on (execution, counter) so re-delivery after a
        worker restart doesn't create duplicate rows.
        """
        try:
            from awx.models import JobOutputChunk
            from django.utils.dateparse import parse_datetime

            counter = event.get('counter', 0)
            if counter == 0:
                return  # Skip placeholder events without a real counter

            # Parse AWX timestamp
            awx_created = None
            created_str = event.get('created')
            if created_str:
                try:
                    awx_created = parse_datetime(created_str)
                except Exception:
                    pass
            if awx_created is None:
                awx_created = timezone.now()

            # Merge extra fields into event_data for rich JSON inspection
            merged_event_data = {
                'task': event.get('task', ''),
                'play': event.get('play', ''),
                'role': event.get('role', ''),
                'host_name': event.get('host_name', ''),
            }
            merged_event_data.update(event.get('event_data') or {})

            JobOutputChunk.objects.update_or_create(
                execution=self.execution,
                counter=counter,
                defaults={
                    'awx_job_id': int(self.awx_job_id),
                    'event_type': event.get('event', 'unknown'),
                    'stdout': event.get('stdout', ''),
                    'stderr': event.get('stderr', ''),
                    'event_data': merged_event_data,
                    'awx_created': awx_created,
                },
            )

        except Exception as e:
            # DB write failures are non-critical for real-time display
            # (WS still works); log at debug to avoid log spam
            logger.debug(f'DB save failed for counter={event.get("counter")} (non-critical): {e}')

    def _publish_heartbeat(self):
        """
        Emit a heartbeat event via WebSocket.

        Lets the frontend distinguish "no new events (job idle)" from
        "stream is dead/stuck". Frontend reconnects if no message arrives
        for >HEARTBEAT_INTERVAL * N seconds.
        """
        try:
            ws_service = get_websocket_service()
            ws_service.emit_execution_output(
                str(self.execution_id),
                {
                    'type': 'heartbeat',
                    'execution_id': str(self.execution_id),
                    'awx_job_id': self.awx_job_id,
                    'last_counter': self.last_counter,
                    'timestamp': timezone.now().isoformat(),
                },
            )
        except Exception as e:
            logger.debug(f'Heartbeat emit failed (non-critical): {e}')


def start_job_output_streaming(execution_id: str, poll_interval: float = 0.5):
    """
    Convenience entry-point called by the stream_job_output Celery task.

    Args:
        execution_id: AutomationExecution UUID (string)
        poll_interval: Polling interval in seconds
    """
    try:
        poller = JobEventsPoller(execution_id, poll_interval=poll_interval)
        poller.start()
    except Exception as e:
        logger.exception(f'Failed to start job output streaming: {e}')
        raise
