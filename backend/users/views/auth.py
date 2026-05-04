# Auth views: registration, profile, login (with brute-force protection), session timeout.

from typing import Optional
from rest_framework import status, generics
from rest_framework.views import APIView
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenObtainPairView
from django.utils import timezone
from datetime import timedelta

from ..serializers import (
    UserRegistrationSerializer,
    UserSerializer,
    PasswordChangeSerializer,
    UserProfileSerializer,
    MFALoginSerializer,
)
from ..models import UserProfile
from ..throttles import (
    LoginRateThrottle,
    MFARateThrottle,
    RegistrationRateThrottle,
    SensitiveActionThrottle,
)
from audit.services import AuditService

import logging
logger = logging.getLogger(__name__)


class UserRegistrationView(generics.CreateAPIView):
    from django.contrib.auth.models import User
    queryset = User.objects.all()
    permission_classes = [AllowAny]
    throttle_classes = [RegistrationRateThrottle]
    serializer_class = UserRegistrationSerializer


class UserProfileView(generics.RetrieveUpdateAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = UserSerializer

    def get_object(self) -> 'User':
        return self.request.user


class PasswordChangeView(generics.UpdateAPIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [SensitiveActionThrottle]
    serializer_class = PasswordChangeSerializer

    def get_object(self) -> 'User':
        return self.request.user

    def update(self, request, *args, **kwargs) -> Response:
        if getattr(request.user, 'profile', None) and request.user.profile.auth_source == 'ldap':
            return Response(
                {'detail': 'Password is managed by your LDAP directory. Contact your system administrator.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({'message': 'Password updated successfully'}, status=status.HTTP_200_OK)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def user_stats(request) -> Response:
    user = request.user
    return Response({
        'username': user.username,
        'email': user.email,
        'date_joined': user.date_joined,
        'query_count': user.created_queries.count(),
        'favorite_count': user.favorite_queries.count(),
        'shared_query_count': user.shared_queries.count(),
    })


class UserPreferencesView(generics.RetrieveUpdateAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = UserProfileSerializer

    def get_object(self):
        profile, _created = UserProfile.objects.get_or_create(user=self.request.user)
        return profile


MAX_FAILED_ATTEMPTS = 5
LOCKOUT_DURATION_MINUTES = 15


class SecureLoginView(TokenObtainPairView):
    """Login with brute-force protection and MFA support.
    Uses ONLY ModelBackend — LDAP users should use /ldap-login/ instead.
    If MFA is enabled, returns 202 with mfa_required=true (no tokens).
    Frontend then calls /mfa-login/ with username + password + totp_code.
    """
    throttle_classes = [LoginRateThrottle]

    def post(self, request, *args, **kwargs):
        username = request.data.get('username', '')

        # Check lockout
        try:
            from django.contrib.auth.models import User as DjangoUser
            user_obj = DjangoUser.objects.select_related('profile').get(username=username)
            profile = user_obj.profile

            if profile.locked_until and profile.locked_until > timezone.now():
                remaining = int((profile.locked_until - timezone.now()).total_seconds() / 60) + 1
                return Response(
                    {'detail': f'Account is temporarily locked. Try again in {remaining} minute(s).'},
                    status=status.HTTP_429_TOO_MANY_REQUESTS
                )
        except Exception:
            logger.warning("Failed to check lockout status for user '%s'", username, exc_info=True)

        response = super().post(request, *args, **kwargs)

        if response.status_code == 200:
            self._handle_successful_login(username)
            mfa_response = self._check_mfa_required(username)
            if mfa_response:
                # Never leak tokens when MFA is pending
                response.data.pop('access', None)
                response.data.pop('refresh', None)
                return mfa_response
        else:
            self._handle_failed_login(username)

        return response

    def _check_mfa_required(self, username: str) -> Optional[Response]:
        try:
            from django.contrib.auth.models import User as DjangoUser
            user_obj = DjangoUser.objects.select_related('profile').get(username=username)
            if user_obj.profile.totp_enabled:
                return Response({
                    'mfa_required': True,
                    'message': 'MFA verification required.',
                }, status=status.HTTP_202_ACCEPTED)
        except Exception:
            logger.warning("Failed to check MFA status for user '%s'", username, exc_info=True)
        return None

    def _handle_successful_login(self, username: str) -> None:
        try:
            from django.contrib.auth.models import User as DjangoUser
            user_obj = DjangoUser.objects.select_related('profile').get(username=username)
            profile = user_obj.profile
            profile.failed_login_attempts = 0
            profile.locked_until = None
            profile.save(update_fields=['failed_login_attempts', 'locked_until'])
        except Exception:
            logger.exception("Failed to reset login counters for user '%s'", username)

    def _handle_failed_login(self, username: str) -> None:
        try:
            from django.contrib.auth.models import User as DjangoUser
            user_obj = DjangoUser.objects.select_related('profile').get(username=username)
            profile = user_obj.profile
            profile.failed_login_attempts += 1

            if profile.failed_login_attempts >= MAX_FAILED_ATTEMPTS:
                profile.locked_until = timezone.now() + timedelta(minutes=LOCKOUT_DURATION_MINUTES)
                profile.failed_login_attempts = 0

            profile.save(update_fields=['failed_login_attempts', 'locked_until'])
        except Exception:
            logger.exception("Failed to record failed login for user '%s'", username)


class MFALoginView(APIView):
    """Second step of MFA login — validates TOTP or backup code, returns JWT."""
    permission_classes = [AllowAny]
    throttle_classes = [MFARateThrottle]

    def post(self, request):
        serializer = MFALoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        username = serializer.validated_data['username']
        password = serializer.validated_data['password']
        totp_code = serializer.validated_data.get('totp_code', '')
        backup_code = serializer.validated_data.get('backup_code', '')

        from django.contrib.auth import authenticate
        user = authenticate(request, username=username, password=password)
        if user is None:
            return Response({'error': 'Invalid credentials.'}, status=400)

        profile = user.profile
        if not profile.totp_enabled:
            return Response({'error': 'MFA is not enabled for this account.'}, status=400)

        verified = False
        method = 'totp'

        if totp_code:
            verified = profile.verify_totp(totp_code)
        elif backup_code:
            verified = profile.use_backup_code(backup_code)
            method = 'backup_code'

        if not verified:
            return Response({'error': 'Invalid verification code.'}, status=400)

        from rest_framework_simplejwt.tokens import RefreshToken
        refresh = RefreshToken.for_user(user)

        AuditService.log(
            user=user,
            action='mfa_login',
            category='user_management',
            resource_type='User',
            resource_id=user.id,
            resource_name=user.username,
            description=f'MFA login via {method} for "{user.username}"',
            request=request,
        )

        return Response({
            'access': str(refresh.access_token),
            'refresh': str(refresh),
        })


LDAP_LOGIN_TIMEOUT_SECONDS = 5


class LDAPLoginView(APIView):
    """Dedicated LDAP login endpoint. Authenticates against the LDAP server
    explicitly, so a slow/down LDAP server never affects the normal /login/
    endpoint. Returns JWT tokens on success, supports MFA."""
    permission_classes = [AllowAny]
    throttle_classes = [LoginRateThrottle]

    def post(self, request):
        from django.conf import settings
        if not getattr(settings, 'LDAP_ENABLED', False):
            return Response(
                {'detail': 'LDAP authentication is not enabled.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        username = request.data.get('username', '')
        password = request.data.get('password', '')

        if not username or not password:
            return Response(
                {'detail': 'Username and password are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Authenticate via LDAPBackend explicitly
        try:
            from django_auth_ldap.backend import LDAPBackend
            backend = LDAPBackend()
            user = backend.authenticate(request, username=username, password=password)
        except Exception:
            logger.exception("LDAP authentication error for user '%s'", username)
            return Response(
                {'detail': 'LDAP server is unreachable. Try local login instead.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        if user is None:
            return Response(
                {'detail': 'Invalid LDAP credentials.'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        # Tag user as LDAP-sourced so password reset/change is blocked
        try:
            from ..models import UserProfile
            profile = user.profile
            if profile.auth_source != UserProfile.AUTH_SOURCE_LDAP:
                profile.auth_source = UserProfile.AUTH_SOURCE_LDAP
                profile.save(update_fields=['auth_source'])
        except Exception:
            pass

        # Check MFA
        try:
            if user.profile.totp_enabled:
                return Response({
                    'mfa_required': True,
                    'message': 'MFA verification required.',
                }, status=status.HTTP_202_ACCEPTED)
        except Exception:
            pass

        # Issue JWT tokens
        from rest_framework_simplejwt.tokens import RefreshToken
        refresh = RefreshToken.for_user(user)

        AuditService.log(
            user=user,
            action='ldap_login',
            category='user_management',
            resource_type='User',
            resource_id=user.id,
            resource_name=user.username,
            description=f'LDAP login for "{user.username}"',
            request=request,
        )

        return Response({
            'access': str(refresh.access_token),
            'refresh': str(refresh),
        })


class SessionTimeoutView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        timeout = getattr(request.user.profile, 'session_timeout_minutes', 480)
        return Response({'session_timeout_minutes': timeout})

    def patch(self, request):
        value = request.data.get('session_timeout_minutes')
        if value is None:
            return Response({'detail': 'session_timeout_minutes required'}, status=400)
        try:
            value = int(value)
            if value < 0:
                raise ValueError
        except (ValueError, TypeError):
            return Response({'detail': 'Must be a non-negative integer'}, status=400)

        profile = request.user.profile
        profile.session_timeout_minutes = value
        profile.save(update_fields=['session_timeout_minutes'])
        return Response({'session_timeout_minutes': value})
