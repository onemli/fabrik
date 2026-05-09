"""
Django management command to set up RabbitMQ topology

Creates exchanges, queues, and bindings for AWX webhook event system

Usage:
    python manage.py setup_rabbitmq
"""

import os
import sys
import pika
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Set up RabbitMQ topology (exchanges, queues, bindings) for AWX webhooks'

    def add_arguments(self, parser):
        parser.add_argument(
            '--rabbitmq-url',
            type=str,
            default=None,
            help='RabbitMQ connection URL (default: from RABBITMQ_URL env var)',
        )
        parser.add_argument(
            '--recreate', action='store_true', help='Delete existing queues and recreate them'
        )

    def handle(self, *args, **options):
        """Execute command"""

        # Get RabbitMQ URL
        rabbitmq_url = options.get('rabbitmq_url') or os.getenv('RABBITMQ_URL')

        if not rabbitmq_url:
            self.stdout.write(
                self.style.ERROR(
                    'RabbitMQ URL not provided. Set RABBITMQ_URL environment variable or use --rabbitmq-url option.'
                )
            )
            sys.exit(1)

        self.stdout.write(self.style.SUCCESS(f'Connecting to RabbitMQ: {rabbitmq_url}'))

        try:
            # Parse connection URL
            parameters = pika.URLParameters(rabbitmq_url)

            # Connect to RabbitMQ
            connection = pika.BlockingConnection(parameters)
            channel = connection.channel()

            self.stdout.write(self.style.SUCCESS('✓ Connected to RabbitMQ'))

            # --- EXCHANGES ---
            self.stdout.write(self.style.MIGRATE_HEADING('\n=== Creating Exchanges ==='))

            # Main event exchange (topic)
            exchange_name = 'awx.events'
            channel.exchange_declare(exchange=exchange_name, exchange_type='topic', durable=True)
            self.stdout.write(
                self.style.SUCCESS(f'✓ Exchange created: {exchange_name} (type: topic)')
            )

            # --- QUEUES ---
            self.stdout.write(self.style.MIGRATE_HEADING('\n=== Creating Queues ==='))

            queues = [
                {
                    'name': 'awx.job.status',
                    'routing_key': 'job.status.#',
                    'description': 'Job template status updates (pending, running, successful, failed)',
                },
                {
                    'name': 'awx.workflow.status',
                    'routing_key': 'workflow.status.#',
                    'description': 'Workflow job status updates',
                },
                {
                    'name': 'awx.job.output',
                    'routing_key': 'job.output.#',
                    'description': 'Job stdout/stderr output chunks (Phase 2)',
                },
            ]

            for queue_info in queues:
                queue_name = queue_info['name']
                routing_key = queue_info['routing_key']

                # Optionally delete existing queue
                if options.get('recreate'):
                    try:
                        channel.queue_delete(queue=queue_name)
                        self.stdout.write(f'  - Deleted existing queue: {queue_name}')
                    except Exception:
                        pass

                # Declare queue
                channel.queue_declare(
                    queue=queue_name,
                    durable=True,
                    arguments={
                        'x-message-ttl': 86400000,  # 24 hours TTL
                        'x-max-length': 100000,  # Max 100k messages
                    },
                )

                # Bind queue to exchange
                channel.queue_bind(
                    exchange=exchange_name, queue=queue_name, routing_key=routing_key
                )

                self.stdout.write(
                    self.style.SUCCESS(
                        f'✓ Queue: {queue_name}\n'
                        f'    Routing: {routing_key}\n'
                        f'    Description: {queue_info["description"]}'
                    )
                )

            # --- DEAD LETTER QUEUE (for failed messages) ---
            self.stdout.write(self.style.MIGRATE_HEADING('\n=== Creating Dead Letter Queue ==='))

            dlq_exchange = 'awx.events.dlx'
            dlq_queue = 'awx.events.dead_letter'

            # DLX exchange
            channel.exchange_declare(exchange=dlq_exchange, exchange_type='topic', durable=True)
            self.stdout.write(self.style.SUCCESS(f'✓ DLX Exchange: {dlq_exchange}'))

            # DLQ queue
            channel.queue_declare(queue=dlq_queue, durable=True)
            channel.queue_bind(exchange=dlq_exchange, queue=dlq_queue, routing_key='#')
            self.stdout.write(self.style.SUCCESS(f'✓ DLQ Queue: {dlq_queue}'))

            # Close connection
            connection.close()

            # --- SUMMARY ---
            self.stdout.write(self.style.MIGRATE_HEADING('\n=== Setup Complete ==='))
            self.stdout.write(
                self.style.SUCCESS(
                    f'\nRabbitMQ topology set up successfully!\n\n'
                    f'Exchanges:\n'
                    f'  - {exchange_name} (topic)\n'
                    f'  - {dlq_exchange} (DLX)\n\n'
                    f'Queues:\n'
                    f'  - awx.job.status (job template status updates)\n'
                    f'  - awx.workflow.status (workflow status updates)\n'
                    f'  - awx.job.output (stdout/stderr streaming - Phase 2)\n'
                    f'  - {dlq_queue} (dead letter queue)\n\n'
                    f'Management UI: http://localhost:15672\n'
                )
            )

        except pika.exceptions.AMQPConnectionError as e:
            self.stdout.write(
                self.style.ERROR(
                    f'Failed to connect to RabbitMQ: {str(e)}\n'
                    f'Make sure RabbitMQ is running: docker compose up -d rabbitmq'
                )
            )
            sys.exit(1)
        except Exception as e:
            self.stdout.write(self.style.ERROR(f'Error setting up RabbitMQ: {str(e)}'))
            sys.exit(1)
