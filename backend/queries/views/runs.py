# queries/views/runs.py
#
# The query run API: start a saved query on the server and read its result,
# without the UI. A person (signed in) or a program (an API key, api_keys/)
# can use it.
#
#   POST /api/queries/runs/                         {"query": 12, "connections": [3, 4], "variables": {}}
#                                                   -> 202, one run per connection, each "pending"
#   GET  /api/queries/runs/{id}/                    the run: status, row count, error
#   GET  /api/queries/runs/{id}/rows/?after=0&limit=1000
#                                                   its rows, in order; "next" is the "after" of the next page
#   GET  /api/queries/runs/latest/?query=12&connection=3
#                                                   the latest successful run of a query on a connection
#   GET  /api/queries/runs/?query=12&connection=3&status=success
#                                                   runs, newest first
#
# Who sees what: a run is visible to whoever can see both its query and its
# connection, the same rule the UI uses for them. Starting a run needs the
# queries.add_queryrun permission, reading one queries.view_queryrun
# (users/permissions.py), and the group must be allowed to execute queries.

from django.db import transaction
from django.db.models import Q
from rest_framework import status, viewsets
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.authentication import JWTAuthentication

from api_keys.authentication import ApiKeyAuthentication
from api_keys.models import ApiKey
from apic_connections.models import APICConnection
from audit.services import AuditService
from queries.models import QueryRun, QueryRunRow, SavedQuery
from queries.serializers_runs import QueryRunSerializer, RunRequestSerializer
from queries.tasks import run_query
from users.permissions import FabrikModelPermissions
from users.quota_service import QuotaService

DEFAULT_ROWS = 1000
MAX_ROWS = 5000


def visible_queries(user):
    return SavedQuery.objects.filter(
        Q(created_by=user) | Q(shared_with=user) | Q(is_public=True)
    ).distinct()


def visible_connections(user):
    if user.is_staff:
        return APICConnection.objects.all()
    return APICConnection.objects.filter(
        Q(created_by=user) | Q(shared_with=user) | Q(is_public=True)
    ).distinct()


def _whole_number(text, name: str, default: int | None = None) -> int | None:
    if text in (None, ''):
        return default
    try:
        return int(text)
    except ValueError:
        raise ValidationError({name: 'A whole number.'})


class QueryRunViewSet(viewsets.GenericViewSet):
    authentication_classes = [ApiKeyAuthentication, JWTAuthentication, SessionAuthentication]
    permission_classes = [IsAuthenticated, FabrikModelPermissions]
    serializer_class = QueryRunSerializer
    queryset = QueryRun.objects.none()  # FabrikModelPermissions reads the model from it

    def get_queryset(self):
        user = self.request.user
        runs = QueryRun.objects.select_related('requested_by').filter(
            saved_query__in=visible_queries(user), apic_connection__in=visible_connections(user)
        )
        query = _whole_number(self.request.query_params.get('query'), 'query')
        connection = _whole_number(self.request.query_params.get('connection'), 'connection')
        if query is not None:
            runs = runs.filter(saved_query_id=query)
        if connection is not None:
            runs = runs.filter(apic_connection_id=connection)
        if self.request.query_params.get('status'):
            runs = runs.filter(status=self.request.query_params['status'])
        return runs

    def list(self, request):
        page = self.paginate_queryset(self.get_queryset())
        return self.get_paginated_response(QueryRunSerializer(page, many=True).data)

    def retrieve(self, request, pk=None):
        return Response(QueryRunSerializer(self.get_object()).data)

    def create(self, request):
        asked = RunRequestSerializer(data=request.data)
        asked.is_valid(raise_exception=True)
        allowed, reason = QuotaService.check_feature(request.user, 'can_execute_queries')
        if not allowed:
            raise PermissionDenied(reason)

        query = visible_queries(request.user).filter(pk=asked.validated_data['query']).first()
        if query is None:
            raise NotFound('No saved query with this id that you can see.')
        wanted = asked.validated_data['connections']
        connections = {
            c.pk: c for c in visible_connections(request.user).filter(pk__in=wanted, is_active=True)
        }
        unknown = [pk for pk in wanted if pk not in connections]
        if unknown:
            raise ValidationError(
                {'connections': f'No active connection you can see with id {unknown}.'}
            )

        api_key = request.auth if isinstance(request.auth, ApiKey) else None
        runs = [
            QueryRun.objects.create(
                saved_query=query,
                query_name=query.name,
                query_version=f'{query.major_version}.{query.minor_version}',
                apic_connection=connections[pk],
                connection_name=connections[pk].name,
                variables=asked.validated_data['variables'],
                requested_by=request.user,
                api_key_name=api_key.name if api_key else '',
            )
            for pk in dict.fromkeys(wanted)  # once each, in the order asked
        ]

        for run in runs:
            transaction.on_commit(lambda run_id=str(run.pk): run_query.delay(run_id))

        AuditService.log(
            user=request.user,
            action='query_run_started',
            category='query_execution',
            resource_type='SavedQuery',
            resource_id=query.id,
            resource_name=query.name,
            description=f"Query '{query.name}' started on {len(runs)} connection(s)"
            + (f" with API key '{api_key.name}'" if api_key else ''),
            metadata={
                'runs': [str(run.pk) for run in runs],
                'connections': list(dict.fromkeys(wanted)),
            },
            request=request,
        )
        return Response(
            {'runs': QueryRunSerializer(runs, many=True).data}, status=status.HTTP_202_ACCEPTED
        )

    @action(detail=True, methods=['get'])
    def rows(self, request, pk=None):
        run = self.get_object()
        if run.status != QueryRun.SUCCESS:
            return Response(
                {
                    'detail': f'The run is {run.status}; rows are there once it succeeds.',
                    'status': run.status,
                },
                status=status.HTTP_409_CONFLICT,
            )
        after = _whole_number(request.query_params.get('after'), 'after', default=0)
        limit = min(
            max(_whole_number(request.query_params.get('limit'), 'limit', default=DEFAULT_ROWS), 1),
            MAX_ROWS,
        )
        rows = list(
            QueryRunRow.objects.filter(run=run, number__gt=after)
            .order_by('number')
            .values('number', 'data')[:limit]
        )
        last = rows[-1]['number'] if rows else after
        return Response(
            {
                'run': str(run.pk),
                'row_count': run.row_count,
                'rows': rows,
                'next': last if last < (run.row_count or 0) else None,
            }
        )

    @action(detail=False, methods=['get'])
    def latest(self, request):
        query = _whole_number(request.query_params.get('query'), 'query')
        connection = _whole_number(request.query_params.get('connection'), 'connection')
        if query is None or connection is None:
            raise ValidationError({'detail': 'Give both query and connection.'})
        run = self.get_queryset().filter(status=QueryRun.SUCCESS).order_by('-completed_at').first()
        if run is None:
            raise NotFound('This query has no successful run on this connection.')
        return Response(QueryRunSerializer(run).data)
