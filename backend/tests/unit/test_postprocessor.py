"""
Unit tests for PostProcessorEngine
Tests each processor type and the execution pipeline
"""

import pytest
from queries.services.postprocessor import PostProcessorEngine


# ======================================================================
# Helpers
# ======================================================================


def _make_apic_response(class_name, items):
    """Build a minimal APIC imdata response"""
    return {
        'totalCount': str(len(items)),
        'imdata': [{class_name: {'attributes': attrs}} for attrs in items],
    }


def _processor_node(processor_type, config=None):
    """Build a processor node dict as used in flow_data"""
    return {
        'id': f'p-{processor_type}',
        'type': 'postProcessorNode',
        'data': {
            'processorType': processor_type,
            'config': config or {},
        },
    }


# ======================================================================
# PostProcessorEngine.execute (pipeline)
# ======================================================================


@pytest.mark.unit
class TestPostProcessorEngineExecute:
    def test_empty_processors_returns_data_unchanged(self):
        data = [1, 2, 3]
        result = PostProcessorEngine.execute(data, [])
        assert result == [1, 2, 3]

    def test_unknown_processor_type_raises(self):
        data = [1, 2, 3]
        with pytest.raises(Exception):
            PostProcessorEngine.execute(data, [_processor_node('nonexistent-processor')])

    def test_node_without_processor_type_skipped(self):
        """Nodes with no processorType in data should be skipped"""
        data = ['a', 'b']
        # No processorType key → processor skipped
        processors = [{'id': 'p1', 'data': {'config': {}}}]
        result = PostProcessorEngine.execute(data, processors)
        assert result == ['a', 'b']

    def test_pipeline_chains_processors(self):
        """Two processors applied in sequence"""
        data = ['  hello  ', '  world  ']
        processors = [
            _processor_node('text-operations', {'operation': 'trim'}),
            _processor_node('text-operations', {'operation': 'upper'}),
        ]
        result = PostProcessorEngine.execute(data, processors)
        assert result == ['HELLO', 'WORLD']


# ======================================================================
# DN Extract
# ======================================================================


@pytest.mark.unit
class TestDnExtract:
    def _run(self, data, config=None):
        return PostProcessorEngine.execute(data, [_processor_node('dn-extract', config or {})])

    def test_extracts_dn_from_apic_response(self):
        data = _make_apic_response(
            'fvTenant',
            [
                {'name': 'prod', 'dn': 'uni/tn-prod'},
                {'name': 'dev', 'dn': 'uni/tn-dev'},
            ],
        )
        result = self._run(data)
        assert result == ['uni/tn-prod', 'uni/tn-dev']

    def test_extracts_custom_field(self):
        data = _make_apic_response(
            'fvTenant',
            [
                {'name': 'prod', 'dn': 'uni/tn-prod'},
            ],
        )
        result = self._run(data, {'extractField': 'name'})
        assert result == ['prod']

    def test_applies_remove_prefix(self):
        data = _make_apic_response(
            'fvTenant',
            [
                {'name': 'prod', 'dn': 'uni/tn-prod'},
            ],
        )
        result = self._run(data, {'extractField': 'dn', 'removePrefix': r'^uni/'})
        assert result == ['tn-prod']

    def test_applies_extract_pattern_with_capture_group(self):
        data = _make_apic_response(
            'fvTenant',
            [
                {'name': 'prod', 'dn': 'uni/tn-production-env'},
            ],
        )
        result = self._run(data, {'extractField': 'dn', 'extractPattern': r'tn-(.+)'})
        assert result == ['production-env']

    def test_returns_empty_for_non_imdata(self):
        result = self._run({'other': 'data'})
        assert result == []

    def test_returns_empty_for_empty_imdata(self):
        result = self._run({'imdata': []})
        assert result == []


# ======================================================================
# Regex Transform
# ======================================================================


