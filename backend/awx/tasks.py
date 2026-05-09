# awx/tasks.py
#
# Celery tasks that glue the AWX execution engine to the rest of the platform.
# There are two distinct execution flows handled here:
#
#   1. execute_automation_request — triggered once when a user submits a request.
#      Hands off to ExecutionEngine which launches a single bulk AWX job
#      and writes an audit log entry.
#
#   2. sync_running_jobs — Celery Beat fires this every 10 seconds. It polls AWX
#      for status changes on all non-terminal executions and broadcasts updates via
#      WebSocket. It also runs a watchdog that detects dead output-streaming tasks
#      and restarts them automatically.
#
# Three housekeeping tasks run on a daily schedule:
#   cleanup_old_output_chunks     — delete JobOutputChunk rows older than 90 days
#   compress_old_output_chunks    — gzip compress rows between 30–90 days old
#   cleanup_stale_executions      — mark zombie jobs (stuck pending/running >2h) as error
#
# retry_failed_execution and validate_template_input_async are called on demand
# from the API layer, not from Celery Beat.

import logging
import uuid
from typing import Dict, Any

from celery import shared_task
from celery.exceptions import SoftTimeLimitExceeded, TimeLimitExceeded
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from awx.models import AutomationRequest, AutomationExecution
from awx.services.execution_engine import ExecutionEngine, ExecutionError
from awx.services.job_monitor import JobMonitor
from audit.services import AuditService
from notifications.services import create_notification

logger = logging.getLogger(__name__)


def _watchdog_streaming_tasks() -> int:
    """Check for dead output-streaming tasks and restart them.

    Each JobEventsPoller writes a Redis keepalive key with a 30-second TTL every
    poll cycle. If that key has disappeared for an execution that's still in a
    non-terminal state, the streaming task has crashed or been evicted and we need
    to restart it. GRACE_SECONDS gives brand-new executions time to get a streaming
    task assigned before the watchdog panics about a missing keepalive.

    Called from sync_running_jobs so this runs every 10 seconds as a side effect
    of the regular status poll — no separate Beat schedule needed.
    """
    from datetime import timedelta

    GRACE_SECONDS = 60  # Give new executions time to start streaming
    KEEPALIVE_PREFIX = 'awx:stream:alive:'

    try:
        from django.core.cache import cache
    except Exception:
        return 0  # Redis unavailable — skip watchdog

    try:
        cutoff = timezone.now() - timedelta(seconds=GRACE_SECONDS)
        running_executions = AutomationExecution.objects.filter(
            status__in=['pending', 'running'],
            awx_job_id__isnull=False,
            created_at__lt=cutoff,
        ).only('id', 'awx_job_id')

        restarted = 0
        for execution in running_executions:
            try:
                # If keepalive key missing → streaming task is dead
                if cache.get(f'{KEEPALIVE_PREFIX}{execution.id}') is None:
                    logger.warning(
                        f'Streaming task dead for execution {execution.id} '
                        f'(awx_job={execution.awx_job_id}), restarting'
                    )
                    stream_job_output.delay(str(execution.id), poll_interval=1.0)
                    restarted += 1
            except Exception as e:
                logger.error(f'Watchdog: failed to restart streaming for {execution.id}: {e}')

        return restarted

    except Exception as e:
        logger.exception(f'Error in _watchdog_streaming_tasks: {e}')
        return 0


def _atomic_revert_request_status(
    request_id: str,
    target_status: str,
    task_id: str = '',
    error_message: str | None = None,
) -> None:
    """Flip a request's status inside a SELECT FOR UPDATE lock.

    We call this in error/timeout handlers where we know the request is ours to
    update but we don't want to race with another worker that somehow also picked
    it up. The error_message goes into metadata['launch_error'] so the frontend
    can surface it without digging through logs.
    """
    try:
        with transaction.atomic():
            req = AutomationRequest.objects.select_for_update().get(id=request_id)
            req.status = target_status
            update_fields = ['status']
            if error_message:
                meta = req.metadata or {}
                meta['launch_error'] = error_message
                req.metadata = meta
                update_fields.append('metadata')
            req.save(update_fields=update_fields)
            logger.info(f'[{task_id}] Set request {request_id} to {target_status}')
    except AutomationRequest.DoesNotExist:
        logger.error(f'[{task_id}] Cannot revert - request {request_id} not found')
    except Exception as e:
        logger.exception(f'[{task_id}] Error reverting request status: {str(e)}')


