# Tests for QueryIntent, MOQueryStrategy, ClassQueryStrategy, and QueryExecutor
#
# These test the query optimization layer that turns React Flow canvas data
# (nodes + edges) into APIC REST API URLs. The key logic being tested:
#   - Class chain parsing from flow data
#   - DN construction from eq filters
#   - Partial DN detection for subtree queries
#   - Filter expression building (eq, wcard, contains, etc.)
#   - Strategy selection (MO vs Class)

import pytest
from queries.services.optimizer import (
    QueryIntent,
    MOQueryStrategy,
    ClassQueryStrategy,
    QueryExecutor,
)


# ======================================================================
# Helpers — build minimal React Flow canvas structures
# ======================================================================


def _class_node(node_id, class_name, scope='self', property_include='all', supplemental_data=None):
    data = {'className': class_name, 'scope': scope, 'propertyInclude': property_include}
    if supplemental_data:
        data['supplementalData'] = supplemental_data
    return {
        'id': node_id,
        'type': 'classNode',
        'position': {'x': 0, 'y': 0},
        'data': data,
    }


def _filter_node(node_id, prop, operator, value, filter_type='property'):
    return {
        'id': node_id,
        'type': 'filterNode',
        'position': {'x': 0, 'y': 0},
        'data': {
            'filterType': filter_type,
            'property': prop,
            'operator': operator,
            'value': value,
        },
    }


def _output_node(node_id='out'):
    return {
        'id': node_id,
        'type': 'outputNode',
        'position': {'x': 0, 'y': 0},
        'data': {},
    }


def _edge(edge_id, source, target):
    return {'id': edge_id, 'source': source, 'target': target, 'data': {}}


def _flow(nodes, edges):
    return {'nodes': nodes, 'edges': edges}


# ======================================================================
# QueryIntent — Parsing
# ======================================================================


@pytest.mark.unit
class TestQueryIntentParsing:
    def test_single_class_node(self):
        flow = _flow(
            [_class_node('c1', 'fvTenant'), _output_node()],
            [_edge('e1', 'c1', 'out')],
        )
        intent = QueryIntent(flow)
        assert intent.class_name == 'fvTenant'
        assert len(intent.class_chain) == 1

    def test_no_class_node_raises(self):
        flow = _flow([_output_node()], [])
        with pytest.raises(ValueError, match='No valid ClassNode'):
            QueryIntent(flow)

    def test_class_node_without_class_name_raises(self):
        node = _class_node('c1', 'fvTenant')
        node['data']['className'] = ''
        flow = _flow([node, _output_node()], [_edge('e1', 'c1', 'out')])
        with pytest.raises(ValueError, match='className'):
            QueryIntent(flow)

    def test_two_class_chain(self):
        """fvTenant → fvBD should produce a chain of 2"""
        flow = _flow(
            [_class_node('c1', 'fvTenant'), _class_node('c2', 'fvBD'), _output_node()],
            [_edge('e1', 'c1', 'c2'), _edge('e2', 'c2', 'out')],
        )
        intent = QueryIntent(flow)
        assert intent.class_name == 'fvBD'
        assert len(intent.class_chain) == 2
        assert intent.class_chain[0]['class_name'] == 'fvTenant'
        assert intent.class_chain[1]['class_name'] == 'fvBD'

    def test_three_class_chain(self):
        """fvTenant → fvAp → fvAEPg"""
        flow = _flow(
            [
                _class_node('c1', 'fvTenant'),
                _class_node('c2', 'fvAp'),
                _class_node('c3', 'fvAEPg'),
                _output_node(),
            ],
            [
                _edge('e1', 'c1', 'c2'),
                _edge('e2', 'c2', 'c3'),
                _edge('e3', 'c3', 'out'),
            ],
        )
        intent = QueryIntent(flow)
        assert intent.class_name == 'fvAEPg'
        assert len(intent.class_chain) == 3

    def test_target_node_id_override(self):
        """When target_node_id is specified, use that node instead of output"""
        flow = _flow(
            [_class_node('c1', 'fvTenant'), _class_node('c2', 'fvBD'), _output_node()],
            [_edge('e1', 'c1', 'c2'), _edge('e2', 'c2', 'out')],
        )
        intent = QueryIntent(flow, target_node_id='c1')
        assert intent.class_name == 'fvTenant'

    def test_scope_from_node(self):
        flow = _flow(
            [_class_node('c1', 'fvTenant', scope='children'), _output_node()],
            [_edge('e1', 'c1', 'out')],
        )
        intent = QueryIntent(flow)
        assert intent.scope == 'children'

    def test_property_include(self):
        flow = _flow(
            [_class_node('c1', 'fvTenant', property_include='naming-only'), _output_node()],
            [_edge('e1', 'c1', 'out')],
        )
        intent = QueryIntent(flow)
        assert intent.property_include == 'naming-only'


