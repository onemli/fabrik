# dashboard/views.py
#
# Intentionally thin — all the logic lives in services.py.
# This view just enforces authentication and hands back whatever the service returns.
# If you ever need caching, a @cache_page(60) decorator here would be enough.

import os

from django.conf import settings
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response

from dashboard.services import get_dashboard_stats


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def dashboard_stats(request):
    stats = get_dashboard_stats(user=request.user)
    return Response(stats)


@api_view(['GET'])
@permission_classes([AllowAny])
def platform_info(request):
    """Public endpoint — returns demo mode flag and version so the frontend
    can adapt its UI before the user even logs in."""
    return Response(
        {
            'demo_mode': getattr(settings, 'DEMO_MODE', False),
            'version': os.getenv('FABRIK_VERSION', '1.0.1'),
            'ldap_enabled': getattr(settings, 'LDAP_ENABLED', False),
            'registration_enabled': getattr(settings, 'FABRIK_ALLOW_PUBLIC_REGISTRATION', False),
        }
    )
