# dashboard/services.py
#
# Read-only aggregation from all FABRIK apps. Returns everything the
# dashboard needs in a single API call so the frontend can render
# without chaining requests.

from datetime import timedelta
from django.utils import timezone
from django.db.models import Count
from django.db.models.functions import TruncDate


def get_dashboard_stats(user=None) -> dict:
    now = timezone.now()
    last_24h = now - timedelta(hours=24)
    last_7d = now - timedelta(days=7)
    # Previous period for delta comparison ("was it better yesterday?")
    prev_24h_start = now - timedelta(hours=48)
    prev_7d_start = now - timedelta(days=14)

    return {
        'generated_at': now.isoformat(),
        'queries': _query_stats(now, last_24h, last_7d, prev_24h_start, user),
        'scheduled_tasks': _scheduled_task_stats(now, last_24h, prev_24h_start, user),
        'awx': _awx_stats(now, last_24h, last_7d, prev_7d_start, user),
        'time_machine': _time_machine_stats(last_24h, last_7d),
        'connections': _connection_stats(),
        'activity': _recent_activity(user),
        'attention': _attention_items(now, last_24h, user),
    }


# ── Queries ───────────────────────────────────────────────────────────────────

def _query_stats(now, last_24h, last_7d, prev_24h_start, user=None) -> dict:
    from queries.models import SavedQuery, QueryExecutionLog

    total_queries = SavedQuery.objects.count()

    base_qs = QueryExecutionLog.objects.filter(executed_by=user) if user else QueryExecutionLog.objects.all()
    execs_24h = base_qs.filter(executed_at__gte=last_24h)
    execs_7d = base_qs.filter(executed_at__gte=last_7d)

    count_24h = execs_24h.count()
    success_24h = execs_24h.filter(success=True).count()
    failed_24h = execs_24h.filter(success=False).count()

    total_7d = execs_7d.count()
    success_7d = execs_7d.filter(success=True).count()
    success_rate = round(success_7d / total_7d * 100, 1) if total_7d > 0 else None

    # Previous 24h window for delta
    prev_count = base_qs.filter(
        executed_at__gte=prev_24h_start, executed_at__lt=last_24h
    ).count()

    # 7-day daily breakdown for sparkline
    daily = list(
        execs_7d
        .annotate(day=TruncDate('executed_at'))
        .values('day')
        .annotate(n=Count('id'))
        .order_by('day')
    )
    sparkline = _fill_sparkline(daily, now, days=7)

    return {
        'total_saved': total_queries,
        'executions_24h': count_24h,
        'prev_24h': prev_count,
        'running_now': 0,
        'success_24h': success_24h,
        'failed_24h': failed_24h,
        'success_rate_7d': success_rate,
        'sparkline_7d': sparkline,
    }


# ── Scheduled Tasks ───────────────────────────────────────────────────────────

def _scheduled_task_stats(now, last_24h, prev_24h_start, user=None) -> dict:
    from queries.models import ScheduledTask, ScheduledTaskExecution

    task_qs = ScheduledTask.objects.filter(created_by=user) if user else ScheduledTask.objects.all()
    total = task_qs.count()
    active = task_qs.filter(status='active').count()
    paused = task_qs.filter(status='paused').count()

    exec_base = ScheduledTaskExecution.objects.filter(scheduled_task__created_by=user) if user else ScheduledTaskExecution.objects.all()
    execs = exec_base.filter(created_at__gte=last_24h)
    status_counts = {
        row['status']: row['n']
        for row in execs.values('status').annotate(n=Count('id'))
    }
    count_24h = execs.count()

    prev_count = exec_base.filter(
        created_at__gte=prev_24h_start, created_at__lt=last_24h
    ).count()

    overdue = task_qs.filter(
        status='active',
        next_run_at__lt=timezone.now() - timedelta(minutes=5),
        next_run_at__isnull=False,
    ).count()

    # Sparkline: last 7 days of scheduled task executions
    last_7d = now - timedelta(days=7)
    daily = list(
        exec_base.filter(created_at__gte=last_7d)
        .annotate(day=TruncDate('created_at'))
        .values('day')
        .annotate(n=Count('id'))
        .order_by('day')
    )
    sparkline = _fill_sparkline(daily, now, days=7)

    return {
        'total': total,
        'active': active,
        'paused': paused,
        'disabled': total - active - paused,
        'executions_24h': count_24h,
        'prev_24h': prev_count,
        'success_24h': status_counts.get('success', 0),
        'failed_24h': status_counts.get('failed', 0),
        'running_now': status_counts.get('running', 0),
        'overdue': overdue,
        'sparkline_7d': sparkline,
    }


