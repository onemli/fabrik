# fabrik/ws_auth_middleware.py
#
# WebSocket auth middleware. Browsers can't send Authorization headers on WS
# upgrades, so we use single-use tickets:
#
#   ?ticket=<uuid>  — single-use, 30-second TTL, stored in Redis.
#   Issued by ws_ticket_view. Tokens never appear in server logs or browser history.
from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.contrib.auth.models import AnonymousUser
from django.core.cache import cache
from rest_framework_simplejwt.tokens import AccessToken
from rest_framework_simplejwt.exceptions import TokenError
from urllib.parse import parse_qs

WS_TICKET_PREFIX = 'ws_ticket:'


@database_sync_to_async
def get_user_from_ticket(ticket):
    """Single-use ticket → user. Deletes ticket after first use."""
    cache_key = f'{WS_TICKET_PREFIX}{ticket}'
    user_id = cache.get(cache_key)
    if not user_id:
        return AnonymousUser()

    # Delete immediately — single use
    cache.delete(cache_key)

    try:
        from django.contrib.auth import get_user_model
        User = get_user_model()
        return User.objects.get(id=user_id)
    except Exception:
        return AnonymousUser()


@database_sync_to_async
def get_user_from_token(token_string):
    """JWT token → user (legacy fallback)."""
    try:
        access_token = AccessToken(token_string)
        user_id = access_token['user_id']
        from django.contrib.auth import get_user_model
        User = get_user_model()
        return User.objects.get(id=user_id)
    except (TokenError, KeyError, Exception):
        return AnonymousUser()


class JWTAuthMiddleware(BaseMiddleware):
    """
    WebSocket auth middleware.

    Priority:
      1. ?ticket=<uuid>  (single-use, Redis-backed, preferred)
      2. ?token=<jwt>    (legacy, logs-unsafe)
      3. Session auth    (fallback)
    """

    async def __call__(self, scope, receive, send):
        query_string = scope.get('query_string', b'').decode()
        query_params = parse_qs(query_string)

        ticket = query_params.get('ticket', [None])[0]

        if ticket:
            scope['user'] = await get_user_from_ticket(ticket)
        else:
            # No ticket provided — reject the connection. The legacy ?token=<jwt>
            # path has been removed because raw JWTs in URLs leak into access logs.
            scope['user'] = AnonymousUser()

        # Hard reject if authentication failed — no anonymous WebSocket access
        user = scope.get('user')
        if not user or isinstance(user, AnonymousUser):
            await send({'type': 'websocket.close', 'code': 4001})
            return

        return await super().__call__(scope, receive, send)
