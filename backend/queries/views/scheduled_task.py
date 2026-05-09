# queries/views/scheduled_task.py
#
# Two ViewSets:
#   ScheduledTaskViewSet          — full CRUD + pause/resume/execute_now/clone
#   ScheduledTaskExecutionViewSet — read-only execution history + stats
#
# Visibility rules:
#   Regular users see only their own tasks (system tasks are hidden from them).
#   Admins see everything, including platform system tasks (cleanup, snapshots, etc.).
#
# System task protection:
#   System tasks cannot be created or deleted via the API — use the seed management command.
#   Admins can change status/priority/order on system tasks but nothing else.

from rest_framework import viewsets, filters, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import PermissionDenied
from users.permissions import FabrikModelPermissions
from audit.services import AuditService
from ..models import ScheduledTask, ScheduledTaskExecution
from ..serializers import ScheduledTaskSerializer, ScheduledTaskExecutionSerializer


class ScheduledTaskViewSet(viewsets.ModelViewSet):
    """CRUD + lifecycle actions for scheduled tasks."""

    serializer_class = ScheduledTaskSerializer
    permission_classes = [FabrikModelPermissions]
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['priority', 'order', 'created_at', 'name', 'next_run_at']
    ordering = ['priority', 'order', '-created_at']

    def get_queryset(self):
        """
        Filter tasks for current user

        - Admin: sees all (user tasks + system tasks)
        - Regular users: see only their own tasks (no system tasks)

        Query params:
        - ?is_system_task=true: filter system tasks (admin-only)
        - ?task_type=system_maintenance: filter by task type
        - ?category=Storage Management: filter by category
        """
        user = self.request.user
        is_admin = user.is_superuser or user.groups.filter(name='Admin').exists()

        # Base queryset
        if is_admin:
            queryset = ScheduledTask.objects.all()
        else:
            # Regular users: only their own tasks (exclude system tasks)
            queryset = ScheduledTask.objects.filter(created_by=user, is_system_task=False)

        # Filter by system task flag
        is_system_task = self.request.query_params.get('is_system_task')
        if is_system_task is not None:
            queryset = queryset.filter(is_system_task=is_system_task.lower() == 'true')

        # Filter by task type
        task_type = self.request.query_params.get('task_type')
        if task_type:
            queryset = queryset.filter(task_type=task_type)

        # Filter by category
        category = self.request.query_params.get('category')
        if category:
            queryset = queryset.filter(category=category)

        return queryset

    def perform_create(self, serializer):
        # Prevent creating system tasks via API (use seed command)
        if serializer.validated_data.get('is_system_task', False):
            raise PermissionDenied(
                'System tasks cannot be created via API. Use management command.'
            )

        # Quota enforcement
        from users.quota_service import QuotaService

        user = self.request.user
        allowed, reason = QuotaService.check_feature(user, 'can_create_scheduled')
        if not allowed:
            raise PermissionDenied(reason)
        allowed, reason = QuotaService.check_can_create(user, 'scheduled_task')
        if not allowed:
            raise PermissionDenied(reason)

        instance = serializer.save(created_by=self.request.user)

        # Audit log
        AuditService.log(
            user=self.request.user,
            action='scheduled_task_created',
            category='task_management',
            resource_type='ScheduledTask',
            resource_id=instance.id,
            resource_name=instance.name,
            description=f"Scheduled task '{instance.name}' created",
            metadata={
                'frequency': instance.frequency,
                'status': instance.status,
                'saved_query': instance.saved_query.name if instance.saved_query else None,
                'priority': instance.priority,
            },
            request=self.request,
        )

    def perform_update(self, serializer):
        """Track changes and audit log updates"""
        instance = serializer.instance
        user = self.request.user
        is_owner = instance.created_by == user
        is_admin = user.is_superuser or user.groups.filter(name='Admin').exists()

        # System tasks: Only admins can update status/priority (not config)
        if instance.is_system_task:
            if not is_admin:
                raise PermissionDenied('Only administrators can modify system tasks')

            # Allow only specific fields to be updated for system tasks
            allowed_fields = {'status', 'priority', 'order'}
            requested_fields = set(serializer.validated_data.keys())
            forbidden_fields = requested_fields - allowed_fields

            if forbidden_fields:
                raise PermissionDenied(
                    f'System task configuration cannot be modified. '
                    f'Only status, priority, and order can be changed. '
                    f'Attempted to change: {", ".join(forbidden_fields)}'
                )

        # User tasks: Owner or admin can edit
        elif not (is_owner or is_admin):
            raise PermissionDenied("You don't have permission to edit this task")

        # Track changes
        old_data = {
            'name': instance.name,
            'description': instance.description,
            'status': instance.status,
            'frequency': instance.frequency,
            'priority': instance.priority,
            'saved_query': instance.saved_query.name if instance.saved_query else None,
        }

        updated_instance = serializer.save()

        # Detect changes
        changes = {}
        new_data = {
            'name': updated_instance.name,
            'description': updated_instance.description,
            'status': updated_instance.status,
            'frequency': updated_instance.frequency,
            'priority': updated_instance.priority,
            'saved_query': updated_instance.saved_query.name
            if updated_instance.saved_query
            else None,
        }
        for key, old_val in old_data.items():
            new_val = new_data[key]
            if old_val != new_val:
                changes[key] = {'old': old_val, 'new': new_val}

        # Audit log
        AuditService.log(
            user=user,
            action='scheduled_task_updated',
            category='task_management',
            resource_type='ScheduledTask',
            resource_id=updated_instance.id,
            resource_name=updated_instance.name,
            description=f"Scheduled task '{updated_instance.name}' updated",
            metadata={'changes': changes} if changes else {},
            request=self.request,
        )

    def perform_destroy(self, instance):
        """Only owner or admin can delete (system tasks cannot be deleted)"""
        user = self.request.user
        is_owner = instance.created_by == user
        is_admin = user.is_superuser or user.groups.filter(name='Admin').exists()

        # System tasks cannot be deleted
        if instance.is_system_task:
            raise PermissionDenied(
                "System tasks cannot be deleted. Use 'pause' or 'disable' status instead."
            )

        # User tasks: Owner or admin can delete
        if not (is_owner or is_admin):
            raise PermissionDenied("You don't have permission to delete this task")

        # Audit log (before deletion)
        AuditService.log(
            user=user,
            action='scheduled_task_deleted',
            category='task_management',
            resource_type='ScheduledTask',
            resource_id=instance.id,
            resource_name=instance.name,
            description=f"Scheduled task '{instance.name}' deleted",
            metadata={
                'frequency': instance.frequency,
                'status': instance.status,
                'saved_query': instance.saved_query.name if instance.saved_query else None,
                'execution_count': instance.execution_count,
                'created_by': instance.created_by.username,
            },
            request=self.request,
        )

        instance.delete()

    @action(detail=True, methods=['post'])
    def pause(self, request, pk=None):
        """Pause a scheduled task"""
        task = self.get_object()
        task.status = ScheduledTask.STATUS_PAUSED
        task.save()

        # Audit log
        AuditService.log(
            user=request.user,
            action='scheduled_task_paused',
            category='task_management',
            resource_type='ScheduledTask',
            resource_id=task.id,
            resource_name=task.name,
            description=f"Scheduled task '{task.name}' paused",
            request=request,
        )

        return Response({'status': 'paused', 'message': 'Task paused successfully'})

    @action(detail=True, methods=['post'])
    def resume(self, request, pk=None):
        """Resume a paused task"""
        task = self.get_object()
        task.status = ScheduledTask.STATUS_ACTIVE
        task.save()

        # Audit log
        AuditService.log(
            user=request.user,
            action='scheduled_task_resumed',
            category='task_management',
            resource_type='ScheduledTask',
            resource_id=task.id,
            resource_name=task.name,
            description=f"Scheduled task '{task.name}' resumed",
            request=request,
        )

        return Response({'status': 'active', 'message': 'Task resumed successfully'})

    @action(detail=True, methods=['post'])
    def execute_now(self, request, pk=None):
        """Manual trigger — dispatches the task to Celery immediately.

        Works for both user tasks and system tasks.
        System tasks require admin permission.
        """
        task = self.get_object()
        user = request.user
        is_admin = user.is_superuser or user.groups.filter(name='Admin').exists()

        # Permission check
        if task.is_system_task:
            # System tasks: Admin-only
            if not is_admin:
                return Response(
                    {'error': 'Only administrators can execute system tasks'},
                    status=status.HTTP_403_FORBIDDEN,
                )
        else:
            # User tasks: Owner or admin
            is_owner = task.created_by == user
            if not (is_owner or is_admin):
                return Response(
                    {'error': 'You do not have permission to execute this task'},
                    status=status.HTTP_403_FORBIDDEN,
                )

        try:
            # Queue task for immediate execution
            from .tasks import execute_scheduled_task

            result = execute_scheduled_task.delay(str(task.id))

            # Audit log
            AuditService.log(
                user=user,
                action='scheduled_task_executed_manually',
                category='task_management',
                resource_type='ScheduledTask',
                resource_id=task.id,
                resource_name=task.name,
                description=f"Scheduled task '{task.name}' executed manually",
                metadata={
                    'is_system_task': task.is_system_task,
                    'task_type': task.task_type,
                    'celery_task_id': result.id,
                },
                request=request,
            )

            return Response(
                {
                    'success': True,
                    'message': f"Task '{task.name}' queued for execution",
                    'celery_task_id': result.id,
                    'task_type': task.task_type,
                    'is_system_task': task.is_system_task,
                }
            )

        except Exception as e:
            import traceback

            return Response(
                {'error': str(e), 'traceback': traceback.format_exc()},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=True, methods=['post'])
    def clone(self, request, pk=None):
        """Duplicate a task. The clone starts as paused so it doesn't run immediately."""
        source_task = self.get_object()

        if source_task.is_system_task:
            return Response(
                {'error': 'System tasks cannot be cloned'}, status=status.HTTP_403_FORBIDDEN
            )

        new_task = ScheduledTask.objects.create(
            name=f'{source_task.name} (Copy)',
            description=source_task.description,
            priority=source_task.priority,
            created_by=request.user,
            saved_query=source_task.saved_query,
            apic_connection_ids=source_task.apic_connection_ids,
            variable_values=source_task.variable_values,
            retry_enabled=source_task.retry_enabled,
            retry_count=source_task.retry_count,
            retry_interval_minutes=source_task.retry_interval_minutes,
            email_on_success=source_task.email_on_success,
            email_on_failure=source_task.email_on_failure,
            email_recipients=source_task.email_recipients,
            log_retention_days=source_task.log_retention_days,
            frequency=source_task.frequency,
            minute_of_hour=source_task.minute_of_hour,
            time_of_day=source_task.time_of_day,
            day_of_week=source_task.day_of_week,
            day_of_month=source_task.day_of_month,
            scheduled_datetime=source_task.scheduled_datetime,
            timezone=source_task.timezone,
            status=ScheduledTask.STATUS_PAUSED,
        )

        # Audit log
        AuditService.log(
            user=request.user,
            action='scheduled_task_cloned',
            category='task_management',
            resource_type='ScheduledTask',
            resource_id=str(new_task.id),
            resource_name=new_task.name,
            description=f"Scheduled task '{source_task.name}' cloned as '{new_task.name}'",
            metadata={
                'source_task_id': str(source_task.id),
                'source_task_name': source_task.name,
                'new_task_id': str(new_task.id),
            },
            request=request,
        )

        serializer = ScheduledTaskSerializer(new_task, context={'request': request})
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'])
    def executions(self, request, pk=None):
        """Get execution history for a specific task"""
        task = self.get_object()
        executions = ScheduledTaskExecution.objects.filter(scheduled_task=task).order_by(
            '-created_at'
        )

        # Apply pagination
        page = self.paginate_queryset(executions)
        if page is not None:
            serializer = ScheduledTaskExecutionSerializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = ScheduledTaskExecutionSerializer(executions, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def upcoming(self, request):
        """Get upcoming scheduled tasks"""
        limit = int(request.query_params.get('limit', 10))
        tasks = (
            self.get_queryset()
            .filter(status=ScheduledTask.STATUS_ACTIVE, next_run_at__isnull=False)
            .order_by('next_run_at')[:limit]
        )

        serializer = self.get_serializer(tasks, many=True)
        return Response(serializer.data)


class ScheduledTaskExecutionViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only view of individual task execution records.

    Supports filtering by task_id, status, and connection_id so the UI
    can show per-task or per-connection history without loading everything.
    """

    serializer_class = ScheduledTaskExecutionSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['created_at', 'started_at', 'completed_at', 'status']
    ordering = ['-created_at']

    def get_queryset(self):
        """Filter execution logs based on user access"""
        user = self.request.user
        is_admin = user.is_superuser or user.groups.filter(name='Admin').exists()
        if is_admin:
            queryset = ScheduledTaskExecution.objects.all()
        else:
            queryset = ScheduledTaskExecution.objects.filter(scheduled_task__created_by=user)

        # Filter by task
        task_id = self.request.query_params.get('task_id')
        if task_id:
            queryset = queryset.filter(scheduled_task_id=task_id)

        # Filter by status
        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)

        # Filter by connection
        connection_id = self.request.query_params.get('connection_id')
        if connection_id:
            queryset = queryset.filter(apic_connection_id=connection_id)

        return queryset.select_related('scheduled_task')

    @action(detail=False, methods=['get'])
    def stats(self, request):
        """Get execution statistics"""
        queryset = self.get_queryset()
        total = queryset.count()
        success = queryset.filter(status=ScheduledTaskExecution.STATUS_SUCCESS).count()
        failed = queryset.filter(status=ScheduledTaskExecution.STATUS_FAILED).count()
        running = queryset.filter(status=ScheduledTaskExecution.STATUS_RUNNING).count()

        return Response(
            {
                'total_executions': total,
                'successful': success,
                'failed': failed,
                'running': running,
                'success_rate': round((success / total * 100) if total > 0 else 0, 2),
            }
        )