# ── AWX ───────────────────────────────────────────────────────────────────────

def _awx_stats(now, last_24h, last_7d, prev_7d_start, user=None) -> dict:
    from awx.models import AWXConnection, AutomationTemplate, AutomationRequest, AutomationExecution

    connections = AWXConnection.objects.count()
    templates = AutomationTemplate.objects.count()

    req_base = AutomationRequest.objects.filter(requested_by=user) if user else AutomationRequest.objects.all()
    requests_7d = req_base.filter(created_at__gte=last_7d)
    req_map = {
        row['status']: row['n']
        for row in requests_7d.values('status').annotate(n=Count('id'))
    }

    total_requests = requests_7d.count()
    successful_requests = req_map.get('successful', 0)
    failed_requests = req_map.get('failed', 0) + req_map.get('cancelled', 0)
    success_rate = (
        round(successful_requests / total_requests * 100, 1)
        if total_requests > 0 else None
    )

    # Previous 7d for delta
    prev_total = req_base.filter(
        created_at__gte=prev_7d_start, created_at__lt=last_7d
    ).count()

    exec_base = AutomationExecution.objects.filter(automation_request__requested_by=user) if user else AutomationExecution.objects.all()
    running_jobs = exec_base.filter(
        status__in=['running', 'waiting', 'pending']
    ).count()

    # Sparkline for AWX
    daily = list(
        requests_7d
        .annotate(day=TruncDate('created_at'))
        .values('day')
        .annotate(n=Count('id'))
        .order_by('day')
    )
    sparkline = _fill_sparkline(daily, now, days=7)

    return {
        'connections': connections,
        'templates': templates,
        'requests_7d': total_requests,
        'prev_7d': prev_total,
        'running_jobs': running_jobs,
        'successful_7d': successful_requests,
        'failed_7d': failed_requests,
        'failed_24h': req_base.filter(
            created_at__gte=last_24h, status__in=['failed', 'cancelled']
        ).count(),
        'success_rate_7d': success_rate,
        'sparkline_7d': sparkline,
    }


# ── Time Machine ──────────────────────────────────────────────────────────────

def _time_machine_stats(last_24h, last_7d) -> dict:
    from time_machine.models import QueryExecutionSnapshot

    total_snapshots = QueryExecutionSnapshot.objects.count()
    snapshots_24h = QueryExecutionSnapshot.objects.filter(executed_at__gte=last_24h)
    changed_24h = snapshots_24h.filter(has_changes=True).count()

    monitored_queries = (
        QueryExecutionSnapshot.objects
        .filter(executed_at__gte=last_7d)
        .values('saved_query_id')
        .distinct()
        .count()
    )

    annotated_total = (
        QueryExecutionSnapshot.objects
        .exclude(annotation__isnull=True)
        .exclude(annotation='')
        .count()
    )

    return {
        'total_snapshots': total_snapshots,
        'snapshots_24h': snapshots_24h.count(),
        'changes_detected_24h': changed_24h,
        'monitored_queries': monitored_queries,
        'annotated_snapshots': annotated_total,
    }


# ── APIC Connections ──────────────────────────────────────────────────────────