@pytest.mark.unit
class TestRegexTransform:
    def _run(self, data, config):
        return PostProcessorEngine.execute(data, [_processor_node('regex-transform', config)])

    def test_replaces_in_string(self):
        result = self._run('hello world', {'pattern': 'world', 'replacement': 'Python'})
        assert result == 'hello Python'

    def test_replaces_in_list(self):
        result = self._run(['uni/tn-prod', 'uni/tn-dev'], {'pattern': r'^uni/', 'replacement': ''})
        assert result == ['tn-prod', 'tn-dev']

    def test_case_insensitive_flag(self):
        result = self._run('Hello World', {'pattern': 'hello', 'replacement': 'Hi', 'flags': 'i'})
        assert result == 'Hi World'

    def test_non_string_items_in_list_unchanged(self):
        """Non-string items in a list should pass through unchanged"""
        result = self._run([42, 'hello'], {'pattern': 'hello', 'replacement': 'bye'})
        assert result[0] == 42
        assert result[1] == 'bye'

    def test_returns_non_string_data_unchanged(self):
        data = {'key': 'value'}
        result = self._run(data, {'pattern': 'x', 'replacement': 'y'})
        assert result == {'key': 'value'}


# ======================================================================
# Array Sort
# ======================================================================


@pytest.mark.unit
class TestArraySort:
    def _run(self, data, config=None):
        return PostProcessorEngine.execute(data, [_processor_node('array-sort', config or {})])

    def test_sorts_strings_alphabetically(self):
        result = self._run(['banana', 'apple', 'cherry'])
        assert result == ['apple', 'banana', 'cherry']

    def test_sorts_numbers_numerically(self):
        result = self._run([10, 3, 7, 1], {'numeric': True})
        assert result == [1, 3, 7, 10]

    def test_reverse_sort(self):
        result = self._run(['a', 'c', 'b'], {'reverse': True})
        assert result == ['c', 'b', 'a']

    def test_unique_removes_duplicates(self):
        result = self._run(['b', 'a', 'a', 'b', 'c'], {'unique': True})
        assert len(result) == 3
        assert 'a' in result
        assert 'b' in result
        assert 'c' in result

    def test_raises_for_non_list(self):
        with pytest.raises(Exception):
            self._run('not a list')

    def test_sort_by_field(self):
        data = [{'name': 'c'}, {'name': 'a'}, {'name': 'b'}]
        result = self._run(data, {'field': 'name'})
        assert result[0]['name'] == 'a'
        assert result[1]['name'] == 'b'
        assert result[2]['name'] == 'c'


# ======================================================================
# Pattern Filter
# ======================================================================


@pytest.mark.unit
class TestPatternFilter:
    def _run(self, data, config=None):
        return PostProcessorEngine.execute(data, [_processor_node('pattern-filter', config or {})])

    def test_include_pattern_filters_in(self):
        data = ['uni/tn-prod', 'uni/tn-dev', 'uni/tn-staging']
        result = self._run(data, {'includePatterns': ['prod']})
        assert result == ['uni/tn-prod']

    def test_exclude_pattern_filters_out(self):
        data = ['uni/tn-prod', 'uni/tn-dev', 'uni/tn-staging']
        result = self._run(data, {'excludePatterns': ['dev', 'staging']})
        assert result == ['uni/tn-prod']

    def test_include_and_exclude_combined(self):
        data = ['uni/tn-prod-A', 'uni/tn-prod-B', 'uni/tn-dev']
        result = self._run(data, {'includePatterns': ['prod'], 'excludePatterns': ['-B']})
        assert result == ['uni/tn-prod-A']

    def test_case_insensitive_by_default(self):
        data = ['PROD', 'dev', 'Staging']
        result = self._run(data, {'includePatterns': ['prod']})
        assert result == ['PROD']

    def test_case_sensitive_mode(self):
        data = ['PROD', 'prod', 'Dev']
        result = self._run(data, {'includePatterns': ['prod'], 'caseSensitive': True})
        assert result == ['prod']

    def test_raises_for_non_list(self):
        with pytest.raises(Exception):
            self._run('not a list')

    def test_no_patterns_returns_all(self):
        data = ['a', 'b', 'c']
        result = self._run(data)
        assert result == ['a', 'b', 'c']