@shared_task(
    bind=True,
    name='awx.execute_automation_request',
    max_retries=3,
    default_retry_delay=60,
    soft_time_limit=3600,  # 1 hour soft limit
    time_limit=3900,  # 1 hour 5 min hard limit
)
def execute_automation_request(self, request_id: str) -> Dict[str, Any]:
    """Launch AWX jobs for an AutomationRequest.

    The view layer creates the request record and hands off the UUID to this task.
    We take it from there: validate status is still PENDING (guards against double
    submission), flip to RUNNING under a SELECT FOR UPDATE, and call ExecutionEngine.

    ExecutionError is a permanent failure — no retry (bad template config, missing
    connection, etc.). Generic exceptions retry with exponential back-off up to 3
    times before giving up.
    """
    task_id = self.request.id
    logger.info(f'[{task_id}] Starting execution for request {request_id}')

    try:
        # Convert string UUID to UUID object
        request_uuid = uuid.UUID(request_id)

        # Load request
        try:
            request = AutomationRequest.objects.select_related(
                'template', 'awx_connection', 'requested_by'
            ).get(id=request_uuid)
        except AutomationRequest.DoesNotExist:
            logger.error(f'[{task_id}] Request {request_id} not found')
            return {
                'success': False,
                'request_id': request_id,
                'execution_ids': [],
                'error': f'Request {request_id} not found',
            }

        # Atomically validate and update status (PENDING → RUNNING)
        # select_for_update prevents race conditions if two workers pick up the same request
        with transaction.atomic():
            request = AutomationRequest.objects.select_for_update().get(id=request_uuid)
            if request.status != AutomationRequest.STATUS_PENDING:
                logger.error(
                    f'[{task_id}] Request {request_id} is not pending. '
                    f'Current status: {request.status}'
                )
                return {
                    'success': False,
                    'request_id': request_id,
                    'execution_ids': [],
                    'error': f'Request must be pending. Current status: {request.status}',
                }
            request.status = AutomationRequest.STATUS_RUNNING
            request.save(update_fields=['status'])

        # Execute request
        engine = ExecutionEngine()
        success, execution_ids, error = engine.execute_request(request_uuid)

        if success:
            logger.info(
                f'[{task_id}] Successfully started execution for request {request_id}. '
                f'Created {len(execution_ids)} execution(s)'
            )

            # Audit log
            AuditService.log(
                user=request.requested_by,
                action='execute_automation_request',
                category='awx_automation',
                resource_type='AutomationRequest',
                resource_id=str(request.id),
                description=f'Started execution with {len(execution_ids)} job(s)',
            )

            create_notification(
                user=request.requested_by,
                type='success',
                title=f'AWX: {request.title} started',
                message=f'{len(execution_ids)} job(s) launched successfully',
                source='awx_execution_success',
                related_execution_id=request.id,
                metadata={
                    'template': request.template.name,
                    'mode': request.template.execution_mode,
                },
            )

            return {
                'success': True,
                'request_id': request_id,
                'execution_ids': [str(ex_id) for ex_id in execution_ids],
                'execution_mode': request.template.execution_mode,
                'error': None,
            }
        else:
            logger.error(f'[{task_id}] Execution failed for request {request_id}: {error}')

            # AWX launch failed — mark as FAILED so user sees the error (not stuck in PENDING)
            _atomic_revert_request_status(
                request_uuid, AutomationRequest.STATUS_FAILED, task_id, error_message=error
            )

            # Audit log
            AuditService.log(
                user=request.requested_by,
                action='execute_automation_request_failed',
                category='awx_automation',
                resource_type='AutomationRequest',
                resource_id=str(request.id),
                description=f'Execution failed: {error}',
            )

            create_notification(
                user=request.requested_by,
                type='error',
                title=f'AWX: {request.title} failed',
                message=str(error)[:200],
                source='awx_execution_failure',
                related_execution_id=request.id,
                metadata={'template': request.template.name, 'error': str(error)[:500]},
            )

            return {'success': False, 'request_id': request_id, 'execution_ids': [], 'error': error}

    except SoftTimeLimitExceeded:
        error_msg = 'Task exceeded soft time limit (1 hour)'
        logger.error(f'[{task_id}] {error_msg}')

        _atomic_revert_request_status(request_uuid, AutomationRequest.STATUS_PENDING, task_id)

        return {'success': False, 'request_id': request_id, 'execution_ids': [], 'error': error_msg}

    except TimeLimitExceeded:
        error_msg = 'Task exceeded hard time limit'
        logger.error(f'[{task_id}] {error_msg}')
        return {'success': False, 'request_id': request_id, 'execution_ids': [], 'error': error_msg}

    except ExecutionError as e:
        # Permanent failure - don't retry
        error_msg = f'Execution error: {str(e)}'
        logger.error(f'[{task_id}] {error_msg}')

        _atomic_revert_request_status(
            request_uuid, AutomationRequest.STATUS_FAILED, task_id, error_message=error_msg
        )

        return {'success': False, 'request_id': request_id, 'execution_ids': [], 'error': error_msg}

    except Exception as e:
        # Unexpected error - retry up to 3 times
        error_msg = f'Unexpected error: {str(e)}'
        logger.exception(f'[{task_id}] {error_msg}')

        # Check retry count - exponential backoff: 60s, 120s, 240s
        if self.request.retries < self.max_retries:
            countdown = 60 * (2**self.request.retries)  # 60, 120, 240
            logger.info(
                f'[{task_id}] Retrying in {countdown}s '
                f'(attempt {self.request.retries + 1}/{self.max_retries})'
            )
            raise self.retry(exc=e, countdown=countdown)
        else:
            logger.error(f'[{task_id}] Max retries reached, failing permanently')

            _atomic_revert_request_status(request_uuid, AutomationRequest.STATUS_FAILED, task_id)

            return {
                'success': False,
                'request_id': request_id,
                'execution_ids': [],
                'error': f'Failed after {self.max_retries} retries: {error_msg}',
            }


