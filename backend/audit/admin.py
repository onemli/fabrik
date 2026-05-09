# audit/admin.py
#
# Admin views for audit data. AuditLog is fully read-only in the admin —
# records are immutable by design so they can't be tampered with after the fact.
# LoginAttempt is also read-only. AuditLogSettings controls retention policy.

from django.contrib import admin
from .models import AuditLog, AuditLogSettings, LoginAttempt


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = [
        'timestamp',
        'username',
        'category',
        'action',
        'resource_type',
        'resource_name',
        'success',
    ]
    list_filter = ['category', 'action', 'success', 'timestamp']
    search_fields = ['username', 'description', 'resource_name', 'ip_address']
    readonly_fields = [f.name for f in AuditLog._meta.fields]
    date_hierarchy = 'timestamp'
    ordering = ['-timestamp']

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return request.user.is_superuser

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(AuditLogSettings)
class AuditLogSettingsAdmin(admin.ModelAdmin):
    fieldsets = (
        (
            'Identity & Access Toggles',
            {
                'fields': (
                    'user_management_enabled',
                    'group_permission_enabled',
                    'login_logout_enabled',
                )
            },
        ),
        (
            'APIC & Query Toggles',
            {
                'fields': (
                    'apic_management_enabled',
                    'query_content_enabled',
                    'task_management_enabled',
                    'time_machine_enabled',
                )
            },
        ),
        (
            'AWX Automation Toggles',
            {
                'fields': (
                    'awx_management_enabled',
                    'awx_automation_enabled',
                )
            },
        ),
        (
            'Infrastructure Toggles',
            {
                'fields': (
                    'settings_changes_enabled',
                    'mim_explorer_enabled',
                    'api_access_enabled',
                )
            },
        ),
        (
            'Retention — Identity & Access (Days)',
            {
                'fields': (
                    'user_management_retention_days',
                    'group_permission_retention_days',
                    'login_logout_retention_days',
                )
            },
        ),
        (
            'Retention — APIC & Query (Days)',
            {
                'fields': (
                    'apic_management_retention_days',
                    'query_content_retention_days',
                    'task_management_retention_days',
                    'time_machine_retention_days',
                )
            },
        ),
        (
            'Retention — AWX & Infrastructure (Days)',
            {
                'fields': (
                    'awx_management_retention_days',
                    'awx_automation_retention_days',
                    'settings_changes_retention_days',
                    'mim_explorer_retention_days',
                    'api_access_retention_days',
                )
            },
        ),
        ('Content Settings', {'fields': ('max_content_size_mb', 'compress_large_content')}),
        ('Cleanup', {'fields': ('auto_cleanup_enabled', 'cleanup_time_hour')}),
        ('Metadata', {'fields': ('updated_at', 'updated_by'), 'classes': ('collapse',)}),
    )
    readonly_fields = ['updated_at', 'updated_by']

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(LoginAttempt)
class LoginAttemptAdmin(admin.ModelAdmin):
    list_display = ['timestamp', 'username', 'ip_address', 'success', 'failure_reason']
    list_filter = ['success', 'timestamp']
    search_fields = ['username', 'ip_address']
    readonly_fields = [f.name for f in LoginAttempt._meta.fields]
    date_hierarchy = 'timestamp'
    ordering = ['-timestamp']

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return request.user.is_superuser

    def has_change_permission(self, request, obj=None):
        return False
