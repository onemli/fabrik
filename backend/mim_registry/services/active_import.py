"""Tracks the currently-running MIM import across browser refreshes.

A single Redis key (via Django's cache framework) stores a lightweight
descriptor of the in-flight import. The ``install_view`` writes it, the
Celery task clears it in ``finally``, and the ``status_view`` exposes it
so the frontend can discover a running import on page load.

Self-heals against orphan keys: if Celery died without running its
``finally`` block, the next ``get_active()`` call sees a terminal state
on ``AsyncResult`` and clears the key itself. The TTL is a last-resort
backstop well above the task's hard time limit.
"""

from datetime import datetime, timezone
from typing import Optional

from celery.result import AsyncResult
from django.core.cache import cache


CACHE_KEY = 'mim_registry:active_import'
TTL_SECONDS = 7200  # 2h — exceeds task_time_limit=3600 with a safety margin

_TERMINAL_STATES = {'SUCCESS', 'FAILURE', 'REVOKED'}


def set_active(
    *,
    task_id: str,
    apic_version: str,
    source: str,
    started_by: Optional[str],
) -> None:
    cache.set(
        CACHE_KEY,
        {
            'task_id': task_id,
            'apic_version': apic_version,
            'source': source,
            'started_at': datetime.now(timezone.utc).isoformat(),
            'started_by': started_by or '',
        },
        timeout=TTL_SECONDS,
    )


def get_active() -> Optional[dict]:
    entry = cache.get(CACHE_KEY)
    if not entry:
        return None
    state = AsyncResult(entry['task_id']).state
    if state in _TERMINAL_STATES:
        cache.delete(CACHE_KEY)
        return None
    return entry


def clear_active() -> None:
    cache.delete(CACHE_KEY)
