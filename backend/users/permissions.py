# users/permissions.py
#
# Reusable permission classes for the project.
#
# FabrikModelPermissions: like DjangoModelPermissions but superusers and Admin
# group members automatically pass. Regular users need the matching
# add_/change_/delete_/view_ permission on their user or group.
#
# This keeps the existing behaviour for admins while adding CRUD permission
# enforcement for everyone else.

from rest_framework.permissions import IsAuthenticated, DjangoModelPermissions
from rest_framework.exceptions import PermissionDenied


ACTION_LABELS = {
    'GET': 'view',
    'POST': 'create',
    'PUT': 'edit',
    'PATCH': 'edit',
    'DELETE': 'delete',
}


class IsAdminOrSuperuser(IsAuthenticated):
    """User must be in Admin group or be superuser."""

    def has_permission(self, request, view) -> bool:
        if not super().has_permission(request, view):
            return False
        return request.user.is_superuser or request.user.groups.filter(name='Admin').exists()


class FabrikModelPermissions(DjangoModelPermissions):
    """DjangoModelPermissions with two tweaks:

    1. GET/HEAD/OPTIONS require view_ permission (DRF default skips them).
    2. Superusers and Admin group members bypass all checks.
    3. Denial message includes which action was blocked and on which resource.
    """

    perms_map = {
        'GET': ['%(app_label)s.view_%(model_name)s'],
        'OPTIONS': [],
        'HEAD': [],
        'POST': ['%(app_label)s.add_%(model_name)s'],
        'PUT': ['%(app_label)s.change_%(model_name)s'],
        'PATCH': ['%(app_label)s.change_%(model_name)s'],
        'DELETE': ['%(app_label)s.delete_%(model_name)s'],
    }

    def has_permission(self, request, view) -> bool:
        if not request.user or not request.user.is_authenticated:
            return False

        # Superuser and Admin group bypass
        if request.user.is_superuser:
            return True
        if request.user.groups.filter(name='Admin').exists():
            return True

        # Check permission with descriptive denial
        has_perm = super().has_permission(request, view)
        if not has_perm:
            action = ACTION_LABELS.get(request.method, request.method.lower())
            model = self._get_model_name(view)
            raise PermissionDenied(
                f'You do not have permission to {action} {model}. '
                f'Contact your administrator to request access.'
            )
        return True

    @staticmethod
    def _get_model_name(view) -> str:
        """Extract a human-readable model name from the view."""
        if hasattr(view, 'queryset') and view.queryset is not None:
            name = view.queryset.model._meta.verbose_name_plural
            return str(name)
        return 'this resource'
