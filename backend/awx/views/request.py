# awx/views/request.py
#
# ViewSet for AutomationRequest — the object a user creates when they want to
# run an automation template with a specific data set. Most of the real work
# happens in execute_automation_request (Celery task); this view just creates
# the record, validates input, and hands the UUID to the task queue.
#
# The execute action is the critical path: it atomically flips status to RUNNING
# inside the Celery task (not here) so a failed Celery dispatch doesn't leave
# the request stuck in RUNNING forever.

import logging
from typing import Any

from rest_framework import viewsets, status, filters
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.serializers import BaseSerializer
from users.permissions import FabrikModelPermissions
from django.db.models import QuerySet
from django.utils import timezone
from audit.services import AuditService

logger = logging.getLogger(__name__)

_AWX_MAX_PAGE_SIZE = 100


def _clamp_page_size(request: Request, default: int = 50) -> int:
    """Return a page_size in [1, _AWX_MAX_PAGE_SIZE] from query params."""
    try:
        val = int(request.query_params.get('page_size', default))
    except (ValueError, TypeError):
        val = default
    return max(1, min(val, _AWX_MAX_PAGE_SIZE))


from datetime import timedelta
from django.conf import settings as django_settings
from awx.models import AutomationRequest, AutomationExecution
from awx.serializers import (
    AutomationRequestListSerializer,
    AutomationRequestDetailSerializer,
    AutomationRequestCreateSerializer,
)
from awx.tasks import execute_automation_request, retry_failed_execution
from notifications.services import create_notification


