# audit/models.py
#
# Immutable audit trail for compliance and security investigations. AuditLog
# rows are append-only by convention — we never update or delete them. username
# is denormalized (copied from user.username at log time) so audit records
# survive user account deletion and remain readable.
#
# AuditLogSettings controls which categories are captured, so teams can disable
# high-volume categories (like api_access) without touching the code.

from django.db import models
from django.contrib.auth.models import User
import uuid


class AuditLog(models.Model):
    """Single entry in the audit trail — one action by one user at one point in time.

    username is stored separately from the FK so deleting a user doesn't erase
    their audit history. Indexes on (timestamp, category, action) support the
    most common admin queries.
    """

    # Primary identification
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    timestamp = models.DateTimeField(auto_now_add=True, db_index=True)

    # User and session info
    user = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name='audit_logs'
    )
    username = models.CharField(max_length=150, db_index=True)  # Denormalized for deleted users
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)

    # Action categorization
    CATEGORY_CHOICES = [
        # Identity & Access
        ('user_management', 'User Management'),
        ('group_permission', 'Group & Permission'),
        ('login_logout', 'Login/Logout'),
        # APIC
        ('apic_management', 'APIC Connection Management'),
        # Query Engine
        ('query_management', 'Query Management'),
        ('query_execution', 'Query Execution'),
        ('category_management', 'Query Category Management'),
        ('task_management', 'Scheduled Task Management'),
        ('time_machine', 'Time Machine'),
        # AWX Automation
        ('awx_management', 'AWX Connection & Template Management'),
        ('awx_automation', 'AWX Automation Execution'),
        ('awx_webhook', 'AWX Webhook Events'),
        ('validation', 'Data Validation'),
        ('validation_management', 'Validation List Management'),
        # Infrastructure
        ('notification_management', 'Notification Management'),
        ('settings_change', 'Settings Change'),
        ('system_settings', 'System Settings'),
        ('api_access', 'API Access'),
        ('mim_explorer', 'MIM Explorer'),
    ]
    category = models.CharField(max_length=50, choices=CATEGORY_CHOICES, db_index=True)

    ACTION_CHOICES = [
        # ── User Management ──
        ('user_created', 'User Created'),
        ('user_updated', 'User Updated'),
        ('user_deleted', 'User Deleted'),
        ('user_activated', 'User Activated'),
        ('user_deactivated', 'User Deactivated'),
        ('password_reset', 'Password Reset'),
        # ── Group & Permission ──
        ('group_created', 'Group Created'),
        ('group_updated', 'Group Updated'),
        ('group_deleted', 'Group Deleted'),
        ('group_cloned', 'Group Cloned'),
        ('permissions_added', 'Permissions Added'),
        ('permissions_removed', 'Permissions Removed'),
        # ── Authentication ──
        ('login_success', 'Login Success'),
        ('login_failed', 'Login Failed'),
        ('logout', 'Logout'),
        # ── APIC Connection ──
        ('apic_connection_created', 'APIC Connection Created'),
        ('apic_connection_updated', 'APIC Connection Updated'),
        ('apic_connection_deleted', 'APIC Connection Deleted'),
        ('apic_connection_tested', 'APIC Connection Tested'),
        ('apic_connection_test_permission_denied', 'APIC Connection Test Permission Denied'),
        ('apic_connection_test_password_error', 'APIC Connection Test Password Error'),
        ('apic_query_executed', 'APIC Query Executed'),
        ('apic_query_validation_failed', 'APIC Query Validation Failed'),
        ('apic_query_connection_not_found', 'APIC Query Connection Not Found'),
        ('apic_query_permission_denied', 'APIC Query Permission Denied'),
        ('apic_query_inactive_connection', 'APIC Query Inactive Connection'),
        ('apic_query_password_error', 'APIC Query Password Error'),
        # ── Query Management ──
        ('query_created', 'Query Created'),
        ('query_updated', 'Query Updated'),
        ('query_deleted', 'Query Deleted'),
        ('query_duplicated', 'Query Duplicated'),
        ('query_executed', 'Query Executed'),
        ('background_query_started', 'Background Query Started'),
        ('background_query_cancelled', 'Background Query Cancelled'),
        # ── Query Category ──
        ('category_created', 'Query Category Created'),
        ('category_updated', 'Query Category Updated'),
        ('category_deleted', 'Query Category Deleted'),
        # ── Scheduled Tasks ──
        ('scheduled_task_created', 'Scheduled Task Created'),
        ('scheduled_task_updated', 'Scheduled Task Updated'),
        ('scheduled_task_deleted', 'Scheduled Task Deleted'),
        ('scheduled_task_paused', 'Scheduled Task Paused'),
        ('scheduled_task_resumed', 'Scheduled Task Resumed'),
        ('scheduled_task_executed_manually', 'Scheduled Task Executed Manually'),
        ('scheduled_task_cloned', 'Scheduled Task Cloned'),
        # ── Time Machine ──
        ('time_machine_snapshot_captured', 'Time Machine Snapshot Captured'),
        ('time_machine_snapshot_failed', 'Time Machine Snapshot Failed'),
        ('time_machine_snapshots_compared', 'Time Machine Snapshots Compared'),
        ('time_machine_settings_updated', 'Time Machine Settings Updated'),
        ('time_machine_cleanup_executed', 'Time Machine Cleanup Executed'),
        # ── AWX Connection & Template ──
        ('awx_connection_created', 'AWX Connection Created'),
        ('awx_connection_updated', 'AWX Connection Updated'),
        ('awx_connection_deleted', 'AWX Connection Deleted'),
        ('awx_connection_tested', 'AWX Connection Tested'),
        ('ansible_template_created', 'Automation Template Created'),
        ('ansible_template_updated', 'Automation Template Updated'),
        ('ansible_template_deleted', 'Automation Template Deleted'),
        ('template_category_updated', 'Template Category Updated'),
        ('template_category_deleted', 'Template Category Deleted'),
        ('template_validation_started', 'Template Validation Started'),
        ('template_sheets_validated', 'Template Sheets Validated'),
        # ── AWX Automation ──
        ('automation_request_created', 'Automation Request Created'),
        ('automation_request_updated', 'Automation Request Updated'),
        ('automation_request_deleted', 'Automation Request Deleted'),
        ('automation_request_execution_triggered', 'Automation Request Execution Triggered'),
        ('automation_execution_retry_triggered', 'Automation Execution Retry Triggered'),
        ('automation_execution_cancelled', 'Automation Execution Cancelled'),
        ('execute_automation_request', 'Automation Request Executed'),
        ('execute_automation_request_failed', 'Automation Request Execution Failed'),
        # ── AWX Webhook ──
        ('awx_webhook_received', 'AWX Webhook Received'),
        # ── Validation Lists ──
        ('validation_list_created', 'Validation List Created'),
        ('validation_list_updated', 'Validation List Updated'),
        ('validation_list_deleted', 'Validation List Deleted'),
        # ── Notifications ──
        ('notification_deleted', 'Notification Deleted'),
        # ── Settings ──
        ('settings_updated', 'Settings Updated'),
        ('audit_settings_updated', 'Audit Settings Updated'),
        ('task_management_settings_updated', 'Task Management Settings Updated'),
        ('ai_settings_updated', 'AI Settings Updated'),
        # ── MIM Explorer ──
        ('mim_sync_started', 'MIM Sync Started'),
        ('mim_sync_completed', 'MIM Sync Completed'),
        ('mim_sync_failed', 'MIM Sync Failed'),
    ]
    action = models.CharField(max_length=50, choices=ACTION_CHOICES, db_index=True)

    # Resource tracking
    resource_type = models.CharField(max_length=50, blank=True, db_index=True)
    resource_id = models.CharField(max_length=100, blank=True, db_index=True)
    resource_name = models.CharField(max_length=255, blank=True)

    # Details
    description = models.TextField(blank=True)

    # Metadata (changes, context)
    metadata = models.JSONField(default=dict, blank=True)

    # Large content (query text, response) - optional
    content = models.TextField(blank=True)
    content_size = models.IntegerField(default=0)
    content_truncated = models.BooleanField(default=False)

    # Success/failure
    success = models.BooleanField(default=True)
    error_message = models.TextField(blank=True)

    class Meta:
        db_table = 'audit_log'
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['-timestamp']),
            models.Index(fields=['user', '-timestamp']),
            models.Index(fields=['category', '-timestamp']),
            models.Index(fields=['action', '-timestamp']),
            models.Index(fields=['resource_type', 'resource_id']),
        ]

    def __str__(self):
        return f'{self.timestamp} - {self.username} - {self.action}'


