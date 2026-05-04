"""
Django management command to run RabbitMQ event consumer

Consumes events from RabbitMQ queues and processes them

Usage:
    python manage.py run_event_consumer --queue awx.job.status
    python manage.py run_event_consumer --queue awx.workflow.status
    python manage.py run_event_consumer --all  # Run all consumers in threads
"""

import os
import sys
import signal
import threading
import logging
import json
import time
from typing import Dict, Any

import pika
from pika.exceptions import AMQPConnectionError
from django.core.management.base import BaseCommand
from django.utils import timezone

from awx.models import AutomationExecution, AutomationRequest
from awx.services.websocket_service import get_websocket_service

logger = logging.getLogger(__name__)


class EventConsumer:
    """
    RabbitMQ event consumer with automatic reconnection
    """

    def __init__(self, queue_name: str):
        self.queue_name = queue_name
        self.rabbitmq_url = os.getenv('RABBITMQ_URL', '')
        self.connection = None
        self.channel = None
        self.should_stop = False

        # Prefetch count (process N messages at a time)
        self.prefetch_count = 10

        logger.info(f"Event consumer initialized for queue: {queue_name}")

    # Exchange → queue binding map
    # routing_key pattern → queue_name
    QUEUE_BINDINGS = {
        'awx.job.status': ('awx.events', 'job.status.*'),
        'awx.workflow.status': ('awx.events', 'workflow.status.*'),
        'awx.job.output': ('awx.events', 'job.output.*'),
    }

    def connect(self, max_retries=5):
        """Connect to RabbitMQ with retry logic"""
        retry_delay = 2  # seconds

        for attempt in range(max_retries):
            try:
                parameters = pika.URLParameters(self.rabbitmq_url)
                parameters.heartbeat = 60
                parameters.blocked_connection_timeout = 120

                self.connection = pika.BlockingConnection(parameters)
                self.channel = self.connection.channel()

                # Declare exchange and queue, then bind (idempotent)
                exchange_name, routing_key = self.QUEUE_BINDINGS.get(
                    self.queue_name, ('', self.queue_name)
                )
                if exchange_name:
                    self.channel.exchange_declare(
                        exchange=exchange_name,
                        exchange_type='topic',
                        durable=True
                    )
                self.channel.queue_declare(
                    queue=self.queue_name,
                    durable=True
                )
                if exchange_name:
                    self.channel.queue_bind(
                        queue=self.queue_name,
                        exchange=exchange_name,
                        routing_key=routing_key
                    )

                # Set QoS - process N messages at a time
                self.channel.basic_qos(prefetch_count=self.prefetch_count)

                logger.info(f"Connected to RabbitMQ for queue: {self.queue_name} (attempt {attempt + 1})")
                return

            except (AMQPConnectionError, Exception) as e:
                logger.warning(
                    f"Failed to connect to RabbitMQ (attempt {attempt + 1}/{max_retries}): {str(e)}"
                )

                # Explicitly close any partially-opened connection to prevent FD leaks
                try:
                    if self.connection and not self.connection.is_closed:
                        self.connection.close()
                except Exception:
                    pass
                self.connection = None
                self.channel = None

                if attempt < max_retries - 1:
                    logger.info(f"Retrying in {retry_delay} seconds...")
                    time.sleep(retry_delay)
                    retry_delay *= 2  # Exponential backoff
                else:
                    logger.error(f"Failed to connect after {max_retries} attempts")
                    raise

    def start_consuming(self):
        """Start consuming messages from queue"""

        try:
            self.connect()

            # Set up consumer
            self.channel.basic_consume(
                queue=self.queue_name,
                on_message_callback=self.on_message,
                auto_ack=False  # Manual acknowledgment for reliability
            )

            logger.info(f"Started consuming from queue: {self.queue_name}")
            logger.info("Press Ctrl+C to stop...")

            # Start consuming (blocks until stopped)
            self.channel.start_consuming()

        except KeyboardInterrupt:
            logger.info("Stopping consumer...")
            self.stop()
        except Exception as e:
            logger.exception(f"Error in consumer: {str(e)}")
            self.reconnect()

    def on_message(self, channel, method, properties, body):
        """
        Handle incoming message

        Args:
            channel: pika channel
            method: delivery method
            properties: message properties
            body: message body (JSON)
        """

        try:
            # Parse JSON
            message = json.loads(body)
            event_data = message.get('data', {})
            metadata = message.get('metadata', {})

            logger.info(
                f"Processing event: routing_key={method.routing_key}, "
                f"correlation_id={metadata.get('correlation_id')}"
            )

            # Process event based on queue
            if self.queue_name == 'awx.job.status':
                self.process_job_status_event(event_data, metadata)
            elif self.queue_name == 'awx.workflow.status':
                self.process_workflow_status_event(event_data, metadata)
            elif self.queue_name == 'awx.job.output':
                self.process_job_output_event(event_data, metadata)
            else:
                logger.warning(f"Unknown queue: {self.queue_name}")

            # Acknowledge message (success)
            channel.basic_ack(delivery_tag=method.delivery_tag)

            logger.debug(f"Event processed successfully: {method.routing_key}")

        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON in message: {str(e)}")
            # Reject and don't requeue (send to DLQ)
            channel.basic_nack(delivery_tag=method.delivery_tag, requeue=False)

        except Exception as e:
            logger.exception(f"Error processing message: {str(e)}")

            # Check retry count from message headers
            headers = properties.headers or {} if properties.headers else {}
            retry_count = headers.get('x-retry-count', 0)

            if retry_count >= 3:
                logger.error(f"Message exceeded max retries ({retry_count}), sending to DLQ")
                channel.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
            else:
                # Nack without requeue, then republish with incremented retry count
                channel.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
                new_headers = dict(headers)
                new_headers['x-retry-count'] = retry_count + 1
                channel.basic_publish(
                    exchange='',
                    routing_key=self.queue_name,
                    body=body,
                    properties=pika.BasicProperties(
                        headers=new_headers,
                        delivery_mode=2,
                    )
                )

    def process_job_status_event(self, event_data: Dict[str, Any], metadata: Dict[str, Any]):
        """
        Process job status change event

        Updates execution record and notifies via WebSocket
        """

        try:
            awx_job_id = event_data.get('awx_job_id')
            new_status = event_data.get('status')
            execution_id = event_data.get('execution_id')

            if not awx_job_id:
                logger.warning("Missing awx_job_id in event")
                return

            # Find execution by AWX job ID
            try:
                if execution_id:
                    execution = AutomationExecution.objects.get(id=execution_id)
                else:
                    execution = AutomationExecution.objects.get(awx_job_id=awx_job_id)
            except AutomationExecution.DoesNotExist:
                logger.warning(f"Execution not found for AWX job {awx_job_id}")
                return
            except AutomationExecution.MultipleObjectsReturned:
                logger.warning(f"Multiple executions found for AWX job {awx_job_id}")
                execution = AutomationExecution.objects.filter(awx_job_id=awx_job_id).first()

            # Map AWX status to Fabrik status
            status_mapping = {
                'pending': 'pending',
                'waiting': 'pending',
                'running': 'running',
                'successful': 'successful',
                'failed': 'failed',
                'error': 'failed',
                'canceled': 'canceled',
            }

            fabrik_status = status_mapping.get(new_status, 'running')

            # Update execution
            execution.status = fabrik_status

            # Terminal status handling
            terminal_statuses = ['successful', 'failed', 'error', 'canceled']
            if new_status in terminal_statuses:
                execution.finished_at = timezone.now()

                if execution.started_at:
                    elapsed = (execution.finished_at - execution.started_at).total_seconds()
                    execution.elapsed_seconds = int(elapsed)

                # Update request status
                request = execution.automation_request
                if fabrik_status == 'successful':
                    request.status = AutomationRequest.STATUS_SUCCESSFUL
                elif fabrik_status in ['failed', 'error']:
                    request.status = AutomationRequest.STATUS_FAILED
                elif fabrik_status == 'canceled':
                    request.status = AutomationRequest.STATUS_CANCELLED
                request.save()

            execution.save()

            # Emit WebSocket update
            try:
                ws_service = get_websocket_service()
                from awx.serializers import AutomationExecutionSerializer
                import uuid

                serialized_data = AutomationExecutionSerializer(execution).data

                # Convert UUID objects to strings for JSON serialization
                def convert_uuids(obj):
                    if isinstance(obj, dict):
                        return {k: convert_uuids(v) for k, v in obj.items()}
                    elif isinstance(obj, list):
                        return [convert_uuids(item) for item in obj]
                    elif isinstance(obj, uuid.UUID):
                        return str(obj)
                    return obj

                serialized_data = convert_uuids(serialized_data)

                ws_service.emit_execution_update(
                    str(execution.automation_request_id),
                    serialized_data
                )

                ws_service.emit_execution_status(
                    str(execution.id),
                    execution.status,
                    execution.awx_job_id,
                    execution.result_traceback,  # Use result_traceback instead of error_message
                    execution.finished_at.isoformat() if execution.finished_at else None
                )

            except Exception as ws_error:
                logger.warning(f"WebSocket update failed: {str(ws_error)}")

            logger.info(
                f"Job status updated: job_id={awx_job_id}, "
                f"execution_id={execution.id}, status={fabrik_status}"
            )

        except Exception as e:
            logger.exception(f"Error processing job status event: {str(e)}")
            raise

    def process_workflow_status_event(self, event_data: Dict[str, Any], metadata: Dict[str, Any]):
        """
        Process workflow status change event

        Similar to job status but for workflows
        """

        try:
            workflow_job_id = event_data.get('workflow_job_id') or event_data.get('awx_job_id')
            new_status = event_data.get('status')
            execution_id = event_data.get('execution_id')

            if not workflow_job_id:
                logger.warning("Missing workflow_job_id in event")
                return

            # Find execution
            try:
                if execution_id:
                    execution = AutomationExecution.objects.get(id=execution_id)
                else:
                    execution = AutomationExecution.objects.get(awx_job_id=workflow_job_id)
            except AutomationExecution.DoesNotExist:
                logger.warning(f"Execution not found for workflow {workflow_job_id}")
                return

            # Update status (same logic as job status)
            status_mapping = {
                'pending': 'pending',
                'waiting': 'pending',
                'running': 'running',
                'successful': 'successful',
                'failed': 'failed',
                'error': 'failed',
                'canceled': 'canceled',
            }

            fabrik_status = status_mapping.get(new_status, 'running')
            execution.status = fabrik_status

            # Terminal status handling
            terminal_statuses = ['successful', 'failed', 'error', 'canceled']
            if new_status in terminal_statuses:
                execution.finished_at = timezone.now()

                if execution.started_at:
                    elapsed = (execution.finished_at - execution.started_at).total_seconds()
                    execution.elapsed_seconds = int(elapsed)

                # Update request status
                request = execution.automation_request
                if fabrik_status == 'successful':
                    request.status = AutomationRequest.STATUS_SUCCESSFUL
                elif fabrik_status in ['failed', 'error']:
                    request.status = AutomationRequest.STATUS_FAILED
                elif fabrik_status == 'canceled':
                    request.status = AutomationRequest.STATUS_CANCELLED
                request.save()

            execution.save()

            # Emit WebSocket update
            try:
                ws_service = get_websocket_service()
                from awx.serializers import AutomationExecutionSerializer
                import uuid

                serialized_data = AutomationExecutionSerializer(execution).data

                # Convert UUID objects to strings for JSON serialization
                def convert_uuids(obj):
                    if isinstance(obj, dict):
                        return {k: convert_uuids(v) for k, v in obj.items()}
                    elif isinstance(obj, list):
                        return [convert_uuids(item) for item in obj]
                    elif isinstance(obj, uuid.UUID):
                        return str(obj)
                    return obj

                serialized_data = convert_uuids(serialized_data)

                ws_service.emit_execution_update(
                    str(execution.automation_request_id),
                    serialized_data
                )

            except Exception as ws_error:
                logger.warning(f"WebSocket update failed: {str(ws_error)}")

            logger.info(
                f"Workflow status updated: workflow_id={workflow_job_id}, "
                f"execution_id={execution.id}, status={fabrik_status}"
            )

        except Exception as e:
            logger.exception(f"Error processing workflow status event: {str(e)}")
            raise

    def process_job_output_event(self, event_data: Dict[str, Any], metadata: Dict[str, Any]):
        """
        Process job output chunk (Phase 2)

        Stores output in database and broadcasts via WebSocket
        """
        try:
            from awx.models import JobOutputChunk
            from dateutil import parser as date_parser

            awx_job_id = event_data.get('awx_job_id')
            execution_id = event_data.get('execution_id')
            counter = event_data.get('counter')

            if not all([awx_job_id, execution_id, counter is not None]):
                logger.warning("Missing required fields in job output event")
                return

            # Find execution
            try:
                execution = AutomationExecution.objects.get(id=execution_id)
            except AutomationExecution.DoesNotExist:
                logger.warning(f"Execution not found: {execution_id}")
                return

            # Parse timestamp
            awx_created_str = event_data.get('created')
            awx_created = timezone.now()
            if awx_created_str:
                try:
                    awx_created = date_parser.parse(awx_created_str)
                    if awx_created.tzinfo is None:
                        awx_created = timezone.make_aware(awx_created)
                except Exception:
                    pass

            # Create or update output chunk
            chunk, created = JobOutputChunk.objects.update_or_create(
                execution=execution,
                counter=counter,
                defaults={
                    'awx_job_id': awx_job_id,
                    'event_type': event_data.get('event_type', 'unknown'),
                    'stdout': event_data.get('stdout', ''),
                    'stderr': event_data.get('stderr', ''),
                    'event_data': {
                        'task': event_data.get('task', ''),
                        'play': event_data.get('play', ''),
                        'role': event_data.get('role', ''),
                        'host_name': event_data.get('host_name', ''),
                    },
                    'awx_created': awx_created,
                }
            )

            # Broadcast via WebSocket
            try:
                ws_service = get_websocket_service()
                import uuid

                # Convert UUIDs to strings
                def convert_uuids(obj):
                    if isinstance(obj, dict):
                        return {k: convert_uuids(v) for k, v in obj.items()}
                    elif isinstance(obj, list):
                        return [convert_uuids(item) for item in obj]
                    elif isinstance(obj, uuid.UUID):
                        return str(obj)
                    return obj

                output_data = {
                    'counter': counter,
                    'stdout': chunk.stdout,
                    'stderr': chunk.stderr,
                    'event_type': chunk.event_type,
                    'timestamp': awx_created.isoformat(),
                    'event_data': convert_uuids(chunk.event_data),
                    'awx_job_id': awx_job_id,
                }

                ws_service.emit_execution_output(
                    str(execution.id),
                    output_data
                )
            except Exception as ws_error:
                logger.warning(f"WebSocket update failed: {str(ws_error)}")

            action = "Created" if created else "Updated"
            logger.debug(
                f"{action} output chunk {counter} for job {awx_job_id} "
                f"(execution {execution_id})"
            )

        except Exception as e:
            logger.exception(f"Error processing job output event: {str(e)}")
            raise

    def reconnect(self):
        """Reconnect to RabbitMQ after connection loss"""

        retry_delay = 5  # seconds

        while not self.should_stop:
            # Close any leftover connections before reconnecting
            try:
                if self.connection and not self.connection.is_closed:
                    self.connection.close()
            except Exception:
                pass
            self.connection = None
            self.channel = None

            try:
                logger.info(f"Attempting to reconnect in {retry_delay} seconds...")
                time.sleep(retry_delay)

                self.connect()
                self.start_consuming()
                break

            except Exception as e:
                logger.error(f"Reconnection failed: {str(e)}")
                retry_delay = min(retry_delay * 2, 60)  # Exponential backoff (max 60s)

    def stop(self):
        """Stop consuming"""

        self.should_stop = True

        try:
            if self.channel and not self.channel.is_closed:
                self.channel.stop_consuming()

            if self.connection and not self.connection.is_closed:
                self.connection.close()

            logger.info("Consumer stopped")

        except Exception as e:
            logger.exception(f"Error stopping consumer: {str(e)}")