@shared_task(
    name='awx.stream_job_output',
    soft_time_limit=3600,  # 1 hour (matches execution limit)
    time_limit=3900,  # 1 hour 5 min hard limit
    ignore_result=True,  # Output streaming is fire-and-forget
    acks_late=True,  # Re-deliver if worker crashes mid-stream
)
def stream_job_output(execution_id: str, poll_interval: float = 0.5) -> None:
    """Pull AWX job events and push them to the WebSocket via Django Channels.

    This runs as a Celery task instead of a background thread because threads
    inside a Django/Celery worker don't get proper DB connection cleanup and are
    invisible to Celery monitoring. As a task, it shows up in Flower, respects
    soft_time_limit for graceful shutdown, and returns its DB connection to the
    pool when it's done. acks_late ensures the job gets re-delivered if the
    worker crashes mid-stream rather than silently vanishing.
    """
    from awx.services.job_events_poller import start_job_output_streaming

    logger.info(f'Starting output streaming task for execution {execution_id}')
    try:
        start_job_output_streaming(execution_id, poll_interval=poll_interval)
    except SoftTimeLimitExceeded:
        logger.warning(f'Output streaming for {execution_id} hit time limit, stopping')
    except Exception as e:
        logger.exception(f'Output streaming failed for execution {execution_id}: {str(e)}')


