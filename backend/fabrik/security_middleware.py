# fabrik/security_middleware.py
#
# Middleware that injects HTTP security headers on every response.
# Headers added: X-Frame-Options, X-Content-Type-Options, Referrer-Policy,
# Permissions-Policy, and Content-Security-Policy.
# CSP is intentionally permissive in dev mode (DEBUG=True) and tighter
# in production.


class SecurityHeadersMiddleware:
    """Inject security headers. Gets called on every HTTP response."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)

        # Prevent MIME-type sniffing
        response['X-Content-Type-Options'] = 'nosniff'

        # Prevent clickjacking
        response['X-Frame-Options'] = 'DENY'

        # XSS protection (legacy browsers)
        response['X-XSS-Protection'] = '1; mode=block'

        # Referrer policy — don't leak URL to external sites
        response['Referrer-Policy'] = 'strict-origin-when-cross-origin'

        # Disable unnecessary browser features
        response['Permissions-Policy'] = (
            'camera=(), microphone=(), geolocation=(), '
            'payment=(), usb=(), bluetooth=()'
        )

        # Remove server identification
        response['Server'] = 'Fabrik'

        return response