class AuditLogSettings(models.Model):
    """
    Singleton model for audit log configuration.
    Admin can toggle categories and set retention policies.
    """

    id = models.IntegerField(primary_key=True, default=1)

    # ── Category toggles ──
    # Identity & Access
    user_management_enabled = models.BooleanField(
        default=True, help_text='Log user create/edit/delete'
    )
    group_permission_enabled = models.BooleanField(
        default=True, help_text='Log group and permission changes'
    )
    login_logout_enabled = models.BooleanField(default=True, help_text='Log authentication events')

    # APIC
    apic_management_enabled = models.BooleanField(
        default=True, help_text='Log APIC connection CRUD and queries'
    )

    # Query Engine
    query_content_enabled = models.BooleanField(
        default=True, help_text='Log query text and responses'
    )
    task_management_enabled = models.BooleanField(
        default=True, help_text='Log scheduled task operations'
    )
    time_machine_enabled = models.BooleanField(
        default=True, help_text='Log time machine operations'
    )

    # AWX Automation
    awx_management_enabled = models.BooleanField(
        default=True, help_text='Log AWX connection and template changes'
    )
    awx_automation_enabled = models.BooleanField(
        default=True, help_text='Log automation request and execution events'
    )

    # Infrastructure
    settings_changes_enabled = models.BooleanField(default=True, help_text='Log settings updates')
    mim_explorer_enabled = models.BooleanField(default=True, help_text='Log MIM sync operations')
    api_access_enabled = models.BooleanField(default=False, help_text='Log all API endpoint access')

    # ── Retention policies (days) — 0 means unlimited ──
    user_management_retention_days = models.IntegerField(default=365)
    group_permission_retention_days = models.IntegerField(default=365)
    login_logout_retention_days = models.IntegerField(default=90)
    apic_management_retention_days = models.IntegerField(default=180)
    query_content_retention_days = models.IntegerField(default=90)
    task_management_retention_days = models.IntegerField(default=180)
    time_machine_retention_days = models.IntegerField(default=90)
    awx_management_retention_days = models.IntegerField(default=365)
    awx_automation_retention_days = models.IntegerField(default=365)
    settings_changes_retention_days = models.IntegerField(default=365)
    mim_explorer_retention_days = models.IntegerField(default=90)
    api_access_retention_days = models.IntegerField(default=30)

    # Content limits
    max_content_size_mb = models.IntegerField(
        default=10, help_text='Max size for query content in MB'
    )
    compress_large_content = models.BooleanField(default=True, help_text='Compress content > 1MB')

    # Cleanup
    auto_cleanup_enabled = models.BooleanField(default=True)
    cleanup_time_hour = models.IntegerField(
        default=3, help_text='Hour of day (0-23) to run cleanup'
    )

    # Metadata
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)

    class Meta:
        db_table = 'audit_log_settings'
        verbose_name = 'Audit Log Settings'
        verbose_name_plural = 'Audit Log Settings'

    def save(self, *args, **kwargs):
        self.id = 1
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        pass

    @classmethod
    def get_settings(cls):
        obj, created = cls.objects.get_or_create(id=1)
        return obj

    def __str__(self):
        return 'Audit Log Settings'


class LoginAttempt(models.Model):
    """
    Dedicated model for login attempts - high volume, separate retention.
    """

    id = models.BigAutoField(primary_key=True)
    timestamp = models.DateTimeField(auto_now_add=True, db_index=True)

    # User info
    username = models.CharField(max_length=150, db_index=True)
    user = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name='login_attempts'
    )

    # Request info
    ip_address = models.GenericIPAddressField()
    user_agent = models.TextField(blank=True)

    # Result
    success = models.BooleanField(db_index=True)
    failure_reason = models.CharField(max_length=255, blank=True)

    # Session tracking
    session_key = models.CharField(max_length=40, blank=True)

    class Meta:
        db_table = 'audit_login_attempt'
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['-timestamp']),
            models.Index(fields=['username', '-timestamp']),
            models.Index(fields=['ip_address', '-timestamp']),
            models.Index(fields=['success', '-timestamp']),
        ]

    def __str__(self):
        status = 'Success' if self.success else f'Failed: {self.failure_reason}'
        return f'{self.timestamp} - {self.username} - {status}'