@shared_task(
    name='awx.sync_running_jobs',
    soft_time_limit=300,  # 5 minutes
    time_limit=360,  # 6 minutes
)
def sync_running_jobs() -> Dict[str, Any]:
    """Poll AWX every 10 seconds for job status changes and broadcast updates.

    Beat fires this constantly, so we use a Redis distributed lock to skip
    the run if the previous one is still in progress — better to miss one cycle
    than to have a pile of concurrent syncs hammering the AWX API. The lock has
    a 2-minute timeout as a dead-man switch in case this task itself gets stuck.
    After syncing, runs the streaming watchdog to restart any dead output tasks.
    """
    from django.core.cache import cache

    LOCK_KEY = 'sync_running_jobs_lock'
    LOCK_TIMEOUT = 120  # 2 minutes - generous for slow AWX responses

    # Acquire distributed lock (non-blocking)
    # Graceful degradation: if Redis is unavailable, proceed without lock
    lock_acquired = False
    try:
        acquired = cache.add(LOCK_KEY, 'locked', LOCK_TIMEOUT)
        if not acquired:
            logger.debug('sync_running_jobs skipped: another instance is running')
            return {
                'total': 0,
                'synced': 0,
                'failed': 0,
                'skipped': True,
                'reason': 'Lock held by another worker',
            }
        lock_acquired = True
    except Exception as cache_err:
        logger.warning(
            f'Redis unavailable for distributed lock, proceeding without lock: {cache_err}'
        )

    start_time = timezone.now()
    logger.info('Starting periodic job sync')

    try:
        # Create job monitor
        monitor = JobMonitor()

        # Sync all running jobs
        stats = monitor.sync_running_jobs()

        # Watchdog: restart dead streaming tasks for running executions
        restarted = _watchdog_streaming_tasks()
        if restarted:
            stats['streaming_restarted'] = restarted

        # Calculate duration
        duration = (timezone.now() - start_time).total_seconds()
        stats['duration_seconds'] = round(duration, 2)

        logger.info(
            f'Job sync completed in {duration:.2f}s: '
            f'{stats["synced"]}/{stats["total"]} synced, '
            f'{stats["failed"]} failed'
            + (f', {restarted} streaming task(s) restarted' if restarted else '')
        )

        return stats

    except SoftTimeLimitExceeded:
        duration = (timezone.now() - start_time).total_seconds()
        logger.error(f'Job sync exceeded soft time limit after {duration:.2f}s')
        return {
            'total': 0,
            'synced': 0,
            'failed': 0,
            'duration_seconds': duration,
            'error': 'Soft time limit exceeded',
        }

    except Exception as e:
        duration = (timezone.now() - start_time).total_seconds()
        logger.exception(f'Error in periodic job sync: {str(e)}')
        return {'total': 0, 'synced': 0, 'failed': 0, 'duration_seconds': duration, 'error': str(e)}

    finally:
        # Release lock only if we acquired it
        if lock_acquired:
            try:
                cache.delete(LOCK_KEY)
            except Exception:
                logger.warning('Failed to release sync_running_jobs lock from Redis')


@shared_task(
    bind=True,
    name='awx.retry_failed_execution',
    max_retries=0,  # No automatic retries - user-initiated only
)
def retry_failed_execution(self, execution_id: str) -> Dict[str, Any]:
    """Retry is not supported for bulk executions — the user should create a new request."""
    return {
        'success': False,
        'execution_id': execution_id,
        'new_execution_id': None,
        'error': 'Bulk executions cannot be retried individually. Please create a new request.',
    }