# ======================================================================
# QueryIntent — Filter Detection
# ======================================================================


@pytest.mark.unit
class TestQueryIntentFilters:
    def test_filter_connected_to_class(self):
        """ClassNode → FilterNode should be detected"""
        flow = _flow(
            [
                _class_node('c1', 'fvTenant'),
                _filter_node('f1', 'name', 'eq', 'prod'),
                _output_node(),
            ],
            [
                _edge('e1', 'c1', 'f1'),
                _edge('e2', 'f1', 'out'),
            ],
        )
        intent = QueryIntent(flow)
        assert intent.class_chain[0]['filter_node'] is not None
        assert intent.class_chain[0]['filter_node']['data']['value'] == 'prod'

    def test_multiple_filters_collected(self):
        """ClassNode → Filter1 → Filter2 should collect both"""
        flow = _flow(
            [
                _class_node('c1', 'fvTenant'),
                _filter_node('f1', 'name', 'eq', 'prod'),
                _filter_node('f2', 'descr', 'contains', 'test'),
                _output_node(),
            ],
            [
                _edge('e1', 'c1', 'f1'),
                _edge('e2', 'f1', 'f2'),
                _edge('e3', 'f2', 'out'),
            ],
        )
        intent = QueryIntent(flow)
        assert len(intent.class_chain[0]['filter_nodes']) == 2

    def test_no_filter(self):
        flow = _flow(
            [_class_node('c1', 'fvTenant'), _output_node()],
            [_edge('e1', 'c1', 'out')],
        )
        intent = QueryIntent(flow)
        assert intent.class_chain[0]['filter_node'] is None

    def test_filter_belongs_to_correct_class(self):
        """Filter between two classes belongs to the first class, not the second"""
        flow = _flow(
            [
                _class_node('c1', 'fvTenant'),
                _filter_node('f1', 'name', 'eq', 'prod'),
                _class_node('c2', 'fvBD'),
                _output_node(),
            ],
            [
                _edge('e1', 'c1', 'f1'),
                _edge('e2', 'f1', 'c2'),
                _edge('e3', 'c2', 'out'),
            ],
        )
        intent = QueryIntent(flow)
        assert intent.class_chain[0]['filter_node'] is not None
        assert intent.class_chain[0]['filter_node']['data']['value'] == 'prod'
        assert intent.class_chain[1]['filter_node'] is None


# ======================================================================
# QueryIntent — DN Construction
# ======================================================================