class AutomationRequestViewSet(viewsets.ModelViewSet):
    """CRUD + execution endpoints for automation requests.

    The queryset is filtered so users only see their own requests unless
    they're staff. view_type=team_all shows all requests (for managers).
    Status filtering is handled via query param rather than separate endpoints
    because the frontend needs mixed-status views for the tracking dashboard.
    """

    permission_classes = [FabrikModelPermissions]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['title', 'description']
    ordering_fields = ['created_at', 'requested_at', 'approved_at', 'status']
    ordering = ['-created_at']

    def get_queryset(self) -> QuerySet[AutomationRequest]:
        """Filter requests based on ownership"""
        user = self.request.user
        queryset = AutomationRequest.objects.select_related(
            'template', 'awx_connection', 'target_apic', 'requested_by'
        )

        # Filter by status
        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)

        # Filter by view type
        view_type = self.request.query_params.get('view_type')
        if view_type == 'all':
            if not user.is_staff:
                from rest_framework.exceptions import PermissionDenied

                raise PermissionDenied('Staff access required to view all requests.')
            # Admin view: all requests — no filter
        elif view_type == 'my_requests':
            queryset = queryset.filter(requested_by=user)
        else:
            # Default: show user's own requests
            queryset = queryset.filter(requested_by=user)

        return queryset.distinct()

    def get_serializer_class(self) -> type[BaseSerializer]:
        if self.action == 'list':
            return AutomationRequestListSerializer
        elif self.action in ['create', 'update', 'partial_update']:
            return AutomationRequestCreateSerializer
        else:
            return AutomationRequestDetailSerializer

    def create(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        # Idempotency check — return existing request if key matches within 5 min
        key = request.data.get('idempotency_key')
        if key:
            existing = AutomationRequest.objects.filter(
                idempotency_key=key,
                requested_by=request.user,
                requested_at__gte=timezone.now() - timedelta(minutes=5),
            ).first()
            if existing:
                serializer = AutomationRequestDetailSerializer(
                    existing, context=self.get_serializer_context()
                )
                return Response(serializer.data, status=status.HTTP_200_OK)

        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer: BaseSerializer) -> None:
        # Quota enforcement
        from users.quota_service import QuotaService

        user = self.request.user
        allowed, reason = QuotaService.check_feature(user, 'can_use_awx')
        if not allowed:
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied(reason)

        instance = serializer.save(requested_by=self.request.user)

        # Capture request metadata for audit trail
        instance.capture_request_metadata(self.request)

        # If the template requires approval, gate execution behind the approval chain
        template = instance.template
        if template.requires_approval:
            if template.auto_approve_for_owner and template.created_by == self.request.user:
                pass  # owner auto-approved — keep status as pending
            else:
                instance.status = AutomationRequest.STATUS_AWAITING_APPROVAL
                instance.save(update_fields=['status', 'metadata'])
                self._notify_approvers(instance)
                AuditService.log(
                    user=self.request.user,
                    action='automation_request_awaiting_approval',
                    category='awx_automation',
                    resource_type='AutomationRequest',
                    resource_id=instance.id,
                    resource_name=instance.title,
                    description=f"Request '{instance.title}' awaiting approval",
                    request=self.request,
                )
                return

        instance.save()

        AuditService.log(
            user=self.request.user,
            action='automation_request_created',
            category='awx_automation',
            resource_type='AutomationRequest',
            resource_id=instance.id,
            resource_name=instance.title,
            description=f"Automation request '{instance.title}' created",
            metadata={
                'template': instance.template.name,
                'status': instance.status,
                'client_ip': instance.metadata.get('client_ip'),
            },
            request=self.request,
        )

    def perform_update(self, serializer: BaseSerializer) -> None:
        instance = serializer.instance
        old_status = instance.status

        updated_instance = serializer.save()

        AuditService.log(
            user=self.request.user,
            action='automation_request_updated',
            category='awx_automation',
            resource_type='AutomationRequest',
            resource_id=updated_instance.id,
            resource_name=updated_instance.title,
            description=f"Automation request '{updated_instance.title}' updated",
            metadata={
                'old_status': old_status,
                'new_status': updated_instance.status,
            },
            request=self.request,
        )

    def perform_destroy(self, instance: AutomationRequest) -> None:
        AuditService.log(
            user=self.request.user,
            action='automation_request_deleted',
            category='awx_automation',
            resource_type='AutomationRequest',
            resource_id=instance.id,
            resource_name=instance.title,
            description=f"Automation request '{instance.title}' deleted",
            metadata={
                'status': instance.status,
            },
            request=self.request,
        )

        instance.delete()

    @action(detail=True, methods=['post'])
    def execute(self, request: Request, pk: Any = None) -> Response:
        """
        Execute automation request
        POST /api/awx/requests/{id}/execute/

        Triggers async execution via Celery task.
        Request must be in 'pending' status to be executed.
        """
        logger.info(f'[Execute] Request received for automation request: {pk}')
        automation_request = self.get_object()
        logger.info(
            f'[Execute] Automation request loaded: {automation_request.title}, status: {automation_request.status}'
        )

        # Check ownership or admin permission
        if automation_request.requested_by != request.user and not request.user.is_staff:
            return Response(
                {'error': 'Only request owner or admin can execute'},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Validate request status — allow both pending and approved
        if automation_request.status not in (
            AutomationRequest.STATUS_PENDING,
            AutomationRequest.STATUS_APPROVED,
        ):
            return Response(
                {
                    'error': f'Request must be pending or approved to execute. Current: {automation_request.status}'
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Quota enforcement — daily AWX execution limit
        from users.quota_service import QuotaService

        allowed, reason = QuotaService.check_daily_execution(request.user, 'awx')
        if not allowed:
            return Response({'detail': reason}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        # Rate limiting — per-user concurrency cap
        max_per_user = getattr(django_settings, 'AWX_MAX_CONCURRENT_PER_USER', 5)
        active_user = (
            AutomationRequest.objects.filter(
                requested_by=request.user,
                status__in=['running', 'pending'],
            )
            .exclude(id=automation_request.id)
            .count()
        )
        if active_user >= max_per_user:
            return Response(
                {
                    'error': f'Concurrent execution limit reached ({active_user}/{max_per_user}). Wait for running jobs to finish.'
                },
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        # Global concurrency cap
        max_global = getattr(django_settings, 'AWX_MAX_CONCURRENT_GLOBAL', 20)
        active_global = (
            AutomationRequest.objects.filter(
                status__in=['running', 'pending'],
            )
            .exclude(id=automation_request.id)
            .count()
        )
        if active_global >= max_global:
            return Response(
                {
                    'error': f'Platform is at capacity ({active_global}/{max_global} active). Try again shortly.'
                },
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        # Check if template exists
        if not automation_request.template:
            return Response(
                {'error': 'Template not found for this request'}, status=status.HTTP_400_BAD_REQUEST
            )

        # Check if AWX connection exists
        if not automation_request.awx_connection:
            return Response(
                {'error': 'AWX connection not found for this request'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            # Trigger async execution
            logger.info(f'[Execute] Triggering Celery task for request: {automation_request.id}')

            # Support deferred execution — Celery's eta parameter handles the delay
            if (
                automation_request.scheduled_for
                and automation_request.scheduled_for > timezone.now()
            ):
                task = execute_automation_request.apply_async(
                    args=[str(automation_request.id)],
                    eta=automation_request.scheduled_for,
                )
            else:
                task = execute_automation_request.delay(str(automation_request.id))

            logger.info(f'[Execute] Celery task created: {task.id}')

            # Audit log
            AuditService.log(
                user=request.user,
                action='automation_request_execution_triggered',
                category='awx_automation',
                resource_type='AutomationRequest',
                resource_id=automation_request.id,
                resource_name=automation_request.title,
                description=f"Execution triggered for request '{automation_request.title}'",
                metadata={
                    'task_id': task.id,
                    'template': automation_request.template.name,
                    'execution_mode': automation_request.template.execution_mode,
                },
                request=self.request,
            )

            logger.info(f'[Execute] Returning 202 response with task_id: {task.id}')

            return Response(
                {
                    'message': 'Execution started',
                    'task_id': task.id,
                    'request_id': str(automation_request.id),
                    'execution_mode': automation_request.template.execution_mode,
                },
                status=status.HTTP_202_ACCEPTED,
            )

        except Exception as e:
            logger.error(
                f'[Execute] EXCEPTION during execution trigger: {type(e).__name__}: {str(e)}'
            )
            logger.exception('[Execute] Full traceback:')
            return Response(
                {'error': 'Failed to trigger execution'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=True, methods=['post'])
    def retry(self, request: Request, pk: Any = None) -> Response:
        """
        Retry failed execution for automation request
        POST /api/awx/requests/{id}/retry/
        Body: { "execution_id": "uuid" }  # Optional - if not provided, retries last failed execution

        Retries a specific failed execution or the most recent failed execution.
        """
        automation_request = self.get_object()

        # Check ownership or admin permission
        if automation_request.requested_by != request.user and not request.user.is_staff:
            return Response(
                {'error': 'Only request owner or admin can retry'}, status=status.HTTP_403_FORBIDDEN
            )

        # Get execution_id from body or find last failed execution
        execution_id = request.data.get('execution_id')

        if execution_id:
            # Retry specific execution
            try:
                execution = AutomationExecution.objects.get(
                    id=execution_id, automation_request=automation_request
                )
            except AutomationExecution.DoesNotExist:
                return Response(
                    {'error': f'Execution {execution_id} not found for this request'},
                    status=status.HTTP_404_NOT_FOUND,
                )
        else:
            # Find most recent failed execution
            execution = (
                AutomationExecution.objects.filter(
                    automation_request=automation_request,
                    status__in=['failed', 'error', 'canceled'],
                )
                .order_by('-created_at')
                .first()
            )

            if not execution:
                return Response(
                    {'error': 'No failed executions found for this request'},
                    status=status.HTTP_404_NOT_FOUND,
                )

        # Validate execution can be retried
        if execution.status not in ['failed', 'error', 'canceled']:
            return Response(
                {
                    'error': f'Only failed/error/canceled executions can be retried. Current status: {execution.status}'
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            # Trigger async retry
            task = retry_failed_execution.delay(str(execution.id))

            # Audit log
            AuditService.log(
                user=request.user,
                action='automation_execution_retry_triggered',
                category='awx_automation',
                resource_type='AutomationExecution',
                resource_id=execution.id,
                description=f'Retry triggered for execution {execution.id}',
                metadata={
                    'task_id': task.id,
                    'original_execution_id': str(execution.id),
                    'request_id': str(automation_request.id),
                    'execution_mode': execution.execution_mode,
                    'row_number': execution.row_number,
                    'batch_number': execution.batch_number,
                },
                request=self.request,
            )

            return Response(
                {
                    'message': 'Retry started',
                    'task_id': task.id,
                    'original_execution_id': str(execution.id),
                    'execution_mode': execution.execution_mode,
                },
                status=status.HTTP_202_ACCEPTED,
            )

        except Exception:
            logger.exception('Failed to trigger retry')
            return Response(
                {'error': 'Failed to trigger retry'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['post'])
    def approve(self, request: Request, pk: Any = None) -> Response:
        """
        Approve an automation request awaiting approval.
        POST /api/awx/requests/{id}/approve/
        """
        automation_request = self.get_object()

        if automation_request.status != AutomationRequest.STATUS_AWAITING_APPROVAL:
            return Response(
                {
                    'error': f'Request must be awaiting approval. Current: {automation_request.status}'
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not self._is_approver(request.user, automation_request):
            return Response(
                {'error': 'You are not authorized to approve this request'},
                status=status.HTTP_403_FORBIDDEN,
            )

        automation_request.status = AutomationRequest.STATUS_APPROVED
        automation_request.approved_by = request.user
        automation_request.approved_at = timezone.now()
        automation_request.save(update_fields=['status', 'approved_by', 'approved_at'])

        AuditService.log(
            user=request.user,
            action='automation_request_approved',
            category='awx_automation',
            resource_type='AutomationRequest',
            resource_id=automation_request.id,
            resource_name=automation_request.title,
            description=f"Request '{automation_request.title}' approved",
            request=self.request,
        )

        create_notification(
            user=automation_request.requested_by,
            type='success',
            title='Request Approved',
            message=f"Your request '{automation_request.title}' has been approved by {request.user.get_full_name() or request.user.username}.",
            metadata={
                'request_id': str(automation_request.id),
                'approved_by': request.user.username,
            },
        )

        serializer = AutomationRequestDetailSerializer(
            automation_request, context=self.get_serializer_context()
        )
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def reject(self, request: Request, pk: Any = None) -> Response:
        """
        Reject an automation request awaiting approval.
        POST /api/awx/requests/{id}/reject/
        Body: { "reason": "..." }
        """
        automation_request = self.get_object()

        if automation_request.status != AutomationRequest.STATUS_AWAITING_APPROVAL:
            return Response(
                {
                    'error': f'Request must be awaiting approval. Current: {automation_request.status}'
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not self._is_approver(request.user, automation_request):
            return Response(
                {'error': 'You are not authorized to reject this request'},
                status=status.HTTP_403_FORBIDDEN,
            )

        reason = request.data.get('reason', '')

        automation_request.status = AutomationRequest.STATUS_REJECTED
        automation_request.approved_by = request.user
        automation_request.approved_at = timezone.now()
        automation_request.rejection_reason = reason
        automation_request.save(
            update_fields=['status', 'approved_by', 'approved_at', 'rejection_reason']
        )

        AuditService.log(
            user=request.user,
            action='automation_request_rejected',
            category='awx_automation',
            resource_type='AutomationRequest',
            resource_id=automation_request.id,
            resource_name=automation_request.title,
            description=f"Request '{automation_request.title}' rejected",
            metadata={'reason': reason},
            request=self.request,
        )

        create_notification(
            user=automation_request.requested_by,
            type='warning',
            title='Request Rejected',
            message=f"Your request '{automation_request.title}' was rejected. Reason: {reason or 'No reason provided.'}",
            metadata={
                'request_id': str(automation_request.id),
                'rejected_by': request.user.username,
                'reason': reason,
            },
        )

        serializer = AutomationRequestDetailSerializer(
            automation_request, context=self.get_serializer_context()
        )
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def rollback(self, request: Request, pk: Any = None) -> Response:
        """
        Create a rollback request using the template's rollback_template.
        POST /api/awx/requests/{id}/rollback/
        """
        automation_request = self.get_object()

        if automation_request.status != AutomationRequest.STATUS_SUCCESSFUL:
            return Response(
                {'error': 'Only successful requests can be rolled back'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        rollback_tmpl = automation_request.template.rollback_template
        if not rollback_tmpl:
            return Response(
                {'error': 'No rollback template configured for this template'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        rollback_request = AutomationRequest.objects.create(
            title=f'[Rollback] {automation_request.title}',
            description=f'Rollback of request {automation_request.id}',
            template=rollback_tmpl,
            awx_connection=automation_request.awx_connection,
            target_apic=automation_request.target_apic,
            input_data=automation_request.input_data,
            requested_by=request.user,
            metadata={
                'rollback_of': str(automation_request.id),
                'original_template': automation_request.template.name,
            },
        )

        AuditService.log(
            user=request.user,
            action='automation_request_rollback_created',
            category='awx_automation',
            resource_type='AutomationRequest',
            resource_id=rollback_request.id,
            resource_name=rollback_request.title,
            description=f"Rollback request created for '{automation_request.title}'",
            metadata={
                'original_request_id': str(automation_request.id),
                'rollback_template': rollback_tmpl.name,
            },
            request=self.request,
        )

        serializer = AutomationRequestDetailSerializer(
            rollback_request, context=self.get_serializer_context()
        )
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    # ── Helpers ────────────────────────────────────────────────────────────

    def _is_approver(self, user: Any, automation_request: AutomationRequest) -> bool:
        """Check if user is authorized to approve/reject this request."""
        if user.is_staff:
            return True

        template = automation_request.template
        if template.approver_users.filter(id=user.id).exists():
            return True

        user_group_ids = user.groups.values_list('id', flat=True)
        if template.approver_groups.filter(id__in=user_group_ids).exists():
            return True

        return False

    def _notify_approvers(self, automation_request: AutomationRequest) -> None:
        """Send notifications to all designated approvers for a request."""
        template = automation_request.template
        notified_ids = set()

        for approver in template.approver_users.all():
            if approver.id not in notified_ids:
                notified_ids.add(approver.id)
                create_notification(
                    user=approver,
                    type='info',
                    title='Approval Required',
                    message=f"Request '{automation_request.title}' by {automation_request.requested_by.username} needs your approval.",
                    metadata={
                        'request_id': str(automation_request.id),
                        'requester': automation_request.requested_by.username,
                    },
                )

        for group in template.approver_groups.all():
            for member in group.user_set.all():
                if member.id not in notified_ids:
                    notified_ids.add(member.id)
                    create_notification(
                        user=member,
                        type='info',
                        title='Approval Required',
                        message=f"Request '{automation_request.title}' by {automation_request.requested_by.username} needs your approval.",
                        metadata={
                            'request_id': str(automation_request.id),
                            'requester': automation_request.requested_by.username,
                        },
                    )

        logger.info(
            '[Approval] Notified %d approvers for request %s',
            len(notified_ids),
            automation_request.id,
        )
