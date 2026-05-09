"""Domain exception hierarchy.

Views raise these instead of catching a generic Exception and stuffing
``str(e)`` into the response body. The central handler in
``fabrik.exception_handler`` maps each subclass to an appropriate HTTP
status, logs the underlying detail, and returns an opaque message so
nothing internal leaks to the client.

For anything DRF already knows how to render (``Http404``,
``PermissionDenied``, ``rest_framework.exceptions.ValidationError`` and
friends) — keep raising those. The handler defers to DRF for those and
only takes over once DRF returns ``None``.
"""

from typing import Optional


class FabrikError(Exception):
    """Base for every domain-specific error the platform raises.

    ``detail`` is the rich internal message that ends up in the log.
    ``user_message`` is what the API client actually sees. Subclasses
    override the class-level defaults; instances can override per-call.
    """

    status_code: int = 500
    user_message: str = 'Internal error'

    def __init__(self, detail: str = '', user_message: Optional[str] = None):
        super().__init__(detail)
        self.detail = detail
        if user_message is not None:
            self.user_message = user_message


class APICError(FabrikError):
    """APIC REST call failed (auth, network, 5xx). 502 to the client."""

    status_code = 502
    user_message = 'APIC request failed'


class AWXError(FabrikError):
    """AWX/Tower API call failed. 502 to the client."""

    status_code = 502
    user_message = 'AWX request failed'


class ResourceNotFoundError(FabrikError):
    """A domain resource was looked up by id and didn't exist."""

    status_code = 404
    user_message = 'Resource not found'
