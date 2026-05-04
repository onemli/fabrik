# queries/views/execution.py
#
# Read-only access to the lightweight execution log (QueryExecutionLog).
# Background execution was removed — all query execution now happens inline
# on the frontend, and the audit trail lands in QueryExecutionLog.

from rest_framework import viewsets, filters
from rest_framework.permissions import IsAuthenticated
from django.db.models import Q
from ..models import QueryExecutionLog
from ..serializers import QueryExecutionLogSerializer


class QueryExecutionLogViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only view of query execution history.

    Users can see logs for queries they own, queries shared with them,
    and any query they personally executed — even public ones they don't own.
    """
    serializer_class = QueryExecutionLogSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['executed_at', 'execution_time_ms', 'result_count']
    ordering = ['-executed_at']

    def get_queryset(self):
        user = self.request.user
        return QueryExecutionLog.objects.filter(
            Q(query__created_by=user) |
            Q(query__shared_with=user) |
            Q(query__is_public=True) |
            Q(executed_by=user)
        ).select_related('query', 'executed_by').distinct()
