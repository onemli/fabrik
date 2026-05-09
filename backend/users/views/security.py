# Password reset (email + admin code), MFA/TOTP, email verification, health checks.

from rest_framework import status
from rest_framework.views import APIView
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from django.contrib.auth.models import User
from django.contrib.auth.tokens import default_token_generator
from django.utils.http import urlsafe_base64_encode, urlsafe_base64_decode
from django.utils.encoding import force_bytes, force_str
from django.utils import timezone
from django.conf import settings as django_settings
from datetime import timedelta

from ..serializers import (
    PasswordResetRequestSerializer,
    PasswordResetConfirmSerializer,
    TOTPVerifySerializer,
    TOTPDisableSerializer,
)
from ..models import UserProfile, PasswordResetCode
from ..throttles import (
    PasswordResetRateThrottle,
    EmailVerifyRateThrottle,
    SensitiveActionThrottle,
    EmailSendThrottle,
)
from ..email_service import EmailService
from ..quota_service import QuotaService
from audit.services import AuditService


def _resolve_site_url(request):
    # Env var wins so operators can point links at the public frontend even when
    # the API runs on a different host. Fall back to the request's host so a
    # missing SITE_URL doesn't bake "localhost" into emails sent from prod.
    site_url = getattr(django_settings, 'SITE_URL', None)
    if site_url:
        return site_url.rstrip('/')
    return f'{request.scheme}://{request.get_host()}'


# --- Password Reset ---


class PasswordResetRequestView(APIView):
    """Request password reset via email. Falls back to admin code if no email."""

    permission_classes = [AllowAny]
    throttle_classes = [PasswordResetRateThrottle]

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        username = serializer.validated_data['username']

        generic_response = Response(
            {
                'message': 'If this account exists, instructions have been sent.',
                'fallback': False,
            }
        )

        try:
            user = User.objects.select_related('profile').get(username=username)
        except User.DoesNotExist:
            return generic_response

        # LDAP users cannot reset passwords through Django
        if hasattr(user, 'profile') and user.profile.auth_source == 'ldap':
            return generic_response

        if not user.email:
            # Don't reveal that the user exists but has no email
            return generic_response

        token = default_token_generator.make_token(user)
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        combined_token = f'{uid}:{token}'
        site_url = _resolve_site_url(request)

        EmailService.send_password_reset_email(user, combined_token, site_url)

        return generic_response


