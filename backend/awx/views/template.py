# awx/views/template.py
#
# ViewSets for TemplateCategory and AutomationTemplate. Templates are the
# core configuration object in the AWX integration — they describe which AWX
# job/workflow to launch, what data to expect from the user (table_schemas),
# and how to map that data into Ansible extra_vars.
#
# The "import from AWX" action (POST /templates/import_from_awx/) converts an
# AWX survey spec into a Fabrik table_schema using SurveyToSchemaConverter so
# teams can onboard existing AWX templates without rebuilding the schema by hand.

import logging
from typing import Any

from rest_framework import viewsets, status, filters
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.serializers import BaseSerializer
from users.permissions import FabrikModelPermissions
from django.db.models import Q, QuerySet
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


from awx.models import TemplateCategory, AutomationTemplate
from awx.serializers import (
    TemplateCategorySerializer,
    AutomationTemplateListSerializer,
    AutomationTemplateDetailSerializer,
    AutomationTemplateCreateSerializer,
)


class TemplateCategoryViewSet(viewsets.ModelViewSet):
    """CRUD for template categories.

    Categories are visible to everyone — they're just organizational labels.
    Pagination is disabled because there are typically fewer than 20 and the
    sidebar needs them all at once. System categories (is_system=True) can't
    be renamed; that's enforced in the serializer.
    """
    permission_classes = [IsAuthenticated]
    serializer_class = TemplateCategorySerializer
    pagination_class = None  # No pagination for categories
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'description']
    ordering_fields = ['name', 'display_order', 'created_at']
    ordering = ['display_order', 'name']

    def get_queryset(self) -> QuerySet[TemplateCategory]:
        """All users can see all categories"""
        return TemplateCategory.objects.all()

    def perform_create(self, serializer: BaseSerializer) -> None:
        instance = serializer.save(created_by=self.request.user)

        AuditService.log(
            user=self.request.user,
            action='template_category_updated',
            category='awx_management',
            resource_type='TemplateCategory',
            resource_id=instance.id,
            resource_name=instance.name,
            description=f"Template category '{instance.name}' created",
            metadata={
                'name': instance.name,
                'display_order': instance.display_order,
            },
            request=self.request,
        )

    def perform_update(self, serializer: BaseSerializer) -> None:
        instance = serializer.save()

        AuditService.log(
            user=self.request.user,
            action='template_category_updated',
            category='awx_management',
            resource_type='TemplateCategory',
            resource_id=instance.id,
            resource_name=instance.name,
            description=f"Template category '{instance.name}' updated",
            metadata={
                'name': instance.name,
                'display_order': instance.display_order
            },
            request=self.request
        )

    def perform_destroy(self, instance: TemplateCategory) -> None:
        # Prevent deletion of system categories
        if instance.is_system:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('System categories cannot be deleted')

        category_name = instance.name
        category_id = instance.id

        instance.delete()

        AuditService.log(
            user=self.request.user,
            action='template_category_deleted',
            category='awx_management',
            resource_type='TemplateCategory',
            resource_id=category_id,
            resource_name=category_name,
            description=f"Template category '{category_name}' deleted",
            request=self.request
        )


