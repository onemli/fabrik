# awx/views/connection.py
#
# CRUD and proxy endpoints for AWXConnection. The "proxy" part matters: several
# actions here forward requests to the AWX API and return its response verbatim
# so the frontend doesn't have to deal with cross-origin requests or AWX auth.
# _clamp_page_size caps list results to prevent clients from accidentally fetching
# thousands of AWX templates in one call.

import logging
from typing import Any

from rest_framework import viewsets, status, filters
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.serializers import BaseSerializer
from users.permissions import FabrikModelPermissions
from django.db.models import Q, QuerySet
from django.utils import timezone
from audit.services import AuditService

logger = logging.getLogger(__name__)

# Hard ceiling on page_size for requests that proxy to the AWX API.
# AWX itself doesn't cap this, so without our own limit a client could
# accidentally request 10,000 templates and time out.
_AWX_MAX_PAGE_SIZE = 100


def _clamp_page_size(request: Request, default: int = 50) -> int:
    """Return a page_size in [1, _AWX_MAX_PAGE_SIZE] from query params."""
    try:
        val = int(request.query_params.get('page_size', default))
    except (ValueError, TypeError):
        val = default
    return max(1, min(val, _AWX_MAX_PAGE_SIZE))


from awx.models import AWXConnection
from awx.serializers import (
    AWXConnectionListSerializer,
    AWXConnectionDetailSerializer,
    AWXConnectionCreateSerializer,
)
from awx.services.awx_client import AWXClient


