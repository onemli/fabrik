# apic_connections/views.py
#
# CRUD + test-connection for APIC controller credentials.
# Passwords are write-only — the serializer never includes them in GET responses.
# is_public connections are visible to all users; private ones are visible only
# to the owner and admins.

import logging

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import PermissionDenied
from django.utils import timezone
from django.db.models import Q

from users.permissions import FabrikModelPermissions
from .models import APICConnection
from .serializers import (
    APICConnectionListSerializer,
    APICConnectionDetailSerializer,
    APICConnectionCreateUpdateSerializer,
    APICQueryExecutionSerializer,
)
from .apic_client import APICClient
from audit.services import AuditService

logger = logging.getLogger(__name__)


class APICConnectionViewSet(viewsets.ModelViewSet):
    """ViewSet for managing APIC connections"""

    permission_classes = [IsAuthenticated, FabrikModelPermissions]
    pagination_class = None  # Disable pagination for APIC connections

    def get_serializer_class(self):
        if self.action in ['create', 'update', 'partial_update']:
            return APICConnectionCreateUpdateSerializer
        elif self.action == 'retrieve':
            return APICConnectionDetailSerializer
        return APICConnectionListSerializer

    def get_queryset(self):
        """Return connections that user can access"""
        user = self.request.user
        is_admin = user.is_superuser or user.groups.filter(name='Admin').exists()

        # Admin sees all
        if is_admin:
            return APICConnection.objects.all()

        # Operators and regular users see own, shared, and public connections
        return APICConnection.objects.filter(
            Q(created_by=user) | Q(shared_with=user) | Q(is_public=True)
        ).distinct()

    def perform_create(self, serializer):
        """Only admins can create connections"""
        user = self.request.user
        is_admin = user.is_superuser or user.groups.filter(name='Admin').exists()

        if not is_admin:
            raise PermissionDenied('Only administrators can create APIC connections')

        instance = serializer.save(created_by=user)

        # Audit log
        AuditService.log(
            user=user,
            action='apic_connection_created',
            category='apic_management',
            resource_type='APICConnection',
            resource_id=instance.id,
            resource_name=instance.name,
            description=f"APIC connection '{instance.name}' created",
            metadata={
                'url': instance.url,
                'username': instance.username,
                'is_public': instance.is_public,
            },
            request=self.request,
        )

    def perform_update(self, serializer):
        """Only owner or admin can update"""
        instance = self.get_object()
        user = self.request.user
        is_owner = instance.created_by == user
        is_admin = user.is_superuser or user.groups.filter(name='Admin').exists()

        if not (is_owner or is_admin):
            raise PermissionDenied("You don't have permission to edit this connection")

        # Track changes
        old_data = {
            'name': instance.name,
            'url': instance.url,
            'username': instance.username,
            'is_public': instance.is_public,
        }

        updated_instance = serializer.save()

        # Detect changes
        changes = {}
        new_data = {
            'name': updated_instance.name,
            'url': updated_instance.url,
            'username': updated_instance.username,
            'is_public': updated_instance.is_public,
        }
        for key, old_val in old_data.items():
            new_val = new_data[key]
            if old_val != new_val:
                changes[key] = {'old': old_val, 'new': new_val}

        # Audit log
        AuditService.log(
            user=user,
            action='apic_connection_updated',
            category='apic_management',
            resource_type='APICConnection',
            resource_id=updated_instance.id,
            resource_name=updated_instance.name,
            description=f"APIC connection '{updated_instance.name}' updated",
            metadata={'changes': changes} if changes else {},
            request=self.request,
        )

    def perform_destroy(self, instance):
        """Only owner or admin can delete"""
        user = self.request.user
        is_owner = instance.created_by == user
        is_admin = user.is_superuser or user.groups.filter(name='Admin').exists()

        if not (is_owner or is_admin):
            raise PermissionDenied("You don't have permission to delete this connection")

        # Audit log (before deletion)
        AuditService.log(
            user=user,
            action='apic_connection_deleted',
            category='apic_management',
            resource_type='APICConnection',
            resource_id=instance.id,
            resource_name=instance.name,
            description=f"APIC connection '{instance.name}' deleted",
            metadata={
                'url': instance.url,
                'username': instance.username,
                'created_by': instance.created_by.username,
            },
            request=self.request,
        )

        instance.delete()

    @action(detail=True, methods=['post'])
    def test(self, request, pk=None):
        """Test APIC connection"""
        connection = self.get_object()

        # Check if user can access this connection
        if not connection.can_be_accessed_by(request.user):
            # Audit log for permission denied
            AuditService.log(
                user=request.user,
                action='apic_connection_test_permission_denied',
                category='apic_management',
                resource_type='APICConnection',
                resource_id=connection.id,
                resource_name=connection.name,
                description=f"APIC connection test denied: No permission for '{connection.name}'",
                metadata={'url': connection.url},
                success=False,
                error_message='Permission denied',
                request=request,
            )
            return Response(
                {'error': 'You do not have permission to test this connection'},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Get password safely with error handling
        try:
            password = connection.get_password()
        except Exception as e:
            # Log the underlying error server-side; the DB column and the
            # response only carry a sanitised message so the stored credential
            # error and stack info don't surface to the client.
            logger.exception('APIC connection %s: password decryption failed', connection.id)
            user_message = 'Failed to decrypt the stored password.'
            connection.last_tested_at = timezone.now()
            connection.last_test_status = False
            connection.last_test_message = user_message
            connection.save()

            AuditService.log(
                user=request.user,
                action='apic_connection_test_password_error',
                category='apic_management',
                resource_type='APICConnection',
                resource_id=connection.id,
                resource_name=connection.name,
                description=f"APIC connection test failed: Password decryption error for '{connection.name}'",
                metadata={'url': connection.url, 'exception': type(e).__name__},
                success=False,
                error_message=str(e),
                request=request,
            )

            return Response(
                {'success': False, 'message': user_message}, status=status.HTTP_400_BAD_REQUEST
            )

        # Create APIC client and test connection
        client = APICClient(
            url=connection.url,
            username=connection.username,
            password=password,
            verify_ssl=connection.verify_ssl,
            timeout=connection.timeout,
        )

        success, error = client.test_connection()
        client.close()

        # Update connection test status
        connection.last_tested_at = timezone.now()
        connection.last_test_status = success
        connection.last_test_message = error if not success else 'Connection successful'
        connection.save()

        # Audit log
        AuditService.log(
            user=request.user,
            action='apic_connection_tested',
            category='apic_management',
            resource_type='APICConnection',
            resource_id=connection.id,
            resource_name=connection.name,
            description=f"APIC connection '{connection.name}' tested: {'successful' if success else 'failed'}",
            metadata={
                'url': connection.url,
                'test_result': 'success' if success else 'failure',
                'error_message': error if not success else None,
            },
            success=success,
            error_message=error if not success else '',
            request=request,
        )

        if success:
            return Response({'success': True, 'message': 'Connection successful'})
        else:
            return Response(
                {'success': False, 'message': error}, status=status.HTTP_400_BAD_REQUEST
            )

    @action(detail=False, methods=['post'])
    def execute_query(self, request):
        """Execute a query on selected APIC connection"""
        serializer = APICQueryExecutionSerializer(data=request.data)

        # Validate request data
        if not serializer.is_valid():
            # Audit log for validation failure
            AuditService.log(
                user=request.user,
                action='apic_query_validation_failed',
                category='apic_management',
                resource_type='APICConnection',
                description='APIC query execution failed: Invalid request data',
                metadata={'errors': serializer.errors},
                success=False,
                error_message=str(serializer.errors),
                request=request,
            )
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        connection_id = serializer.validated_data['connection_id']
        query_path = serializer.validated_data['query_path']
        method = serializer.validated_data.get('method', 'GET')
        data = serializer.validated_data.get('data')

        try:
            connection = APICConnection.objects.get(id=connection_id)
        except APICConnection.DoesNotExist:
            connection = None
        if not connection:
            # Audit log for connection not found or not accessible
            AuditService.log(
                user=request.user,
                action='apic_query_connection_not_found',
                category='apic_management',
                resource_type='APICConnection',
                description='APIC query execution failed: Connection not found',
                metadata={
                    'connection_id': str(connection_id),
                    'query_path': query_path,
                },
                success=False,
                error_message='Connection not found',
                request=request,
            )
            return Response({'error': 'Connection not found'}, status=status.HTTP_404_NOT_FOUND)

        # Check if connection is active
        if not connection.is_active:
            # Audit log for inactive connection
            AuditService.log(
                user=request.user,
                action='apic_query_inactive_connection',
                category='apic_management',
                resource_type='APICConnection',
                resource_id=connection.id,
                resource_name=connection.name,
                description="APIC query execution failed: Connection '{connection.name}' is inactive",
                metadata={
                    'query_path': query_path,
                    'connection_url': connection.url,
                },
                success=False,
                error_message='Connection is not active',
                request=request,
            )
            return Response(
                {'error': 'Connection is not active'}, status=status.HTTP_400_BAD_REQUEST
            )

        # Get password safely with error handling
        try:
            password = connection.get_password()
        except Exception as e:
            logger.exception('APIC connection %s: password decryption failed', connection.id)
            user_message = 'Failed to decrypt the stored password.'
            AuditService.log(
                user=request.user,
                action='apic_query_password_error',
                category='apic_management',
                resource_type='APICConnection',
                resource_id=connection.id,
                resource_name=connection.name,
                description=f"APIC query execution failed: Password decryption error for '{connection.name}'",
                metadata={
                    'query_path': query_path,
                    'connection_url': connection.url,
                    'exception': type(e).__name__,
                },
                success=False,
                error_message=str(e),
                request=request,
            )
            return Response(
                {'success': False, 'error': user_message}, status=status.HTTP_400_BAD_REQUEST
            )

        # Create APIC client and execute query
        client = APICClient(
            url=connection.url,
            username=connection.username,
            password=password,
            verify_ssl=connection.verify_ssl,
            timeout=connection.timeout,
        )

        success, response_data, error = client.execute_query(query_path, method, data)
        client.close()

        # Multi-class chain queries return APIC's nested children layout, which
        # PostProcessor pipelines and table renderers can't iterate without
        # descending into each `children` array. Flatten to the target class
        # here so every UI consumer sees the same shape (flat imdata of target
        # objects). Single-class queries are detected as such and pass through
        # unchanged.
        if success and isinstance(response_data, dict):
            from queries.services.response_flattener import maybe_flatten_response

            response_data = maybe_flatten_response(response_data, query_path)

        # Audit log
        result_count = (
            len(response_data.get('imdata', []))
            if success and isinstance(response_data, dict)
            else 0
        )
        AuditService.log(
            user=request.user,
            action='apic_query_executed',
            category='apic_management',
            resource_type='APICConnection',
            resource_id=connection.id,
            resource_name=connection.name,
            description=f"Query executed on APIC '{connection.name}': {'successful' if success else 'failed'}",
            metadata={
                'query_path': query_path,
                'method': method,
                'connection_url': connection.url,
                'result_count': result_count,
            },
            success=success,
            error_message=error if not success else '',
            request=request,
        )

        if success:
            return Response(
                {
                    'success': True,
                    'data': response_data,
                    'connection': {
                        'id': connection.id,
                        'name': connection.name,
                        'url': connection.url,
                    },
                }
            )
        else:
            return Response(
                {
                    'success': False,
                    'error': error,
                    'connection': {
                        'id': connection.id,
                        'name': connection.name,
                        'url': connection.url,
                    },
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
