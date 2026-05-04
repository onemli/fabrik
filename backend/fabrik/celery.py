# fabrik/celery.py
#
# Celery application configuration. Task routes send work to the right queues:
#   queue_exec    — on-demand APIC query executions (user-triggered)
#   scheduled     — scheduled task execution
#   awx_monitor   — lightweight AWX job status polling (runs every 10 seconds)
#   awx_exec      — AWX automation request execution (can be heavy)
#   maintenance   — daily cleanup/housekeeping tasks
#
# Beat schedule is also configured here — see CELERY_BEAT_SCHEDULE in settings.py.

import os
from celery import Celery
from celery.schedules import crontab

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'fabrik.settings')

app = Celery('fabrik')

# Pull all CELERY_* settings from Django's settings module
app.config_from_object('django.conf:settings', namespace='CELERY')

# Auto-discover tasks in every installed Django app's tasks.py
from django.conf import settings
app.autodiscover_tasks(lambda: settings.INSTALLED_APPS)

# Celery Beat Schedule - Enterprise Task Management
# All system maintenance tasks are now managed via Task Management UI (ScheduledTask model)
# This provides visibility, control, and audit trail for all scheduled operations
app.conf.beat_schedule = {
    # ============================================================================
    # Core Scheduler (REQUIRED)
    # ============================================================================
    # Check and execute scheduled tasks every minute
    # This task reads from ScheduledTask model and executes due tasks
    # Both user-created APIC queries and system maintenance tasks are handled here
    'check-scheduled-tasks': {
        'task': 'queries.check_scheduled_tasks',
        'schedule': crontab(minute='*'),  # Every minute
    },

    # ============================================================================
    # Real-time Monitoring (CRITICAL - AWX Status Polling)
    # ============================================================================
    # AWX: Sync running job statuses (CRITICAL for real-time job monitoring)
    # Polls AWX every 10 seconds to update execution status and emit WebSocket updates
    # TODO: Implement webhooks as PRIMARY method for instant updates (event-driven, not polling)
    # NOTE: This is NOT a cronjob - it's real-time monitoring, so NOT moved to Task Management
    'sync-awx-jobs': {
        'task': 'awx.sync_running_jobs',
        'schedule': 30.0,  # Every 30 seconds - event consumers handle real-time updates
    },

    # ============================================================================
    # Maintenance Tasks
    # ============================================================================
    # Cleanup zombie executions stuck in pending/running for >2 hours
    'cleanup-stale-executions': {
        'task': 'awx.cleanup_stale_executions',
        'schedule': crontab(minute='*/30'),  # Every 30 minutes
    },

    # Purge old notifications based on retention settings
    'cleanup-old-notifications': {
        'task': 'notifications.cleanup_old_notifications',
        'schedule': crontab(hour=4, minute=0),  # Daily at 04:00
    },

    # Flush notification digests for users with batching enabled
    'flush-notification-digests': {
        'task': 'notifications.flush_notification_digests',
        'schedule': 60.0,  # Every 60 seconds
    },

    # Escalate unread critical notifications to designated targets
    'check-escalations': {
        'task': 'notifications.check_escalations',
        'schedule': crontab(minute='*/5'),  # Every 5 minutes
    },

    # Cleanup expired password reset codes (daily at 05:00)
    'cleanup-expired-reset-codes': {
        'task': 'users.cleanup_expired_reset_codes',
        'schedule': crontab(hour=5, minute=0),
    },

    # Sweep ephemeral workflow_job_template clones that the immediate
    # post-terminal hook (delete_workflow_clone) failed to remove.
    'cleanup-orphaned-workflow-clones': {
        'task': 'awx.cleanup_orphaned_workflow_clones',
        'schedule': crontab(minute=0),  # Hourly on the hour
    },

}

# Celery Configuration
app.conf.update(
    # Task settings
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,

    # Result backend
    result_backend='redis://redis:6379/0',
    result_expires=3600,  # Results expire after 1 hour

    # Task routing — dedicated queues per domain
    task_routes={
        # Critical path — query execution
        'queries.check_scheduled_tasks': {'queue': 'scheduled'},
        'queries.execute_scheduled_task': {'queue': 'scheduled'},
        'queries.execute_pipeline': {'queue': 'query_exec'},
        # AWX automation
        'awx.sync_running_jobs': {'queue': 'awx_monitor'},
        'awx.execute_automation_request': {'queue': 'awx_exec'},
        'awx.cleanup_stale_executions': {'queue': 'maintenance'},
        'awx.delete_workflow_clone': {'queue': 'awx_monitor'},
        'awx.cleanup_orphaned_workflow_clones': {'queue': 'maintenance'},
        'queries.cleanup_time_machine_snapshots': {'queue': 'maintenance'},
        'notifications.cleanup_old_notifications': {'queue': 'maintenance'},
        'notifications.send_notification_email': {'queue': 'maintenance'},
        'notifications.flush_notification_digests': {'queue': 'maintenance'},
        'notifications.check_escalations': {'queue': 'maintenance'},
        # User management
        'users.delete_recovery_user': {'queue': 'maintenance'},
        'users.cleanup_expired_reset_codes': {'queue': 'maintenance'},
    },

    # Worker settings
    worker_prefetch_multiplier=4,
    worker_max_tasks_per_child=1000,

    # Task time limits
    task_soft_time_limit=300,  # 5 minutes soft limit
    task_time_limit=600,       # 10 minutes hard limit
)


@app.task(bind=True, ignore_result=True)
def debug_task(self):
    """Debug task for testing Celery"""
    print(f'Request: {self.request!r}')