@pytest.mark.unit
class TestQueryIntentDN:
    def test_can_build_dn_single_class_with_eq_filter(self):
        flow = _flow(
            [
                _class_node('c1', 'fvTenant'),
                _filter_node('f1', 'name', 'eq', 'prod'),
                _output_node(),
            ],
            [_edge('e1', 'c1', 'f1'), _edge('e2', 'f1', 'out')],
        )
        intent = QueryIntent(flow)
        assert intent.can_build_dn() is True
        assert intent.build_dn() == 'uni/tn-prod'

    def test_cannot_build_dn_without_filter(self):
        flow = _flow(
            [_class_node('c1', 'fvTenant'), _output_node()],
            [_edge('e1', 'c1', 'out')],
        )
        intent = QueryIntent(flow)
        assert intent.can_build_dn() is False
        assert intent.build_dn() is None

    def test_cannot_build_dn_with_wcard_filter(self):
        """Wildcard filters can't be used for DN construction"""
        flow = _flow(
            [
                _class_node('c1', 'fvTenant'),
                _filter_node('f1', 'name', 'wcard', 'prod*'),
                _output_node(),
            ],
            [_edge('e1', 'c1', 'f1'), _edge('e2', 'f1', 'out')],
        )
        intent = QueryIntent(flow)
        assert intent.can_build_dn() is False

    def test_two_class_full_dn(self):
        """fvTenant(name=prod) → fvBD(name=web) → DN: uni/tn-prod/BD-web"""
        flow = _flow(
            [
                _class_node('c1', 'fvTenant'),
                _filter_node('f1', 'name', 'eq', 'prod'),
                _class_node('c2', 'fvBD'),
                _filter_node('f2', 'name', 'eq', 'web'),
                _output_node(),
            ],
            [
                _edge('e1', 'c1', 'f1'),
                _edge('e2', 'f1', 'c2'),
                _edge('e3', 'c2', 'f2'),
                _edge('e4', 'f2', 'out'),
            ],
        )
        intent = QueryIntent(flow)
        assert intent.can_build_dn() is True
        dn = intent.build_dn()
        assert dn == 'uni/tn-prod/BD-web'

    def test_partial_dn_parent_has_filter_target_does_not(self):
        """fvTenant(name=prod) → fvBD(no filter) → partial DN"""
        flow = _flow(
            [
                _class_node('c1', 'fvTenant'),
                _filter_node('f1', 'name', 'eq', 'prod'),
                _class_node('c2', 'fvBD'),
                _output_node(),
            ],
            [
                _edge('e1', 'c1', 'f1'),
                _edge('e2', 'f1', 'c2'),
                _edge('e3', 'c2', 'out'),
            ],
        )
        intent = QueryIntent(flow)
        assert intent.can_build_dn() is False
        assert intent.can_build_partial_dn() is True
        assert intent.build_partial_dn() == 'uni/tn-prod'

    def test_cannot_build_partial_dn_single_class(self):
        """Partial DN requires at least 2 classes"""
        flow = _flow(
            [_class_node('c1', 'fvTenant'), _output_node()],
            [_edge('e1', 'c1', 'out')],
        )
        intent = QueryIntent(flow)
        assert intent.can_build_partial_dn() is False

    def test_estimate_result_count_with_eq(self):
        flow = _flow(
            [
                _class_node('c1', 'fvTenant'),
                _filter_node('f1', 'name', 'eq', 'prod'),
                _output_node(),
            ],
            [_edge('e1', 'c1', 'f1'), _edge('e2', 'f1', 'out')],
        )
        intent = QueryIntent(flow)
        assert intent.estimate_result_count() == 'low'

    def test_estimate_result_count_no_filter(self):
        flow = _flow(
            [_class_node('c1', 'fvTenant'), _output_node()],
            [_edge('e1', 'c1', 'out')],
        )
        intent = QueryIntent(flow)
        assert intent.estimate_result_count() == 'high'


# ======================================================================
# MOQueryStrategy
# ======================================================================


