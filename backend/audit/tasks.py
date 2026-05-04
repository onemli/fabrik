# audit/tasks.py
#
# Celery maintenance task that purges old audit log entries based on the
# retention period in AuditLogSettings. Runs on a schedule set in celery.py.
# Also cleans up stale LoginAttempt records that are past their lock window.

from celery import shared_task
from django.utils import timezone
from datetime import timedelta
from .models import AuditLog, AuditLogSettings, LoginAttempt


@shared_task
def cleanup_old_audit_logs() -> str:
    settings = AuditLogSettings.get_settings()
    if not settings.auto_cleanup_enabled:
        return "Cleanup disabled"
    deleted_counts = {}
    category_retention_map = {
        # Identity & Access
        "user_management": settings.user_management_retention_days,
        "group_permission": settings.group_permission_retention_days,
        "login_logout": settings.login_logout_retention_days,
        # APIC
        "apic_management": settings.apic_management_retention_days,
        # Query Engine
        "query_management": settings.query_content_retention_days,
        "query_execution": settings.query_content_retention_days,
        "category_management": settings.query_content_retention_days,
        "task_management": settings.task_management_retention_days,
        "time_machine": settings.time_machine_retention_days,
        # AWX Automation
        "awx_management": settings.awx_management_retention_days,
        "awx_automation": settings.awx_automation_retention_days,
        "awx_webhook": settings.awx_automation_retention_days,
        "validation": settings.awx_management_retention_days,
        "validation_management": settings.awx_management_retention_days,
        # Infrastructure
        "notification_management": settings.settings_changes_retention_days,
        "settings_change": settings.settings_changes_retention_days,
        "system_settings": settings.settings_changes_retention_days,
        "mim_explorer": settings.mim_explorer_retention_days,
        "api_access": settings.api_access_retention_days,
    }
    for category, retention_days in category_retention_map.items():
        if retention_days == 0:
            continue
        cutoff_date = timezone.now() - timedelta(days=retention_days)
        deleted, _ = AuditLog.objects.filter(category=category, timestamp__lt=cutoff_date).delete()
        deleted_counts[category] = deleted
    login_cutoff = timezone.now() - timedelta(days=settings.login_logout_retention_days)
    login_deleted, _ = LoginAttempt.objects.filter(timestamp__lt=login_cutoff).delete()
    deleted_counts["login_attempts"] = login_deleted
    return f"Cleaned up: {deleted_counts}"