# ======================================================================
# Field Extract
# ======================================================================


@pytest.mark.unit
class TestFieldExtract:
    def _run(self, data, config=None):
        return PostProcessorEngine.execute(data, [_processor_node('field-extract', config or {})])

    def test_extracts_top_level_field(self):
        data = [{'name': 'prod', 'dn': 'uni/tn-prod', 'descr': 'Production'}]
        result = self._run(data, {'fields': ['name']})
        assert result == [{'name': 'prod'}]

    def test_extracts_nested_field(self):
        data = [{'attrs': {'name': 'prod', 'descr': 'desc'}}]
        result = self._run(data, {'fields': ['attrs.name']})
        assert result[0]['name'] == 'prod'

    def test_extracts_multiple_fields(self):
        data = [{'name': 'prod', 'dn': 'uni/tn-prod', 'descr': 'Production'}]
        result = self._run(data, {'fields': ['name', 'dn']})
        assert set(result[0].keys()) == {'name', 'dn'}

    def test_raises_without_fields(self):
        with pytest.raises(Exception):
            self._run([{'name': 'a'}], {'fields': []})

    def test_raises_for_non_list(self):
        with pytest.raises(Exception):
            self._run('not a list', {'fields': ['name']})


# ======================================================================
# Flatten
# ======================================================================


@pytest.mark.unit
class TestFlatten:
    def _run(self, data, config=None):
        return PostProcessorEngine.execute(data, [_processor_node('flatten', config or {})])

    def test_flattens_nested_array_one_level(self):
        data = [[1, 2], [3, 4], [5]]
        result = self._run(data)
        assert result == [1, 2, 3, 4, 5]

    def test_flattens_dict(self):
        data = {'a': {'b': {'c': 1}}}
        result = self._run(data, {'separator': '.'})
        assert result == {'a.b.c': 1}

    def test_non_nested_array_unchanged(self):
        data = [1, 2, 3]
        result = self._run(data)
        assert result == [1, 2, 3]


# ======================================================================
# Text Operations
# ======================================================================


@pytest.mark.unit
class TestTextOperations:
    def _run(self, data, config=None):
        return PostProcessorEngine.execute(data, [_processor_node('text-operations', config or {})])

    def test_trim(self):
        result = self._run(['  hello  ', ' world '])
        assert result == ['hello', 'world']

    def test_upper(self):
        result = self._run(['hello', 'world'], {'operation': 'upper'})
        assert result == ['HELLO', 'WORLD']

    def test_lower(self):
        result = self._run(['HELLO', 'WORLD'], {'operation': 'lower'})
        assert result == ['hello', 'world']

    def test_split_string(self):
        result = self._run('a,b,c', {'operation': 'split', 'separator': ','})
        assert result == ['a', 'b', 'c']

    def test_join_list(self):
        result = self._run(['a', 'b', 'c'], {'operation': 'join', 'delimiter': '-'})
        assert result == 'a-b-c'

    def test_substring(self):
        result = self._run('hello world', {'operation': 'substring', 'start': 6})
        assert result == 'world'

    def test_substring_with_end(self):
        result = self._run('hello world', {'operation': 'substring', 'start': 0, 'end': 5})
        assert result == 'hello'


# ======================================================================
# Aggregate
# ======================================================================