class AutomationTemplateViewSet(viewsets.ModelViewSet):
    """
    ViewSet for Ansible automation templates
    """
    permission_classes = [FabrikModelPermissions]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'description', 'tags']
    ordering_fields = ['name', 'created_at', 'execution_count', 'last_executed_at']
    ordering = ['-created_at']

    def get_queryset(self) -> QuerySet[AutomationTemplate]:
        """Filter templates based on ownership"""
        user = self.request.user
        queryset = AutomationTemplate.objects.select_related(
            'created_by', 'category', 'awx_connection'
        ).filter(
            Q(created_by=user) | Q(is_public=True)
        ).distinct()

        # Filter by category
        category = self.request.query_params.get('category')
        if category:
            queryset = queryset.filter(category=category)

        return queryset

    def get_serializer_class(self) -> type[BaseSerializer]:
        if self.action == 'list':
            return AutomationTemplateListSerializer
        elif self.action in ['create', 'update', 'partial_update']:
            return AutomationTemplateCreateSerializer
        else:
            return AutomationTemplateDetailSerializer

    def get_serializer_context(self) -> dict[str, Any]:
        """
        Extra context provided to the serializer class.
        Ensure request is always included for permission checks.
        """
        context = super().get_serializer_context()
        context['request'] = self.request
        return context

    def perform_create(self, serializer: BaseSerializer) -> None:
        instance = serializer.save(created_by=self.request.user)

        AuditService.log(
            user=self.request.user,
            action='ansible_template_created',
            category='awx_management',
            resource_type='AutomationTemplate',
            resource_id=instance.id,
            resource_name=instance.name,
            description=f"Automation template '{instance.name}' created",
            metadata={
                'category': instance.category.name if instance.category else None,
                'awx_type': instance.awx_type,
                'awx_template_id': instance.awx_template_id,
            },
            request=self.request
        )

    def perform_update(self, serializer: BaseSerializer) -> None:
        instance = serializer.instance
        old_name = instance.name

        updated_instance = serializer.save()

        AuditService.log(
            user=self.request.user,
            action='ansible_template_updated',
            category='awx_management',
            resource_type='AutomationTemplate',
            resource_id=updated_instance.id,
            resource_name=updated_instance.name,
            description=f"Ansible template '{old_name}' updated",
            request=self.request
        )

    def perform_destroy(self, instance: AutomationTemplate) -> None:
        AuditService.log(
            user=self.request.user,
            action='ansible_template_deleted',
            category='awx_management',
            resource_type='AutomationTemplate',
            resource_id=instance.id,
            resource_name=instance.name,
            description=f"Ansible template '{instance.name}' deleted",
            metadata={
                'execution_count': instance.execution_count,
            },
            request=self.request
        )

        instance.delete()

    @action(detail=True, methods=['post'])
    def validate_data(self, request: Request, pk: Any = None) -> Response:
        """
        Validate input data against template schema
        POST /api/awx/templates/{id}/validate-data/
        Body: { "input_data": {...} }
        """
        template = self.get_object()
        input_data = request.data.get('input_data', {})

        is_valid, errors = template.validate_input_data(input_data)

        return Response({
            'valid': is_valid,
            'errors': errors
        })

    @action(detail=True, methods=['post'], url_path='validate-input')
    def validate_input(self, request: Request, pk: Any = None) -> Response:
        """
        Asynchronously validate user input against schema
        POST /api/awx/templates/{id}/validate-input/
        Body: { "input_data": [...], "connection_id": 123 }

        Returns:
            { "task_id": "uuid", "status": "PENDING", "polling_interval": 2 }
        """
        from awx.tasks import validate_template_input_async
        from django.conf import settings

        template = self.get_object()
        input_data = request.data.get('input_data', {})
        connection_id = request.data.get('connection_id')  # APIC connection ID for query validation

        try:
            # Start async validation task
            task = validate_template_input_async.delay(
                template_id=str(template.id),
                input_data=input_data,
                connection_id=connection_id
            )

            # Store task ownership for authorization check in validation_status
            from django.core.cache import cache
            try:
                cache.set(
                    f"validation_task_owner:{task.id}",
                    request.user.id,
                    timeout=3600  # 1 hour TTL
                )
            except Exception:
                logger.warning(f"Failed to cache task ownership for {task.id}, IDOR check will be skipped")

            # Audit log - task started
            AuditService.log(
                user=self.request.user,
                action='template_validation_started',
                category='awx_management',
                resource_type='AutomationTemplate',
                resource_id=template.id,
                resource_name=template.name,
                description=f"Async validation started for template '{template.name}'",
                metadata={
                    'task_id': task.id,
                    'connection_id': connection_id,
                    'row_count': len(input_data) if isinstance(input_data, list) else 0
                },
                success=True,
                request=self.request
            )

            return Response({
                'task_id': task.id,
                'status': 'PENDING',
                'polling_interval': settings.AWX_VALIDATION_POLLING_INTERVAL
            }, status=status.HTTP_202_ACCEPTED)

        except Exception as e:
            return Response({
                'valid': False,
                'errors': [f"Failed to start validation: {str(e)}"]
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=False, methods=['get'], url_path='validation-status/(?P<task_id>[^/.]+)')
    def validation_status(self, request: Request, task_id: Any = None) -> Response:
        """
        Get validation task status
        GET /api/awx/templates/validation-status/{task_id}/

        Returns:
            {
                "state": "PENDING|STARTED|PROGRESS|SUCCESS|FAILURE",
                "status": "Human readable status",
                "progress": 0-100,
                "result": { "valid": bool, "errors": [...] }  # Only when SUCCESS
            }
        """
        from celery.result import AsyncResult
        from django.core.cache import cache

        # Verify task ownership - prevent IDOR
        owner_id = cache.get(f"validation_task_owner:{task_id}")
        if owner_id is not None and owner_id != request.user.id:
            return Response(
                {'error': 'Permission denied'},
                status=status.HTTP_403_FORBIDDEN
            )

        try:
            task = AsyncResult(task_id)

            response_data = {
                'state': task.state,
                'task_id': task_id
            }

            if task.state == 'PENDING':
                response_data['status'] = 'Validation task pending...'
                response_data['progress'] = 0

            elif task.state == 'STARTED':
                response_data['status'] = task.info.get('status', 'Validation started...')
                response_data['progress'] = task.info.get('progress', 10)

            elif task.state == 'PROGRESS':
                response_data['status'] = task.info.get('status', 'Validating...')
                response_data['progress'] = task.info.get('progress', 50)

            elif task.state == 'SUCCESS':
                result = task.result
                response_data['status'] = 'Validation complete'
                response_data['progress'] = 100
                response_data['result'] = result
                response_data['completed'] = True  # Signal to stop polling

            elif task.state == 'FAILURE':
                response_data['status'] = 'Validation failed'
                response_data['progress'] = 0
                response_data['error'] = str(task.info)
                response_data['completed'] = True  # Signal to stop polling
                response_data['result'] = {
                    'valid': False,
                    'errors': [str(task.info)]
                }

            else:
                response_data['status'] = f'Unknown state: {task.state}'
                response_data['progress'] = 0

            return Response(response_data)

        except Exception:
            logger.exception(f"Error checking validation task status: {task_id}")
            return Response({
                'state': 'ERROR',
                'status': 'Failed to get task status',
                'error': 'Internal error checking task status',
                'completed': True  # Stop polling on error
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=['post'], url_path='validate-sheets')
    def validate_sheets(self, request: Request, pk: Any = None) -> Response:
        """
        Validate multi-sheet data against template schemas.

        Uses the existing AutomationTemplate.validate_input_data() method
        which already supports multi-schema validation via dict input.

        POST /api/awx/templates/{id}/validate-sheets/
        Body: {
            "sheets": {
                "Sheet1": [{"col1": "val1", ...}, ...],
                "Sheet2": [{"col1": "val1", ...}, ...]
            },
            "connection_id": 123  // optional, for query-based validation
        }
        """
        import time

        template = self.get_object()
        sheets_data = request.data.get('sheets', {})
        connection_id = request.data.get('connection_id')

        if not sheets_data:
            return Response({
                'is_valid': True,
                'sheets': {},
                'total_errors': 0,
                'validation_time_ms': 0,
            })

        start = time.monotonic()

        # Build a mapping from sheet_name -> awx_variable_name
        # so we can translate frontend sheet names to what the model expects
        sheet_to_var = {}
        for schema in (template.table_schemas or []):
            var_name = schema.get('awx_variable_name', '')
            sheet_name = schema.get('sheet_name', schema.get('name', var_name))
            sheet_to_var[sheet_name] = var_name
            # Also map var_name to itself for direct matches
            sheet_to_var[var_name] = var_name

        # Convert sheets_data keys from sheet_name to awx_variable_name
        mapped_data = {}
        for key, rows in sheets_data.items():
            var_name = sheet_to_var.get(key, key)
            mapped_data[var_name] = rows

        # Use the model's built-in multi-schema validation
        is_valid, errors = template.validate_input_data(mapped_data, connection_id=connection_id)

        # Group errors by schema/sheet for per-sheet results
        sheet_results = {}
        for schema in (template.table_schemas or []):
            var_name = schema.get('awx_variable_name', '')
            sheet_name = schema.get('sheet_name', schema.get('name', var_name))
            if var_name in mapped_data:
                sheet_errors = [
                    e for e in errors
                    if e.get('schema_index') is not None and
                    (template.table_schemas or []).index(schema) == e.get('schema_index')
                ]
                sheet_results[sheet_name] = {
                    'is_valid': len(sheet_errors) == 0,
                    'error_count': len(sheet_errors),
                    'errors': sheet_errors,
                }

        elapsed = int((time.monotonic() - start) * 1000)

        # Audit log
        AuditService.log(
            user=self.request.user,
            action='template_sheets_validated',
            category='validation',
            resource_type='AutomationTemplate',
            resource_id=template.id,
            resource_name=template.name,
            description=f"Multi-sheet validation for template '{template.name}'",
            metadata={
                'is_valid': is_valid,
                'total_errors': len(errors),
                'sheet_count': len(sheets_data),
                'validation_time_ms': elapsed,
            },
            success=is_valid,
            request=self.request
        )

        return Response({
            'is_valid': is_valid,
            'sheets': sheet_results,
            'total_errors': len(errors),
            'validation_time_ms': elapsed,
        })