@shared_task(bind=True, max_retries=0)
def validate_template_input_async(
    self,
    template_id: str,
    input_data: Any,
    connection_id: int | None,
) -> Dict[str, Any]:
    """Run column validation against live APIC data in the background.

    Validation can require an APIC query (query_list mode) which might take
    several seconds, so we run it as a Celery task instead of blocking the HTTP
    request. The frontend polls for the task result via /api/awx/validation-status/.

    We update task state to STARTED and then PROGRESS so the UI can show a
    progress bar. We deliberately do NOT call update_state(state='SUCCESS') at
    the end — returning the dict directly is enough and avoids Celery overwriting
    the return value.
    """
    from awx.models import AutomationTemplate
    import logging

    logger = logging.getLogger(__name__)

    try:
        # Update task state to STARTED
        self.update_state(
            state='STARTED', meta={'status': 'Validating input data...', 'progress': 10}
        )

        logger.info('[Validation Task] ========== RECEIVED DATA ==========')
        logger.info(f'[Validation Task] Input data type: {type(input_data)}')
        logger.info(
            f'[Validation Task] Input data keys: {list(input_data.keys()) if isinstance(input_data, dict) else "N/A"}'
        )
        logger.info(f'[Validation Task] Input data: {input_data}')
        logger.info('[Validation Task] ==================================')

        # Get template
        template = AutomationTemplate.objects.get(id=template_id)

        # Validate using template's method (passes connection_id)
        self.update_state(
            state='PROGRESS', meta={'status': 'Executing validation query...', 'progress': 50}
        )

        is_valid, errors = template.validate_input_data(input_data, connection_id=connection_id)

        # Success - DON'T use update_state(state='SUCCESS') because it overrides return value
        # Just return the result directly
        return {'valid': is_valid, 'errors': errors, 'task_id': self.request.id}

    except AutomationTemplate.DoesNotExist:
        logger.error(f'Template {template_id} not found')
        return {
            'valid': False,
            'errors': [f'Template not found: {template_id}'],
            'task_id': self.request.id,
        }

    except Exception as e:
        logger.error(f'Validation task failed: {e}', exc_info=True)
        return {
            'valid': False,
            'errors': [f'Validation error: {str(e)}'],
            'task_id': self.request.id,
        }

    finally:
        # CRITICAL: Always cleanup connections
        # Note: APIC connection is managed within validate_input_data and execute_saved_query_sync
        # They handle connection cleanup internally
        pass


# ============================================================================
# Enterprise Stdout Management - Retention & Compression Tasks
# ============================================================================


@shared_task(name='awx.cleanup_old_output_chunks', soft_time_limit=3600, time_limit=3900)
def cleanup_old_output_chunks() -> Dict[str, Any]:
    """Delete playbook output chunks that are older than 90 days.

    We delete in batches of 1000 rows rather than issuing a single mass-delete
    because a DELETE on a large table can lock rows for a long time and cause
    visible latency spikes. Looping with small batches keeps the lock window short
    and lets other queries in between.
    """
    from datetime import timedelta
    from awx.models import JobOutputChunk

    try:
        # Calculate cutoff date (90 days ago)
        cutoff_date = timezone.now() - timedelta(days=90)

        # Find old chunks
        old_chunks = JobOutputChunk.objects.filter(created_at__lt=cutoff_date)
        count_before = old_chunks.count()

        logger.info(f'Starting cleanup: {count_before} chunks older than 90 days')

        # Delete in batches to avoid memory issues
        batch_size = 1000
        deleted_total = 0

        while True:
            # Get batch of IDs
            chunk_ids = list(old_chunks.values_list('id', flat=True)[:batch_size])

            if not chunk_ids:
                break

            # Delete batch
            deleted_count = JobOutputChunk.objects.filter(id__in=chunk_ids).delete()[0]
            deleted_total += deleted_count

            logger.info(f'Deleted {deleted_count} chunks (total: {deleted_total})')

        logger.info(f'Cleanup completed: deleted {deleted_total} chunks')

        return {
            'status': 'success',
            'deleted_count': deleted_total,
            'cutoff_date': cutoff_date.isoformat(),
        }

    except Exception as e:
        logger.exception(f'Error in cleanup_old_output_chunks: {str(e)}')
        return {'status': 'error', 'error': str(e)}


