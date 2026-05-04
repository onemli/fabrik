"""
Unit tests for Query Versioning utilities
Tests hash generation, change detection, and version incrementing
"""
import pytest
from queries.services.versioning import (
    normalize_flow_data,
    generate_query_version_hash,
    categorize_nodes,
    detect_version_change_type,
    increment_version,
    create_version_history_entry,
    format_version,
)


# ======================================================================
# normalize_flow_data
# ======================================================================

@pytest.mark.unit
class TestNormalizeFlowData:

    def test_empty_flow_data(self):
        result = normalize_flow_data({})
        assert result == {}

    def test_none_flow_data(self):
        result = normalize_flow_data(None)
        assert result == {}

    def test_normalizes_class_node(self):
        flow_data = {
            'nodes': [{
                'id': 'n1',
                'type': 'classNode',
                'position': {'x': 100, 'y': 200},  # should be stripped
                'data': {
                    'className': 'fvTenant',
                    'scope': 'self',
                    'queryTarget': 'self',
                    'label': 'Tenant',  # irrelevant
                }
            }],
            'edges': []
        }
        result = normalize_flow_data(flow_data)
        node = result['nodes'][0]
        assert node['className'] == 'fvTenant'
        assert node['scope'] == 'self'
        assert node['queryTarget'] == 'self'
        assert 'position' not in node
        assert 'label' not in node

    def test_normalizes_edges_to_source_target_only(self):
        flow_data = {
            'nodes': [],
            'edges': [{
                'id': 'e1',
                'source': 'n1',
                'target': 'n2',
                'label': 'contains',  # should be stripped
                'animated': True,
            }]
        }
        result = normalize_flow_data(flow_data)
        edge = result['edges'][0]
        assert edge == {'source': 'n1', 'target': 'n2'}

    def test_filter_node_keeps_filters(self):
        flow_data = {
            'nodes': [{
                'id': 'f1',
                'type': 'filterNode',
                'data': {'filters': [{'field': 'name', 'op': 'eq', 'value': 'prod'}]}
            }],
            'edges': []
        }
        result = normalize_flow_data(flow_data)
        node = result['nodes'][0]
        assert node['filters'] == [{'field': 'name', 'op': 'eq', 'value': 'prod'}]

    def test_output_node_has_no_semantic_data(self):
        flow_data = {
            'nodes': [{
                'id': 'out1',
                'type': 'outputNode',
                'data': {'label': 'Output', 'columns': ['name', 'dn']}
            }],
            'edges': []
        }
        result = normalize_flow_data(flow_data)
        node = result['nodes'][0]
        assert node['type'] == 'outputNode'
        assert node['id'] == 'out1'
        assert 'columns' not in node


# ======================================================================
# generate_query_version_hash
# ======================================================================

@pytest.mark.unit
class TestGenerateQueryVersionHash:

    def test_returns_8_char_hex(self):
        flow_data = {'nodes': [], 'edges': []}
        result = generate_query_version_hash(flow_data)
        assert isinstance(result, str)
        assert len(result) == 8
        # All hex characters
        int(result, 16)

    def test_deterministic_same_input(self):
        flow_data = {
            'nodes': [{'id': '1', 'type': 'classNode', 'data': {'className': 'fvTenant'}}],
            'edges': []
        }
        h1 = generate_query_version_hash(flow_data)
        h2 = generate_query_version_hash(flow_data)
        assert h1 == h2

    def test_different_class_different_hash(self):
        fd1 = {'nodes': [{'id': '1', 'type': 'classNode', 'data': {'className': 'fvTenant'}}], 'edges': []}
        fd2 = {'nodes': [{'id': '1', 'type': 'classNode', 'data': {'className': 'fvBD'}}], 'edges': []}
        assert generate_query_version_hash(fd1) != generate_query_version_hash(fd2)

    def test_position_change_does_not_change_hash(self):
        """Changing position should not affect hash (semantic equality)"""
        fd1 = {
            'nodes': [{'id': '1', 'type': 'classNode', 'position': {'x': 0, 'y': 0}, 'data': {'className': 'fvTenant'}}],
            'edges': []
        }
        fd2 = {
            'nodes': [{'id': '1', 'type': 'classNode', 'position': {'x': 999, 'y': 999}, 'data': {'className': 'fvTenant'}}],
            'edges': []
        }
        # Hashes should be equal since position is stripped
        assert generate_query_version_hash(fd1) == generate_query_version_hash(fd2)

    def test_empty_flow_data_returns_hash(self):
        result = generate_query_version_hash({})
        assert len(result) == 8


