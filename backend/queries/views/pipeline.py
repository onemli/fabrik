# queries/views/pipeline.py
#
# REST endpoints for query pipeline execution. A pipeline is a multi-stage
# query where each stage's output feeds the next stage as filter input.
#
# Endpoints:
#   POST /api/queries/pipeline-executions/          — start a new pipeline
#   GET  /api/queries/pipeline-executions/<id>/      — get pipeline status
#   GET  /api/queries/pipeline-executions/<id>/stages/ — per-stage results
#   POST /api/queries/pipeline-executions/<id>/cancel/ — cancel running pipeline

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.utils import timezone
from celery.result import AsyncResult

from audit.services import AuditService
from queries.models import ChainExecutionJob
from queries.tasks import execute_pipeline


class PipelineExecutionViewSet(viewsets.ReadOnlyModelViewSet):
    """Pipeline execution lifecycle management."""

    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return (
            ChainExecutionJob.objects.filter(
                user=self.request.user,
                execution_mode='pipeline',
            )
            .prefetch_related('iterations')
            .order_by('-created_at')
        )

    def _serialize_job(self, job):
        return {
            'id': str(job.id),
            'status': job.status,
            'execution_mode': job.execution_mode,
            'total_stages': job.total_iterations,
            'completed_stages': job.completed_iterations,
            'failed_stages': job.failed_iterations,
            'current_stage_index': job.current_stage_index,
            'pipeline_stages': job.pipeline_stages,
            'progress_percentage': job.progress_percentage,
            'created_at': job.created_at.isoformat() if job.created_at else None,
            'started_at': job.started_at.isoformat() if job.started_at else None,
            'completed_at': job.completed_at.isoformat() if job.completed_at else None,
            'execution_time_ms': job.execution_time_ms,
            'errors': job.errors,
        }

    def _serialize_stage(self, iteration):
        return {
            'stage_index': iteration.iteration_index,
            'class_name': iteration.extracted_value,
            'status': iteration.status,
            'result': iteration.result,
            'result_count': iteration.result_count,
            'query_url': iteration.query_url,
            'execution_time_ms': iteration.execution_time_ms,
            'error_type': iteration.error_type,
            'error_message': iteration.error_message,
            'started_at': iteration.started_at.isoformat() if iteration.started_at else None,
            'completed_at': iteration.completed_at.isoformat() if iteration.completed_at else None,
        }

    def list(self, request):
        queryset = self.get_queryset()[:50]
        return Response([self._serialize_job(j) for j in queryset])

    def retrieve(self, request, pk=None):
        try:
            job = self.get_queryset().get(id=pk)
            data = self._serialize_job(job)
            data['aggregated_results'] = job.aggregated_results
            return Response(data)
        except ChainExecutionJob.DoesNotExist:
            return Response({'error': 'Pipeline not found'}, status=status.HTTP_404_NOT_FOUND)

    def create(self, request):
        """Start a new pipeline execution.

        Request body:
            flow_data: dict          — full canvas with pipeline edges
            apic_connection_id: int  — APIC connection to query against
            query_name: str          — display name for this execution
            saved_query_id: int      — optional, link to SavedQuery
        """
        flow_data = request.data.get('flow_data')
        connection_id = request.data.get('apic_connection_id')
        query_name = request.data.get('query_name', 'Pipeline Query')
        saved_query_id = request.data.get('saved_query_id')

        if not flow_data:
            return Response({'error': 'flow_data is required'}, status=status.HTTP_400_BAD_REQUEST)
        if not connection_id:
            return Response(
                {'error': 'apic_connection_id is required'}, status=status.HTTP_400_BAD_REQUEST
            )

        # Validate that pipeline edges exist
        edges = flow_data.get('edges', [])
        pipeline_edges = [e for e in edges if e.get('data', {}).get('edgeType') == 'pipeline']
        if not pipeline_edges:
            return Response(
                {
                    'error': 'No pipeline edges found. Use regular execution for single-stage queries.'
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Verify APIC connection access
        from apic_connections.models import APICConnection

        try:
            connection = APICConnection.objects.get(id=connection_id)
            if not connection.can_be_accessed_by(request.user):
                return Response(
                    {'error': 'Access denied to APIC connection'}, status=status.HTTP_403_FORBIDDEN
                )
        except APICConnection.DoesNotExist:
            return Response(
                {'error': 'APIC connection not found'}, status=status.HTTP_404_NOT_FOUND
            )

        # Find or reference SavedQuery
        query_ref = None
        if saved_query_id:
            from queries.models import SavedQuery

            try:
                query_ref = SavedQuery.objects.get(id=saved_query_id)
            except SavedQuery.DoesNotExist:
                pass

        # If no SavedQuery, we need a temporary reference — use the first one owned by user
        # or create the job without a query reference
        if not query_ref:
            from queries.models import SavedQuery

            query_ref = SavedQuery.objects.filter(created_by=request.user).first()
            if not query_ref:
                return Response(
                    {'error': 'Save the query first before running a pipeline'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        job = ChainExecutionJob.objects.create(
            query=query_ref,
            user=request.user,
            status=ChainExecutionJob.STATUS_PENDING,
            execution_mode='pipeline',
            chain_config={
                'flow_data': flow_data,
                'apic_connection_id': connection_id,
                'query_name': query_name,
            },
        )

        task = execute_pipeline.delay(str(job.id))
        job.celery_task_id = task.id
        job.save(update_fields=['celery_task_id'])

        AuditService.log(
            user=request.user,
            action='pipeline_execution_started',
            category='query_execution',
            resource_type='ChainExecutionJob',
            resource_id=job.id,
            resource_name=query_name,
            description=f"Pipeline '{query_name}' started with {len(pipeline_edges)} pipeline edge(s)",
            metadata={
                'celery_task_id': task.id,
                'apic_connection_id': connection_id,
                'pipeline_edges': len(pipeline_edges),
            },
            request=request,
        )

        return Response(self._serialize_job(job), status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'])
    def stages(self, request, pk=None):
        """Return per-stage results for a pipeline execution."""
        try:
            job = self.get_queryset().get(id=pk)
        except ChainExecutionJob.DoesNotExist:
            return Response({'error': 'Pipeline not found'}, status=status.HTTP_404_NOT_FOUND)

        iterations = job.iterations.all().order_by('iteration_index')
        return Response([self._serialize_stage(it) for it in iterations])

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        """Cancel a running pipeline execution."""
        try:
            job = self.get_queryset().get(id=pk)
        except ChainExecutionJob.DoesNotExist:
            return Response({'error': 'Pipeline not found'}, status=status.HTTP_404_NOT_FOUND)

        if job.status not in [ChainExecutionJob.STATUS_PENDING, ChainExecutionJob.STATUS_RUNNING]:
            return Response(
                {'error': f'Cannot cancel pipeline with status: {job.status}'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if job.celery_task_id:
            AsyncResult(job.celery_task_id).revoke(terminate=True)

        job.status = ChainExecutionJob.STATUS_CANCELLED
        job.completed_at = timezone.now()
        job.save(update_fields=['status', 'completed_at'])

        AuditService.log(
            user=request.user,
            action='pipeline_execution_cancelled',
            category='query_execution',
            resource_type='ChainExecutionJob',
            resource_id=job.id,
            resource_name=job.chain_config.get('query_name', ''),
            description='Pipeline cancelled',
            request=request,
        )

        return Response(
            {
                'message': 'Pipeline cancelled',
                'id': str(job.id),
                'status': job.status,
            }
        )
