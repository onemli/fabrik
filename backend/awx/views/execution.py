# awx/views/execution.py
#
# ViewSet for AutomationExecution — the per-row or per-batch job records created
# when a request is processed. Primarily read-only from the API side; the execution
# engine creates these records internally. The WebSocket stream and relaunch
# endpoints are the main interactive pieces here.

import logging
from typing import Any, Union

from rest_framework import viewsets, status, filters
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.serializers import BaseSerializer
from django_filters.rest_framework import DjangoFilterBackend
from django.db.models import QuerySet
from django.http import HttpResponse
from django.utils import timezone
from audit.services import AuditService

logger = logging.getLogger(__name__)


# awx/views/execution.py
#
# Read-only ViewSet for AutomationExecution plus two action endpoints:
#   output()     — returns JobOutputChunk rows for the live terminal viewer
#   relaunch()   — triggers retry_failed_execution for per-row/hybrid jobs
#
# _heal_missing_events is the most interesting piece here: if the Celery
# streaming task crashed before the job finished, some events never made
# it to the DB. When the frontend opens the output endpoint for a completed
# job, this function detects the gap, fetches the missing events from AWX,
# and backfills them so the terminal shows a complete log.


_ANSIBLE_RESULT_EVENTS = {
    'runner_on_ok',
    'runner_on_failed',
    'runner_on_unreachable',
    'runner_on_skipped',
    'runner_item_on_ok',
    'runner_item_on_failed',
    'runner_item_on_skipped',
}


def _heal_missing_events(execution: 'AutomationExecution', db_chunks: list) -> list:
    """Back-fill missing and enrich thin job events from AWX for terminal executions.

    Two failure modes this recovers from:

    1. Streaming task died mid-job → trailing events exist in AWX but not in
       JobOutputChunk. Detected by awx_total > db_count.
    2. AWX writes event rows in two phases: the event row is created first,
       then `event_data.res` (module return — ACI `current`, `mo`,
       `invocation.module_args`, etc.) is written seconds later. If the poller
       persisted between those two writes, the DB chunk has no `res`. Detected
       by scanning db_chunks for ansible result events missing `res`.

    Both are repaired with update_or_create (idempotent). AWX API failures are
    swallowed and db_chunks returned unchanged — partial output beats a 500.
    """
    from django.utils.dateparse import parse_datetime
    from awx.models import JobOutputChunk
    from awx.services.awx_client import AWXClient

    try:
        client = AWXClient.for_connection(execution.awx_connection)

        enrichable_counters = {
            c.counter
            for c in db_chunks
            if c.event_type in _ANSIBLE_RESULT_EVENTS and not (c.event_data or {}).get('res')
        }

        check_url = f'{client.base_url}/api/v2/jobs/{execution.awx_job_id}/job_events/?page_size=1'
        r = client.session.get(check_url, verify=client.verify_ssl, timeout=10)
        if r.status_code != 200:
            return db_chunks

        awx_total = r.json().get('count', 0)
        db_count = len(db_chunks)
        needs_healing = awx_total > db_count
        needs_enrichment = bool(enrichable_counters)

        if not needs_healing and not needs_enrichment:
            return db_chunks

        existing_by_counter = {c.counter: c for c in db_chunks}
        last_db_counter = db_chunks[-1].counter if db_chunks else 0

        # When enriching, we must revisit counters already in DB, so start from 0.
        # Pure healing can skip straight past the last known counter.
        cursor = 0 if needs_enrichment else last_db_counter

        logger.info(
            'Healing execution %s (job %s): db=%d, awx=%d, missing=%d, '
            'enrichable=%d, cursor_start=%d',
            execution.id,
            execution.awx_job_id,
            db_count,
            awx_total,
            max(0, awx_total - db_count),
            len(enrichable_counters),
            cursor,
        )

        base_url = f'{client.base_url}/api/v2/jobs/{execution.awx_job_id}/job_events/'
        touched_chunks = []

        while True:
            r = client.session.get(
                base_url,
                params={
                    'order_by': 'counter',
                    'counter__gt': cursor,
                    'page_size': 100,
                },
                verify=client.verify_ssl,
                timeout=15,
            )
            if r.status_code != 200:
                break

            data = r.json()
            events = data.get('results', [])
            if not events:
                break

            for event in events:
                counter = event.get('counter', 0)
                if counter == 0:
                    continue
                cursor = max(cursor, counter)

                event_data_raw = event.get('event_data') or {}
                awx_has_res = bool(event_data_raw.get('res'))
                existing = existing_by_counter.get(counter)

                if existing is not None:
                    # Skip unless this is a counter we want to enrich AND AWX
                    # actually now carries the richer payload.
                    if counter not in enrichable_counters or not awx_has_res:
                        continue

                awx_created = None
                created_str = event.get('created')
                if created_str:
                    try:
                        awx_created = parse_datetime(created_str)
                    except Exception:
                        pass
                if awx_created is None:
                    awx_created = timezone.now()

                merged_event_data = {
                    'task': event.get('task', ''),
                    'play': event.get('play', ''),
                    'role': event.get('role', ''),
                    'host_name': event.get('host_name', ''),
                }
                merged_event_data.update(event_data_raw)

                chunk, _ = JobOutputChunk.objects.update_or_create(
                    execution=execution,
                    counter=counter,
                    defaults={
                        'awx_job_id': int(execution.awx_job_id),
                        'event_type': event.get('event', 'unknown'),
                        'stdout': event.get('stdout', ''),
                        'stderr': event.get('stderr', ''),
                        'event_data': merged_event_data,
                        'awx_created': awx_created,
                    },
                )
                touched_chunks.append(chunk)

            if not data.get('next'):
                break

        if touched_chunks:
            logger.info(
                'Healed/enriched %d events for execution %s',
                len(touched_chunks),
                execution.id,
            )
            merged = {c.counter: c for c in db_chunks}
            for c in touched_chunks:
                merged[c.counter] = c
            return sorted(merged.values(), key=lambda c: c.counter)

    except Exception as e:
        logger.warning(
            'Event healing failed for execution %s (non-critical): %s',
            execution.id,
            e,
        )

    return db_chunks


