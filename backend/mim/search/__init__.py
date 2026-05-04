"""MIM search helpers — Lucene query construction and ACI alias expansion.

The module is split out of ``mim.services`` so each concern stays small and
testable. Public API:

    from mim.search import build_search_query, resolve_aliases
"""

from .aliases import resolve_aliases
from .lucene import build_search_query, escape_lucene

__all__ = ['build_search_query', 'escape_lucene', 'resolve_aliases']
