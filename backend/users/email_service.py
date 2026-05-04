# users/email_service.py
#
# Centralized email service with health checking and graceful degradation.
# Every email send in the app goes through this service so that failures
# never crash the caller — they just get a "not sent" result and can
# fall back to a non-email path (e.g. admin-generated reset code).

import logging
from django.conf import settings
from django.core.mail import send_mail, get_connection
from django.template.loader import render_to_string
from django.utils import timezone
from django.core.cache import cache

logger = logging.getLogger(__name__)

EMAIL_HEALTH_CACHE_KEY = 'email_service_health'
EMAIL_HEALTH_CACHE_TTL = 60  # seconds


class EmailService:

    @staticmethod
    def is_email_enabled() -> bool:
        """Check if email is configured at all (not just healthy)."""
        return getattr(settings, 'EMAIL_ENABLED', True)

    @staticmethod
    def is_email_available() -> bool:
        """Quick health check — try SMTP handshake with 3s timeout.
        Result cached for 60s to avoid hammering a dead server."""
        if not EmailService.is_email_enabled():
            return False

        cached = cache.get(EMAIL_HEALTH_CACHE_KEY)
        if cached is not None:
            return cached

        # Console backend is always "available" (dev mode)
        backend = getattr(settings, 'EMAIL_BACKEND', '')
        if 'console' in backend or 'locmem' in backend or 'dummy' in backend:
            cache.set(EMAIL_HEALTH_CACHE_KEY, True, EMAIL_HEALTH_CACHE_TTL)
            return True

        try:
            connection = get_connection(fail_silently=False)
            connection.timeout = 3
            connection.open()
            connection.close()
            cache.set(EMAIL_HEALTH_CACHE_KEY, True, EMAIL_HEALTH_CACHE_TTL)
            return True
        except Exception as e:
            logger.warning('Email health check failed: %s', e)
            cache.set(EMAIL_HEALTH_CACHE_KEY, False, EMAIL_HEALTH_CACHE_TTL)
            return False

    @staticmethod
    def send_or_fallback(
        subject: str,
        template_name: str,
        context: dict,
        recipient_email: str,
        plain_message: str = '',
    ) -> dict:
        """Try to send email. On failure return status dict — never raises.

        Returns:
            {"sent": True} on success
            {"sent": False, "reason": "..."} on failure
        """
        if not EmailService.is_email_enabled():
            return {'sent': False, 'reason': 'email_disabled'}

        if not EmailService.is_email_available():
            return {'sent': False, 'reason': 'email_unavailable'}

        try:
            html_message = render_to_string(template_name, context)
            send_mail(
                subject=subject,
                message=plain_message or subject,
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[recipient_email],
                html_message=html_message,
                fail_silently=False,
            )
            return {'sent': True}
        except Exception as e:
            logger.error('Email send failed to %s: %s', recipient_email, e)
            # Invalidate health cache so next check re-probes
            cache.delete(EMAIL_HEALTH_CACHE_KEY)
            return {'sent': False, 'reason': str(e)}

    @staticmethod
    def send_password_reset_email(user, token: str, site_url: str) -> dict:
        """Send password reset link via email."""
        reset_url = f"{site_url}/reset-password?token={token}"
        context = {
            'user': user,
            'reset_url': reset_url,
            'expiry_minutes': 30,
            'site_url': site_url,
        }
        return EmailService.send_or_fallback(
            subject='FABRIK — Password Reset',
            template_name='users/password_reset_email.html',
            context=context,
            recipient_email=user.email,
        )

    @staticmethod
    def send_verification_email(user, token: str, site_url: str) -> dict:
        """Send email verification link."""
        verify_url = f"{site_url}/verify-email?token={token}"
        context = {
            'user': user,
            'verify_url': verify_url,
            'site_url': site_url,
        }
        return EmailService.send_or_fallback(
            subject='FABRIK — Verify Your Email',
            template_name='users/email_verification.html',
            context=context,
            recipient_email=user.email,
        )

    @staticmethod
    def get_health_status() -> dict:
        """Detailed health info for admin dashboard."""
        if not EmailService.is_email_enabled():
            return {
                'status': 'disabled',
                'last_checked': None,
                'backend': getattr(settings, 'EMAIL_BACKEND', 'unknown'),
            }

        available = EmailService.is_email_available()
        return {
            'status': 'healthy' if available else 'down',
            'last_checked': timezone.now().isoformat(),
            'backend': getattr(settings, 'EMAIL_BACKEND', 'unknown'),
            'host': getattr(settings, 'EMAIL_HOST', ''),
            'port': getattr(settings, 'EMAIL_PORT', ''),
        }