# ======================================================================
# categorize_nodes
# ======================================================================

@pytest.mark.unit
class TestCategorizeNodes:

    def test_empty_nodes(self):
        result = categorize_nodes({'nodes': [], 'edges': []})
        assert result['structural_nodes'] == []
        assert result['filter_nodes'] == []
        assert result['processor_nodes'] == []

    def test_categorizes_class_nodes_as_structural(self):
        flow_data = {
            'nodes': [
                {'id': '1', 'type': 'classNode', 'data': {}},
                {'id': '2', 'type': 'classNode', 'data': {}},
            ],
            'edges': []
        }
        result = categorize_nodes(flow_data)
        assert len(result['structural_nodes']) == 2
        assert len(result['filter_nodes']) == 0

    def test_categorizes_filter_nodes(self):
        flow_data = {
            'nodes': [
                {'id': '1', 'type': 'filterNode', 'data': {}},
            ],
            'edges': []
        }
        result = categorize_nodes(flow_data)
        assert len(result['filter_nodes']) == 1
        assert len(result['structural_nodes']) == 0

    def test_categorizes_post_processor_nodes(self):
        flow_data = {
            'nodes': [
                {'id': '1', 'type': 'postProcessorNode', 'data': {}},
            ],
            'edges': []
        }
        result = categorize_nodes(flow_data)
        assert len(result['processor_nodes']) == 1

    def test_mixed_nodes(self):
        flow_data = {
            'nodes': [
                {'id': '1', 'type': 'classNode', 'data': {}},
                {'id': '2', 'type': 'filterNode', 'data': {}},
                {'id': '3', 'type': 'postProcessorNode', 'data': {}},
                {'id': '4', 'type': 'outputNode', 'data': {}},
            ],
            'edges': []
        }
        result = categorize_nodes(flow_data)
        assert len(result['structural_nodes']) == 1
        assert len(result['filter_nodes']) == 1
        assert len(result['processor_nodes']) == 1


# ======================================================================
# detect_version_change_type
# ======================================================================

