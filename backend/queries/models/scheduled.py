import uuid
from datetime import timedelta

from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone

from .core import SavedQuery


class ScheduledTask(models.Model):
    """Recurring or one-time task that executes a query on a schedule.
    No cron syntax — frequency + time fields cover the common cases,
    and calculate_next_run() converts them to an absolute datetime.
    """

    TASK_TYPE_APIC_QUERY = 'apic_query'
    TASK_TYPE_SYSTEM_MAINTENANCE = 'system_maintenance'
    TASK_TYPE_SYSTEM_MONITORING = 'system_monitoring'
    TASK_TYPE_SYSTEM_SYNC = 'system_sync'
    TASK_TYPE_SYSTEM_SNAPSHOT = 'system_snapshot'

    TASK_TYPE_CHOICES = [
        (TASK_TYPE_APIC_QUERY, 'APIC Query'),
        (TASK_TYPE_SYSTEM_MAINTENANCE, 'System Maintenance'),
        (TASK_TYPE_SYSTEM_MONITORING, 'System Monitoring'),
        (TASK_TYPE_SYSTEM_SYNC, 'External System Sync'),
        (TASK_TYPE_SYSTEM_SNAPSHOT, 'Snapshot & Backup'),
    ]

    STATUS_ACTIVE = 'active'
    STATUS_PAUSED = 'paused'
    STATUS_DISABLED = 'disabled'

    STATUS_CHOICES = [
        (STATUS_ACTIVE, 'Active'),
        (STATUS_PAUSED, 'Paused'),
        (STATUS_DISABLED, 'Disabled'),
    ]

    FREQ_ONCE = 'once'
    FREQ_HOURLY = 'hourly'
    FREQ_DAILY = 'daily'
    FREQ_WEEKLY = 'weekly'
    FREQ_MONTHLY = 'monthly'

    FREQUENCY_CHOICES = [
        (FREQ_ONCE, 'Once'),
        (FREQ_HOURLY, 'Hourly'),
        (FREQ_DAILY, 'Daily'),
        (FREQ_WEEKLY, 'Weekly'),
        (FREQ_MONTHLY, 'Monthly'),
    ]

    PRIORITY_LOW = 'low'
    PRIORITY_MEDIUM = 'medium'
    PRIORITY_HIGH = 'high'

    PRIORITY_CHOICES = [
        (PRIORITY_LOW, 'Low'),
        (PRIORITY_MEDIUM, 'Medium'),
        (PRIORITY_HIGH, 'High'),
    ]

    DAY_CHOICES = [
        ('monday', 'Monday'),
        ('tuesday', 'Tuesday'),
        ('wednesday', 'Wednesday'),
        ('thursday', 'Thursday'),
        ('friday', 'Friday'),
        ('saturday', 'Saturday'),
        ('sunday', 'Sunday'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    name = models.CharField(max_length=200, help_text='Task name')
    description = models.TextField(blank=True, null=True)

    task_type = models.CharField(
        max_length=50,
        choices=TASK_TYPE_CHOICES,
        default=TASK_TYPE_APIC_QUERY,
        db_index=True,
        help_text='Type of task (APIC query or system task)',
    )
    category = models.CharField(
        max_length=100,
        blank=True,
        null=True,
        help_text='Task category for UI grouping (e.g., "Storage", "Monitoring", "Snapshots")',
    )
    is_system_task = models.BooleanField(
        default=False, db_index=True, help_text='System task (admin-only, managed by platform)'
    )
    system_task_handler = models.CharField(
        max_length=255,
        blank=True,
        null=True,
        help_text='Celery task path for system tasks (e.g., "awx.cleanup_old_output_chunks")',
    )

    priority = models.CharField(
        max_length=20,
        choices=PRIORITY_CHOICES,
        default=PRIORITY_MEDIUM,
        db_index=True,
        help_text='Task priority (affects execution order)',
    )
    order = models.IntegerField(
        default=0,
        db_index=True,
        help_text='Manual order within same priority (lower executes first)',
    )

    # Nullable for system tasks that have no creator/query
    created_by = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='scheduled_tasks',
        null=True,
        blank=True,
        help_text='User who created this task (null for system tasks)',
    )
    saved_query = models.ForeignKey(
        SavedQuery,
        on_delete=models.CASCADE,
        related_name='scheduled_tasks',
        null=True,
        blank=True,
        help_text='Query or template to execute (null for system tasks)',
    )

    apic_connection_ids = models.JSONField(
        default=list, help_text='List of APIC connection IDs to execute against'
    )
    variable_values = models.JSONField(
        null=True, blank=True, help_text='Variable values for template execution'
    )

    retry_enabled = models.BooleanField(
        default=False, help_text='Enable automatic retry on failure'
    )
    retry_count = models.IntegerField(default=3, help_text='Number of retry attempts on failure')
    retry_interval_minutes = models.IntegerField(
        default=5, help_text='Minutes to wait between retry attempts'
    )

    email_on_success = models.BooleanField(
        default=False, help_text='Send email notification on successful execution'
    )
    email_on_failure = models.BooleanField(
        default=True, help_text='Send email notification on failed execution'
    )
    email_recipients = models.JSONField(
        default=list, blank=True, help_text='List of email addresses to notify'
    )

    log_retention_days = models.IntegerField(
        default=30, help_text='Number of days to retain execution logs'
    )

    # Schedule fields — no cron, just friendly options
    frequency = models.CharField(
        max_length=20,
        choices=FREQUENCY_CHOICES,
        default=FREQ_DAILY,
        help_text='Execution frequency',
    )
    minute_of_hour = models.IntegerField(
        null=True, blank=True, help_text='Minute of the hour for hourly tasks (0-59)'
    )
    time_of_day = models.TimeField(
        null=True, blank=True, help_text='Time of day for daily tasks (HH:MM)'
    )
    day_of_week = models.CharField(
        max_length=20,
        choices=DAY_CHOICES,
        null=True,
        blank=True,
        help_text='Day of week for weekly tasks',
    )
    day_of_month = models.IntegerField(
        null=True, blank=True, help_text='Day of month for monthly tasks (1-31)'
    )
    scheduled_datetime = models.DateTimeField(
        null=True, blank=True, help_text='Specific datetime for one-time tasks'
    )
    timezone = models.CharField(
        max_length=50, default='UTC', help_text='Timezone for scheduled execution'
    )

    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default=STATUS_ACTIVE,
        db_index=True,
    )

    last_run_at = models.DateTimeField(null=True, blank=True, help_text='Last execution time')
    next_run_at = models.DateTimeField(
        null=True, blank=True, db_index=True, help_text='Next scheduled execution time'
    )

    execution_count = models.IntegerField(default=0, help_text='Number of times executed')
    success_count = models.IntegerField(default=0, help_text='Number of successful executions')
    failure_count = models.IntegerField(default=0, help_text='Number of failed executions')

    celery_periodic_task_name = models.CharField(
        max_length=255,
        null=True,
        blank=True,
        unique=True,
        help_text='Celery periodic task name',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Scheduled Task'
        verbose_name_plural = 'Scheduled Tasks'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['created_by', '-created_at']),
            models.Index(fields=['status', 'next_run_at']),
            models.Index(fields=['saved_query', '-created_at']),
        ]

    def __str__(self):
        return f'{self.name} ({self.frequency}) - {self.status}'

    @property
    def success_rate(self):
        if self.execution_count == 0:
            return 100
        return int((self.success_count / self.execution_count) * 100)

    @property
    def schedule_description(self):
        if self.frequency == self.FREQ_ONCE:
            if not self.scheduled_datetime:
                return 'Once (not configured)'
            return f'Once on {self.scheduled_datetime.strftime("%Y-%m-%d %H:%M")}'
        elif self.frequency == self.FREQ_HOURLY:
            return f'Every hour at minute {self.minute_of_hour}'
        elif self.frequency == self.FREQ_DAILY:
            if not self.time_of_day:
                return 'Daily (time not configured)'
            return f'Daily at {self.time_of_day.strftime("%H:%M")}'
        elif self.frequency == self.FREQ_WEEKLY:
            if not self.time_of_day:
                return f'Every {self.get_day_of_week_display()} (time not configured)'
            return f'Every {self.get_day_of_week_display()} at {self.time_of_day.strftime("%H:%M")}'
        elif self.frequency == self.FREQ_MONTHLY:
            if not self.time_of_day:
                return f'Monthly on day {self.day_of_month} (time not configured)'
            return f'Monthly on day {self.day_of_month} at {self.time_of_day.strftime("%H:%M")}'
        return 'Unknown schedule'

    def calculate_next_run(self):
        import pytz

        now = timezone.now()
        tz = pytz.timezone(self.timezone)

        if self.frequency == self.FREQ_ONCE:
            return self.scheduled_datetime if self.scheduled_datetime else None

        elif self.frequency == self.FREQ_HOURLY:
            next_run = now.astimezone(tz).replace(
                minute=self.minute_of_hour, second=0, microsecond=0
            )
            if next_run <= now:
                next_run += timedelta(hours=1)
            return next_run

        elif self.frequency == self.FREQ_DAILY:
            hour, minute = self.time_of_day.hour, self.time_of_day.minute
            next_run = now.astimezone(tz).replace(hour=hour, minute=minute, second=0, microsecond=0)
            if next_run <= now:
                next_run += timedelta(days=1)
            return next_run

        elif self.frequency == self.FREQ_WEEKLY:
            return self._next_weekly_run(now, tz)

        elif self.frequency == self.FREQ_MONTHLY:
            return self._next_monthly_run(now, tz)

        return None

    def _next_weekly_run(self, now, tz):
        day_map = {
            'monday': 0,
            'tuesday': 1,
            'wednesday': 2,
            'thursday': 3,
            'friday': 4,
            'saturday': 5,
            'sunday': 6,
        }
        target_weekday = day_map.get(self.day_of_week, 0)
        hour, minute = self.time_of_day.hour, self.time_of_day.minute

        next_run = now.astimezone(tz).replace(hour=hour, minute=minute, second=0, microsecond=0)
        days_ahead = target_weekday - next_run.weekday()
        if days_ahead < 0 or (days_ahead == 0 and next_run <= now):
            days_ahead += 7

        next_run += timedelta(days=days_ahead)
        return next_run

    def _next_monthly_run(self, now, tz):
        hour, minute = self.time_of_day.hour, self.time_of_day.minute
        next_run = now.astimezone(tz).replace(
            day=min(self.day_of_month, 28),
            hour=hour,
            minute=minute,
            second=0,
            microsecond=0,
        )

        if next_run <= now:
            if next_run.month == 12:
                next_run = next_run.replace(year=next_run.year + 1, month=1)
            else:
                next_run = next_run.replace(month=next_run.month + 1)

        return next_run

    def save(self, *args, **kwargs):
        # Recalculate next_run_at so pausing/reactivating gets a fresh schedule
        if self.status == self.STATUS_ACTIVE:
            self.next_run_at = self.calculate_next_run()
        else:
            self.next_run_at = None

        super().save(*args, **kwargs)