@pytest.mark.unit
class TestMOQueryStrategy:
    def _intent(self, nodes, edges):
        return QueryIntent(_flow(nodes, edges))

    def test_can_handle_with_full_dn(self):
        intent = self._intent(
            [
                _class_node('c1', 'fvTenant'),
                _filter_node('f1', 'name', 'eq', 'prod'),
                _output_node(),
            ],
            [_edge('e1', 'c1', 'f1'), _edge('e2', 'f1', 'out')],
        )
        strategy = MOQueryStrategy()
        assert strategy.can_handle(intent) is True

    def test_cannot_handle_without_dn(self):
        intent = self._intent(
            [_class_node('c1', 'fvTenant'), _output_node()],
            [_edge('e1', 'c1', 'out')],
        )
        strategy = MOQueryStrategy()
        assert strategy.can_handle(intent) is False

    def test_execute_full_dn(self):
        intent = self._intent(
            [
                _class_node('c1', 'fvTenant'),
                _filter_node('f1', 'name', 'eq', 'prod'),
                _output_node(),
            ],
            [_edge('e1', 'c1', 'f1'), _edge('e2', 'f1', 'out')],
        )
        strategy = MOQueryStrategy()
        url, metadata = strategy.execute(intent)
        assert '/api/mo/uni/tn-prod.json' in url
        assert metadata['strategy'] == 'MO'
        assert metadata['uses_dn'] is True
        assert metadata['is_partial_dn'] is False

    def test_execute_partial_dn(self):
        intent = self._intent(
            [
                _class_node('c1', 'fvTenant'),
                _filter_node('f1', 'name', 'eq', 'prod'),
                _class_node('c2', 'fvBD'),
                _output_node(),
            ],
            [
                _edge('e1', 'c1', 'f1'),
                _edge('e2', 'f1', 'c2'),
                _edge('e3', 'c2', 'out'),
            ],
        )
        strategy = MOQueryStrategy()
        url, metadata = strategy.execute(intent)
        assert '/api/mo/uni/tn-prod.json' in url
        assert 'target-subtree-class=fvBD' in url
        assert metadata['is_partial_dn'] is True

    def test_execute_with_scope_children(self):
        intent = self._intent(
            [
                _class_node('c1', 'fvTenant', scope='children'),
                _filter_node('f1', 'name', 'eq', 'prod'),
                _output_node(),
            ],
            [_edge('e1', 'c1', 'f1'), _edge('e2', 'f1', 'out')],
        )
        strategy = MOQueryStrategy()
        url, _ = strategy.execute(intent)
        assert 'query-target=children' in url

    def test_execute_with_property_include(self):
        intent = self._intent(
            [
                _class_node('c1', 'fvTenant', property_include='naming-only'),
                _filter_node('f1', 'name', 'eq', 'prod'),
                _output_node(),
            ],
            [_edge('e1', 'c1', 'f1'), _edge('e2', 'f1', 'out')],
        )
        strategy = MOQueryStrategy()
        url, _ = strategy.execute(intent)
        assert 'rsp-prop-include=naming-only' in url

    def test_execute_with_supplemental_data(self):
        intent = self._intent(
            [
                _class_node('c1', 'fvTenant', supplemental_data={'health': True, 'faults': True}),
                _filter_node('f1', 'name', 'eq', 'prod'),
                _output_node(),
            ],
            [_edge('e1', 'c1', 'f1'), _edge('e2', 'f1', 'out')],
        )
        strategy = MOQueryStrategy()
        url, _ = strategy.execute(intent)
        assert 'rsp-subtree-include=' in url
        assert 'health' in url
        assert 'faults' in url

    def test_execute_with_pagination(self):
        flow = _flow(
            [
                _class_node('c1', 'fvTenant'),
                _filter_node('f1', 'name', 'eq', 'prod'),
                _output_node(),
            ],
            [_edge('e1', 'c1', 'f1'), _edge('e2', 'f1', 'out')],
        )
        intent = QueryIntent(flow, enable_pagination=True, page=2, page_size=25)
        strategy = MOQueryStrategy()
        url, _ = strategy.execute(intent)
        assert 'page=2' in url
        assert 'page-size=25' in url

    def test_estimate_cost(self):
        intent = self._intent(
            [
                _class_node('c1', 'fvTenant'),
                _filter_node('f1', 'name', 'eq', 'prod'),
                _output_node(),
            ],
            [_edge('e1', 'c1', 'f1'), _edge('e2', 'f1', 'out')],
        )
        strategy = MOQueryStrategy()
        assert strategy.estimate_cost(intent) == 300

    def test_operator_expressions(self):
        """Test all operator expression builders"""
        strategy = MOQueryStrategy()
        assert (
            strategy._build_operator_expression('eq', 'fvTenant.name', 'prod')
            == 'eq(fvTenant.name,"prod")'
        )
        assert (
            strategy._build_operator_expression('ne', 'fvTenant.name', 'prod')
            == 'ne(fvTenant.name,"prod")'
        )
        assert (
            strategy._build_operator_expression('gt', 'fvTenant.name', '5')
            == 'gt(fvTenant.name,"5")'
        )
        assert (
            strategy._build_operator_expression('lt', 'fvTenant.name', '5')
            == 'lt(fvTenant.name,"5")'
        )
        assert (
            strategy._build_operator_expression('ge', 'fvTenant.name', '5')
            == 'ge(fvTenant.name,"5")'
        )
        assert (
            strategy._build_operator_expression('le', 'fvTenant.name', '5')
            == 'le(fvTenant.name,"5")'
        )

    def test_contains_operator(self):
        strategy = MOQueryStrategy()
        result = strategy._build_operator_expression('contains', 'fvTenant.name', 'prod')
        assert result == 'wcard(fvTenant.name,".*prod.*")'

    def test_wcard_operator_with_regex(self):
        strategy = MOQueryStrategy()
        result = strategy._build_operator_expression('wcard', 'fvTenant.name', '.*prod.*')
        assert result == 'wcard(fvTenant.name,".*prod.*")'

    def test_wcard_operator_without_regex(self):
        strategy = MOQueryStrategy()
        result = strategy._build_operator_expression('wcard', 'fvTenant.name', 'prod')
        assert result == 'wcard(fvTenant.name,"prod.*")'