@pytest.mark.unit
class TestDetectVersionChangeType:

    def _class_node(self, node_id, class_name='fvTenant'):
        return {
            'id': node_id,
            'type': 'classNode',
            'data': {'className': class_name, 'scope': 'self', 'queryTarget': 'self'}
        }

    def _filter_node(self, node_id, filters=None):
        return {
            'id': node_id,
            'type': 'filterNode',
            'data': {'filters': filters or []}
        }

    def _processor_node(self, node_id, processors=None):
        return {
            'id': node_id,
            'type': 'postProcessorNode',
            'data': {'processors': processors or []}
        }

    def test_no_old_flow_data_returns_none(self):
        new_flow = {'nodes': [self._class_node('1')], 'edges': []}
        change_type, changes = detect_version_change_type(None, new_flow)
        assert change_type == 'none'

    def test_no_changes_returns_none(self):
        flow = {'nodes': [self._class_node('1')], 'edges': []}
        change_type, changes = detect_version_change_type(flow, flow)
        assert change_type == 'none'

    def test_adding_class_node_is_major(self):
        old_flow = {'nodes': [self._class_node('1')], 'edges': []}
        new_flow = {
            'nodes': [self._class_node('1'), self._class_node('2', 'fvBD')],
            'edges': []
        }
        change_type, changes = detect_version_change_type(old_flow, new_flow)
        assert change_type == 'major'
        assert any('Added' in c for c in changes)

    def test_removing_class_node_is_major(self):
        old_flow = {
            'nodes': [self._class_node('1'), self._class_node('2', 'fvBD')],
            'edges': []
        }
        new_flow = {'nodes': [self._class_node('1')], 'edges': []}
        change_type, changes = detect_version_change_type(old_flow, new_flow)
        assert change_type == 'major'
        assert any('Removed' in c for c in changes)

    def test_adding_edge_is_major(self):
        old_flow = {
            'nodes': [self._class_node('1'), self._class_node('2', 'fvBD')],
            'edges': []
        }
        new_flow = {
            'nodes': [self._class_node('1'), self._class_node('2', 'fvBD')],
            'edges': [{'source': '1', 'target': '2'}]
        }
        change_type, changes = detect_version_change_type(old_flow, new_flow)
        assert change_type == 'major'

    def test_adding_filter_node_is_minor(self):
        old_flow = {'nodes': [self._class_node('1')], 'edges': []}
        new_flow = {
            'nodes': [self._class_node('1'), self._filter_node('f1')],
            'edges': []
        }
        change_type, changes = detect_version_change_type(old_flow, new_flow)
        assert change_type == 'minor'

    def test_changing_filter_content_is_minor(self):
        old_flow = {
            'nodes': [
                self._class_node('1'),
                self._filter_node('f1', [{'field': 'name', 'op': 'eq', 'value': 'prod'}])
            ],
            'edges': []
        }
        new_flow = {
            'nodes': [
                self._class_node('1'),
                self._filter_node('f1', [{'field': 'name', 'op': 'eq', 'value': 'staging'}])
            ],
            'edges': []
        }
        change_type, changes = detect_version_change_type(old_flow, new_flow)
        assert change_type == 'minor'

    def test_adding_processor_node_is_minor(self):
        old_flow = {'nodes': [self._class_node('1')], 'edges': []}
        new_flow = {
            'nodes': [self._class_node('1'), self._processor_node('p1')],
            'edges': []
        }
        change_type, changes = detect_version_change_type(old_flow, new_flow)
        assert change_type == 'minor'

    def test_major_overrides_minor(self):
        """When both structural and filter changes exist, major wins"""
        old_flow = {
            'nodes': [self._class_node('1'), self._filter_node('f1', [])],
            'edges': []
        }
        new_flow = {
            'nodes': [
                self._class_node('1'),
                self._class_node('2', 'fvBD'),  # major change
                self._filter_node('f1', [{'field': 'name', 'op': 'eq', 'value': 'x'}])  # minor change
            ],
            'edges': []
        }
        change_type, _ = detect_version_change_type(old_flow, new_flow)
        assert change_type == 'major'


# ======================================================================
# increment_version
# ======================================================================

@pytest.mark.unit
class TestIncrementVersion:

    def test_major_change_bumps_major_resets_minor(self):
        new_major, new_minor = increment_version(1, 3, 'major')
        assert new_major == 2
        assert new_minor == 0

    def test_minor_change_keeps_major_bumps_minor(self):
        new_major, new_minor = increment_version(2, 1, 'minor')
        assert new_major == 2
        assert new_minor == 2

    def test_no_change_returns_same(self):
        new_major, new_minor = increment_version(3, 5, 'none')
        assert new_major == 3
        assert new_minor == 5


# ======================================================================
# create_version_history_entry
# ======================================================================

@pytest.mark.unit
class TestCreateVersionHistoryEntry:

    def test_creates_entry_with_required_fields(self):
        entry = create_version_history_entry(
            version='v2.1',
            version_hash='abc12345',
            changes=['Added tenant node']
        )
        assert entry['version'] == 'v2.1'
        assert entry['hash'] == 'abc12345'
        assert entry['changes'] == ['Added tenant node']
        assert 'created_at' in entry

    def test_includes_user_info_when_provided(self):
        entry = create_version_history_entry(
            version='v1.0',
            version_hash='deadbeef',
            changes=['Initial'],
            user_id=42,
            username='alice'
        )
        assert entry['created_by_id'] == 42
        assert entry['created_by_username'] == 'alice'

    def test_user_info_defaults_to_none(self):
        entry = create_version_history_entry(
            version='v1.0',
            version_hash='deadbeef',
            changes=['Initial']
        )
        assert entry['created_by_id'] is None
        assert entry['created_by_username'] is None


# ======================================================================
# format_version
# ======================================================================

@pytest.mark.unit
class TestFormatVersion:

    def test_formats_v1_0(self):
        assert format_version(1, 0) == 'v1.0'

    def test_formats_v2_3(self):
        assert format_version(2, 3) == 'v2.3'

    def test_formats_v10_0(self):
        assert format_version(10, 0) == 'v10.0'