class ScheduledTaskExecution(models.Model):
    """Immutable record of a single ScheduledTask run.
    apic_connection_name is denormalized so old records survive connection renames.
    """

    STATUS_PENDING = 'pending'
    STATUS_RUNNING = 'running'
    STATUS_SUCCESS = 'success'
    STATUS_FAILED = 'failed'
    STATUS_CANCELLED = 'cancelled'

    STATUS_CHOICES = [
        (STATUS_PENDING, 'Pending'),
        (STATUS_RUNNING, 'Running'),
        (STATUS_SUCCESS, 'Success'),
        (STATUS_FAILED, 'Failed'),
        (STATUS_CANCELLED, 'Cancelled'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    scheduled_task = models.ForeignKey(
        ScheduledTask,
        on_delete=models.CASCADE,
        related_name='executions',
        help_text='The scheduled task that was executed',
    )

    apic_connection_id = models.IntegerField(help_text='APIC connection ID used for this execution')
    apic_connection_name = models.CharField(
        max_length=200, blank=True, help_text='APIC connection name (cached for history)'
    )

    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default=STATUS_PENDING,
        db_index=True,
    )

    result = models.JSONField(null=True, blank=True, help_text='Query execution result')
    result_count = models.IntegerField(
        null=True, blank=True, help_text='Number of results returned'
    )

    error_type = models.CharField(
        max_length=100, null=True, blank=True, help_text='Error type if failed'
    )
    error_message = models.TextField(null=True, blank=True, help_text='Detailed error message')
    error_traceback = models.TextField(
        null=True, blank=True, help_text='Error traceback for debugging'
    )

    retry_attempt = models.IntegerField(
        default=0, help_text='Retry attempt number (0 = first attempt)'
    )
    is_retry = models.BooleanField(default=False, help_text='Is this a retry attempt?')

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    execution_time_ms = models.IntegerField(
        null=True, blank=True, help_text='Execution time in milliseconds'
    )
    celery_task_id = models.CharField(
        max_length=255, null=True, blank=True, db_index=True, help_text='Celery task ID'
    )

    class Meta:
        verbose_name = 'Scheduled Task Execution'
        verbose_name_plural = 'Scheduled Task Executions'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['scheduled_task', '-created_at']),
            models.Index(fields=['status', '-created_at']),
            models.Index(fields=['apic_connection_id', '-created_at']),
        ]

    def __str__(self):
        return f'{self.scheduled_task.name} - {self.created_at} ({self.status})'

    @property
    def duration_seconds(self):
        if self.execution_time_ms:
            return self.execution_time_ms / 1000
        return None

    def _compute_execution_time(self):
        if self.started_at:
            delta = self.completed_at - self.started_at
            self.execution_time_ms = int(delta.total_seconds() * 1000)

    def mark_as_running(self):
        self.status = self.STATUS_RUNNING
        self.started_at = timezone.now()
        self.save(update_fields=['status', 'started_at'])

    def mark_as_success(self, result, result_count=None):
        self.status = self.STATUS_SUCCESS
        self.completed_at = timezone.now()
        self.result = result
        self.result_count = result_count
        self._compute_execution_time()
        self.save(
            update_fields=[
                'status',
                'completed_at',
                'result',
                'result_count',
                'execution_time_ms',
            ]
        )

    def mark_as_failed(self, error_type, error_message, traceback=None):
        self.status = self.STATUS_FAILED
        self.completed_at = timezone.now()
        self.error_type = error_type
        self.error_message = error_message
        self.error_traceback = traceback
        self._compute_execution_time()
        self.save(
            update_fields=[
                'status',
                'completed_at',
                'error_type',
                'error_message',
                'error_traceback',
                'execution_time_ms',
            ]
        )


class TaskManagementSettings(models.Model):
    """Platform-wide defaults for task scheduling. Singleton enforced via id=1."""

    id = models.IntegerField(primary_key=True, default=1, editable=False)

    default_retry_count = models.IntegerField(
        default=3, help_text='Default number of retry attempts'
    )
    default_retry_interval_minutes = models.IntegerField(
        default=5, help_text='Default minutes between retry attempts'
    )
    default_log_retention_days = models.IntegerField(
        default=30, help_text='Default number of days to retain execution logs'
    )

    email_enabled = models.BooleanField(
        default=False, help_text='Enable email notifications globally'
    )
    email_from_address = models.EmailField(
        blank=True, default='', help_text='From email address for notifications'
    )

    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        help_text='Last user who updated settings',
    )

    class Meta:
        verbose_name = 'Task Management Settings'
        verbose_name_plural = 'Task Management Settings'

    def __str__(self):
        return 'Task Management Settings'

    def save(self, *args, **kwargs):
        self.id = 1
        super().save(*args, **kwargs)

    @classmethod
    def get_settings(cls):
        settings, _created = cls.objects.get_or_create(id=1)
        return settings
