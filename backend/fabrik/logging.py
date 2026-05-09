"""Helpers for inserting untrusted values into log messages.

The single function exported from here, :func:`safe`, escapes carriage
returns and line feeds in a value before it lands in a ``logger.X(...)``
call. Without that escape, a user-controlled string can include a literal
``\r\n`` and forge a fake log line — useful to hide actions in audit
trails or confuse triage tooling.

Use it whenever you log a value that originated outside the process:
request bodies, query parameters, header values, anything pulled out of
``request.user`` that the user could have set, etc.

::

    logger.info('Login attempt: %s', safe(username))
"""

from __future__ import annotations

from typing import Any


def safe(value: Any) -> Any:
    """Return *value* with CR/LF replaced by their escaped form.

    Non-string values pass through unchanged, so this is safe to wrap
    around mixed log arguments without worrying about types.
    """
    if not isinstance(value, str):
        return value
    return value.replace('\r', '\\r').replace('\n', '\\n')
