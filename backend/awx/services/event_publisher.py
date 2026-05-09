# awx/services/event_publisher.py
#
# Publishes AWX job events to RabbitMQ so other consumers (e.g., the
# WebSocket broadcaster) can pick them up without tight coupling to the poller.
#
# The circuit breaker trips after repeated publish failures and blocks further
# attempts for a cooldown period — this prevents a broken RabbitMQ from making
# every job event poll slow (the poller would otherwise wait for each publish
# timeout). After the cooldown, one probe attempt is made; if it succeeds the
# breaker closes again.
#
# A module-level singleton is returned by get_event_publisher() so all Celery
# workers in the same process share one connection pool.

import os
import logging
import json
import time
import threading
from typing import Dict, Any, Optional, Tuple
from datetime import datetime
from contextlib import contextmanager

import pika
from pika.exceptions import AMQPConnectionError, AMQPChannelError

logger = logging.getLogger(__name__)


class CircuitBreaker:
    """Three-state circuit breaker for RabbitMQ publish operations.

    CLOSED → normal operation, failures counted.
    OPEN   → breaker tripped; all publish calls return immediately.
    HALF_OPEN → cooldown expired; one probe attempt allowed.
    """

    CLOSED = 'closed'
    OPEN = 'open'
    HALF_OPEN = 'half_open'

    def __init__(self, failure_threshold: int = 5, timeout: int = 60):
        self.failure_threshold = failure_threshold
        self.timeout = timeout  # seconds to wait before trying again
        self.failure_count = 0
        self.last_failure_time = None
        self.state = self.CLOSED
        self._lock = threading.Lock()

    def call(self, func, *args, **kwargs):
        """Execute function with circuit breaker protection"""
        with self._lock:
            if self.state == self.OPEN:
                if self._should_attempt_reset():
                    self.state = self.HALF_OPEN
                    logger.info('Circuit breaker: OPEN -> HALF_OPEN')
                else:
                    raise Exception(f'Circuit breaker is OPEN. Wait {self.timeout}s.')

        try:
            result = func(*args, **kwargs)
            with self._lock:
                if self.state == self.HALF_OPEN:
                    self.state = self.CLOSED
                    self.failure_count = 0
                    logger.info('Circuit breaker: HALF_OPEN -> CLOSED')
            return result
        except Exception:
            with self._lock:
                self.failure_count += 1
                self.last_failure_time = time.time()

                if self.failure_count >= self.failure_threshold:
                    self.state = self.OPEN
                    logger.error(
                        f'Circuit breaker: CLOSED -> OPEN after {self.failure_count} failures'
                    )
            raise

    def _should_attempt_reset(self) -> bool:
        """Check if enough time has passed to try again"""
        return (time.time() - self.last_failure_time) >= self.timeout


