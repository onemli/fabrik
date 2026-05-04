"""Unit tests for the MIM search query builder and alias resolution.

These tests do not touch Neo4j — they verify the pure-Python building
blocks (escape, tokenize, alias resolution, Lucene query string) so we
can iterate on relevance heuristics without spinning up a graph.
"""

import pytest

from mim.search import build_search_query, escape_lucene, resolve_aliases
from mim.search.aliases import MULTI_WORD_ALIASES, SINGLE_WORD_ALIASES
from mim.search.lucene import _strip_intent_suffix, _tokenize


@pytest.mark.unit
class TestEscapeLucene:

    @pytest.mark.parametrize('term, expected', [
        ('plain', 'plain'),
        ('a:b', 'a\\:b'),
        ('foo/bar', 'foo\\/bar'),
        ('a+b-c', 'a\\+b\\-c'),
        ('(grouped)', '\\(grouped\\)'),
        ('quote"x', 'quote\\"x'),
        ('back\\slash', 'back\\\\slash'),
    ])
    def test_special_chars_are_escaped(self, term, expected):
        assert escape_lucene(term) == expected

    def test_whitespace_is_preserved(self):
        assert escape_lucene('two words') == 'two words'

    def test_empty_input(self):
        assert escape_lucene('') == ''


@pytest.mark.unit
class TestTokenize:

    def test_bare_words(self):
        assert _tokenize('foo bar') == [('word', 'foo'), ('word', 'bar')]

    def test_quoted_phrase(self):
        assert _tokenize('"bridge domain"') == [('phrase', 'bridge domain')]

    def test_phrase_and_word_mixed(self):
        result = _tokenize('"vlan pool" encap')
        assert result == [('phrase', 'vlan pool'), ('word', 'encap')]

    def test_empty_quotes_dropped(self):
        assert _tokenize('"" foo') == [('word', 'foo')]

    def test_extra_whitespace(self):
        assert _tokenize('   foo   bar  ') == [('word', 'foo'), ('word', 'bar')]


@pytest.mark.unit
class TestStripIntentSuffix:

    def test_wildcard_suffix(self):
        assert _strip_intent_suffix('fv*') == ('fv', '*', '')

    def test_fuzzy_suffix(self):
        assert _strip_intent_suffix('tenant~') == ('tenant', '', '~1')

    def test_no_suffix(self):
        assert _strip_intent_suffix('plain') == ('plain', '', '')

    def test_lone_suffix_kept_as_token(self):
        # A bare ``*`` or ``~`` is treated as the literal token, not an
        # intent — there's no base term to apply the operator to.
        assert _strip_intent_suffix('*') == ('*', '', '')
        assert _strip_intent_suffix('~') == ('~', '', '')


@pytest.mark.unit
class TestResolveAliases:

    def test_single_word_alias(self):
        assert resolve_aliases('vrf') == ['fvCtx']

    def test_multi_word_alias(self):
        assert resolve_aliases('bridge domain') == ['fvBD']

    def test_unknown_term_returns_empty(self):
        assert resolve_aliases('asdfqwerty') == []

    def test_blank_input(self):
        assert resolve_aliases('') == []
        assert resolve_aliases('   ') == []

    def test_longest_match_wins(self):
        # "bridge domain" must consume the span before the bare "bridge"
        # alias (if any) gets a chance — otherwise we'd double-count.
        result = resolve_aliases('bridge domain')
        assert result == ['fvBD']
        assert 'bridge' not in result

    def test_multiple_aliases_in_one_query(self):
        result = resolve_aliases('vrf and bd')
        assert 'fvCtx' in result
        assert 'fvBD' in result

    def test_dedupe(self):
        # Adding the same alias twice should not duplicate the className.
        result = resolve_aliases('vrf vrf')
        assert result == ['fvCtx']

    def test_case_insensitive(self):
        assert resolve_aliases('VRF') == ['fvCtx']
        assert resolve_aliases('Bridge Domain') == ['fvBD']


@pytest.mark.unit
class TestBuildSearchQuery:

    def test_blank_returns_empty(self):
        assert build_search_query('') == ''
        assert build_search_query('   ') == ''

    def test_single_word_marks_required(self):
        query = build_search_query('tenant')
        assert query.startswith('+(')

    def test_multi_word_each_required(self):
        query = build_search_query('bridge domain')
        # Two +-required clauses, one per token.
        assert query.count('+(') >= 2

    def test_phrase_is_required_and_quoted(self):
        query = build_search_query('"vlan pool"')
        assert '+(' in query
        assert '"vlan pool"' in query

    def test_alias_is_folded_into_token_clause(self):
        # Single-word alias must appear inside the +-required group
        # so Lucene can satisfy the requirement even when the literal
        # token doesn't tokenize against any indexed value.
        query = build_search_query('vrf')
        assert 'className:fvCtx^' in query

    def test_multi_word_alias_appended(self):
        query = build_search_query('vlan pool')
        assert 'className:fvnsVlanInstP^' in query

    def test_special_chars_in_token_are_escaped(self):
        query = build_search_query('foo:bar')
        assert 'foo\\:bar' in query

    def test_wildcard_intent_preserved(self):
        query = build_search_query('fv*')
        assert 'className:fv*' in query

    def test_explicit_fuzzy_intent_preserved(self):
        query = build_search_query('tenant~')
        assert 'className:tenant~1' in query

    def test_short_token_skips_implicit_fuzzy(self):
        query = build_search_query('bd')
        # Implicit fuzzy is only added for tokens >= 4 chars.
        assert 'className:bd~1' not in query


@pytest.mark.unit
class TestAliasInventory:
    """Sanity checks on the alias dictionaries themselves."""

    def test_single_word_keys_are_lowercase(self):
        for key in SINGLE_WORD_ALIASES:
            assert key == key.lower(), f'alias key not lowercase: {key!r}'

    def test_single_word_values_are_non_empty_tuples(self):
        for key, classes in SINGLE_WORD_ALIASES.items():
            assert isinstance(classes, tuple)
            assert classes, f'alias {key!r} has no classes'
            for cls in classes:
                assert isinstance(cls, str) and cls

    def test_multi_word_aliases_sorted_longest_first(self):
        lengths = [len(phrase) for phrase, _ in MULTI_WORD_ALIASES]
        assert lengths == sorted(lengths, reverse=True), (
            'MULTI_WORD_ALIASES must be longest-first to keep substring '
            'matching greedy.'
        )