@shared_task(name='awx.cleanup_stale_executions', soft_time_limit=300, time_limit=360)
def cleanup_stale_executions() -> Dict[str, Any]:
    """Mark zombie executions that have been stuck in pending/running too long.

    If sync_running_jobs missed an execution (worker crash, AWX unreachable, manual
    job cancel in the AWX UI), the execution record can stay in 'running' forever.
    This task sweeps for anything older than AWX_STALE_EXECUTION_HOURS (default 2h)
    and marks it as 'error'. It uses skip_locked so multiple workers racing to clean
    up the same row just skip it rather than waiting for each other. After flipping
    the execution, it checks if the parent request also needs resolving.
    """
    from datetime import timedelta
    from django.db import transaction as db_transaction

    stale_hours = getattr(settings, 'AWX_STALE_EXECUTION_HOURS', 2)
    cutoff = timezone.now() - timedelta(hours=stale_hours)

    try:
        stale_executions = AutomationExecution.objects.filter(
            status__in=['pending', 'running'], created_at__lt=cutoff
        ).select_related('automation_request')

        cleaned = 0
        for execution in stale_executions:
            try:
                with db_transaction.atomic():
                    exec_locked = (
                        AutomationExecution.objects.select_for_update(skip_locked=True)
                        .filter(id=execution.id, status__in=['pending', 'running'])
                        .first()
                    )

                    if exec_locked is None:
                        continue

                    exec_locked.status = AutomationExecution.STATUS_ERROR
                    exec_locked.finished_at = timezone.now()
                    exec_locked.result_traceback = (
                        f"Marked as stale: execution was in '{execution.status}' state "
                        f'for more than {stale_hours} hours without progress'
                    )
                    exec_locked.save(update_fields=['status', 'finished_at', 'result_traceback'])

                    # Also resolve the parent request if all executions are terminal
                    request = exec_locked.automation_request
                    active_siblings = (
                        AutomationExecution.objects.filter(
                            automation_request=request, status__in=['pending', 'running']
                        )
                        .exclude(id=exec_locked.id)
                        .exists()
                    )

                    if not active_siblings:
                        from awx.models import AutomationRequest

                        with db_transaction.atomic():
                            req = AutomationRequest.objects.select_for_update().get(id=request.id)
                            if req.status in ['pending', 'running']:
                                req.status = AutomationRequest.STATUS_FAILED
                                req.save(update_fields=['status'])

                    cleaned += 1
                    logger.info(
                        f'Marked stale execution {execution.id} as error '
                        f"(was '{execution.status}' since {execution.created_at})"
                    )

            except Exception as e:
                logger.exception(f'Error cleaning stale execution {execution.id}: {str(e)}')

        if cleaned > 0:
            logger.warning(f'Cleaned {cleaned} stale executions (threshold: {stale_hours}h)')

        return {
            'cleaned': cleaned,
            'threshold_hours': stale_hours,
        }

    except Exception as e:
        logger.exception(f'Error in cleanup_stale_executions: {str(e)}')
        return {'cleaned': 0, 'error': str(e)}


