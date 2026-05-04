# Admin-only user management: CRUD, permissions, activate/deactivate.

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.pagination import PageNumberPagination
from django.contrib.auth.models import User, Group, Permission
from django.db.models import Q
from django.utils import timezone

from ..serializers import (
    UserManagementListSerializer,
    UserManagementCreateSerializer,
    UserManagementUpdateSerializer,
    AdminPasswordResetSerializer,
    PermissionSerializer,
)
from ..models import PasswordResetCode
from ..permissions import IsAdminOrSuperuser
from ..throttles import SensitiveActionThrottle
from audit.services import AuditService


class StandardResultsSetPagination(PageNumberPagination):
    page_size = 100
    page_size_query_param = 'page_size'
    max_page_size = 1000


class UserManagementViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all().select_related('profile').prefetch_related('groups')
    permission_classes = [IsAdminOrSuperuser]
    pagination_class = StandardResultsSetPagination

    # Actions that mutate user state or grant access — these are the "sensitive"
    # ones we want rate-limited. Everything else (list, retrieve, and
    # read-only custom actions like effective_permissions) falls back to the
    # default `user: 300/minute` throttle so admin browsing isn't blocked.
    _SENSITIVE_ACTIONS = {
        'create', 'update', 'partial_update', 'destroy',
        'reset_password', 'generate_reset_code',
        'verify_email', 'disable_mfa',
        'activate', 'deactivate',
        'add_permissions', 'remove_permissions',
    }

    def get_throttles(self):
        if self.action in self._SENSITIVE_ACTIONS:
            return [SensitiveActionThrottle()]
        return super().get_throttles()

    def get_serializer_class(self):
        if self.action == 'create':
            return UserManagementCreateSerializer
        elif self.action in ['update', 'partial_update']:
            return UserManagementUpdateSerializer
        return UserManagementListSerializer

    def get_queryset(self):
        queryset = super().get_queryset()

        group_id = self.request.query_params.get('group_id')
        if group_id:
            queryset = queryset.filter(groups__id=group_id)

        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        permission_id = self.request.query_params.get('permission_id')
        if permission_id:
            queryset = queryset.filter(
                Q(user_permissions__id=permission_id) |
                Q(groups__permissions__id=permission_id)
            ).distinct()

        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(username__icontains=search) |
                Q(email__icontains=search) |
                Q(first_name__icontains=search) |
                Q(last_name__icontains=search)
            )

        return queryset.order_by('-date_joined')

    def update(self, request, *args, **kwargs):
        user = self.get_object()
        user._pre_save_state = {
            'email': user.email,
            'first_name': user.first_name,
            'last_name': user.last_name,
            'is_active': user.is_active,
            'is_staff': user.is_staff,
        }

        # Lockout protection: refuse a payload that would strip the last
        # remaining admin of their admin status. We check both group changes
        # (group_ids no longer contains Admin) and superuser revocation,
        # because either can leave the system without an admin.
        denial = self._would_remove_last_admin(user, request.data)
        if denial is not None:
            return Response({'error': denial}, status=status.HTTP_400_BAD_REQUEST)

        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        user = self.get_object()

        if user.id == request.user.id:
            return Response(
                {'error': 'You cannot delete your own account'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if self._is_last_admin(user):
            return Response(
                {'error': 'Cannot delete the last admin user'},
                status=status.HTTP_400_BAD_REQUEST
            )

        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=['post'])
    def reset_password(self, request, pk=None):
        user = self.get_object()
        serializer = AdminPasswordResetSerializer(data=request.data)
        if serializer.is_valid():
            user.set_password(serializer.validated_data['new_password'])
            user.save()

            AuditService.log(
                user=request.user,
                action='password_reset',
                category='user_management',
                resource_type='User',
                resource_id=user.id,
                resource_name=user.username,
                description=f"Password reset for user '{user.username}' by admin",
                request=request,
            )
            return Response({'message': 'Password reset successfully'}, status=status.HTTP_200_OK)

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'])
    def generate_reset_code(self, request, pk=None):
        """Generate a one-time reset code when email is unavailable."""
        user = self.get_object()
        reset_code, plain_code = PasswordResetCode.create_for_user(
            user=user, created_by=request.user
        )

        AuditService.log(
            user=request.user,
            action='reset_code_generated',
            category='user_management',
            resource_type='User',
            resource_id=user.id,
            resource_name=user.username,
            description=f"Admin generated password reset code for '{user.username}'",
            request=request,
        )

        return Response({
            'code': plain_code,
            'expires_at': reset_code.expires_at.isoformat(),
            'message': f'Give this code to {user.username}. It expires in 30 minutes.',
        })

    @action(detail=True, methods=['post'])
    def verify_email(self, request, pk=None):
        """Admin manually marks a user's email as verified."""
        user = self.get_object()
        if hasattr(user, 'profile'):
            user.profile.email_verified = True
            user.profile.email_verified_at = timezone.now()
            user.profile.save(update_fields=['email_verified', 'email_verified_at'])

        AuditService.log(
            user=request.user,
            action='email_verified_by_admin',
            category='user_management',
            resource_type='User',
            resource_id=user.id,
            resource_name=user.username,
            description=f"Email manually verified for '{user.username}' by admin",
            request=request,
        )
        return Response({'message': f"Email verified for {user.username}."})

    @action(detail=True, methods=['post'])
    def disable_mfa(self, request, pk=None):
        """Admin disables MFA for a user (e.g. lost phone recovery)."""
        user = self.get_object()
        if hasattr(user, 'profile') and user.profile.totp_enabled:
            user.profile.disable_totp()

            AuditService.log(
                user=request.user,
                action='mfa_disabled_by_admin',
                category='user_management',
                resource_type='User',
                resource_id=user.id,
                resource_name=user.username,
                description=f"MFA disabled for '{user.username}' by admin (recovery)",
                request=request,
            )
            return Response({'message': f"MFA disabled for {user.username}."})
        return Response({'message': 'MFA was not enabled for this user.'})

    @action(detail=True, methods=['post'])
    def activate(self, request, pk=None):
        user = self.get_object()
        user.is_active = True
        user.save()

        AuditService.log(
            user=request.user,
            action='user_activated',
            category='user_management',
            resource_type='User',
            resource_id=user.id,
            resource_name=user.username,
            description=f"User '{user.username}' activated",
            request=request,
        )
        return Response({'message': 'User activated successfully'}, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'])
    def deactivate(self, request, pk=None):
        user = self.get_object()

        if user.id == request.user.id:
            return Response(
                {'error': 'You cannot deactivate your own account'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if self._is_last_admin(user):
            return Response(
                {'error': 'Cannot deactivate the last admin user'},
                status=status.HTTP_400_BAD_REQUEST
            )

        user.is_active = False
        user.save()

        AuditService.log(
            user=request.user,
            action='user_deactivated',
            category='user_management',
            resource_type='User',
            resource_id=user.id,
            resource_name=user.username,
            description=f"User '{user.username}' deactivated",
            request=request,
        )
        return Response({'message': 'User deactivated successfully'}, status=status.HTTP_200_OK)

    @action(detail=True, methods=['get'])
    def user_permissions(self, request, pk=None):
        user = self.get_object()
        permissions = user.user_permissions.select_related('content_type').all()
        serializer = PermissionSerializer(permissions, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def add_permissions(self, request, pk=None):
        user = self.get_object()
        permission_ids = request.data.get('permission_ids', [])
        permissions = Permission.objects.filter(id__in=permission_ids)
        permission_names = [p.name for p in permissions]
        user.user_permissions.add(*permissions)

        AuditService.log(
            user=request.user,
            action='permissions_added',
            category='user_permission',
            resource_type='User',
            resource_id=user.id,
            resource_name=user.username,
            description=f"Added {len(permissions)} direct permissions to user '{user.username}'",
            metadata={'permissions': permission_names},
            request=request,
        )
        return Response({'message': f'Added {len(permissions)} permissions to user'})

    @action(detail=True, methods=['post'])
    def remove_permissions(self, request, pk=None):
        user = self.get_object()
        permission_ids = request.data.get('permission_ids', [])
        permissions = Permission.objects.filter(id__in=permission_ids)
        permission_names = [p.name for p in permissions]
        user.user_permissions.remove(*permissions)

        AuditService.log(
            user=request.user,
            action='permissions_removed',
            category='user_permission',
            resource_type='User',
            resource_id=user.id,
            resource_name=user.username,
            description=f"Removed {len(permissions)} direct permissions from user '{user.username}'",
            metadata={'permissions': permission_names},
            request=request,
        )
        return Response({'message': f'Removed {len(permissions)} permissions from user'})

    @action(detail=True, methods=['get'])
    def effective_permissions(self, request, pk=None):
        """All effective permissions with source annotation (direct + via groups)."""
        user = self.get_object()
        result = []
        seen_direct_ids = set()

        for perm in user.user_permissions.select_related('content_type').all():
            perm_data = PermissionSerializer(perm).data
            perm_data['source'] = 'direct'
            result.append(perm_data)
            seen_direct_ids.add(perm.id)

        for group in user.groups.prefetch_related('permissions__content_type').all():
            for perm in group.permissions.all():
                if perm.id not in seen_direct_ids:
                    perm_data = PermissionSerializer(perm).data
                    perm_data['source'] = group.name
                    result.append(perm_data)

        return Response(result)

    def _is_last_admin(self, user):
        if not (user.groups.filter(name='Admin').exists() or user.is_superuser):
            return False
        admin_count = User.objects.filter(
            Q(groups__name='Admin') | Q(is_superuser=True),
            is_active=True
        ).distinct().count()
        return admin_count <= 1

    def _would_remove_last_admin(self, user, payload):
        """Return a denial message if `payload` would strip admin status from
        the last remaining admin. Covers both group reassignment that removes
        Admin and explicit `is_superuser=False` on the only superuser."""
        if not self._is_last_admin(user):
            return None

        # Look up the Admin group id once; absence means the group was renamed
        # or deleted, in which case nobody currently holds admin via groups.
        admin_group_id = (
            Group.objects.filter(name='Admin')
            .values_list('id', flat=True)
            .first()
        )

        # Group-based removal: payload provides group_ids that no longer
        # include Admin, AND the user isn't a standalone superuser.
        if 'group_ids' in payload and not user.is_superuser:
            new_group_ids = payload.get('group_ids') or []
            try:
                new_group_ids = [int(gid) for gid in new_group_ids]
            except (TypeError, ValueError):
                new_group_ids = []
            if admin_group_id is not None and admin_group_id not in new_group_ids:
                return 'Cannot remove the last admin from the Admin group.'

        # Superuser revocation: only meaningful when the user has no Admin
        # group membership to fall back on.
        if 'is_superuser' in payload and user.is_superuser:
            new_value = payload.get('is_superuser')
            if new_value in (False, 'false', 'False', 0, '0'):
                still_admin_via_group = (
                    admin_group_id is not None
                    and admin_group_id in (payload.get('group_ids') or [])
                )
                if not still_admin_via_group and not user.groups.filter(name='Admin').exists():
                    return 'Cannot revoke superuser status from the last admin.'

        return None