class Command(BaseCommand):
    help = 'Run RabbitMQ event consumer'

    def add_arguments(self, parser):
        parser.add_argument(
            '--queue',
            type=str,
            help='Queue name to consume from (awx.job.status, awx.workflow.status, awx.job.output)'
        )
        parser.add_argument(
            '--all',
            action='store_true',
            help='Run all consumers in separate threads'
        )

    def handle(self, *args, **options):
        """Execute command"""

        queue_name = options.get('queue')
        run_all = options.get('all')

        if run_all:
            self.run_all_consumers()
        elif queue_name:
            self.run_single_consumer(queue_name)
        else:
            self.stdout.write(self.style.ERROR(
                'Please specify --queue <name> or --all'
            ))
            sys.exit(1)

    def run_single_consumer(self, queue_name: str):
        """Run single consumer"""

        self.stdout.write(self.style.SUCCESS(
            f'Starting event consumer for queue: {queue_name}'
        ))

        consumer = EventConsumer(queue_name)

        # Handle Ctrl+C 
        def signal_handler(sig, frame):
            self.stdout.write(self.style.WARNING('\nStopping consumer...'))
            consumer.stop()
            sys.exit(0)

        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)

        consumer.start_consuming()

    def run_all_consumers(self):
        """Run all consumers in separate threads"""

        self.stdout.write(self.style.SUCCESS(
            'Starting all event consumers in threads...'
        ))

        queues = [
            'awx.job.status',
            'awx.workflow.status',
            'awx.job.output',  # Phase 2: Real-time output streaming
        ]

        consumers = []
        threads = []

        # Create consumers
        for queue_name in queues:
            consumer = EventConsumer(queue_name)
            consumers.append(consumer)

            # Start in thread
            thread = threading.Thread(
                target=consumer.start_consuming,
                name=f"consumer-{queue_name}",
                daemon=False
            )
            threads.append(thread)
            thread.start()

            self.stdout.write(self.style.SUCCESS(
                f'✓ Consumer started for queue: {queue_name}'
            ))

        # Handle Ctrl+C 
        def signal_handler(sig, frame):
            self.stdout.write(self.style.WARNING('\nStopping all consumers...'))
            for consumer in consumers:
                consumer.stop()
            sys.exit(0)

        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)

        # Wait for all threads
        for thread in threads:
            thread.join()