@pytest.mark.unit
class TestAggregate:
    def _run(self, data, config=None):
        return PostProcessorEngine.execute(data, [_processor_node('aggregate', config or {})])

    def test_count(self):
        result = self._run([1, 2, 3, 4, 5])
        assert result == 5

    def test_sum(self):
        data = [{'value': 10}, {'value': 20}, {'value': 30}]
        result = self._run(data, {'operation': 'sum', 'field': 'value'})
        assert result == 60

    def test_avg(self):
        data = [{'score': 10}, {'score': 20}, {'score': 30}]
        result = self._run(data, {'operation': 'avg', 'field': 'score'})
        assert result == 20.0

    def test_min(self):
        data = [{'val': 5}, {'val': 2}, {'val': 8}]
        result = self._run(data, {'operation': 'min', 'field': 'val'})
        assert result == 2

    def test_sum_requires_field(self):
        with pytest.raises(Exception):
            self._run([1, 2, 3], {'operation': 'sum'})

    def test_raises_for_non_list(self):
        with pytest.raises(Exception):
            self._run({'not': 'list'})

    def test_max(self):
        data = [{'val': 5}, {'val': 2}, {'val': 8}]
        result = self._run(data, {'operation': 'max', 'field': 'val'})
        assert result == 8

    def test_group_by(self):
        data = [
            {'name': 'a', 'type': 'x'},
            {'name': 'b', 'type': 'x'},
            {'name': 'c', 'type': 'y'},
        ]
        result = self._run(data, {'operation': 'group', 'groupBy': 'type'})
        assert len(result['x']) == 2
        assert len(result['y']) == 1

    def test_group_requires_groupby(self):
        with pytest.raises(Exception):
            self._run([{'a': 1}], {'operation': 'group'})

    def test_unknown_operation_raises(self):
        with pytest.raises(Exception):
            self._run([1, 2], {'operation': 'median'})

    def test_avg_with_string_numbers(self):
        """APIC often returns numbers as strings"""
        data = [{'val': '10'}, {'val': '20'}, {'val': '30'}]
        result = self._run(data, {'operation': 'avg', 'field': 'val'})
        assert result == 20.0

    def test_min_empty_values(self):
        data = [{'val': 'not_a_number'}]
        result = self._run(data, {'operation': 'min', 'field': 'val'})
        assert result is None


# ======================================================================
# APIC Envelope Normalization in execute()
# ======================================================================


@pytest.mark.unit
class TestAPICEnvelopeNormalization:
    """Tests for the APIC envelope unwrapping added to execute()"""

    def test_execute_unwraps_apic_envelope_before_pipeline(self):
        """execute() should unwrap imdata so processors get a list"""
        data = _make_apic_response(
            'fvTenant',
            [
                {'name': 'prod', 'dn': 'uni/tn-prod'},
                {'name': 'dev', 'dn': 'uni/tn-dev'},
            ],
        )
        processors = [_processor_node('aggregate')]
        result = PostProcessorEngine.execute(data, processors)
        assert result == 2

    def test_execute_list_input_passes_through(self):
        """If data is already a list, no unwrapping needed"""
        data = [{'name': 'a'}, {'name': 'b'}]
        processors = [_processor_node('aggregate')]
        result = PostProcessorEngine.execute(data, processors)
        assert result == 2

    def test_execute_dict_without_imdata_passes_through(self):
        """Dicts without imdata key should pass through as-is"""
        data = {'someKey': 'someValue'}
        result = PostProcessorEngine.execute(data, [])
        assert result == {'someKey': 'someValue'}

    def test_execute_apic_envelope_with_field_extract(self):
        """field-extract on APIC envelope should work after normalization.

        After envelope unwrap each item is {'fvBD': {'attributes': {...}}}.
        _get_nested_value auto-unwraps the single-key class envelope, so
        'attributes.name' resolves through fvBD → attributes → name.
        """
        data = _make_apic_response(
            'fvBD',
            [
                {'name': 'web-bd', 'dn': 'uni/tn-prod/BD-web-bd', 'seg': '16777209'},
                {'name': 'app-bd', 'dn': 'uni/tn-prod/BD-app-bd', 'seg': '16777210'},
            ],
        )
        processors = [
            _processor_node('field-extract', {'fields': ['attributes.name', 'attributes.seg']})
        ]
        result = PostProcessorEngine.execute(data, processors)
        assert len(result) == 2
        assert result[0].get('name') == 'web-bd'
        assert result[0].get('seg') == '16777209'

    def test_execute_apic_envelope_with_pattern_filter(self):
        """pattern-filter on APIC envelope items after normalization"""
        data = _make_apic_response(
            'fvTenant',
            [
                {'name': 'prod', 'dn': 'uni/tn-prod'},
                {'name': 'dev', 'dn': 'uni/tn-dev'},
                {'name': 'staging', 'dn': 'uni/tn-staging'},
            ],
        )
        processors = [
            _processor_node('dn-extract', {'extractField': 'name'}),
            _processor_node('pattern-filter', {'includePatterns': ['prod']}),
        ]
        result = PostProcessorEngine.execute(data, processors)
        assert result == ['prod']

    def test_pipeline_chain_apic_envelope_to_multiple_processors(self):
        """Full chain: APIC data → dn-extract → regex-transform → pattern-filter"""
        data = _make_apic_response(
            'fvTenant',
            [
                {'name': 'tn-prod-east', 'dn': 'uni/tn-prod-east'},
                {'name': 'tn-dev-west', 'dn': 'uni/tn-dev-west'},
                {'name': 'tn-prod-west', 'dn': 'uni/tn-prod-west'},
            ],
        )
        processors = [
            _processor_node('dn-extract', {'extractField': 'name'}),
            _processor_node('regex-transform', {'pattern': '^tn-', 'replacement': ''}),
            _processor_node('pattern-filter', {'includePatterns': ['prod']}),
        ]
        result = PostProcessorEngine.execute(data, processors)
        assert set(result) == {'prod-east', 'prod-west'}