def _connection_stats() -> dict:
    from apic_connections.models import APICConnection

    total = APICConnection.objects.count()
    active = APICConnection.objects.filter(is_active=True).count()

    return {
        'total': total,
        'active': active,
        'inactive': total - active,
    }


# ── Recent Activity ───────────────────────────────────────────────────────────

def _recent_activity(user=None) -> list:
    from audit.models import AuditLog
    try:
        qs = AuditLog.objects.all()
        if user:
            qs = qs.filter(user=user)
        events = (
            qs
            .order_by('-timestamp')
            .values('timestamp', 'action', 'resource_type', 'username', 'success')
            [:10]
        )
        return [
            {
                'time': e['timestamp'].isoformat() if e['timestamp'] else None,
                'action': e['action'],
                'resource': e['resource_type'],
                'user': e['username'],
                'success': e['success'],
            }
            for e in events
        ]
    except Exception:
        return []


# ── Attention Items ───────────────────────────────────────────────────────────
# Actionable alerts the user should see first thing. Each item has a message,
# severity level, and a link so they can jump straight to the fix.

def _attention_items(now, last_24h, user=None) -> list:
    from queries.models import ScheduledTask, ScheduledTaskExecution, QueryExecutionLog
    from apic_connections.models import APICConnection

    items = []

    # Overdue scheduled tasks
    task_qs = ScheduledTask.objects.filter(created_by=user) if user else ScheduledTask.objects.all()
    overdue_tasks = task_qs.filter(
        status='active',
        next_run_at__lt=now - timedelta(minutes=5),
        next_run_at__isnull=False,
    )
    overdue_count = overdue_tasks.count()
    if overdue_count > 0:
        items.append({
            'severity': 'critical',
            'message': f'{overdue_count} scheduled {"task is" if overdue_count == 1 else "tasks are"} overdue',
            'link': '/tasks',
        })

    # Failed query executions in last 24h
    exec_qs = QueryExecutionLog.objects.filter(executed_by=user) if user else QueryExecutionLog.objects.all()
    failed_queries = exec_qs.filter(
        executed_at__gte=last_24h, success=False
    ).count()
    if failed_queries > 0:
        items.append({
            'severity': 'warning',
            'message': f'{failed_queries} query {"execution" if failed_queries == 1 else "executions"} failed in the last 24h',
            'link': '/saved',
        })

    # Failed scheduled task executions in last 24h
    sched_exec_qs = ScheduledTaskExecution.objects.filter(scheduled_task__created_by=user) if user else ScheduledTaskExecution.objects.all()
    failed_scheduled = sched_exec_qs.filter(
        created_at__gte=last_24h, status='failed'
    ).count()
    if failed_scheduled > 0:
        items.append({
            'severity': 'warning',
            'message': f'{failed_scheduled} scheduled task {"execution" if failed_scheduled == 1 else "executions"} failed today',
            'link': '/tasks',
        })

    # Inactive APIC connections
    inactive = APICConnection.objects.filter(is_active=False).count()
    if inactive > 0:
        items.append({
            'severity': 'info',
            'message': f'{inactive} APIC {"connection is" if inactive == 1 else "connections are"} inactive',
            'link': '/settings/connections',
        })

    # No connections at all — onboarding nudge
    total_conn = APICConnection.objects.count()
    if total_conn == 0:
        items.append({
            'severity': 'info',
            'message': 'No APIC connections configured — add one to get started',
            'link': '/settings/connections',
        })

    return items


# ── Helpers ───────────────────────────────────────────────────────────────────

def _fill_sparkline(daily_rows, now, days=7) -> list[int]:
    """Turn a queryset of {day, n} dicts into a dense list of counts,
    one per day for the last `days` days. Missing days get 0."""
    by_date = {row['day']: row['n'] for row in daily_rows}
    today = now.date()
    return [by_date.get(today - timedelta(days=days - 1 - i), 0) for i in range(days)]
