# queries/views/notifications.py
#
# Global task management settings (singleton). Notification endpoints have been
# moved to the notifications app — see notifications/views.py.

from rest_framework import viewsets, status
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from audit.services import AuditService
from ..models import TaskManagementSettings
from ..serializers import TaskManagementSettingsSerializer


class TaskManagementSettingsViewSet(viewsets.ViewSet):
    """Read/update the singleton TaskManagementSettings row.

    Update is restricted to admins — regular users can read the defaults
    but can't change them platform-wide.
    """

    permission_classes = [IsAuthenticated]

    def list(self, request):
        """GET returns the one and only settings row (created on first access if missing)."""
        settings = TaskManagementSettings.get_settings()
        serializer = TaskManagementSettingsSerializer(settings)
        return Response(serializer.data)

    def update(self, request, pk=None):
        """Update task management settings (admin only)"""
        user = request.user
        is_admin = user.is_superuser or user.groups.filter(name='Admin').exists()

        if not is_admin:
            return Response(
                {'error': 'Only administrators can update settings'},
                status=status.HTTP_403_FORBIDDEN,
            )

        settings = TaskManagementSettings.get_settings()

        # Track changes
        old_settings = {
            'default_retry_count': settings.default_retry_count,
            'default_retry_interval_minutes': settings.default_retry_interval_minutes,
            'email_enabled': settings.email_enabled,
        }

        serializer = TaskManagementSettingsSerializer(settings, data=request.data, partial=True)

        if serializer.is_valid():
            updated_settings = serializer.save(updated_by=request.user)

            # Detect changes
            changes = {}
            new_settings = {
                'default_retry_count': updated_settings.default_retry_count,
                'default_retry_interval_minutes': updated_settings.default_retry_interval_minutes,
                'email_enabled': updated_settings.email_enabled,
            }
            for key, old_val in old_settings.items():
                new_val = new_settings[key]
                if old_val != new_val:
                    changes[key] = {'old': old_val, 'new': new_val}

            # Audit log
            AuditService.log(
                user=request.user,
                action='task_management_settings_updated',
                category='system_settings',
                resource_type='TaskManagementSettings',
                description='Task management settings updated',
                metadata={'changes': changes} if changes else {},
                request=request,
            )

            return Response(serializer.data)

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
