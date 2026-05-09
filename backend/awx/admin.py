# awx/admin.py — Django admin registrations for the AWX app.
# Mostly used for debugging and emergency data inspection, not day-to-day ops.
# Credentials are stored encrypted; the admin will show the field but the value
# is Fernet ciphertext — decrypt via AWXConnection.get_token() in the shell.

from django.contrib import admin
from .models import (
    AWXConnection,
    TemplateCategory,
    AutomationTemplate,
    AutomationRequest,
    AutomationExecution,
)


@admin.register(AWXConnection)
class AWXConnectionAdmin(admin.ModelAdmin):
    list_display = [
        'name',
        'url',
        'auth_type',
        'awx_version',
        'last_test_status',
        'is_public',
        'created_at',
    ]
    list_filter = ['auth_type', 'is_public', 'last_test_status', 'created_at']
    search_fields = ['name', 'url', 'description']
    readonly_fields = ['id', 'created_at', 'updated_at', 'last_tested_at']
    filter_horizontal = ['shared_with']


@admin.register(TemplateCategory)
class TemplateCategoryAdmin(admin.ModelAdmin):
    list_display = ['name', 'color', 'display_order', 'created_by', 'created_at']
    list_filter = ['created_at']
    search_fields = ['name', 'description']
    readonly_fields = ['id', 'created_at', 'updated_at']


@admin.register(AutomationTemplate)
class AutomationTemplateAdmin(admin.ModelAdmin):
    list_display = ['name', 'awx_type', 'category', 'is_public', 'execution_count', 'created_at']
    list_filter = ['awx_type', 'category', 'is_public', 'created_at']
    search_fields = ['name', 'description', 'tags', 'awx_template_name']
    readonly_fields = [
        'id',
        'execution_count',
        'success_count',
        'failure_count',
        'last_executed_at',
        'created_at',
        'updated_at',
    ]


@admin.register(AutomationRequest)
class AutomationRequestAdmin(admin.ModelAdmin):
    list_display = ['title', 'status', 'template', 'requested_by', 'requested_at', 'created_at']
    list_filter = ['status', 'requested_at', 'created_at']
    search_fields = ['title', 'description', 'template__name', 'requested_by__username']
    readonly_fields = ['id', 'requested_at', 'created_at', 'updated_at']


@admin.register(AutomationExecution)
class AutomationExecutionAdmin(admin.ModelAdmin):
    list_display = [
        'awx_job_id',
        'status',
        'automation_request',
        'progress_percentage',
        'started_at',
        'finished_at',
    ]
    list_filter = ['status', 'created_at', 'started_at', 'finished_at']
    search_fields = ['awx_job_id', 'automation_request__title', 'current_task']
    readonly_fields = ['id', 'created_at', 'updated_at']