# ======================================================================
# ClassQueryStrategy
# ======================================================================


@pytest.mark.unit
class TestClassQueryStrategy:
    def _intent(self, nodes, edges):
        return QueryIntent(_flow(nodes, edges))

    def test_can_always_handle(self):
        intent = self._intent(
            [_class_node('c1', 'fvTenant'), _output_node()],
            [_edge('e1', 'c1', 'out')],
        )
        strategy = ClassQueryStrategy()
        assert strategy.can_handle(intent) is True

    def test_simple_class_query(self):
        intent = self._intent(
            [_class_node('c1', 'fvTenant'), _output_node()],
            [_edge('e1', 'c1', 'out')],
        )
        strategy = ClassQueryStrategy()
        url, metadata = strategy.execute(intent)
        assert '/api/class/fvTenant.json' in url
        assert metadata['strategy'] == 'Class'

    def test_class_query_with_filter(self):
        intent = self._intent(
            [
                _class_node('c1', 'fvTenant'),
                _filter_node('f1', 'name', 'eq', 'prod'),
                _output_node(),
            ],
            [_edge('e1', 'c1', 'f1'), _edge('e2', 'f1', 'out')],
        )
        strategy = ClassQueryStrategy()
        url, _ = strategy.execute(intent)
        assert 'query-target-filter=' in url
        assert 'fvTenant.name' in url

    def test_multi_class_uses_root_class(self):
        """Multi-class chain should use root class as base URL"""
        intent = self._intent(
            [
                _class_node('c1', 'fvTenant'),
                _class_node('c2', 'fvBD'),
                _output_node(),
            ],
            [_edge('e1', 'c1', 'c2'), _edge('e2', 'c2', 'out')],
        )
        strategy = ClassQueryStrategy()
        url, _ = strategy.execute(intent)
        assert '/api/class/fvTenant.json' in url
        assert 'rsp-subtree-class' in url

    def test_scope_children(self):
        intent = self._intent(
            [_class_node('c1', 'fvTenant', scope='children'), _output_node()],
            [_edge('e1', 'c1', 'out')],
        )
        strategy = ClassQueryStrategy()
        url, _ = strategy.execute(intent)
        assert 'rsp-subtree=children' in url

    def test_estimate_cost_with_filter(self):
        intent = self._intent(
            [
                _class_node('c1', 'fvTenant'),
                _filter_node('f1', 'name', 'eq', 'prod'),
                _output_node(),
            ],
            [_edge('e1', 'c1', 'f1'), _edge('e2', 'f1', 'out')],
        )
        strategy = ClassQueryStrategy()
        assert strategy.estimate_cost(intent) == 1500

    def test_estimate_cost_without_filter(self):
        intent = self._intent(
            [_class_node('c1', 'fvTenant'), _output_node()],
            [_edge('e1', 'c1', 'out')],
        )
        strategy = ClassQueryStrategy()
        assert strategy.estimate_cost(intent) == 4000


