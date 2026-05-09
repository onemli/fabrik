# Centralized rate limiting for authentication and security-sensitive endpoints.
#
# All rates are configured via Django settings (RATE_LIMITS dict) so enterprise
# deployments can tune them in .env or settings without touching code.
#
# Throttle scopes:
#   login          — POST /login/, /ldap-login/
#   mfa            — POST /mfa-login/
#   registration   — POST /register/
#   password_reset — POST /password-reset/, /password-reset/confirm/
#   token_refresh  — POST /token/refresh/
#   email_verify   — POST /email/verify/, /email/send-verification/
#   webhook        — POST /awx/webhooks/receiver/
#   sensitive_action — password change, MFA enable/disable (authenticated)

from rest_framework.throttling import AnonRateThrottle, UserRateThrottle
from django.conf import settings


def _get_rate(scope: str, default: str) -> str:
    rates = getattr(settings, 'RATE_LIMITS', {})
    return rates.get(scope, default)


# ─── Anonymous (unauthenticated) throttles ───────────────────────


class LoginRateThrottle(AnonRateThrottle):
    """Throttle login attempts per IP. Prevents credential stuffing."""

    scope = 'login'

    def get_rate(self) -> str:
        return _get_rate('login', '10/minute')


class MFARateThrottle(AnonRateThrottle):
    """Throttle MFA verification attempts per IP. Prevents TOTP brute-force."""

    scope = 'mfa'

    def get_rate(self) -> str:
        return _get_rate('mfa', '10/minute')


class RegistrationRateThrottle(AnonRateThrottle):
    """Throttle registration per IP. Prevents mass account creation."""

    scope = 'registration'

    def get_rate(self) -> str:
        return _get_rate('registration', '5/hour')


class PasswordResetRateThrottle(AnonRateThrottle):
    """Throttle password reset requests per IP. Prevents email bombing."""

    scope = 'password_reset'

    def get_rate(self) -> str:
        return _get_rate('password_reset', '5/hour')


class TokenRefreshRateThrottle(AnonRateThrottle):
    """Throttle token refresh per IP. Prevents token refresh abuse."""

    scope = 'token_refresh'

    def get_rate(self) -> str:
        return _get_rate('token_refresh', '30/minute')


class EmailVerifyRateThrottle(AnonRateThrottle):
    """Throttle email verification per IP."""

    scope = 'email_verify'

    def get_rate(self) -> str:
        return _get_rate('email_verify', '10/hour')


class WebhookRateThrottle(AnonRateThrottle):
    """Throttle incoming webhooks per IP. Defense-in-depth alongside HMAC."""

    scope = 'webhook'

    def get_rate(self) -> str:
        return _get_rate('webhook', '120/minute')


# ─── Authenticated user throttles ────────────────────────────────


class SensitiveActionThrottle(UserRateThrottle):
    """Throttle sensitive actions (password change, MFA toggle) per user."""

    scope = 'sensitive_action'

    def get_rate(self) -> str:
        return _get_rate('sensitive_action', '10/hour')


class EmailSendThrottle(UserRateThrottle):
    """Throttle outbound email sending per user. Prevents email spam."""

    scope = 'email_send'

    def get_rate(self) -> str:
        return _get_rate('email_send', '5/hour')
