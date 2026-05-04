# users/urls.py
#
# URL routes for auth, user management, password reset, and quota endpoints.
# JWT endpoints use SimpleJWT views. Management endpoints are ViewSet-based
# and restricted to admin users via the ViewSet's permission_classes.

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from .throttles import TokenRefreshRateThrottle


class ThrottledTokenRefreshView(TokenRefreshView):
    throttle_classes = [TokenRefreshRateThrottle]

from .views import (
    UserRegistrationView,
    UserProfileView,
    PasswordChangeView,
    UserPreferencesView,
    UserManagementViewSet,
    GroupViewSet,
    PermissionViewSet,
    user_stats,
    SecureLoginView,
    LDAPLoginView,
    SessionTimeoutView,
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
    MFALoginView,
)

# Router for admin-only ViewSets
router = DefaultRouter()
router.register(r'management', UserManagementViewSet, basename='user-management')
router.register(r'groups', GroupViewSet, basename='groups')
router.register(r'permissions', PermissionViewSet, basename='permissions')

urlpatterns = [
    # JWT Authentication
    path('login/', SecureLoginView.as_view(), name='token_obtain_pair'),
    path('ldap-login/', LDAPLoginView.as_view(), name='ldap_login'),
    path('token/refresh/', ThrottledTokenRefreshView.as_view(), name='token_refresh'),

    # Registration & Profile
    path('register/', UserRegistrationView.as_view(), name='register'),
    path('profile/', UserProfileView.as_view(), name='profile'),
    path('preferences/', UserPreferencesView.as_view(), name='preferences'),
    path('password/change/', PasswordChangeView.as_view(), name='password_change'),
    path('stats/', user_stats, name='user_stats'),
    path('session-timeout/', SessionTimeoutView.as_view(), name='session-timeout'),

    # Password reset (dual-channel: email token + admin code)
    path('password-reset/', PasswordResetRequestView.as_view(), name='password_reset_request'),
    path('password-reset/confirm/', PasswordResetConfirmView.as_view(), name='password_reset_confirm'),

    # Email verification (soft)
    path('email/send-verification/', send_verification_email, name='send_verification_email'),
    path('email/verify/', verify_email, name='verify_email'),

    # MFA / TOTP
    path('mfa/setup/', mfa_setup, name='mfa_setup'),
    path('mfa/verify/', mfa_verify, name='mfa_verify'),
    path('mfa/disable/', mfa_disable, name='mfa_disable'),
    path('mfa/status/', mfa_status, name='mfa_status'),
    path('mfa/backup-codes/', mfa_regenerate_backup_codes, name='mfa_backup_codes'),
    path('mfa-login/', MFALoginView.as_view(), name='mfa_login'),

    # Auth health & quota
    path('health/', auth_health, name='auth_health'),
    path('quota-usage/', quota_usage, name='quota_usage'),

    # Admin-only ViewSets
    path('', include(router.urls)),
]
