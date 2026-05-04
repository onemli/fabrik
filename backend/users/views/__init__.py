# Re-export all views so urls.py imports keep working:
#   from .views import UserRegistrationView, SecureLoginView, ...

from .auth import (
    UserRegistrationView,
    UserProfileView,
    PasswordChangeView,
    user_stats,
    UserPreferencesView,
    SecureLoginView,
    LDAPLoginView,
    MFALoginView,
    SessionTimeoutView,
)
from .management import (
    UserManagementViewSet,
)
from .groups import (
    GroupViewSet,
    PermissionViewSet,
)
from .security import (
    PasswordResetRequestView,
    PasswordResetConfirmView,
    auth_health,
    quota_usage,
    send_verification_email,
    verify_email,
    mfa_setup,
    mfa_verify,
    mfa_disable,
    mfa_status,
    mfa_regenerate_backup_codes,
)

# Backward compat: permissions.py re-export was in old views.py
from ..permissions import IsAdminOrSuperuser  # noqa: F401

__all__ = [
    'UserRegistrationView',
    'UserProfileView',
    'PasswordChangeView',
    'user_stats',
    'UserPreferencesView',
    'SecureLoginView',
    'LDAPLoginView',
    'MFALoginView',
    'SessionTimeoutView',
    'UserManagementViewSet',
    'GroupViewSet',
    'PermissionViewSet',
    'PasswordResetRequestView',
    'PasswordResetConfirmView',
    'auth_health',
    'quota_usage',
    'send_verification_email',
    'verify_email',
    'mfa_setup',
    'mfa_verify',
    'mfa_disable',
    'mfa_status',
    'mfa_regenerate_backup_codes',
    'IsAdminOrSuperuser',
]
