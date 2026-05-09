# fabrik/asgi.py
#
# ASGI entry point for Daphne. Routes HTTP to Django's standard WSGI-over-ASGI
# handler and WebSocket connections to Django Channels. AllowedHostsOriginValidator
# gates WebSocket connections to the configured ALLOWED_HOSTS.

import os

from channels.auth import AuthMiddlewareStack
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import AllowedHostsOriginValidator
from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'fabrik.settings')

# Initialize Django ASGI application early to ensure AppRegistry is populated
django_asgi_app = get_asgi_application()

# Import routing and custom middleware after Django setup
from fabrik.routing import websocket_urlpatterns
from fabrik.ws_auth_middleware import JWTAuthMiddleware

application = ProtocolTypeRouter(
    {
        'http': django_asgi_app,
        'websocket': AllowedHostsOriginValidator(
            JWTAuthMiddleware(AuthMiddlewareStack(URLRouter(websocket_urlpatterns)))
        ),
    }
)
