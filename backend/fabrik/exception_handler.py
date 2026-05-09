"""Central DRF exception handler.

Two responsibilities:

1. Anything DRF already knows how to render (``Http404``,
   ``PermissionDenied``, ``rest_framework.exceptions.ValidationError``,
   etc.) goes through DRF's default handler so existing 4xx contracts
   don't change.
2. Everything else — ``FabrikError`` subclasses and bare ``Exception``s
   — is logged with a trace_id and replaced with an opaque response so
   internal details never reach the client.

The trace_id is returned to the caller so support can correlate a
client report against the server log entry.
"""

import logging
import uuid

from django.conf import settings
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

from .exceptions import FabrikError

logger = logging.getLogger('fabrik')


def fabrik_exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    if response is not None:
        return response

    request = context.get('request') if context else None
    request_path = getattr(request, 'path', '?')
    trace_id = uuid.uuid4().hex

    if isinstance(exc, FabrikError):
        logger.exception(
            'Domain error %s on %s [trace_id=%s]: %s',
            type(exc).__name__,
            request_path,
            trace_id,
            exc.detail,
        )
        body = {'error': exc.user_message, 'trace_id': trace_id}
        if settings.DEBUG and exc.detail:
            body['detail'] = exc.detail
        return Response(body, status=exc.status_code)

    logger.exception(
        'Unhandled exception on %s [trace_id=%s]',
        request_path,
        trace_id,
    )
    body = {'error': 'Internal error', 'trace_id': trace_id}
    if settings.DEBUG:
        body['detail'] = f'{type(exc).__name__}: {exc}'
    return Response(body, status=500)
