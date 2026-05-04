"""Lucene query construction for the Neo4j MIM full-text index.

The Neo4j index ``class_search`` covers four properties on every
``:Class`` node — ``className``, ``label``, ``classPkg``, ``qualifiedName``.
Lucene's default behaviour with raw user input has two failure modes for
ACI search:

  1. Special characters (``:``, ``/``, ``-``) crash the parser or change
     query meaning silently.
  2. Multi-word input is OR-ed across all fields, so ``bridge domain``
     ranks any class mentioning either word — drowning the real ``fvBD``
     match in noise.

This module fixes both. Each user token becomes a required clause
(``+``-prefixed), each clause searches every indexed field with a tuned
boost (className highest, description lowest), and ACI shorthand is
expanded via :mod:`mim.search.aliases` so ``vrf`` ranks ``fvCtx`` first.
"""

import re

from .aliases import MULTI_WORD_ALIASES, SINGLE_WORD_ALIASES


# Characters Lucene's QueryParser treats as syntax. Any one of them in a
# raw user term must be backslash-escaped or the parser raises or, worse,
# silently rewrites the query.
_LUCENE_SPECIAL = set(r'+-&|!(){}[]^"~*?:\/')

# Field weights — empirically tuned. className is the canonical handle so
# it dominates; description matches indicate concept overlap so they count
# but never outweigh a name hit.
_FIELD_BOOSTS: tuple[tuple[str, int], ...] = (
    ('className', 8),
    ('label', 4),
    ('qualifiedName', 4),
    ('classPkg', 3),
)

# Aliases resolve to a className the user almost certainly wants, so we
# boost them above any field-weighted match.
_ALIAS_BOOST = 12

# Fuzzy matching is helpful for typos but expensive — only enable for
# tokens long enough that a single edit doesn't dominate the term.
_FUZZY_MIN_LENGTH = 4

_TOKEN_PATTERN = re.compile(r'"([^"]*)"|(\S+)')


def escape_lucene(term: str) -> str:
    """Backslash-escape every Lucene-reserved character in ``term``.

    Whitespace is left alone so the caller can decide whether multi-word
    input is a phrase (already quoted) or a sequence of tokens.
    """
    return ''.join('\\' + ch if ch in _LUCENE_SPECIAL else ch for ch in term)


def build_search_query(raw_query: str) -> str:
    """Compile a user search string into a Lucene query for ACI MIM.

    Returns an empty string when the input is blank — callers should
    short-circuit and skip the index call rather than send Lucene an empty
    query (which raises).
    """
    if not raw_query or not raw_query.strip():
        return ''

    tokens = _tokenize(raw_query)
    if not tokens:
        return ''

    clauses = [_clause_for_token(kind, text) for kind, text in tokens]
    multi_alias_clause = _multi_word_alias_clause(raw_query)
    if multi_alias_clause:
        # Multi-word aliases (e.g. "bridge domain" → fvBD) are appended
        # as an unbound OR boost — already captured implicitly by the
        # per-token clauses but pinned harder so the canonical class
        # always wins on tie scores.
        return ' '.join(clauses) + ' ' + multi_alias_clause
    return ' '.join(clauses)


def _tokenize(raw_query: str) -> list[tuple[str, str]]:
    """Split ``raw_query`` into ``(kind, text)`` pairs.

    ``kind`` is ``'phrase'`` for double-quoted segments and ``'word'``
    for everything else. Empty fragments are dropped.
    """
    tokens: list[tuple[str, str]] = []
    for match in _TOKEN_PATTERN.finditer(raw_query):
        phrase, word = match.group(1), match.group(2)
        if phrase is not None and phrase.strip():
            tokens.append(('phrase', phrase.strip()))
        elif word is not None and word.strip():
            tokens.append(('word', word.strip()))
    return tokens


def _clause_for_token(kind: str, text: str) -> str:
    """Build a ``+(...)``-required clause for one user token."""
    if kind == 'phrase':
        return '+' + _phrase_clause(text)
    return '+' + _word_clause(text)


def _word_clause(token: str) -> str:
    """Build the OR-of-fields clause for a single bare word.

    Honors two power-user suffixes that survive escaping:

      * ``term*`` — prefix wildcard. Useful for browsing ``fv*`` etc.
      * ``term~`` — explicit fuzzy match (single edit distance).

    Bare tokens get an implicit fuzzy variant on the className field
    for typo tolerance, but only when the token is long enough that a
    single edit is not a significant fraction of the term.

    If the token is a known ACI shorthand (e.g. ``bd`` → ``fvBD``) the
    canonical className(s) are folded into the same OR group so the
    required-clause is satisfied even when the literal token would not
    match — Lucene's whole-token analyzer cannot otherwise reach
    ``fvBD`` from the substring ``bd``.
    """
    base, wildcard, fuzzy = _strip_intent_suffix(token)
    if not base:
        return '(*:*)'

    safe = escape_lucene(base)
    suffix = wildcard or fuzzy
    parts = [f'{field}:{safe}{suffix}^{boost}' for field, boost in _FIELD_BOOSTS]

    if not suffix and len(base) >= _FUZZY_MIN_LENGTH:
        parts.append(f'className:{safe}~1^2')
        parts.append(f'label:{safe}~1')

    for alias_class in SINGLE_WORD_ALIASES.get(base.lower(), ()):
        parts.append(f'className:{escape_lucene(alias_class)}^{_ALIAS_BOOST}')

    return '(' + ' OR '.join(parts) + ')'


def _strip_intent_suffix(token: str) -> tuple[str, str, str]:
    """Split a token into ``(base, wildcard_suffix, fuzzy_suffix)``.

    Only one of the suffixes is non-empty. Suffixes are returned in the
    Lucene form expected by :func:`_word_clause` so the caller can splice
    them in without further processing.
    """
    if token.endswith('*') and len(token) > 1:
        return token[:-1], '*', ''
    if token.endswith('~') and len(token) > 1:
        return token[:-1], '', '~1'
    return token, '', ''


def _phrase_clause(phrase: str) -> str:
    """Build the OR-of-fields clause for a quoted phrase.

    Phrases only meaningfully match the ``label`` field — ``className``,
    ``classPkg`` and ``qualifiedName`` never contain spaces, so phrase
    search against them is wasted work.
    """
    safe = phrase.replace('\\', '\\\\').replace('"', '\\"')
    return f'(label:"{safe}"^4)'


def _multi_word_alias_clause(raw_query: str) -> str:
    """Optional OR boost for multi-word aliases like ``"bridge domain"``.

    Single-word aliases are already folded into their token's clause
    by :func:`_word_clause`; this helper only fires for phrase-level
    matches that span multiple tokens.
    """
    lower = raw_query.lower()
    target_classes: list[str] = []
    seen: set[str] = set()
    for phrase, classes in MULTI_WORD_ALIASES:
        if phrase in lower:
            for cls in classes:
                if cls not in seen:
                    seen.add(cls)
                    target_classes.append(cls)
    if not target_classes:
        return ''
    parts = [f'className:{escape_lucene(c)}^{_ALIAS_BOOST}' for c in target_classes]
    return '(' + ' OR '.join(parts) + ')'
