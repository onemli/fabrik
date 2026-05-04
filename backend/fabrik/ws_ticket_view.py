# fabrik/ws_ticket_view.py
#
# Ticket endpoint for WebSocket auth. The flow:
#   1. Client has a Bearer JWT from a normal HTTP login.
#   2. Client calls POST /api/ws-ticket/ → gets back a UUID ticket (30s TTL).
#   3. Client opens WebSocket with ?ticket=<uuid> in the query string.
#   4. ws_auth_middleware validates the ticket, resolves the user, burns the ticket.
#
# Tickets are single-use and expire — much safer than passing a long-lived
# JWT in the URL where it ends up in server access logs.

import uuid
from django.core.cache import cache
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

WS_TICKET_TTL = 30  # seconds
WS_TICKET_PREFIX = 'ws_ticket:'


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def issue_ws_ticket(request):
    """
    Issue a single-use WebSocket authentication ticket.

    Returns a UUID ticket valid for 30 seconds.
    The ticket is stored in Redis and deleted after first use.
    """
    ticket = str(uuid.uuid4())
    cache_key = f'{WS_TICKET_PREFIX}{ticket}'
    cache.set(cache_key, request.user.id, timeout=WS_TICKET_TTL)

    return Response({'ticket': ticket, 'ttl': WS_TICKET_TTL})
