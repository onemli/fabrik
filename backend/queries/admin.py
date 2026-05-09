# queries/admin.py
#
# Django admin registrations for the queries app. Mostly read-only views used
# by admins to inspect query history and scheduled task execution logs.

from django.contrib import admin
from .models import (
    Category,
    SavedQuery,
    QueryExecutionLog,
    ScheduledTask,
    ScheduledTaskExecution,
    TaskManagementSettings,
)


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ['name', 'color', 'icon', 'created_at']
    search_fields = ['name', 'description']
    list_filter = ['created_at']
    ordering = ['name']


@admin.register(SavedQuery)
class SavedQueryAdmin(admin.ModelAdmin):
    list_display = ['name', 'created_by', 'category', 'is_public', 'execution_count', 'created_at']
    search_fields = ['name', 'description', 'tags', 'created_by__username']
    list_filter = ['is_public', 'category', 'created_at']
    readonly_fields = ['execution_count', 'last_executed_at', 'created_at', 'updated_at']
    filter_horizontal = ['shared_with', 'favorited_by']
    ordering = ['-created_at']

    fieldsets = (
        ('Basic Info', {'fields': ('name', 'description', 'category', 'tags')}),
        ('Query Data', {'fields': ('flow_data', 'generated_query')}),
        ('Permissions', {'fields': ('created_by', 'is_public', 'shared_with')}),
        (
            'Stats',
            {
                'fields': (
                    'execution_count',
                    'last_executed_at',
                    'favorited_by',
                    'created_at',
                    'updated_at',
                ),
                'classes': ('collapse',),
            },
        ),
    )


@admin.register(QueryExecutionLog)
class QueryExecutionLogAdmin(admin.ModelAdmin):
    list_display = [
        'query',
        'executed_by',
        'executed_at',
        'execution_time_ms',
        'result_count',
        'success',
    ]
    search_fields = ['query__name', 'executed_by__username']
    list_filter = ['success', 'executed_at']
    readonly_fields = ['query', 'executed_by', 'executed_at']
    ordering = ['-executed_at']

    def has_add_permission(self, request):
        return False  # Logs are created automatically

    def has_change_permission(self, request, obj=None):
        return False  # Logs are read-only


@admin.register(ScheduledTask)
class ScheduledTaskAdmin(admin.ModelAdmin):
    list_display = [
        'name',
        'priority',
        'status',
        'created_by',
        'frequency',
        'next_run_at',
        'execution_count',
    ]
    search_fields = ['name', 'description', 'created_by__username']
    list_filter = ['status', 'priority', 'frequency', 'created_at']
    readonly_fields = [
        'execution_count',
        'success_count',
        'failure_count',
        'last_run_at',
        'next_run_at',
        'created_at',
        'updated_at',
    ]
    ordering = ['priority', 'order', '-created_at']

    fieldsets = (
        (
            'Basic Info',
            {'fields': ('name', 'description', 'priority', 'order', 'created_by', 'saved_query')},
        ),
        ('Connections & Variables', {'fields': ('apic_connection_ids', 'variable_values')}),
        (
            'Schedule',
            {
                'fields': (
                    'frequency',
                    'minute_of_hour',
                    'time_of_day',
                    'day_of_week',
                    'day_of_month',
                    'scheduled_datetime',
                    'timezone',
                )
            },
        ),
        (
            'Retry & Notifications',
            {
                'fields': (
                    'retry_enabled',
                    'retry_count',
                    'retry_interval_minutes',
                    'email_on_success',
                    'email_on_failure',
                    'email_recipients',
                )
            },
        ),
        (
            'Status & Stats',
            {
                'fields': (
                    'status',
                    'log_retention_days',
                    'execution_count',
                    'success_count',
                    'failure_count',
                    'last_run_at',
                    'next_run_at',
                    'created_at',
                    'updated_at',
                )
            },
        ),
    )


@admin.register(ScheduledTaskExecution)
class ScheduledTaskExecutionAdmin(admin.ModelAdmin):
    list_display = [
        'scheduled_task',
        'apic_connection_name',
        'status',
        'created_at',
        'execution_time_ms',
        'retry_attempt',
    ]
    search_fields = ['scheduled_task__name', 'apic_connection_name']
    list_filter = ['status', 'is_retry', 'created_at']
    readonly_fields = [
        'scheduled_task',
        'created_at',
        'started_at',
        'completed_at',
        'execution_time_ms',
    ]
    ordering = ['-created_at']

    def has_add_permission(self, request):
        return False  # Executions are created automatically

    def has_change_permission(self, request, obj=None):
        return False  # Executions are read-only


@admin.register(TaskManagementSettings)
class TaskManagementSettingsAdmin(admin.ModelAdmin):
    list_display = [
        'id',
        'default_retry_count',
        'default_retry_interval_minutes',
        'default_log_retention_days',
        'email_enabled',
    ]
    readonly_fields = ['updated_at', 'updated_by']