# ======================================================================
# _get_nested_value APIC Envelope Auto-Unwrap
# ======================================================================


@pytest.mark.unit
class TestGetNestedValueEnvelopeUnwrap:
    """Tests for _get_nested_value auto-unwrapping APIC class envelopes"""

    def test_direct_path_works(self):
        obj = {'attributes': {'name': 'prod'}}
        result = PostProcessorEngine._get_nested_value(obj, 'attributes.name')
        assert result == 'prod'

    def test_apic_envelope_auto_unwrap(self):
        """When root has single key wrapping a dict, unwrap transparently"""
        obj = {'fvTenant': {'attributes': {'name': 'prod', 'dn': 'uni/tn-prod'}}}
        result = PostProcessorEngine._get_nested_value(obj, 'attributes.name')
        assert result == 'prod'

    def test_apic_envelope_dn_access(self):
        obj = {'fvTenant': {'attributes': {'dn': 'uni/tn-prod'}}}
        result = PostProcessorEngine._get_nested_value(obj, 'attributes.dn')
        assert result == 'uni/tn-prod'

    def test_direct_path_takes_priority_over_unwrap(self):
        """If the path matches at root level, don't unwrap"""
        obj = {'name': 'direct', 'fvTenant': {'attributes': {'name': 'wrapped'}}}
        result = PostProcessorEngine._get_nested_value(obj, 'name')
        assert result == 'direct'

    def test_non_dict_returns_none(self):
        assert PostProcessorEngine._get_nested_value('string', 'path') is None
        assert PostProcessorEngine._get_nested_value(42, 'path') is None
        assert PostProcessorEngine._get_nested_value(None, 'path') is None

    def test_missing_path_returns_none(self):
        obj = {'fvTenant': {'attributes': {'name': 'prod'}}}
        result = PostProcessorEngine._get_nested_value(obj, 'attributes.nonexistent')
        assert result is None

    def test_multi_key_dict_no_unwrap(self):
        """Dicts with multiple keys should not attempt envelope unwrap"""
        obj = {'key1': {'a': 1}, 'key2': {'b': 2}}
        result = PostProcessorEngine._get_nested_value(obj, 'a')
        assert result is None

    def test_nested_value_integer(self):
        obj = {'fvCEp': {'attributes': {'encap': 'vlan-100', 'lcC': '3'}}}
        result = PostProcessorEngine._get_nested_value(obj, 'attributes.lcC')
        assert result == '3'


