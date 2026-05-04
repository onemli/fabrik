# audit/middleware.py
#
# Thread-local storage for the current request user. Django signals don't receive
# the HTTP request, so this middleware stores the authenticated user in a thread
# local so signal handlers (and AuditService) can attach the user to log entries
# without being passed the request explicitly.

import threading
from typing import Optional
from django.contrib.auth.models import User
from django.http import HttpRequest, HttpResponse

_thread_locals = threading.local()


def get_current_user() -> Optional[User]:
    """Get current user from thread local."""
    return getattr(_thread_locals, 'user', None)


def get_current_request() -> Optional[HttpRequest]:
    """Get current request from thread local."""
    return getattr(_thread_locals, 'request', None)


class AuditMiddleware:
    """
    Middleware to track current user and request in thread local.
    Enables signal handlers to access request context.
    """

    def __init__(self, get_response) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        _thread_locals.user = getattr(request, 'user', None)
        _thread_locals.request = request

        response = self.get_response(request)

        # Clean up
        _thread_locals.user = None
        _thread_locals.request = None

        return response
