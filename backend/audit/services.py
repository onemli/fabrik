# audit/services.py
#
# AuditService.log() is the single place where audit entries are created.
# All other code calls this — never creates AuditLog rows directly.
# The category_enabled_map gates each category against AuditLogSettings so
# admins can turn off high-volume logging (e.g. api_access) without code
# changes. Categories not in the map default to enabled (safe for new features).

import gzip
import base64
from typing import Optional
from django.contrib.auth.models import User
from django.http import HttpRequest
from .models import AuditLog, AuditLogSettings, LoginAttempt


class AuditService:
    @staticmethod
    def log(user: Optional[User], action: str, category: str, resource_type: str = '',
            resource_id: str = '', resource_name: str = '', description: str = '',
            metadata: Optional[dict] = None, content: str = '', success: bool = True,
            error_message: str = '', request: Optional[HttpRequest] = None) -> Optional[AuditLog]:
        settings = AuditLogSettings.get_settings()

        category_enabled_map = {
            # Identity & Access
            'user_management': settings.user_management_enabled,
            'group_permission': settings.group_permission_enabled,
            'login_logout': settings.login_logout_enabled,
            # APIC
            'apic_management': settings.apic_management_enabled,
            # Query Engine
            'query_management': settings.query_content_enabled,
            'query_execution': settings.query_content_enabled,
            'category_management': settings.query_content_enabled,
            'task_management': settings.task_management_enabled,
            'time_machine': settings.time_machine_enabled,
            # AWX Automation
            'awx_management': settings.awx_management_enabled,
            'awx_automation': settings.awx_automation_enabled,
            'awx_webhook': settings.awx_automation_enabled,
            'validation': settings.awx_management_enabled,
            'validation_management': settings.awx_management_enabled,
            # Infrastructure
            'notification_management': settings.settings_changes_enabled,
            'settings_change': settings.settings_changes_enabled,
            'system_settings': settings.settings_changes_enabled,
            'mim_explorer': settings.mim_explorer_enabled,
            'api_access': settings.api_access_enabled,
        }

        # Default to True for categories not explicitly configured
        # This allows new audit categories to work without requiring settings updates
        if not category_enabled_map.get(category, True):
            return None

        if user and hasattr(user, 'is_authenticated'):
            if not user.is_authenticated:
                user = None

        if user:
            username = user.username
        elif request and hasattr(request, 'user') and request.user.is_authenticated:
            user = request.user
            username = user.username
        else:
            user = None
            username = 'system'

        ip_address = None
        user_agent = ''
        if request:
            ip_address = AuditService._get_client_ip(request)
            user_agent = request.META.get('HTTP_USER_AGENT', '')[:500]

        content_truncated = False
        content_size = 0
        if content:
            content_size = len(content.encode('utf-8'))
            max_size = settings.max_content_size_mb * 1024 * 1024

            if content_size > max_size:
                content = content[:max_size]
                content_truncated = True
                content_size = max_size

            if settings.compress_large_content and content_size > 1024 * 1024:
                content = AuditService._compress_content(content)

        log_entry = AuditLog.objects.create(
            user=user,
            username=username,
            ip_address=ip_address,
            user_agent=user_agent,
            category=category,
            action=action,
            resource_type=resource_type,
            resource_id=str(resource_id) if resource_id else '',
            resource_name=resource_name,
            description=description,
            metadata=metadata or {},
            content=content,
            content_size=content_size,
            content_truncated=content_truncated,
            success=success,
            error_message=error_message,
        )

        return log_entry

    @staticmethod
    def log_login_attempt(username: str, success: bool, ip_address: str, user_agent: str,
                          failure_reason: str = '', user: Optional[User] = None,
                          session_key: str = '') -> Optional[LoginAttempt]:
        settings = AuditLogSettings.get_settings()
        if not settings.login_logout_enabled:
            return None

        return LoginAttempt.objects.create(
            username=username,
            user=user,
            ip_address=ip_address,
            user_agent=user_agent,
            success=success,
            failure_reason=failure_reason,
            session_key=session_key,
        )

    @staticmethod
    def _get_client_ip(request: HttpRequest) -> Optional[str]:
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            # Rightmost entry is added by the trusted reverse proxy
            ip = x_forwarded_for.split(',')[-1].strip()
        else:
            ip = request.META.get('REMOTE_ADDR')
        return ip

    @staticmethod
    def _compress_content(content: str) -> str:
        compressed = gzip.compress(content.encode('utf-8'))
        return base64.b64encode(compressed).decode('utf-8')

    @staticmethod
    def _decompress_content(compressed_content: str) -> str:
        try:
            decoded = base64.b64decode(compressed_content.encode('utf-8'))
            decompressed = gzip.decompress(decoded)
            return decompressed.decode('utf-8')
        except Exception:
            return compressed_content
