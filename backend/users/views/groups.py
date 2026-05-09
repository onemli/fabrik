# Admin-only group and permission management.

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.pagination import PageNumberPagination
from django.contrib.auth.models import Group, Permission
from django.db.models import Q

from ..serializers import (
    GroupQuotaSerializer,
    PermissionSerializer,
)
from ..models import GroupQuota
from ..permissions import IsAdminOrSuperuser
from audit.services import AuditService


class StandardResultsSetPagination(PageNumberPagination):
    page_size = 100
    page_size_query_param = 'page_size'
    max_page_size = 1000


class GroupViewSet(viewsets.ModelViewSet):
    queryset = Group.objects.all().prefetch_related('permissions', 'user_set')
    permission_classes = [IsAdminOrSuperuser]
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        if self.action in ['create', 'update', 'partial_update']:
            from ..serializers import GroupCreateUpdateSerializer

            return GroupCreateUpdateSerializer
        from ..serializers import GroupDetailSerializer

        return GroupDetailSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(name__icontains=search)
        return queryset.order_by('name')

    def destroy(self, request, *args, **kwargs):
        group = self.get_object()
        if group.name == 'Admin':
            return Response(
                {'error': 'Cannot delete the Admin group'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().destroy(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        group = self.get_object()
        # Renaming the bootstrap Admin group would silently strip RBAC bypass
        # from every member, since IsAdminOrSuperuser / FabrikModelPermissions
        # match by the literal name 'Admin'. Block rename even when the
        # request is a partial_update that includes 'name'.
        new_name = request.data.get('name')
        if group.name == 'Admin' and new_name and new_name != 'Admin':
            return Response(
                {'error': 'Cannot rename the Admin group'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        return self.update(request, *args, **kwargs)

    @action(detail=True, methods=['post'])
    def add_permissions(self, request, pk=None):
        group = self.get_object()
        permission_ids = request.data.get('permission_ids', [])
        permissions = Permission.objects.filter(id__in=permission_ids)
        permission_names = [p.name for p in permissions]
        group.permissions.add(*permissions)

        AuditService.log(
            user=request.user,
            action='permissions_added',
            category='group_permission',
            resource_type='Group',
            resource_id=group.id,
            resource_name=group.name,
            description=f"Added {len(permissions)} permissions to group '{group.name}'",
            metadata={'permissions': permission_names},
            request=request,
        )
        serializer = self.get_serializer(group)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def remove_permissions(self, request, pk=None):
        group = self.get_object()
        permission_ids = request.data.get('permission_ids', [])
        permissions = Permission.objects.filter(id__in=permission_ids)
        permission_names = [p.name for p in permissions]
        group.permissions.remove(*permissions)

        AuditService.log(
            user=request.user,
            action='permissions_removed',
            category='group_permission',
            resource_type='Group',
            resource_id=group.id,
            resource_name=group.name,
            description=f"Removed {len(permissions)} permissions from group '{group.name}'",
            metadata={'permissions': permission_names},
            request=request,
        )
        serializer = self.get_serializer(group)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def role_templates(self, request):
        """Predefined role templates for quick group creation."""
        EXCLUDED_APPS = {'admin', 'contenttypes', 'sessions', 'authtoken', 'token_blacklist'}
        all_perms = Permission.objects.select_related('content_type').exclude(
            content_type__app_label__in=EXCLUDED_APPS
        )

        def get_perm_ids(codename_patterns):
            matching = all_perms.filter(
                Q(*[Q(codename__contains=p) for p in codename_patterns], _connector=Q.OR)
            )
            return list(matching.values_list('id', flat=True))

        templates = {
            'admin': {
                'name': 'Administrator',
                'description': 'Full system access with all permissions',
                'permission_ids': list(all_perms.values_list('id', flat=True)),
                'icon': 'shield-check',
                'color': 'red',
                'quota_preset': {
                    'max_saved_queries': 0,
                    'max_scheduled_tasks': 0,
                    'max_apic_connections': 0,
                    'max_awx_requests_daily': 0,
                    'max_awx_concurrent': 10,
                    'max_query_results': 0,
                    'max_export_rows': 0,
                    'query_execution_daily': 0,
                    'can_create_queries': True,
                    'can_execute_queries': True,
                    'can_create_scheduled': True,
                    'can_use_awx': True,
                    'can_use_time_machine': True,
                    'can_export_data': True,
                    'can_share_resources': True,
                    'can_use_ai_builder': True,
                },
            },
            'operator': {
                'name': 'Operator',
                'description': 'Can execute queries, manage connections, and run background tasks',
                'permission_ids': get_perm_ids(
                    [
                        'view_',
                        'add_savedquery',
                        'change_savedquery',
                        'add_scheduledtask',
                        'change_scheduledtask',
                        'view_queryexecutionsnapshot',
                    ]
                ),
                'icon': 'play-circle',
                'color': 'blue',
                'quota_preset': {
                    'max_saved_queries': 100,
                    'max_scheduled_tasks': 20,
                    'max_apic_connections': 10,
                    'max_awx_requests_daily': 50,
                    'max_awx_concurrent': 5,
                    'max_query_results': 10000,
                    'max_export_rows': 50000,
                    'query_execution_daily': 200,
                    'can_create_queries': True,
                    'can_execute_queries': True,
                    'can_create_scheduled': True,
                    'can_use_awx': True,
                    'can_use_time_machine': True,
                    'can_export_data': True,
                    'can_share_resources': True,
                    'can_use_ai_builder': True,
                },
            },
            'viewer': {
                'name': 'Viewer',
                'description': 'Read-only access to queries and system data',
                'permission_ids': get_perm_ids(['view_']),
                'icon': 'eye',
                'color': 'green',
                'quota_preset': {
                    'max_saved_queries': 10,
                    'max_scheduled_tasks': 0,
                    'max_apic_connections': 2,
                    'max_awx_requests_daily': 0,
                    'max_awx_concurrent': 0,
                    'max_query_results': 1000,
                    'max_export_rows': 5000,
                    'query_execution_daily': 50,
                    'can_create_queries': False,
                    'can_execute_queries': True,
                    'can_create_scheduled': False,
                    'can_use_awx': False,
                    'can_use_time_machine': True,
                    'can_export_data': True,
                    'can_share_resources': False,
                    'can_use_ai_builder': False,
                },
            },
            'editor': {
                'name': 'Editor',
                'description': 'Can create and edit queries, but not delete or manage users',
                'permission_ids': get_perm_ids(
                    [
                        'view_',
                        'add_savedquery',
                        'change_savedquery',
                        'add_category',
                        'change_category',
                    ]
                ),
                'icon': 'edit',
                'color': 'yellow',
                'quota_preset': {
                    'max_saved_queries': 50,
                    'max_scheduled_tasks': 10,
                    'max_apic_connections': 5,
                    'max_awx_requests_daily': 20,
                    'max_awx_concurrent': 3,
                    'max_query_results': 5000,
                    'max_export_rows': 25000,
                    'query_execution_daily': 100,
                    'can_create_queries': True,
                    'can_execute_queries': True,
                    'can_create_scheduled': True,
                    'can_use_awx': False,
                    'can_use_time_machine': True,
                    'can_export_data': True,
                    'can_share_resources': True,
                    'can_use_ai_builder': True,
                },
            },
        }

        return Response(templates)

    @action(detail=True, methods=['get', 'put'])
    def quota(self, request, pk=None):
        group = self.get_object()

        if request.method == 'GET':
            try:
                gq = group.quota
            except GroupQuota.DoesNotExist:
                return Response({'detail': 'No quota configured for this group.'}, status=404)
            serializer = GroupQuotaSerializer(gq)
            return Response(serializer.data)

        # PUT — create or update
        try:
            gq = group.quota
            serializer = GroupQuotaSerializer(gq, data=request.data, partial=True)
        except GroupQuota.DoesNotExist:
            serializer = GroupQuotaSerializer(data=request.data)

        serializer.is_valid(raise_exception=True)
        serializer.save(group=group)

        AuditService.log(
            user=request.user,
            action='quota_updated',
            category='group_permission',
            resource_type='Group',
            resource_id=group.id,
            resource_name=group.name,
            description=f"Quota updated for group '{group.name}'",
            request=request,
        )
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def clone(self, request, pk=None):
        """Clone a group with all its permissions."""
        from ..serializers import GroupDetailSerializer

        source_group = self.get_object()
        new_name = request.data.get('name')

        if not new_name:
            return Response(
                {'error': 'Group name is required'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if Group.objects.filter(name=new_name).exists():
            return Response(
                {'error': f'A group with name "{new_name}" already exists'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        new_group = Group.objects.create(name=new_name)
        new_group.permissions.set(source_group.permissions.all())

        AuditService.log(
            user=request.user,
            action='group_cloned',
            category='group_permission',
            resource_type='Group',
            resource_id=new_group.id,
            resource_name=new_group.name,
            description=f"Cloned group '{source_group.name}' to '{new_group.name}'",
            metadata={
                'source_group_id': source_group.id,
                'source_group_name': source_group.name,
                'permission_count': source_group.permissions.count(),
            },
            request=request,
        )
        serializer = GroupDetailSerializer(new_group)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class PermissionViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Permission.objects.all().select_related('content_type')
    serializer_class = PermissionSerializer
    permission_classes = [IsAdminOrSuperuser]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        queryset = super().get_queryset()

        content_type_id = self.request.query_params.get('content_type_id')
        if content_type_id:
            queryset = queryset.filter(content_type_id=content_type_id)

        app_label = self.request.query_params.get('app_label')
        if app_label:
            queryset = queryset.filter(content_type__app_label=app_label)

        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(Q(name__icontains=search) | Q(codename__icontains=search))

        return queryset.order_by('content_type__app_label', 'codename')
