# notifications/models.py
#
# In-app notification model. Extracted from queries app so every FABRIK module
# (AWX, Time Machine, APIC connections, etc.) can emit notifications without
# circular imports.

import uuid
from django.conf import settings
from django.db import models
from django.utils import timezone

User = settings.AUTH_USER_MODEL


class Notification(models.Model):
    # Severity / type constants
    TYPE_INFO = 'info'
    TYPE_SUCCESS = 'success'
    TYPE_WARNING = 'warning'
    TYPE_ERROR = 'error'

    TYPE_CHOICES = [
        (TYPE_INFO, 'Info'),
        (TYPE_SUCCESS, 'Success'),
        (TYPE_WARNING, 'Warning'),
        (TYPE_ERROR, 'Error'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='notifications',
        help_text='User who receives this notification',
    )

    type = models.CharField(
        max_length=20,
        choices=TYPE_CHOICES,
        default=TYPE_INFO,
        db_index=True,
    )

    title = models.CharField(max_length=200)
    message = models.TextField()

    # Optional deep-link references
    related_task_id = models.UUIDField(null=True, blank=True)
    related_execution_id = models.UUIDField(null=True, blank=True)

    # Arbitrary payload for the frontend (connection name, error details, etc.)
    metadata = models.JSONField(default=dict, blank=True)

    is_read = models.BooleanField(default=False, db_index=True)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        # Keep the original table name so we don't need a real DB migration
        db_table = 'queries_notification'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', '-created_at']),
            models.Index(fields=['user', 'is_read', '-created_at']),
            models.Index(fields=['type', '-created_at']),
        ]

    def __str__(self):
        return f'{self.user} - {self.title} ({self.type})'

    def mark_as_read(self):
        if not self.is_read:
            self.is_read = True
            self.read_at = timezone.now()
            self.save(update_fields=['is_read', 'read_at'])


class NotificationPreference(models.Model):
    # Per-user notification preferences — auto-created on first access
    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name='notification_preferences',
    )

    # Per-source toggles
    scheduled_task_success = models.BooleanField(default=True)
    scheduled_task_failure = models.BooleanField(default=True)
    awx_execution_success = models.BooleanField(default=True)
    awx_execution_failure = models.BooleanField(default=True)
    query_execution_failure = models.BooleanField(default=True)
    connection_health = models.BooleanField(default=True)
    time_machine_cleanup = models.BooleanField(default=True)
    system_maintenance = models.BooleanField(default=True)

    # Delivery channels
    in_app_enabled = models.BooleanField(default=True)
    email_enabled = models.BooleanField(default=False)

    # Quiet hours
    quiet_hours_enabled = models.BooleanField(default=False)
    quiet_hours_start = models.TimeField(null=True, blank=True)
    quiet_hours_end = models.TimeField(null=True, blank=True)

    # Minimum severity for email delivery
    email_min_severity = models.CharField(
        max_length=20,
        default='warning',
        choices=Notification.TYPE_CHOICES,
    )

    # Digest batching
    digest_enabled = models.BooleanField(default=False)
    digest_interval_minutes = models.IntegerField(default=60)

    class Meta:
        db_table = 'notifications_preference'

    def __str__(self):
        return f'NotificationPreference({self.user})'


class NotificationBuffer(models.Model):
    # Holds pending notifications during the digest window.
    # Flushed periodically into a single summary notification + email.
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    source = models.CharField(max_length=50)
    type = models.CharField(max_length=20)
    title = models.CharField(max_length=200)
    message = models.TextField()
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'notifications_buffer'
        indexes = [
            models.Index(fields=['user', 'created_at']),
        ]


class EscalationRule(models.Model):
    # Defines when and to whom unread critical notifications should be escalated.
    name = models.CharField(max_length=200)
    source = models.CharField(max_length=50, blank=True, default='')
    min_severity = models.CharField(
        max_length=20,
        default='error',
        choices=Notification.TYPE_CHOICES,
    )
    escalate_after_minutes = models.IntegerField(default=30)
    escalate_to = models.ManyToManyField(User, related_name='escalation_targets')
    email_on_escalation = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'notifications_escalation_rule'

    def __str__(self):
        return f'EscalationRule({self.name})'