# ======================================================================
# DN Extract — List Input Support
# ======================================================================


@pytest.mark.unit
class TestDnExtractListInput:
    """Tests for _dn_extract accepting pre-normalized list input"""

    def _run(self, data, config=None):
        return PostProcessorEngine.execute(data, [_processor_node('dn-extract', config or {})])

    def test_list_input_extracts_dn(self):
        """When execute() normalizes APIC envelope to list, dn-extract still works"""
        data = [
            {'fvTenant': {'attributes': {'name': 'prod', 'dn': 'uni/tn-prod'}}},
            {'fvTenant': {'attributes': {'name': 'dev', 'dn': 'uni/tn-dev'}}},
        ]
        result = self._run(data)
        assert result == ['uni/tn-prod', 'uni/tn-dev']

    def test_list_input_with_custom_field(self):
        data = [
            {'fvBD': {'attributes': {'name': 'web-bd', 'dn': 'uni/tn-prod/BD-web-bd'}}},
        ]
        result = self._run(data, {'extractField': 'name'})
        assert result == ['web-bd']

    def test_list_input_with_remove_prefix(self):
        data = [
            {'fvTenant': {'attributes': {'dn': 'uni/tn-prod'}}},
        ]
        result = self._run(data, {'extractField': 'dn', 'removePrefix': r'^uni/'})
        assert result == ['tn-prod']

    def test_list_with_non_dict_items_skipped(self):
        """Non-dict items in the list should be silently skipped"""
        data = [
            {'fvTenant': {'attributes': {'dn': 'uni/tn-prod'}}},
            'not-a-dict',
            42,
        ]
        result = self._run(data)
        assert result == ['uni/tn-prod']

    def test_empty_list_returns_empty(self):
        result = self._run([])
        assert result == []


# ======================================================================
# Filter Rows
# ======================================================================


@pytest.mark.unit
class TestFilterRows:
    def _run(self, data, config=None):
        return PostProcessorEngine.execute(data, [_processor_node('filter_rows', config or {})])

    def test_equality_string(self):
        data = [{'name': 'prod'}, {'name': 'dev'}, {'name': 'staging'}]
        result = self._run(data, {'condition': "item.name === 'prod'"})
        assert len(result) == 1
        assert result[0]['name'] == 'prod'

    def test_inequality(self):
        data = [{'status': 'active'}, {'status': 'inactive'}]
        result = self._run(data, {'condition': "item.status !== 'inactive'"})
        assert len(result) == 1
        assert result[0]['status'] == 'active'

    def test_greater_than(self):
        data = [{'count': 5}, {'count': 15}, {'count': 25}]
        result = self._run(data, {'condition': 'item.count > 10'})
        assert len(result) == 2

    def test_less_than(self):
        data = [{'count': 5}, {'count': 15}]
        result = self._run(data, {'condition': 'item.count < 10'})
        assert len(result) == 1
        assert result[0]['count'] == 5

    def test_greater_equal(self):
        data = [{'val': 10}, {'val': 20}]
        result = self._run(data, {'condition': 'item.val >= 10'})
        assert len(result) == 2

    def test_less_equal(self):
        data = [{'val': 10}, {'val': 20}]
        result = self._run(data, {'condition': 'item.val <= 10'})
        assert len(result) == 1

    def test_nested_field_access(self):
        data = [
            {'fvTenant': {'attributes': {'name': 'prod'}}},
            {'fvTenant': {'attributes': {'name': 'dev'}}},
        ]
        # _get_nested_value auto-unwraps single-key APIC envelope
        result = self._run(data, {'condition': "item.attributes.name === 'prod'"})
        assert len(result) == 1

    def test_boolean_true_value(self):
        data = [{'active': True}, {'active': False}]
        result = self._run(data, {'condition': 'item.active === true'})
        assert len(result) == 1
        assert result[0]['active'] is True

    def test_null_value(self):
        data = [{'val': None}, {'val': 'something'}]
        result = self._run(data, {'condition': 'item.val === null'})
        assert len(result) == 1
        assert result[0]['val'] is None

    def test_empty_condition_returns_all(self):
        data = [{'a': 1}, {'a': 2}]
        result = self._run(data, {'condition': ''})
        assert len(result) == 2

    def test_invalid_condition_format_raises(self):
        with pytest.raises(Exception, match='Unsupported condition'):
            self._run([{'a': 1}], {'condition': 'invalid syntax'})

    def test_non_list_raises(self):
        with pytest.raises(Exception):
            self._run({'not': 'list'}, {'condition': "item.a === 'b'"})

    def test_double_equals(self):
        """== should work same as ==="""
        data = [{'name': 'prod'}, {'name': 'dev'}]
        result = self._run(data, {'condition': "item.name == 'prod'"})
        assert len(result) == 1

    def test_numeric_string_coercion(self):
        """APIC often has numeric values as strings — coercion should handle this"""
        data = [{'count': 10}, {'count': 20}]
        result = self._run(data, {'condition': "item.count === '10'"})
        # int 10 compared to string '10' — coercion kicks in
        assert len(result) == 1