class RabbitMQPublisher:
    """
    Production-grade RabbitMQ event publisher

    Features:
    - Connection pooling
    - Automatic reconnection
    - Retry with exponential backoff
    - Circuit breaker
    - Thread-safe
    """

    def __init__(self):
        self.rabbitmq_url = os.getenv('RABBITMQ_URL', '')
        self.exchange_name = 'awx.events'

        self._connection = None
        self._channel = None
        self._lock = threading.Lock()
        self._circuit_breaker = CircuitBreaker(failure_threshold=5, timeout=60)

        # Connection pool settings
        self._heartbeat = 60  # 1 minute - detect dead connections faster
        self._blocked_connection_timeout = 120  # 2 minutes

        logger.info(f'RabbitMQ Publisher initialized: {self._mask_url(self.rabbitmq_url)}')

    def _mask_url(self, url: str) -> str:
        """Mask password in URL for logging"""
        try:
            parts = url.split('@')
            if len(parts) == 2:
                user_pass = parts[0].split('//')[-1]
                if ':' in user_pass:
                    user = user_pass.split(':')[0]
                    return url.replace(user_pass, f'{user}:****')
            return url
        except Exception:
            return '***masked***'

    @contextmanager
    def _get_channel(self):
        """
        Context manager for thread-safe channel access
        Automatically reconnects if connection is lost
        """
        with self._lock:
            if not self._connection or self._connection.is_closed:
                self._connect()

            if not self._channel or self._channel.is_closed:
                self._channel = self._connection.channel()

            yield self._channel

    def _connect(self):
        """Establish connection to RabbitMQ with retry logic"""
        max_retries = 3
        retry_delay = 1  # seconds

        for attempt in range(max_retries):
            try:
                parameters = pika.URLParameters(self.rabbitmq_url)
                parameters.heartbeat = self._heartbeat
                parameters.blocked_connection_timeout = self._blocked_connection_timeout

                self._connection = pika.BlockingConnection(parameters)
                self._channel = self._connection.channel()

                # Auto-declare exchange so it exists before first publish
                self._channel.exchange_declare(
                    exchange=self.exchange_name,
                    exchange_type='topic',
                    durable=True,
                )

                logger.info(f'Connected to RabbitMQ (attempt {attempt + 1}/{max_retries})')
                return

            except AMQPConnectionError as e:
                logger.warning(
                    f'Failed to connect to RabbitMQ (attempt {attempt + 1}/{max_retries}): {str(e)}'
                )

                if attempt < max_retries - 1:
                    time.sleep(retry_delay * (2**attempt))  # Exponential backoff
                else:
                    raise

    def publish_event(
        self,
        routing_key: str,
        event_data: Dict[str, Any],
        correlation_id: Optional[str] = None,
        retry_count: int = 3,
    ) -> Tuple[bool, Optional[str]]:
        """
        Publish event to RabbitMQ with retry logic

        Args:
            routing_key: Routing key (e.g., 'job.status.successful')
            event_data: Event payload
            correlation_id: Optional correlation ID for tracking
            retry_count: Number of retry attempts

        Returns:
            (success: bool, error_message: Optional[str])
        """

        try:
            # Use circuit breaker to prevent cascading failures
            return self._circuit_breaker.call(
                self._publish_with_retry, routing_key, event_data, correlation_id, retry_count
            )
        except Exception as e:
            error_msg = f'Circuit breaker prevented publish: {str(e)}'
            logger.error(error_msg)
            return False, error_msg

    def _publish_with_retry(
        self,
        routing_key: str,
        event_data: Dict[str, Any],
        correlation_id: Optional[str],
        retry_count: int,
    ) -> Tuple[bool, Optional[str]]:
        """Internal method with retry logic"""

        last_error = None

        for attempt in range(retry_count):
            try:
                # Add metadata
                message = {
                    'data': event_data,
                    'metadata': {
                        'timestamp': datetime.utcnow().isoformat(),
                        'correlation_id': correlation_id,
                        'routing_key': routing_key,
                        'source': 'fabrik',
                        'version': '1.0',
                    },
                }

                # Serialize to JSON
                body = json.dumps(message)

                # Publish with channel context manager
                with self._get_channel() as channel:
                    channel.basic_publish(
                        exchange=self.exchange_name,
                        routing_key=routing_key,
                        body=body,
                        properties=pika.BasicProperties(
                            delivery_mode=2,  # Persistent
                            content_type='application/json',
                            correlation_id=correlation_id,
                            timestamp=int(time.time()),
                        ),
                    )

                logger.info(
                    f'Event published: routing_key={routing_key}, '
                    f'correlation_id={correlation_id}, attempt={attempt + 1}'
                )

                return True, None

            except (AMQPConnectionError, AMQPChannelError) as e:
                last_error = str(e)
                logger.warning(
                    f'Failed to publish event (attempt {attempt + 1}/{retry_count}): {last_error}'
                )

                # Reset connection on error
                with self._lock:
                    self._connection = None
                    self._channel = None

                if attempt < retry_count - 1:
                    time.sleep(0.5 * (2**attempt))  # Exponential backoff

            except Exception as e:
                last_error = str(e)
                logger.exception(f'Unexpected error publishing event: {last_error}')
                break

        return False, last_error

    def publish_job_status_event(
        self,
        job_id: int,
        status: str,
        execution_id: str,
        request_id: str,
        extra_data: Optional[Dict] = None,
    ) -> Tuple[bool, Optional[str]]:
        """
        Publish job status change event

        Routing key format: job.status.{status}
        Example: job.status.successful
        """

        event_data = {
            'event_type': 'job_status_change',
            'job_id': job_id,
            'status': status,
            'execution_id': execution_id,
            'request_id': request_id,
            **(extra_data or {}),
        }

        routing_key = f'job.status.{status}'
        correlation_id = execution_id

        return self.publish_event(routing_key, event_data, correlation_id)

    def publish_workflow_status_event(
        self,
        workflow_job_id: int,
        status: str,
        execution_id: str,
        request_id: str,
        extra_data: Optional[Dict] = None,
    ) -> Tuple[bool, Optional[str]]:
        """
        Publish workflow status change event

        Routing key format: workflow.status.{status}
        Example: workflow.status.successful
        """

        event_data = {
            'event_type': 'workflow_status_change',
            'workflow_job_id': workflow_job_id,
            'status': status,
            'execution_id': execution_id,
            'request_id': request_id,
            **(extra_data or {}),
        }

        routing_key = f'workflow.status.{status}'
        correlation_id = execution_id

        return self.publish_event(routing_key, event_data, correlation_id)

    def publish_job_output_event(
        self, job_id: int, output_chunk: str, execution_id: str, chunk_index: int = 0
    ) -> Tuple[bool, Optional[str]]:
        """
        Publish job output chunk (Phase 2)

        Routing key format: job.output.{job_id}
        """

        event_data = {
            'event_type': 'job_output_chunk',
            'job_id': job_id,
            'execution_id': execution_id,
            'chunk_index': chunk_index,
            'output': output_chunk,
        }

        routing_key = f'job.output.{job_id}'
        correlation_id = execution_id

        return self.publish_event(routing_key, event_data, correlation_id)

    def health_check(self) -> Dict[str, Any]:
        """
        Check RabbitMQ connection health

        Returns:
            Health status dictionary
        """
        try:
            with self._get_channel() as channel:
                # Try to declare queue (passive) to test connection
                channel.queue_declare('awx.job.status', passive=True)

            return {
                'status': 'healthy',
                'rabbitmq_connected': True,
                'circuit_breaker_state': self._circuit_breaker.state,
                'timestamp': datetime.utcnow().isoformat(),
            }
        except Exception as e:
            return {
                'status': 'unhealthy',
                'rabbitmq_connected': False,
                'circuit_breaker_state': self._circuit_breaker.state,
                'error': str(e),
                'timestamp': datetime.utcnow().isoformat(),
            }

    def close(self):
        """Close connection"""
        try:
            if self._channel and not self._channel.is_closed:
                self._channel.close()

            if self._connection and not self._connection.is_closed:
                self._connection.close()

            logger.info('RabbitMQ connection closed')
        except Exception as e:
            logger.exception(f'Error closing RabbitMQ connection: {str(e)}')


# Global singleton instance
_publisher_instance = None
_publisher_lock = threading.Lock()


def get_event_publisher() -> RabbitMQPublisher:
    """
    Get global RabbitMQ publisher instance (singleton pattern)
    Thread-safe initialization
    """
    global _publisher_instance

    if _publisher_instance is None:
        with _publisher_lock:
            if _publisher_instance is None:  # Double-check locking
                _publisher_instance = RabbitMQPublisher()

    return _publisher_instance