@shared_task(name='awx.compress_old_output_chunks', soft_time_limit=3600, time_limit=3900)
def compress_old_output_chunks() -> Dict[str, Any]:
    """Gzip compress playbook output that's between 30 and 90 days old.

    Playbook logs older than 30 days are rarely viewed but still within retention.
    Compressing them saves 70–80% storage for typical Ansible text output.
    We encode the result as "GZIP:<base64>" so it's still a valid text string
    in the PostgreSQL column — the terminal viewer in the UI detects the prefix
    and decompresses on the fly. Chunks smaller than 1 KB are skipped because
    the gzip header overhead makes them larger, not smaller.
    """
    import gzip
    import base64
    from datetime import timedelta
    from awx.models import JobOutputChunk

    try:
        # Calculate date range (30-90 days old)
        compress_cutoff = timezone.now() - timedelta(days=30)
        delete_cutoff = timezone.now() - timedelta(days=90)

        # Find uncompressed chunks in this range
        # We'll use a custom field to track if compressed
        # For now, we'll just log what we would compress

        chunks_to_compress = JobOutputChunk.objects.filter(
            created_at__gte=delete_cutoff, created_at__lt=compress_cutoff
        )

        total_chunks = chunks_to_compress.count()
        compressed_count = 0
        bytes_saved = 0

        logger.info(f'Starting compression: {total_chunks} chunks between 30-90 days old')

        # Process in batches
        batch_size = 100

        for chunk in chunks_to_compress.iterator(chunk_size=batch_size):
            try:
                # Check if already compressed (we'd add a field for this)
                # For now, compress if stdout/stderr is large

                original_size = 0
                compressed_size = 0

                if chunk.stdout and len(chunk.stdout) > 1000:  # > 1KB
                    original_size += len(chunk.stdout.encode('utf-8'))
                    compressed = gzip.compress(chunk.stdout.encode('utf-8'))
                    compressed_size += len(compressed)

                    # Store as base64 for database safety
                    chunk.stdout = f'GZIP:{base64.b64encode(compressed).decode("ascii")}'

                if chunk.stderr and len(chunk.stderr) > 1000:
                    original_size += len(chunk.stderr.encode('utf-8'))
                    compressed = gzip.compress(chunk.stderr.encode('utf-8'))
                    compressed_size += len(compressed)

                    chunk.stderr = f'GZIP:{base64.b64encode(compressed).decode("ascii")}'

                if original_size > 0:
                    chunk.save(update_fields=['stdout', 'stderr'])
                    compressed_count += 1
                    bytes_saved += original_size - compressed_size

                    if compressed_count % 100 == 0:
                        logger.info(f'Compressed {compressed_count}/{total_chunks} chunks')

            except Exception as chunk_error:
                logger.warning(f'Failed to compress chunk {chunk.id}: {str(chunk_error)}')
                continue

        logger.info(
            f'Compression completed: {compressed_count} chunks compressed, '
            f'~{bytes_saved / (1024 * 1024):.2f} MB saved'
        )

        return {
            'status': 'success',
            'total_chunks': total_chunks,
            'compressed_count': compressed_count,
            'bytes_saved': bytes_saved,
            'mb_saved': bytes_saved / (1024 * 1024),
        }

    except Exception as e:
        logger.exception(f'Error in compress_old_output_chunks: {str(e)}')
        return {'status': 'error', 'error': str(e)}


# ── Workflow clone lifecycle ────────────────────────────────────────────────
#
# ExecutionEngine creates an ephemeral workflow_job_template clone for every
# workflow launch (see _launch_workflow_via_clone). Two cleanup paths keep
# AWX tidy:
#
#   delete_workflow_clone — fired by JobMonitor as soon as the workflow_job
#       reaches a terminal status. Single shot, idempotent (404 from AWX is
#       treated as success).
#
#   cleanup_orphaned_workflow_clones — hourly safety net. Sweeps any clone
#       whose deletion hook missed (worker crash, AWX outage, etc).

# Reaper threshold — how stale must an orphan be before deletion. Must exceed
# the longest reasonable workflow runtime so we never delete a clone whose
# workflow_job is still running but somehow lost its DB binding. 1 hour is
# generous for typical ACI playbooks; tune via env if you have multi-hour
# workflows.
_CLONE_REAPER_AGE_SECONDS = 3600


