# users/quota_service.py
#
# Central service for resolving effective quotas and checking limits.
# Resolution order: GroupQuota (most permissive across all user's groups) → settings.DEFAULT_QUOTAS.
# Every view that creates or executes something should call check_can_create()
# or check_feature() before proceeding.

from django.conf import settings
from django.utils import timezone


# Global defaults — used when user has no group quota
DEFAULT_QUOTAS = getattr(
    settings,
    'DEFAULT_QUOTAS',
    {
        'max_saved_queries': 0,
        'max_scheduled_tasks': 0,
        'max_apic_connections': 0,
        'max_awx_requests_daily': 0,
        'max_awx_concurrent': 5,
        'max_query_results': 0,
        'max_export_rows': 50000,
        'query_execution_daily': 0,
        'can_create_queries': True,
        'can_execute_queries': True,
        'can_create_scheduled': True,
        'can_use_awx': True,
        'can_use_time_machine': True,
        'can_export_data': True,
        'can_share_resources': True,
        'can_use_ai_builder': True,
        'ai_analysis_daily': 0,
    },
)

# Resource type → (quota field, model path for counting)
RESOURCE_MAP = {
    'saved_query': ('max_saved_queries', 'created_queries'),
    'scheduled_task': ('max_scheduled_tasks', 'scheduled_tasks'),
    'apic_connection': ('max_apic_connections', 'apic_connections'),
}


class QuotaService:
    @staticmethod
    def get_effective_quota(user) -> dict:
        """Resolve user's effective quota by merging all group quotas (most permissive wins).
        Superusers always get unlimited."""
        if user.is_superuser:
            result = dict(DEFAULT_QUOTAS)
            # Superuser = all unlimited, all features on
            for key in result:
                if isinstance(result[key], bool):
                    result[key] = True
                else:
                    result[key] = 0  # 0 = unlimited
            return result

        from .models import GroupQuota

        group_quotas = GroupQuota.objects.filter(group__in=user.groups.all())

        if not group_quotas.exists():
            return dict(DEFAULT_QUOTAS)

        # When group quotas exist, they REPLACE global defaults entirely.
        # Merge across multiple groups: most permissive wins.
        # For numeric: 0 = unlimited beats any number, otherwise take max.
        # For boolean: True beats False.
        numeric_fields = [
            'max_saved_queries',
            'max_scheduled_tasks',
            'max_apic_connections',
            'max_awx_requests_daily',
            'max_awx_concurrent',
            'max_query_results',
            'max_export_rows',
            'query_execution_daily',
            'ai_analysis_daily',
        ]
        boolean_fields = [
            'can_create_queries',
            'can_execute_queries',
            'can_create_scheduled',
            'can_use_awx',
            'can_use_time_machine',
            'can_export_data',
            'can_share_resources',
            'can_use_ai_builder',
        ]

        # Start from the first group's values (not from global defaults)
        first_gq = group_quotas[0]
        result = {}
        for field in numeric_fields:
            result[field] = getattr(first_gq, field)
        for field in boolean_fields:
            result[field] = getattr(first_gq, field)

        # Merge remaining groups (most permissive)
        for gq in group_quotas[1:]:
            for field in numeric_fields:
                current = result[field]
                group_val = getattr(gq, field)
                if group_val == 0:
                    result[field] = 0
                elif current == 0:
                    pass
                else:
                    result[field] = max(current, group_val)

            for field in boolean_fields:
                if getattr(gq, field):
                    result[field] = True

        return result

    @staticmethod
    def check_feature(user, feature: str) -> tuple[bool, str]:
        """Check if a feature is enabled for the user.
        Returns (allowed, reason)."""
        quota = QuotaService.get_effective_quota(user)
        if quota.get(feature, True):
            return True, ''

        FEATURE_LABELS = {
            'can_create_queries': 'creating queries',
            'can_execute_queries': 'executing queries',
            'can_create_scheduled': 'creating scheduled tasks',
            'can_use_awx': 'AWX automation',
            'can_use_time_machine': 'Time Machine',
            'can_export_data': 'data export',
            'can_share_resources': 'resource sharing',
            'can_use_ai_builder': 'AI builder',
        }
        label = FEATURE_LABELS.get(feature, feature)
        return False, f'Your group does not have access to {label}. Contact your administrator.'

    @staticmethod
    def check_can_create(user, resource_type: str) -> tuple[bool, str]:
        """Check if user can create a resource based on quota limits.
        Returns (allowed, reason)."""
        if resource_type not in RESOURCE_MAP:
            return True, ''

        quota_field, related_name = RESOURCE_MAP[resource_type]
        quota = QuotaService.get_effective_quota(user)
        limit = quota.get(quota_field, 0)

        if limit == 0:
            return True, ''  # unlimited

        current_count = getattr(user, related_name).count()
        if current_count >= limit:
            return (
                False,
                f'You have reached your limit of {limit} {resource_type.replace("_", " ")}s.',
            )

        return True, ''

    @staticmethod
    def check_daily_execution(user, execution_type: str = 'query') -> tuple[bool, str]:
        """Check daily execution limits for queries or AWX requests."""
        quota = QuotaService.get_effective_quota(user)

        if execution_type == 'query':
            limit = quota.get('query_execution_daily', 0)
            if limit == 0:
                return True, ''
            from queries.models import QueryExecutionLog

            today_start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
            count = QueryExecutionLog.objects.filter(
                executed_by=user, executed_at__gte=today_start
            ).count()
        elif execution_type == 'awx':
            limit = quota.get('max_awx_requests_daily', 0)
            if limit == 0:
                return True, ''
            from awx.models import AutomationExecution

            today_start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
            count = AutomationExecution.objects.filter(
                request__created_by=user, created_at__gte=today_start
            ).count()
        elif execution_type == 'ai':
            limit = quota.get('ai_analysis_daily', 0)
            if limit == 0:
                return True, ''
            from audit.models import AuditLog

            today_start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
            count = AuditLog.objects.filter(
                user=user, action='ai_query', timestamp__gte=today_start
            ).count()
        else:
            return True, ''

        if count >= limit:
            remaining_label = {
                'query': 'query executions',
                'awx': 'automation requests',
                'ai': 'AI requests',
            }.get(execution_type, f'{execution_type} executions')
            return (
                False,
                f'Daily limit reached: {count}/{limit} {remaining_label}. Resets at midnight UTC.',
            )
        return True, ''

    @staticmethod
    def get_usage(user) -> dict:
        """Current resource counts for quota display on frontend."""
        from queries.models import QueryExecutionLog

        today_start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)

        usage = {
            'saved_queries': user.created_queries.count(),
            'query_executions_today': QueryExecutionLog.objects.filter(
                executed_by=user, executed_at__gte=today_start
            ).count(),
        }

        # Scheduled tasks
        try:
            usage['scheduled_tasks'] = user.scheduled_tasks.count()
        except Exception:
            usage['scheduled_tasks'] = 0

        # APIC connections
        try:
            usage['apic_connections'] = user.apic_connections.count()
        except Exception:
            usage['apic_connections'] = 0

        # AWX executions today
        try:
            from awx.models import AutomationExecution

            usage['awx_executions_today'] = AutomationExecution.objects.filter(
                request__created_by=user, created_at__gte=today_start
            ).count()
        except Exception:
            usage['awx_executions_today'] = 0

        return usage