class PasswordResetConfirmView(APIView):
    """Confirm password reset via email token OR admin-generated code."""

    permission_classes = [AllowAny]
    throttle_classes = [PasswordResetRateThrottle]

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        new_password = serializer.validated_data['new_password']
        method = serializer.validated_data.get('method', 'token')

        if method == 'token':
            user = self._verify_token(serializer)
        elif method == 'code':
            user = self._verify_code(serializer)
        else:
            return Response(
                {'error': 'Invalid method. Use "token" or "code".'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if isinstance(user, Response):
            return user  # error response

        user.set_password(new_password)
        user.save()

        if hasattr(user, 'profile'):
            user.profile.failed_login_attempts = 0
            user.profile.locked_until = None
            user.profile.save(update_fields=['failed_login_attempts', 'locked_until'])

        AuditService.log(
            user=user,
            action='password_reset_completed',
            category='user_management',
            resource_type='User',
            resource_id=user.id,
            resource_name=user.username,
            description=f'Password reset completed via {method} for "{user.username}"',
            request=request,
        )
        return Response({'message': 'Password has been reset successfully.'})

    def _verify_token(self, serializer):
        token_str = serializer.validated_data.get('token', '')
        try:
            uid_str, token = token_str.split(':', 1)
            uid = force_str(urlsafe_base64_decode(uid_str))
            user = User.objects.get(pk=uid)
        except (ValueError, User.DoesNotExist):
            return Response(
                {'error': 'Invalid or expired reset link.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not default_token_generator.check_token(user, token):
            return Response(
                {'error': 'Invalid or expired reset link.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return user

    def _verify_code(self, serializer):
        username = serializer.validated_data.get('username', '')
        code = serializer.validated_data.get('code', '')
        generic_error = Response(
            {'error': 'Invalid or expired reset code.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

        try:
            user = User.objects.get(username=username)
        except User.DoesNotExist:
            return generic_error

        reset_code = (
            PasswordResetCode.objects.filter(user=user, used=False).order_by('-created_at').first()
        )

        if not reset_code or not reset_code.verify_code(code):
            return generic_error

        reset_code.consume()
        return user


# --- MFA / TOTP ---


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@throttle_classes([SensitiveActionThrottle])
def mfa_setup(request):
    """Start MFA setup — generates a TOTP secret and returns QR code."""
    import qrcode
    import qrcode.image.svg
    import io
    import base64

    profile = request.user.profile
    if profile.totp_enabled:
        return Response({'error': 'MFA is already enabled. Disable it first.'}, status=400)

    secret = profile.setup_totp()
    uri = profile.get_totp_uri()

    qr = qrcode.QRCode(version=1, box_size=6, border=2)
    qr.add_data(uri)
    qr.make(fit=True)
    img = qr.make_image(fill_color='white', back_color='#0a0a0a')
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    qr_b64 = base64.b64encode(buf.getvalue()).decode()

    return Response(
        {
            'secret': secret,
            'otpauth_uri': uri,
            'qr_code': f'data:image/png;base64,{qr_b64}',
        }
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@throttle_classes([SensitiveActionThrottle])
def mfa_verify(request):
    """Verify TOTP code to complete MFA setup. Returns backup codes."""
    serializer = TOTPVerifySerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    profile = request.user.profile
    if not profile.totp_secret:
        return Response({'error': 'Run MFA setup first.'}, status=400)

    if not profile.verify_totp(serializer.validated_data['code']):
        return Response({'error': 'Invalid code. Try again.'}, status=400)

    profile.enable_totp()
    backup_codes = profile.generate_backup_codes()

    AuditService.log(
        user=request.user,
        action='mfa_enabled',
        category='user_management',
        resource_type='User',
        resource_id=request.user.id,
        resource_name=request.user.username,
        description=f'MFA enabled for "{request.user.username}"',
        request=request,
    )

    return Response(
        {
            'message': 'MFA enabled successfully.',
            'backup_codes': backup_codes,
        }
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@throttle_classes([SensitiveActionThrottle])
def mfa_disable(request):
    """Disable MFA. Requires current password."""
    serializer = TOTPDisableSerializer(data=request.data, context={'request': request})
    serializer.is_valid(raise_exception=True)

    profile = request.user.profile
    if not profile.totp_enabled:
        return Response({'error': 'MFA is not enabled.'}, status=400)

    profile.disable_totp()

    AuditService.log(
        user=request.user,
        action='mfa_disabled',
        category='user_management',
        resource_type='User',
        resource_id=request.user.id,
        resource_name=request.user.username,
        description=f'MFA disabled for "{request.user.username}"',
        request=request,
    )

    return Response({'message': 'MFA has been disabled.'})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def mfa_status(request):
    profile = request.user.profile
    return Response(
        {
            'mfa_enabled': profile.totp_enabled,
            'backup_codes_remaining': len(profile.backup_codes) if profile.totp_enabled else 0,
        }
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@throttle_classes([SensitiveActionThrottle])
def mfa_regenerate_backup_codes(request):
    password = request.data.get('password', '')
    if not request.user.check_password(password):
        return Response({'error': 'Incorrect password.'}, status=400)

    profile = request.user.profile
    if not profile.totp_enabled:
        return Response({'error': 'MFA is not enabled.'}, status=400)

    backup_codes = profile.generate_backup_codes()
    return Response({'backup_codes': backup_codes})


# --- Email Verification ---


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@throttle_classes([EmailSendThrottle])
def send_verification_email(request):
    user = request.user
    if not user.email:
        return Response({'error': 'No email address on file.'}, status=400)

    if hasattr(user, 'profile') and user.profile.email_verified:
        return Response({'message': 'Email is already verified.'})

    token = default_token_generator.make_token(user)
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    combined_token = f'{uid}:{token}'
    site_url = _resolve_site_url(request)

    result = EmailService.send_verification_email(user, combined_token, site_url)

    if result['sent']:
        return Response({'message': 'Verification email sent.'})
    return Response(
        {
            'message': 'Email service is unavailable. Try again later.',
            'fallback': True,
        }
    )


@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([EmailVerifyRateThrottle])
def verify_email(request):
    token_str = request.data.get('token', '')
    try:
        uid_str, token = token_str.split(':', 1)
        uid = force_str(urlsafe_base64_decode(uid_str))
        user = User.objects.get(pk=uid)
    except (ValueError, User.DoesNotExist):
        return Response({'error': 'Invalid or expired link.'}, status=400)

    if not default_token_generator.check_token(user, token):
        return Response({'error': 'Invalid or expired link.'}, status=400)

    if hasattr(user, 'profile'):
        user.profile.email_verified = True
        user.profile.email_verified_at = timezone.now()
        user.profile.save(update_fields=['email_verified', 'email_verified_at'])

    return Response({'message': 'Email verified successfully.'})


# --- Health & Quota ---


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def auth_health(request):
    """Auth health check. Admins see full details, others only email status."""
    is_admin = request.user.is_superuser or request.user.groups.filter(name='Admin').exists()

    if is_admin:
        health = {
            'email': EmailService.get_health_status(),
            'email_enabled': EmailService.is_email_enabled(),
        }

        if getattr(django_settings, 'LDAP_ENABLED', False):
            health['ldap'] = {'status': 'enabled'}
        else:
            health['ldap'] = {'status': 'disabled'}

        health['locked_accounts'] = UserProfile.objects.filter(
            locked_until__gt=timezone.now()
        ).count()
        health['active_users_24h'] = User.objects.filter(
            last_login__gte=timezone.now() - timedelta(hours=24)
        ).count()

        return Response(health)

    return Response(
        {
            'email_available': EmailService.is_email_available(),
            'email_enabled': EmailService.is_email_enabled(),
        }
    )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def quota_usage(request):
    quota = QuotaService.get_effective_quota(request.user)
    usage = QuotaService.get_usage(request.user)
    return Response(
        {
            'quota': quota,
            'usage': usage,
        }
    )