@shared_task(
    name='awx.delete_workflow_clone',
    soft_time_limit=30,
    time_limit=60,
    max_retries=0,  # idempotent + reaper is the safety net
)
def delete_workflow_clone(execution_id: str) -> Dict[str, Any]:
    """Delete the ephemeral workflow_job_template clone bound to an execution.

    Called once per workflow execution after JobMonitor sees terminal status.
    A no-op for executions without a clone (job-template runs, or already
    cleaned). Failures are logged — the orphan reaper will catch them.
    """
    from awx.services.awx_client import AWXClient

    try:
        execution = AutomationExecution.objects.select_related('awx_connection').get(
            id=execution_id,
        )
    except AutomationExecution.DoesNotExist:
        logger.warning(f'delete_workflow_clone: execution {execution_id} not found')
        return {'status': 'not_found'}

    clone_id = execution.clone_template_id
    if not clone_id:
        return {'status': 'no_clone'}

    try:
        client = AWXClient.for_connection(execution.awx_connection)
    except Exception as e:
        logger.warning(
            f'delete_workflow_clone: failed to build AWX client (execution {execution_id}): {e}'
        )
        return {'status': 'client_error', 'clone_id': clone_id}

    ok, err = client.delete_workflow_template(clone_id)
    if ok:
        AutomationExecution.objects.filter(id=execution_id).update(
            clone_template_id=None,
        )
        logger.info(f'Deleted workflow clone {clone_id} for execution {execution_id}')
        return {'status': 'deleted', 'clone_id': clone_id}

    logger.warning(
        f'Failed to delete clone {clone_id} (execution {execution_id}): {err}. Reaper will retry.'
    )
    return {'status': 'delete_failed', 'clone_id': clone_id, 'error': err}


@shared_task(
    name='awx.cleanup_orphaned_workflow_clones',
    soft_time_limit=300,
    time_limit=360,
)
def cleanup_orphaned_workflow_clones() -> Dict[str, Any]:
    """Sweep ephemeral workflow_job_template clones the immediate hook missed.

    For each AWX connection, lists templates by Fabrik's clone prefix, then
    deletes any that are both:
      - older than _CLONE_REAPER_AGE_SECONDS, AND
      - not currently bound to an active AutomationExecution.

    The age check guards against deleting a clone whose workflow_job is still
    running but whose DB binding is stale. The active-binding check guards
    against deleting an in-flight launch. Together these are sufficient to
    make the reaper safe to run hourly without coordination with the live
    launch path.
    """
    from datetime import timedelta
    from django.utils.dateparse import parse_datetime

    from awx.models import AWXConnection
    from awx.services.awx_client import AWXClient
    from awx.services.execution_engine import _CLONE_NAME_PREFIX

    threshold = timezone.now() - timedelta(seconds=_CLONE_REAPER_AGE_SECONDS)
    stats: Dict[str, Any] = {
        'connections': 0,
        'inspected': 0,
        'deleted': 0,
        'skipped': 0,
        'errors': 0,
    }

    active_clone_ids = set(
        AutomationExecution.objects.exclude(clone_template_id=None).values_list(
            'clone_template_id', flat=True
        )
    )

    for conn in AWXConnection.objects.all():
        stats['connections'] += 1
        try:
            client = AWXClient.for_connection(conn)
            ok, templates, err = client.list_workflow_templates_by_prefix(
                _CLONE_NAME_PREFIX,
            )
            if not ok:
                logger.warning(
                    f'Reaper: list_workflow_templates_by_prefix failed on {conn.name}: {err}'
                )
                stats['errors'] += 1
                continue

            for tpl in templates:
                stats['inspected'] += 1
                tpl_id = tpl.get('id')
                if tpl_id is None:
                    stats['skipped'] += 1
                    continue
                if tpl_id in active_clone_ids:
                    stats['skipped'] += 1
                    continue

                created_str = tpl.get('created')
                created = parse_datetime(created_str) if created_str else None
                if created and created > threshold:
                    stats['skipped'] += 1
                    continue

                ok, err = client.delete_workflow_template(tpl_id)
                if ok:
                    stats['deleted'] += 1
                    logger.info(f'Reaper: deleted orphan clone {tpl_id} on {conn.name}')
                else:
                    stats['errors'] += 1
                    logger.warning(f'Reaper: delete clone {tpl_id} on {conn.name} failed: {err}')
        except Exception as e:
            stats['errors'] += 1
            logger.exception(f'Reaper: connection {conn.name} failed: {e}')

    logger.info(f'Workflow clone reaper finished: {stats}')
    return stats