# ======================================================================
# Map Transform
# ======================================================================


@pytest.mark.unit
class TestMapTransform:
    def _run(self, data, config=None):
        return PostProcessorEngine.execute(data, [_processor_node('map-transform', config or {})])

    def test_identity_expression(self):
        data = [{'a': 1}, {'a': 2}]
        result = self._run(data, {'expression': 'item'})
        assert result == data

    def test_field_path_expression(self):
        data = [{'name': 'prod'}, {'name': 'dev'}]
        result = self._run(data, {'expression': 'item.name'})
        assert result == ['prod', 'dev']

    def test_nested_field_path(self):
        data = [{'attrs': {'name': 'prod'}}, {'attrs': {'name': 'dev'}}]
        result = self._run(data, {'expression': 'item.attrs.name'})
        assert result == ['prod', 'dev']

    def test_apic_envelope_field_access(self):
        """_get_nested_value should unwrap APIC envelope for map-transform"""
        data = [
            {'fvTenant': {'attributes': {'name': 'prod'}}},
            {'fvTenant': {'attributes': {'name': 'dev'}}},
        ]
        result = self._run(data, {'expression': 'item.attributes.name'})
        assert result == ['prod', 'dev']

    def test_unknown_expression_passthrough(self):
        """Unknown expressions should return items unchanged"""
        data = [{'a': 1}]
        result = self._run(data, {'expression': 'something_else'})
        assert result == [{'a': 1}]

    def test_default_expression_is_identity(self):
        data = [1, 2, 3]
        result = self._run(data)
        assert result == [1, 2, 3]

    def test_non_list_raises(self):
        with pytest.raises(Exception):
            self._run('not a list', {'expression': 'item'})

    def test_missing_field_returns_none(self):
        data = [{'name': 'prod'}, {'other': 'field'}]
        result = self._run(data, {'expression': 'item.name'})
        assert result[0] == 'prod'
        assert result[1] is None


# ======================================================================
# _walk_path
# ======================================================================


@pytest.mark.unit
class TestWalkPath:
    def test_simple_path(self):
        obj = {'a': {'b': 'value'}}
        assert PostProcessorEngine._walk_path(obj, 'a.b') == 'value'

    def test_single_key(self):
        obj = {'name': 'prod'}
        assert PostProcessorEngine._walk_path(obj, 'name') == 'prod'

    def test_missing_key_returns_none(self):
        obj = {'a': 1}
        assert PostProcessorEngine._walk_path(obj, 'b') is None

    def test_deep_path(self):
        obj = {'a': {'b': {'c': {'d': 42}}}}
        assert PostProcessorEngine._walk_path(obj, 'a.b.c.d') == 42

    def test_non_dict_intermediate_returns_none(self):
        obj = {'a': 'not_a_dict'}
        assert PostProcessorEngine._walk_path(obj, 'a.b') is None
