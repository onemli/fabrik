# awx/views/validation.py
#
# ViewSet for ValidationList — the shared library of allowed-value sets used
# by column validation. Also exposes an async validation endpoint that kicks
# off a Celery task so the frontend can validate table data against live APIC
# queries without blocking the HTTP response.

import logging
from typing import Any

from rest_framework import viewsets, filters
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


from awx.models import ValidationList, ValidationUsage, RegexPattern
from awx.serializers import (
    ValidationListSerializer,
    ValidationListCreateSerializer,
    ValidationUsageSerializer,
    RegexPatternSerializer,
    RegexPatternCreateSerializer,
)


class ValidationListViewSet(viewsets.ModelViewSet):
    """CRUD for shared allowed-value lists used in column validation.

    You see your own lists plus public ones. can_delete in the serializer blocks
    deletion when usage_count > 0 — we don't want to silently break templates
    that reference the list. The validate_async action offloads APIC-backed
    validation to a Celery task and returns a task ID the client polls.
    """

    permission_classes = [IsAuthenticated]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'description']
    ordering_fields = ['name', 'created_at', 'usage_count', 'last_used_at']
    ordering = ['-created_at']

    def get_queryset(self) -> QuerySet[ValidationList]:
        """Filter validation lists based on ownership and sharing"""
        user = self.request.user
        return ValidationList.objects.filter(Q(created_by=user) | Q(is_public=True)).distinct()

    def get_serializer_class(self) -> type[BaseSerializer]:
        """Use different serializers for create/list/update"""
        if self.action == 'create':
            return ValidationListCreateSerializer
        if self.action in ['update', 'partial_update']:
            return ValidationListSerializer
        return ValidationListSerializer

    def perform_create(self, serializer: BaseSerializer) -> None:
        """Create validation list with audit logging"""
        instance = serializer.save(created_by=self.request.user)

        # Audit log
        AuditService.log(
            user=self.request.user,
            action='validation_list_created',
            category='validation_management',
            resource_type='ValidationList',
            resource_id=instance.id,
            resource_name=instance.name,
            description=f"Validation list '{instance.name}' created with {len(instance.values)} values",
            metadata={
                'values_count': len(instance.values),
                'case_sensitive': instance.case_sensitive,
                'is_public': instance.is_public,
            },
            request=self.request,
        )

    def perform_update(self, serializer: BaseSerializer) -> None:
        """Update validation list with change tracking"""
        instance = serializer.instance
        old_values_count = len(instance.values) if instance.values else 0

        updated_instance = serializer.save()
        new_values_count = len(updated_instance.values) if updated_instance.values else 0

        # Audit log
        AuditService.log(
            user=self.request.user,
            action='validation_list_updated',
            category='validation_management',
            resource_type='ValidationList',
            resource_id=updated_instance.id,
            resource_name=updated_instance.name,
            description=f"Validation list '{updated_instance.name}' updated",
            metadata={
                'old_values_count': old_values_count,
                'new_values_count': new_values_count,
            },
            request=self.request,
        )

    def perform_destroy(self, instance: ValidationList) -> None:
        """Delete validation list with checks"""
        from rest_framework.exceptions import ValidationError as DRFValidationError

        # Check if in use - raise exception so DRF returns proper error response
        if instance.usage_count > 0:
            raise DRFValidationError(
                {
                    'error': f'Cannot delete validation list that is in use ({instance.usage_count} usages)'
                }
            )

        # Audit log
        AuditService.log(
            user=self.request.user,
            action='validation_list_deleted',
            category='validation_management',
            resource_type='ValidationList',
            resource_id=instance.id,
            resource_name=instance.name,
            description=f"Validation list '{instance.name}' deleted",
            metadata={
                'values_count': len(instance.values) if instance.values else 0,
            },
            request=self.request,
        )

        instance.delete()

    @action(detail=True, methods=['get'])
    def usages(self, request: Request, pk: Any = None) -> Response:
        """
        Get all usages of this validation list.

        Returns list of templates/columns using this list.
        """
        validation_list = self.get_object()
        usages = ValidationUsage.objects.filter(validation_list=validation_list)
        serializer = ValidationUsageSerializer(usages, many=True, context={'request': request})

        return Response(
            {
                'validation_list': {
                    'id': validation_list.id,
                    'name': validation_list.name,
                },
                'usage_count': validation_list.usage_count,
                'usages': serializer.data,
            }
        )