class AWXConnectionViewSet(viewsets.ModelViewSet):
    """CRUD + proxy for AWX connections.

    Visibility is union-based: you see connections you created, connections
    explicitly shared with you, and connections marked public. The distinct()
    call prevents duplicate rows when a user both owns and is shared on the same
    connection. Audit logs capture create/update/delete so we have a history of
    who changed credentials.
    """
    permission_classes = [FabrikModelPermissions]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'description', 'url']
    ordering_fields = ['name', 'created_at', 'last_tested_at']
    ordering = ['-created_at']

    def get_queryset(self) -> QuerySet[AWXConnection]:
        """Filter connections based on ownership and sharing"""
        user = self.request.user
        return AWXConnection.objects.filter(
            Q(created_by=user) | Q(shared_with=user) | Q(is_public=True)
        ).distinct()

    def get_serializer_class(self) -> type[BaseSerializer]:
        """Use different serializers for list/detail/create"""
        if self.action == 'list':
            return AWXConnectionListSerializer
        elif self.action in ['create', 'update', 'partial_update']:
            return AWXConnectionCreateSerializer
        else:
            return AWXConnectionDetailSerializer

    def perform_create(self, serializer: BaseSerializer) -> None:
        """Create connection with audit logging"""
        instance = serializer.save(created_by=self.request.user)

        # Audit log
        AuditService.log(
            user=self.request.user,
            action='awx_connection_created',
            category='awx_management',
            resource_type='AWXConnection',
            resource_id=instance.id,
            resource_name=instance.name,
            description=f"AWX connection '{instance.name}' created",
            metadata={
                'url': instance.url,
                'auth_type': instance.auth_type,
            },
            request=self.request
        )

    def perform_update(self, serializer: BaseSerializer) -> None:
        """Update connection with change tracking"""
        instance = serializer.instance

        # Track changes
        old_data = {
            'name': instance.name,
            'url': instance.url,
            'auth_type': instance.auth_type,
            'verify_ssl': instance.verify_ssl,
        }

        updated_instance = serializer.save()

        # Detect changes
        changes = {}
        new_data = {
            'name': updated_instance.name,
            'url': updated_instance.url,
            'auth_type': updated_instance.auth_type,
            'verify_ssl': updated_instance.verify_ssl,
        }
        for key, old_val in old_data.items():
            new_val = new_data[key]
            if old_val != new_val:
                changes[key] = {'old': old_val, 'new': new_val}

        # Audit log
        AuditService.log(
            user=self.request.user,
            action='awx_connection_updated',
            category='awx_management',
            resource_type='AWXConnection',
            resource_id=updated_instance.id,
            resource_name=updated_instance.name,
            description=f"AWX connection '{updated_instance.name}' updated",
            metadata={'changes': changes},
            request=self.request
        )

    def perform_destroy(self, instance: AWXConnection) -> None:
        """Delete connection with audit logging"""
        # Audit log (before deletion)
        AuditService.log(
            user=self.request.user,
            action='awx_connection_deleted',
            category='awx_management',
            resource_type='AWXConnection',
            resource_id=instance.id,
            resource_name=instance.name,
            description=f"AWX connection '{instance.name}' deleted",
            metadata={
                'url': instance.url,
                'request_count': instance.requests.count(),
            },
            request=self.request
        )

        instance.delete()

    @action(detail=True, methods=['post'])
    def test(self, request: Request, pk: Any = None) -> Response:
        """
        Test AWX connection
        POST /api/awx/connections/{id}/test/
        """
        connection = self.get_object()

        try:
            # Create a client for this connection
            client = AWXClient.for_connection(connection)

            # Test connection
            success, error, metadata = client.test_connection()

            # Update connection metadata
            connection.last_tested_at = timezone.now()
            if success:
                connection.last_test_status = 'success'
                connection.awx_version = metadata.get('version', '')
            else:
                connection.last_test_status = 'failed'
            connection.save()

            # Audit log
            AuditService.log(
                user=self.request.user,
                action='awx_connection_tested',
                category='awx_management',
                resource_type='AWXConnection',
                resource_id=connection.id,
                resource_name=connection.name,
                description=f"AWX connection '{connection.name}' tested",
                metadata={
                    'success': success,
                    'version': metadata.get('version') if success else None,
                    'error': error
                },
                success=success,
                error_message=error or '',
                request=self.request
            )

            if success:
                return Response({
                    'success': True,
                    'message': 'Connection successful',
                    'metadata': metadata
                })
            else:
                return Response({
                    'success': False,
                    'error': error
                }, status=status.HTTP_400_BAD_REQUEST)

        except Exception:
            logger.exception(f"Error testing AWX connection {connection.id}")
            connection.last_tested_at = timezone.now()
            connection.last_test_status = 'failed'
            connection.save()

            return Response({
                'success': False,
                'error': 'Connection test failed due to an internal error'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=['get'])
    def templates(self, request: Request, pk: Any = None) -> Response:
        """
        List AWX job templates from this connection
        GET /api/awx/connections/{id}/templates/
        """
        connection = self.get_object()

        try:
            # Create a client for this connection
            client = AWXClient.for_connection(connection)

            # Get templates
            success, data, error = client.list_job_templates(
                page=int(request.query_params.get('page', 1)),
                page_size=_clamp_page_size(request)
            )

            if success:
                return Response(data)
            else:
                return Response({
                    'error': error
                }, status=status.HTTP_400_BAD_REQUEST)

        except Exception:
            logger.exception("AWX API request failed")
            return Response({
                'error': 'An internal error occurred'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=['get'], url_path='job-templates')
    def job_templates(self, request: Request, pk: Any = None) -> Response:
        """
        List AWX job templates from this connection
        GET /api/awx/connections/{id}/job-templates/?page=1&page_size=50&name=L3Out
        """
        connection = self.get_object()

        try:
            client = AWXClient.for_connection(connection)

            success, data, error = client.list_job_templates(
                page=int(request.query_params.get('page', 1)),
                page_size=_clamp_page_size(request),
                name_filter=request.query_params.get('name')
            )

            if success:
                return Response(data)
            else:
                return Response({'error': error}, status=status.HTTP_400_BAD_REQUEST)

        except Exception:
            logger.exception("AWX API request failed")
            return Response({'error': 'An internal error occurred'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=['get'], url_path='job-templates/(?P<template_id>[0-9]+)')
    def job_template_detail(self, request: Request, pk: Any = None, template_id: Any = None) -> Response:
        """
        Get specific job template details
        GET /api/awx/connections/{id}/job-templates/{template_id}/
        """
        connection = self.get_object()

        try:
            client = AWXClient.for_connection(connection)

            success, data, error = client.get_job_template(int(template_id))

            if success:
                # Also fetch survey spec
                survey_success, survey_data, survey_error = client.get_job_template_survey(int(template_id))
                if survey_success:
                    data['survey_spec'] = survey_data

                return Response(data)
            else:
                return Response({'error': error}, status=status.HTTP_400_BAD_REQUEST)

        except Exception:
            logger.exception("AWX API request failed")
            return Response({'error': 'An internal error occurred'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=['get'], url_path='workflow-templates')
    def workflow_templates(self, request: Request, pk: Any = None) -> Response:
        """
        List AWX workflow templates from this connection
        GET /api/awx/connections/{id}/workflow-templates/?page=1&page_size=50&name=Multi
        """
        connection = self.get_object()

        try:
            client = AWXClient.for_connection(connection)

            success, data, error = client.list_workflow_templates(
                page=int(request.query_params.get('page', 1)),
                page_size=_clamp_page_size(request),
                name_filter=request.query_params.get('name')
            )

            if success:
                return Response(data)
            else:
                return Response({'error': error}, status=status.HTTP_400_BAD_REQUEST)

        except Exception:
            logger.exception("AWX API request failed")
            return Response({'error': 'An internal error occurred'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=['get'], url_path='workflow-templates/(?P<template_id>[0-9]+)')
    def workflow_template_detail(self, request: Request, pk: Any = None, template_id: Any = None) -> Response:
        """
        Get specific workflow template details with nodes
        GET /api/awx/connections/{id}/workflow-templates/{template_id}/
        """
        connection = self.get_object()

        try:
            client = AWXClient.for_connection(connection)

            # Get workflow template
            success, data, error = client.get_workflow_template(int(template_id))

            if success:
                # Also fetch nodes and survey spec
                nodes_success, nodes_data, nodes_error = client.get_workflow_nodes(int(template_id))
                if nodes_success:
                    data['workflow_nodes'] = nodes_data.get('results', [])

                survey_success, survey_data, survey_error = client.get_workflow_template_survey(int(template_id))
                if survey_success:
                    data['survey_spec'] = survey_data

                return Response(data)
            else:
                return Response({'error': error}, status=status.HTTP_400_BAD_REQUEST)

        except Exception:
            logger.exception("AWX API request failed")
            return Response({'error': 'An internal error occurred'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=['get'], url_path='credentials')
    def credentials(self, request: Request, pk: Any = None) -> Response:
        """List credentials available in this AWX instance.

        GET /api/awx/connections/{id}/credentials/?credential_type=14&search=apic
        Returns AWX credential metadata (id, name, description, type) — never
        the secret values. AWX strips secrets from GET responses by design.
        """
        connection = self.get_object()
        try:
            client = AWXClient.for_connection(connection)
            page_size = _clamp_page_size(request)
            credential_type = request.query_params.get('credential_type')
            search = request.query_params.get('search')

            success, data, error = client.list_credentials(
                credential_type_id=int(credential_type) if credential_type else None,
                page=int(request.query_params.get('page', 1)),
                page_size=page_size,
                search=search,
                name_startswith=connection.credential_prefix or None,
            )

            if success:
                return Response(data)
            return Response({'error': error}, status=status.HTTP_400_BAD_REQUEST)

        except Exception:
            logger.exception("Failed to list AWX credentials")
            return Response({'error': 'An internal error occurred'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=['get'], url_path='credential-types')
    def credential_types(self, request: Request, pk: Any = None) -> Response:
        """List credential types registered in this AWX instance.

        GET /api/awx/connections/{id}/credential-types/
        Useful for filtering credentials by type (e.g. find the 'Cisco ACI' type).
        """
        connection = self.get_object()
        try:
            client = AWXClient.for_connection(connection)
            page_size = _clamp_page_size(request)

            success, data, error = client.list_credential_types(
                page=int(request.query_params.get('page', 1)),
                page_size=page_size,
            )

            if success:
                return Response(data)
            return Response({'error': error}, status=status.HTTP_400_BAD_REQUEST)

        except Exception:
            logger.exception("Failed to list AWX credential types")
            return Response({'error': 'An internal error occurred'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
