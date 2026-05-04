"""
Django management command to seed system tasks

Seeds enterprise-grade system maintenance tasks into ScheduledTask model.
System tasks are managed by platform admins and handle automated operations:
- Storage cleanup and compression
- Health monitoring
- Snapshot management
- External system sync

Usage:
    python manage.py seed_system_tasks
    python manage.py seed_system_tasks --reset  # Delete existing and re-seed
"""

from django.core.management.base import BaseCommand
from datetime import time

from queries.models import ScheduledTask


class Command(BaseCommand):
    help = 'Seed system tasks for automated platform maintenance'

    def add_arguments(self, parser):
        parser.add_argument(
            '--reset',
            action='store_true',
            help='Delete existing system tasks before seeding'
        )

    def handle(self, *args, **options):
        """Execute command"""

        reset = options.get('reset', False)

        if reset:
            self.stdout.write(self.style.WARNING('Deleting existing system tasks...'))
            deleted_count = ScheduledTask.objects.filter(is_system_task=True).delete()[0]
            self.stdout.write(self.style.SUCCESS(f'Deleted {deleted_count} system tasks'))

        self.stdout.write(self.style.SUCCESS('Seeding system tasks...'))

        # System tasks definition
        system_tasks = [
            # ============================================================================
            # Storage Management (system_maintenance)
            # ============================================================================
            {
                'name': 'Cleanup Old AWX Output Chunks',
                'description': 'Delete JobOutputChunk records older than 90 days to manage storage. '
                               'Enterprise retention policy: logs are automatically cleaned up after 90 days.',
                'task_type': ScheduledTask.TASK_TYPE_SYSTEM_MAINTENANCE,
                'category': 'Storage Management',
                'system_task_handler': 'awx.cleanup_old_output_chunks',
                'frequency': ScheduledTask.FREQ_DAILY,
                'time_of_day': time(3, 0),  # 3:00 AM
                'priority': ScheduledTask.PRIORITY_LOW,
                'order': 1,
            },
            {
                'name': 'Compress Old AWX Outputs',
                'description': 'Gzip compress stdout/stderr for JobOutputChunk records 30-90 days old. '
                               'Saves ~70-80% storage while keeping data accessible.',
                'task_type': ScheduledTask.TASK_TYPE_SYSTEM_MAINTENANCE,
                'category': 'Storage Management',
                'system_task_handler': 'awx.compress_old_output_chunks',
                'frequency': ScheduledTask.FREQ_DAILY,
                'time_of_day': time(4, 0),  # 4:00 AM
                'priority': ScheduledTask.PRIORITY_LOW,
                'order': 2,
            },

            # ============================================================================
            # Snapshot Management (system_snapshot)
            # ============================================================================
            {
                'name': 'Cleanup Time Machine Snapshots',
                'description': 'Delete Time Machine snapshots based on retention policies (7/30/90 days, 1 year). '
                               'Runs daily at 3:30 AM.',
                'task_type': ScheduledTask.TASK_TYPE_SYSTEM_SNAPSHOT,
                'category': 'Snapshot Management',
                'system_task_handler': 'queries.cleanup_time_machine_snapshots',
                'frequency': ScheduledTask.FREQ_DAILY,
                'time_of_day': time(3, 30),  # 3:30 AM
                'priority': ScheduledTask.PRIORITY_LOW,
                'order': 1,
            },
        ]

        created_count = 0
        updated_count = 0

        for task_data in system_tasks:
            # Check if task exists (by handler)
            handler = task_data['system_task_handler']
            existing_task = ScheduledTask.objects.filter(
                system_task_handler=handler
            ).first()

            if existing_task:
                # Update existing task
                for key, value in task_data.items():
                    setattr(existing_task, key, value)

                existing_task.is_system_task = True
                existing_task.status = ScheduledTask.STATUS_ACTIVE
                existing_task.timezone = 'UTC'

                # Recalculate next_run_at (using model method)
                existing_task.next_run_at = existing_task.calculate_next_run()

                existing_task.save()

                updated_count += 1
                self.stdout.write(
                    self.style.WARNING(f'  Updated: {existing_task.name}')
                )
            else:
                # Create new task
                task = ScheduledTask.objects.create(
                    **task_data,
                    is_system_task=True,
                    status=ScheduledTask.STATUS_ACTIVE,
                    timezone='UTC',
                    created_by=None,  # System task has no creator
                    saved_query=None,  # System task has no query
                )

                # Calculate initial next_run_at (using model method)
                task.next_run_at = task.calculate_next_run()
                task.save(update_fields=['next_run_at'])

                created_count += 1
                self.stdout.write(
                    self.style.SUCCESS(f'  Created: {task.name}')
                )

        self.stdout.write(self.style.SUCCESS(
            f'\n✅ Seeding completed: {created_count} created, {updated_count} updated'
        ))

        # Summary by category
        self.stdout.write(self.style.SUCCESS('\nSystem Tasks by Category:'))
        for category in ['Storage Management', 'Snapshot Management']:
            count = ScheduledTask.objects.filter(
                is_system_task=True,
                category=category
            ).count()
            self.stdout.write(f'  - {category}: {count} tasks')