# Maximum page_size for AWX proxy endpoints to prevent abuse
_AWX_MAX_PAGE_SIZE = 100


def _clamp_page_size(request: Request, default: int = 50) -> int:
    """Parse and clamp page_size from query params."""
    try:
        val = int(request.query_params.get('page_size', default))
    except (ValueError, TypeError):
        val = default
    return max(1, min(val, _AWX_MAX_PAGE_SIZE))


from awx.models import AutomationExecution
from awx.services.awx_client import AWXClient
from awx.serializers import (
    AutomationExecutionListSerializer,
    AutomationExecutionDetailSerializer,
)


class AutomationExecutionViewSet(viewsets.ReadOnlyModelViewSet):
    """
    ViewSet for automation executions (read-only)
    """

    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['automation_request', 'status']
    search_fields = ['automation_request__title']
    ordering_fields = ['created_at', 'started_at', 'finished_at', 'status']
    ordering = ['-created_at']

    def get_queryset(self) -> QuerySet[AutomationExecution]:
        """Filter executions based on request ownership"""
        user = self.request.user
        return AutomationExecution.objects.select_related(
            'automation_request', 'awx_connection'
        ).filter(automation_request__requested_by=user)

    def get_serializer_class(self) -> type[BaseSerializer]:
        if self.action == 'list':
            return AutomationExecutionListSerializer
        else:
            return AutomationExecutionDetailSerializer

    # Legacy /stdout/ endpoint removed - use /output/ instead (JobOutputChunk-based)
    # Enterprise retention policy ensures full stdout without truncation

    @action(detail=True, methods=['post'])
    def cancel(self, request: Request, pk: Any = None) -> Response:
        """
        Cancel running execution
        POST /api/awx/executions/{id}/cancel/
        """
        from django.db import transaction

        try:
            with transaction.atomic():
                # Lock the row to prevent concurrent cancel/status-update races
                execution = AutomationExecution.objects.select_for_update().get(pk=pk)

                # Check ownership
                if execution.automation_request.requested_by != request.user:
                    return Response(
                        {'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN
                    )

                # Check if cancellable (re-check under lock)
                if execution.is_terminal_status:
                    return Response(
                        {'error': 'Execution already finished'}, status=status.HTTP_400_BAD_REQUEST
                    )

                # Create client for this execution's connection
                client = AWXClient.for_connection(execution.awx_connection)

                # Cancel job
                success, error = client.cancel_job(execution.awx_job_id)

                if success:
                    execution.status = AutomationExecution.STATUS_CANCELED
                    execution.finished_at = timezone.now()
                    execution.save(update_fields=['status', 'finished_at', 'updated_at'])

                    AuditService.log(
                        user=request.user,
                        action='automation_execution_cancelled',
                        category='awx_automation',
                        resource_type='AutomationExecution',
                        resource_id=execution.id,
                        description=f'Execution {execution.awx_job_id} cancelled',
                        request=self.request,
                    )

                    return Response({'message': 'Execution cancelled'})
                else:
                    return Response({'error': error}, status=status.HTTP_400_BAD_REQUEST)

        except AutomationExecution.DoesNotExist:
            return Response({'error': 'Execution not found'}, status=status.HTTP_404_NOT_FOUND)
        except Exception:
            logger.exception('AWX API request failed')
            return Response(
                {'error': 'An internal error occurred'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    MAX_RELAUNCH_COUNT = 3

    @action(detail=True, methods=['post'])
    def relaunch(self, request: Request, pk: Any = None) -> Response:
        """Relaunch a terminal-status execution by re-running the same AutomationRequest.

        POST /api/awx/executions/{id}/relaunch/

        Routes through ExecutionEngine so workflow launches go through the same
        ephemeral-clone path as the original launch — this is what makes
        relaunch survive AWX's launch-time snapshot semantics.
        """
        from awx.services.execution_engine import ExecutionEngine

        try:
            execution = AutomationExecution.objects.select_related(
                'automation_request',
                'automation_request__template',
                'awx_connection',
            ).get(pk=pk)
        except AutomationExecution.DoesNotExist:
            return Response(
                {'error': 'Execution not found'},
                status=status.HTTP_404_NOT_FOUND,
            )

        if execution.automation_request.requested_by != request.user:
            return Response(
                {'error': 'Permission denied'},
                status=status.HTTP_403_FORBIDDEN,
            )
        if not execution.is_terminal_status:
            return Response(
                {'error': 'Only terminal executions can be relaunched'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if execution.relaunch_count >= self.MAX_RELAUNCH_COUNT:
            return Response(
                {'error': f'Maximum relaunch limit ({self.MAX_RELAUNCH_COUNT}) reached'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            engine = ExecutionEngine()
            success, execution_ids, error = engine.execute_request(
                request_id=execution.automation_request_id,
                relaunch_of_execution_id=execution.id,
            )
        except Exception:
            logger.exception('Relaunch failed for execution %s', pk)
            return Response(
                {'error': 'An internal error occurred'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        if not success or not execution_ids:
            return Response(
                {'error': error or 'Relaunch failed'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        new_execution = AutomationExecution.objects.get(id=execution_ids[0])

        AuditService.log(
            user=request.user,
            action='automation_execution_relaunched',
            category='awx_automation',
            resource_type='AutomationExecution',
            resource_id=execution.id,
            description=(
                f'Execution {execution.awx_job_id} relaunched → new job {new_execution.awx_job_id}'
            ),
            metadata={'new_execution_id': str(new_execution.id)},
            request=self.request,
        )

        return Response(
            {
                'message': 'Execution relaunched',
                'new_execution_id': str(new_execution.id),
                'new_awx_job_id': new_execution.awx_job_id,
            }
        )

    @action(detail=True, methods=['get'])
    def output(self, request: Request, pk: Any = None) -> Response:
        """
        Get full job output for this execution (Phase 2)

        Returns all output chunks in order with metadata.
        GET /api/awx/executions/{id}/output/
        """
        execution = self.get_object()

        # Check ownership
        if execution.automation_request.requested_by != request.user:
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

        # Get all chunks ordered by counter
        chunks = list(execution.output_chunks.all().order_by('counter'))

        # Self-healing: if job is done but DB is missing trailing events (e.g. after
        # a Celery worker crash mid-stream), fetch from AWX and backfill on demand.
        if (
            execution.is_terminal_status
            and execution.awx_job_id
            and getattr(execution, 'awx_connection_id', None)
        ):
            chunks = _heal_missing_events(execution, chunks)

        # Combine stdout/stderr
        full_stdout = '\n'.join([chunk.stdout for chunk in chunks if chunk.stdout])
        full_stderr = '\n'.join([chunk.stderr for chunk in chunks if chunk.stderr])

        return Response(
            {
                'execution_id': str(execution.id),
                'awx_job_id': execution.awx_job_id,
                'status': execution.status,
                'chunk_count': len(chunks),
                'stdout': full_stdout,
                'stderr': full_stderr,
                'chunks': [
                    {
                        'counter': chunk.counter,
                        'event_type': chunk.event_type,
                        'stdout': chunk.stdout,
                        'stderr': chunk.stderr,
                        'timestamp': chunk.awx_created.isoformat(),
                        'event_data': chunk.event_data,
                        'awx_job_id': chunk.awx_job_id,
                        'task': chunk.event_data.get('task', '') if chunk.event_data else '',
                        'play': chunk.event_data.get('play', '') if chunk.event_data else '',
                        'role': chunk.event_data.get('role', '') if chunk.event_data else '',
                        'host_name': chunk.event_data.get('host_name', '')
                        if chunk.event_data
                        else '',
                    }
                    for chunk in chunks
                ],
            }
        )

    @action(detail=True, methods=['get'])
    def download_output(self, request: Request, pk: Any = None) -> Union[Response, HttpResponse]:
        """
        Download full job output as text file (Phase 2)

        GET /api/awx/executions/{id}/download_output/
        """
        from django.http import HttpResponse

        execution = self.get_object()

        # Check ownership
        if execution.automation_request.requested_by != request.user:
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

        chunks = execution.output_chunks.all().order_by('counter')
        full_output = '\n'.join([chunk.stdout for chunk in chunks if chunk.stdout])

        AuditService.log(
            user=request.user,
            action='execute_automation_request',
            category='awx_automation',
            resource_type='AutomationExecution',
            resource_id=execution.id,
            resource_name=f'Execution #{execution.id}',
            description=f'Downloaded output for AWX job {execution.awx_job_id}',
            metadata={'awx_job_id': execution.awx_job_id},
            request=request,
        )

        response = HttpResponse(full_output, content_type='text/plain')
        response['Content-Disposition'] = (
            f'attachment; filename="job_{execution.awx_job_id}_output.txt"'
        )
        return response

    @action(detail=True, methods=['get'], url_path='workflow-nodes')
    def workflow_nodes(self, request: Request, pk: Any = None) -> Response:
        """
        Get workflow job nodes for this execution

        Returns all workflow nodes (SCM jobs, etc.) that run before/during the main job.
        This helps users understand the full execution pipeline.

        GET /api/awx/executions/{id}/workflow-nodes/
        """
        execution = self.get_object()

        # Check ownership
        if execution.automation_request.requested_by != request.user:
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

        # Check if this is a workflow job
        if not execution.awx_job_id:
            return Response({'nodes': []})

        # First check execution_metadata for cached workflow nodes (from job_monitor)
        if 'workflow_nodes' in execution.execution_metadata:
            cached_nodes = execution.execution_metadata['workflow_nodes']
            if cached_nodes:
                return Response({'nodes': cached_nodes, 'cached': True})

        # If not in metadata, fetch from AWX API (for old executions or initial load)
        try:
            # Create client for this execution's connection
            client = AWXClient.for_connection(execution.awx_connection)

            # Check if this is a workflow template
            if execution.automation_request.template.awx_type != 'workflow_template':
                return Response({'nodes': []})

            # Direct workflow job - get nodes
            workflow_nodes_url = (
                f'{client.base_url}/api/v2/workflow_jobs/{execution.awx_job_id}/workflow_nodes/'
            )
            nodes_response = client.session.get(
                workflow_nodes_url, verify=client.verify_ssl, timeout=client.timeout
            )

            if nodes_response.status_code == 200:
                nodes_data = nodes_response.json()
                return Response({'nodes': nodes_data.get('results', []), 'cached': False})

            logger.warning(
                'AWX returned %d when fetching workflow nodes for execution %s',
                nodes_response.status_code,
                pk,
            )
            return Response({'nodes': [], 'error': 'Failed to fetch workflow nodes from AWX'})

        except Exception:
            logger.exception('Error fetching workflow nodes for execution %s', pk)
            return Response({'nodes': []})

    @action(detail=True, methods=['get'], url_path='node-output/(?P<awx_job_id>[0-9]+)')
    def node_output(self, request: Request, pk: Any = None, awx_job_id: Any = None) -> Response:
        """
        Get output for a specific workflow node job (real-time from AWX)

        This endpoint fetches job events directly from AWX for workflow node jobs.
        Used for displaying SCM sync, inventory updates, and other pre-playbook jobs.

        GET /api/awx/executions/{id}/node-output/{awx_job_id}/
        """
        execution = self.get_object()

        # Check ownership
        if execution.automation_request.requested_by != request.user:
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

        # Validate awx_job_id belongs to this execution's workflow
        # For workflow templates, the node jobs should be related to the execution's main job
        # For regular jobs, the awx_job_id must match exactly
        if not execution.execution_metadata.get('workflow_nodes'):
            # Not a workflow execution or no cached nodes - verify direct match
            if str(awx_job_id) != str(execution.awx_job_id):
                return Response(
                    {'error': 'Job ID does not belong to this execution'},
                    status=status.HTTP_403_FORBIDDEN,
                )
        else:
            # Workflow execution - verify the job is in the cached workflow nodes
            valid_job_ids = {
                str(node.get('summary_fields', {}).get('job', {}).get('id', ''))
                for node in execution.execution_metadata.get('workflow_nodes', [])
            }
            if str(awx_job_id) not in valid_job_ids and str(awx_job_id) != str(
                execution.awx_job_id
            ):
                return Response(
                    {'error': 'Job ID does not belong to this execution workflow'},
                    status=status.HTTP_403_FORBIDDEN,
                )

        try:
            # Create client for this execution's connection
            client = AWXClient.for_connection(execution.awx_connection)

            # Fetch job events from AWX
            events_url = f'{client.base_url}/api/v2/jobs/{awx_job_id}/job_events/'

            response = client.session.get(
                events_url,
                params={'page_size': 200, 'order_by': 'counter'},
                verify=client.verify_ssl,
                timeout=client.timeout,
            )

            if response.status_code == 200:
                events_data = response.json()

                # Transform to our format (similar to output endpoint)
                chunks = []
                for event in events_data.get('results', []):
                    chunks.append(
                        {
                            'counter': event.get('counter', 0),
                            'event_type': event.get('event', 'runner_on_ok'),
                            'stdout': event.get('stdout', ''),
                            'stderr': '',
                            'timestamp': event.get('created', ''),
                            'event_data': event.get('event_data', {}),
                            'awx_job_id': int(awx_job_id),
                        }
                    )

                AuditService.log(
                    user=request.user,
                    action='execute_automation_request',
                    category='awx_automation',
                    resource_type='AutomationExecution',
                    resource_id=execution.id,
                    resource_name=f'Execution #{execution.id}',
                    description=f'Accessed node output for AWX job {awx_job_id} (execution #{pk})',
                    metadata={'awx_job_id': int(awx_job_id), 'chunk_count': len(chunks)},
                    request=request,
                )

                return Response(
                    {'awx_job_id': int(awx_job_id), 'chunk_count': len(chunks), 'chunks': chunks}
                )

            return Response(
                {'error': f'Failed to fetch events from AWX: {response.status_code}', 'chunks': []},
                status=response.status_code,
            )

        except Exception:
            logger.exception(f'Error fetching node output for job {awx_job_id}')
            return Response(
                {'error': 'Failed to fetch node output', 'chunks': []},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=True, methods=['get'], url_path='row-results')
    def row_results(self, request: Request, pk: Any = None) -> Response:
        """
        Get per-host/per-row results for a bulk execution.
        GET /api/awx/executions/{id}/row-results/
        """
        execution = self.get_object()

        if execution.automation_request.requested_by != request.user and not request.user.is_staff:
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

        if not execution.row_results:
            return Response(
                {'detail': 'No per-row results available for this execution'},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(
            {
                'execution_id': str(execution.id),
                'row_results': execution.row_results,
            }
        )