class RegexPatternViewSet(viewsets.ModelViewSet):
    # CRUD for saved regex patterns. Same ownership model as ValidationList:
    # you see your own + public ones, can_delete blocks deletion when in use.
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'description', 'pattern']
    ordering_fields = ['name', 'created_at', 'usage_count', 'category']
    ordering = ['-created_at']

    def get_queryset(self) -> QuerySet[RegexPattern]:
        user = self.request.user
        qs = RegexPattern.objects.filter(Q(created_by=user) | Q(is_public=True)).distinct()

        category = self.request.query_params.get('category')
        if category:
            qs = qs.filter(category=category)
        return qs

    def get_serializer_class(self) -> type[BaseSerializer]:
        if self.action == 'create':
            return RegexPatternCreateSerializer
        return RegexPatternSerializer

    def perform_create(self, serializer: BaseSerializer) -> None:
        instance = serializer.save(created_by=self.request.user)
        AuditService.log(
            user=self.request.user,
            action='regex_pattern_created',
            category='validation_management',
            resource_type='RegexPattern',
            resource_id=instance.id,
            resource_name=instance.name,
            description=f"Regex pattern '{instance.name}' created",
            metadata={
                'pattern': instance.pattern,
                'category': instance.category,
                'is_public': instance.is_public,
            },
            request=self.request,
        )

    def perform_update(self, serializer: BaseSerializer) -> None:
        updated = serializer.save()
        AuditService.log(
            user=self.request.user,
            action='regex_pattern_updated',
            category='validation_management',
            resource_type='RegexPattern',
            resource_id=updated.id,
            resource_name=updated.name,
            description=f"Regex pattern '{updated.name}' updated",
            metadata={'pattern': updated.pattern},
            request=self.request,
        )

    def perform_destroy(self, instance: RegexPattern) -> None:
        from rest_framework.exceptions import ValidationError as DRFValidationError

        if instance.usage_count > 0:
            raise DRFValidationError(
                {'error': f'Cannot delete regex pattern in use ({instance.usage_count} usages)'}
            )

        AuditService.log(
            user=self.request.user,
            action='regex_pattern_deleted',
            category='validation_management',
            resource_type='RegexPattern',
            resource_id=instance.id,
            resource_name=instance.name,
            description=f"Regex pattern '{instance.name}' deleted",
            request=self.request,
        )
        instance.delete()

    @action(detail=False, methods=['post'])
    def test(self, request: Request) -> Response:
        # Live-test a regex pattern against multiple strings without saving.
        # POST { "pattern": "^\\d+$", "flags": ["i"], "test_strings": ["123", "abc"] }
        import re

        pattern_str = request.data.get('pattern', '')
        flag_list = request.data.get('flags', [])
        test_strings = request.data.get('test_strings', [])

        regex_flags = 0
        if 'i' in flag_list:
            regex_flags |= re.IGNORECASE
        if 'm' in flag_list:
            regex_flags |= re.MULTILINE
        if 's' in flag_list:
            regex_flags |= re.DOTALL

        try:
            compiled = re.compile(pattern_str, regex_flags)
        except re.error as exc:
            # re.error.msg carries the curated regex parse error (e.g.
            # "missing ), unterminated subpattern at position 5") — that's
            # exactly what the user needs to fix their pattern.
            return Response({'valid': False, 'error': exc.msg, 'results': []})

        results = []
        for entry in test_strings[:50]:  # cap at 50
            value = entry if isinstance(entry, str) else str(entry)
            match = compiled.search(value)
            results.append(
                {
                    'value': value,
                    'is_match': bool(match),
                    'match_start': match.start() if match else None,
                    'match_end': match.end() if match else None,
                    'matched_text': match.group() if match else None,
                }
            )

        return Response({'valid': True, 'error': None, 'results': results})