# ======================================================================
# QueryExecutor — Strategy Selection
# ======================================================================


@pytest.mark.unit
class TestQueryExecutor:
    def _intent(self, nodes, edges):
        return QueryIntent(_flow(nodes, edges))

    def test_selects_mo_when_dn_available(self):
        """MO strategy should be selected when full DN can be built"""
        intent = self._intent(
            [
                _class_node('c1', 'fvTenant'),
                _filter_node('f1', 'name', 'eq', 'prod'),
                _output_node(),
            ],
            [_edge('e1', 'c1', 'f1'), _edge('e2', 'f1', 'out')],
        )
        executor = QueryExecutor()
        url, metadata = executor.execute(intent)
        assert metadata['strategy'] == 'MO'

    def test_falls_back_to_class_when_no_dn(self):
        """Class strategy should be used when no DN is available"""
        intent = self._intent(
            [_class_node('c1', 'fvTenant'), _output_node()],
            [_edge('e1', 'c1', 'out')],
        )
        executor = QueryExecutor()
        url, metadata = executor.execute(intent)
        assert metadata['strategy'] == 'Class'

    def test_selects_mo_for_partial_dn(self):
        """MO with partial DN should be preferred over Class"""
        intent = self._intent(
            [
                _class_node('c1', 'fvTenant'),
                _filter_node('f1', 'name', 'eq', 'prod'),
                _class_node('c2', 'fvBD'),
                _output_node(),
            ],
            [
                _edge('e1', 'c1', 'f1'),
                _edge('e2', 'f1', 'c2'),
                _edge('e3', 'c2', 'out'),
            ],
        )
        executor = QueryExecutor()
        url, metadata = executor.execute(intent)
        assert metadata['strategy'] == 'MO'
        assert metadata['is_partial_dn'] is True

    def test_full_dn_multi_class(self):
        """Full DN with multi-class chain — MO strategy"""
        intent = self._intent(
            [
                _class_node('c1', 'fvTenant'),
                _filter_node('f1', 'name', 'eq', 'prod'),
                _class_node('c2', 'fvBD'),
                _filter_node('f2', 'name', 'eq', 'web'),
                _output_node(),
            ],
            [
                _edge('e1', 'c1', 'f1'),
                _edge('e2', 'f1', 'c2'),
                _edge('e3', 'c2', 'f2'),
                _edge('e4', 'f2', 'out'),
            ],
        )
        executor = QueryExecutor()
        url, metadata = executor.execute(intent)
        assert metadata['strategy'] == 'MO'
        assert 'uni/tn-prod/BD-web' in metadata['dn']


# ======================================================================
# Pipeline edge skipping
# ======================================================================


@pytest.mark.unit
class TestPipelineEdgeSkipping:
    def test_pipeline_edge_skipped_in_chain_traversal(self):
        """Pipeline edges should not be followed when building class chain"""
        flow = _flow(
            [
                _class_node('c1', 'fvTenant'),
                _class_node('c2', 'fvBD'),
                _output_node(),
            ],
            [
                # Pipeline edge (not containment) between c1 and c2
                {'id': 'pe1', 'source': 'c1', 'target': 'c2', 'data': {'edgeType': 'pipeline'}},
                _edge('e2', 'c2', 'out'),
            ],
        )
        intent = QueryIntent(flow)
        # c2 should NOT have c1 as parent because the edge is a pipeline edge
        assert len(intent.class_chain) == 1
        assert intent.class_chain[0]['class_name'] == 'fvBD'
