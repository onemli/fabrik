# awx/views/column_template.py
#
# ViewSet for ColumnTemplate — saved column definitions that users can pick
# from a library instead of typing the same regex/validation every time.
# The apply action inserts a saved column into a specific table schema on a
# given AutomationTemplate and increments the usage counter.

import logging
from typing import Any

from rest_framework import viewsets, status, filters
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.serializers import BaseSerializer
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


from awx.models import ColumnTemplate
from awx.serializers import ColumnTemplateSerializer
from awx.services.column_template_service import ColumnTemplateService, ColumnTemplateError


class ColumnTemplateViewSet(viewsets.ModelViewSet):
    """CRUD for reusable column definitions.

    Visibility is union of: own, public, explicitly shared. Ordered by usage_count
    descending by default so the most-reused templates show up first in the picker.
    """

    permission_classes = [IsAuthenticated]
    serializer_class = ColumnTemplateSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'description']
    ordering_fields = ['name', 'usage_count', 'created_at']
    ordering = ['-usage_count', 'name']

    def get_queryset(self) -> QuerySet[ColumnTemplate]:
        """Filter templates based on access"""
        user = self.request.user
        return ColumnTemplate.objects.filter(
            Q(created_by=user) | Q(is_public=True) | Q(shared_with=user)
        ).distinct()

    def perform_create(self, serializer: BaseSerializer) -> None:
        """Create column template"""
        instance = serializer.save(created_by=self.request.user)

        AuditService.log(
            user=self.request.user,
            action='validation_list_created',
            category='awx_management',
            resource_type='ColumnTemplate',
            resource_id=instance.id,
            resource_name=instance.name,
            description=f"Column template '{instance.name}' created",
            request=self.request,
        )

    def perform_update(self, serializer: BaseSerializer) -> None:
        """Update column template"""
        instance = serializer.save()

        AuditService.log(
            user=self.request.user,
            action='validation_list_updated',
            category='awx_management',
            resource_type='ColumnTemplate',
            resource_id=instance.id,
            resource_name=instance.name,
            description=f"Column template '{instance.name}' updated",
            request=self.request,
        )

    def perform_destroy(self, instance: ColumnTemplate) -> None:
        """Delete column template"""
        template_name = instance.name
        template_id = instance.id
        instance.delete()

        AuditService.log(
            user=self.request.user,
            action='validation_list_deleted',
            category='awx_management',
            resource_type='ColumnTemplate',
            resource_id=template_id,
            resource_name=template_name,
            description=f"Column template '{template_name}' deleted",
            request=self.request,
        )

    @action(detail=True, methods=['post'])
    def duplicate(self, request: Request, pk: Any = None) -> Response:
        """Duplicate template"""
        service = ColumnTemplateService()
        try:
            new_template = service.duplicate_template(pk, request.user)
            serializer = self.get_serializer(new_template)

            AuditService.log(
                user=request.user,
                action='validation_list_created',
                category='awx_management',
                resource_type='ColumnTemplate',
                resource_id=new_template.id,
                resource_name=new_template.name,
                description=f"Column template duplicated from #{pk} as '{new_template.name}'",
                metadata={'source_template_id': str(pk)},
                request=request,
            )

            return Response(serializer.data, status=status.HTTP_201_CREATED)
        except ColumnTemplateError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
