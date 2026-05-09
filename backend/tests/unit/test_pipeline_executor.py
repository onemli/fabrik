# Tests for PipelineExecutor and PipelineStage
#
# These tests cover stage parsing (connected components, topological sort),
# value extraction, field extraction from APIC items, result counting,
# and post-processor application within pipeline stages.
#
# The APIC client and DB models are mocked — we're testing the orchestration
# logic, not the network calls or persistence.

import pytest
from unittest.mock import MagicMock, patch
from queries.services.pipeline_executor import PipelineStage, PipelineExecutor


# ======================================================================
# Helpers
# ======================================================================


def _class_node(node_id, class_name, filters=None):
    """Build a minimal classNode for flow_data"""
    return {
        'id': node_id,
        'type': 'classNode',
        'data': {'className': class_name, 'filters': filters or []},
        'position': {'x': 0, 'y': 0},
    }


def _output_node(node_id):
    return {
        'id': node_id,
        'type': 'outputNode',
        'data': {},
        'position': {'x': 0, 'y': 0},
    }


def _pp_node(node_id, processor_type, config=None):
    return {
        'id': node_id,
        'type': 'postProcessorNode',
        'data': {
            'processorType': processor_type,
            'config': config or {},
        },
        'position': {'x': 0, 'y': 0},
    }


def _normal_edge(edge_id, source, target):
    return {
        'id': edge_id,
        'source': source,
        'target': target,
        'data': {},
    }


def _pipeline_edge(
    edge_id, source, target, inject_as='filter_values', extract_field='dn', inject_property=None
):
    data = {
        'edgeType': 'pipeline',
        'injectAs': inject_as,
        'extractField': extract_field,
    }
    if inject_property:
        data['injectProperty'] = inject_property
    return {
        'id': edge_id,
        'source': source,
        'target': target,
        'data': data,
    }


def _make_executor(flow_data):
    """Create a PipelineExecutor with mocked job and apic_client."""
    job = MagicMock()
    job.chain_config = {'flow_data': flow_data}
    job.total_iterations = 0
    job.completed_iterations = 0
    job.failed_iterations = 0
    job.current_stage_index = 0
    job.pipeline_stages = []
    apic_client = MagicMock()
    return PipelineExecutor(job, apic_client)


def _apic_response(class_name, items):
    return {
        'totalCount': str(len(items)),
        'imdata': [{class_name: {'attributes': attrs}} for attrs in items],
    }


# ======================================================================
# PipelineStage
# ======================================================================


@pytest.mark.unit
class TestPipelineStage:
    def test_finds_class_name(self):
        nodes = [_class_node('n1', 'fvTenant'), _output_node('n2')]
        stage = PipelineStage(index=0, nodes=nodes, edges=[])
        assert stage.class_name == 'fvTenant'

    def test_class_name_none_when_no_class_node(self):
        nodes = [_output_node('n1')]
        stage = PipelineStage(index=0, nodes=nodes, edges=[])
        assert stage.class_name is None

    def test_inject_mode_default(self):
        stage = PipelineStage(index=0, nodes=[], edges=[], inject_config={})
        assert stage.inject_mode == 'filter_values'

    def test_inject_mode_from_config(self):
        stage = PipelineStage(index=0, nodes=[], edges=[], inject_config={'injectAs': 'dn_scope'})
        assert stage.inject_mode == 'dn_scope'

    def test_extract_field_default(self):
        stage = PipelineStage(index=0, nodes=[], edges=[], inject_config={})
        assert stage.extract_field == 'dn'

    def test_extract_field_from_config(self):
        stage = PipelineStage(index=0, nodes=[], edges=[], inject_config={'extractField': 'name'})
        assert stage.extract_field == 'name'

    def test_inject_property_default_none(self):
        stage = PipelineStage(index=0, nodes=[], edges=[], inject_config={})
        assert stage.inject_property is None

    def test_inject_property_from_config(self):
        stage = PipelineStage(
            index=0, nodes=[], edges=[], inject_config={'injectProperty': 'fvTenant.name'}
        )
        assert stage.inject_property == 'fvTenant.name'


# ======================================================================
# _parse_pipeline_stages
# ======================================================================


@pytest.mark.unit
class TestParsePipelineStages:
    def test_no_pipeline_edges_single_stage(self):
        """No pipeline edges → entire canvas is one stage"""
        flow_data = {
            'nodes': [_class_node('n1', 'fvTenant'), _output_node('n2')],
            'edges': [_normal_edge('e1', 'n1', 'n2')],
        }
        executor = _make_executor(flow_data)
        stages = executor._parse_pipeline_stages()
        assert len(stages) == 1
        assert stages[0].class_name == 'fvTenant'

    def test_two_stages_with_pipeline_edge(self):
        """Two class nodes connected by a pipeline edge → two stages"""
        flow_data = {
            'nodes': [
                _class_node('n1', 'fvTenant'),
                _class_node('n2', 'fvBD'),
            ],
            'edges': [
                _pipeline_edge('pe1', 'n1', 'n2', inject_as='dn_scope'),
            ],
        }
        executor = _make_executor(flow_data)
        stages = executor._parse_pipeline_stages()
        assert len(stages) == 2
        assert stages[0].class_name == 'fvTenant'
        assert stages[1].class_name == 'fvBD'
        assert stages[1].inject_mode == 'dn_scope'

    def test_three_stages_linear(self):
        """A → B → C pipeline"""
        flow_data = {
            'nodes': [
                _class_node('n1', 'fvTenant'),
                _class_node('n2', 'fvBD'),
                _class_node('n3', 'fvSubnet'),
            ],
            'edges': [
                _pipeline_edge('pe1', 'n1', 'n2'),
                _pipeline_edge('pe2', 'n2', 'n3'),
            ],
        }
        executor = _make_executor(flow_data)
        stages = executor._parse_pipeline_stages()
        assert len(stages) == 3
        assert stages[0].class_name == 'fvTenant'
        assert stages[1].class_name == 'fvBD'
        assert stages[2].class_name == 'fvSubnet'

    def test_stage_with_internal_edges(self):
        """A stage with class + output nodes connected by normal edges"""
        flow_data = {
            'nodes': [
                _class_node('n1', 'fvTenant'),
                _output_node('out1'),
                _class_node('n2', 'fvBD'),
            ],
            'edges': [
                _normal_edge('e1', 'n1', 'out1'),
                _pipeline_edge('pe1', 'n1', 'n2'),
            ],
        }
        executor = _make_executor(flow_data)
        stages = executor._parse_pipeline_stages()
        assert len(stages) == 2
        # First stage should contain both n1 and out1 (connected by normal edge)
        stage0_node_ids = {n['id'] for n in stages[0].nodes}
        assert 'n1' in stage0_node_ids
        assert 'out1' in stage0_node_ids

    def test_stage_without_class_node_excluded(self):
        """Stages with only non-class nodes are excluded"""
        flow_data = {
            'nodes': [
                _class_node('n1', 'fvTenant'),
                _output_node('orphan'),
            ],
            'edges': [
                _pipeline_edge('pe1', 'n1', 'orphan'),
            ],
        }
        executor = _make_executor(flow_data)
        stages = executor._parse_pipeline_stages()
        # Only one stage with class node
        assert len(stages) == 1
        assert stages[0].class_name == 'fvTenant'

    def test_empty_flow_data_returns_single_empty_stage(self):
        """Empty flow_data with no pipeline edges still creates one stage (all nodes)"""
        executor = _make_executor({'nodes': [], 'edges': []})
        stages = executor._parse_pipeline_stages()
        # No pipeline edges → single stage containing all nodes (empty set)
        # But no classNode → filtered out
        assert len(stages) == 0 or all(s.class_name is None for s in stages)

    def test_single_node_no_edges(self):
        flow_data = {
            'nodes': [_class_node('n1', 'fvTenant')],
            'edges': [],
        }
        executor = _make_executor(flow_data)
        stages = executor._parse_pipeline_stages()
        assert len(stages) == 1
        assert stages[0].class_name == 'fvTenant'

    def test_inject_config_propagated_to_stage(self):
        """Pipeline edge config should be available on the target stage"""
        flow_data = {
            'nodes': [
                _class_node('n1', 'fvTenant'),
                _class_node('n2', 'fvBD'),
            ],
            'edges': [
                _pipeline_edge(
                    'pe1',
                    'n1',
                    'n2',
                    inject_as='iterate',
                    extract_field='name',
                    inject_property='fvBD.name',
                ),
            ],
        }
        executor = _make_executor(flow_data)
        stages = executor._parse_pipeline_stages()
        assert stages[1].inject_mode == 'iterate'
        assert stages[1].extract_field == 'name'
        assert stages[1].inject_property == 'fvBD.name'


# ======================================================================
# _extract_values
# ======================================================================


@pytest.mark.unit
class TestExtractValues:
    def _executor(self):
        return _make_executor({'nodes': [], 'edges': []})

    def test_extract_dn_from_apic_response(self):
        result = _apic_response(
            'fvTenant',
            [
                {'dn': 'uni/tn-prod', 'name': 'prod'},
                {'dn': 'uni/tn-dev', 'name': 'dev'},
            ],
        )
        values = self._executor()._extract_values(result, 'dn')
        assert values == ['uni/tn-prod', 'uni/tn-dev']

    def test_extract_name_from_apic_response(self):
        result = _apic_response(
            'fvTenant',
            [
                {'dn': 'uni/tn-prod', 'name': 'prod'},
                {'dn': 'uni/tn-dev', 'name': 'dev'},
            ],
        )
        values = self._executor()._extract_values(result, 'name')
        assert values == ['prod', 'dev']

    def test_extract_from_flat_list_of_strings(self):
        """Post-processed data might be a flat string list"""
        result = ['uni/tn-prod', 'uni/tn-dev']
        values = self._executor()._extract_values(result, 'dn')
        assert values == ['uni/tn-prod', 'uni/tn-dev']

    def test_extract_from_list_of_dicts(self):
        result = [{'name': 'prod'}, {'name': 'dev'}]
        values = self._executor()._extract_values(result, 'name')
        assert values == ['prod', 'dev']

    def test_deduplication_preserves_order(self):
        result = _apic_response(
            'fvTenant',
            [
                {'dn': 'uni/tn-prod', 'name': 'prod'},
                {'dn': 'uni/tn-prod', 'name': 'prod'},
                {'dn': 'uni/tn-dev', 'name': 'dev'},
            ],
        )
        values = self._executor()._extract_values(result, 'dn')
        assert values == ['uni/tn-prod', 'uni/tn-dev']

    def test_empty_imdata(self):
        result = {'totalCount': '0', 'imdata': []}
        values = self._executor()._extract_values(result, 'dn')
        assert values == []

    def test_empty_list(self):
        values = self._executor()._extract_values([], 'dn')
        assert values == []


# ======================================================================
# _extract_field_from_item
# ======================================================================


@pytest.mark.unit
class TestExtractFieldFromItem:
    def _executor(self):
        return _make_executor({'nodes': [], 'edges': []})

    def test_apic_envelope_format(self):
        item = {'fvTenant': {'attributes': {'dn': 'uni/tn-prod', 'name': 'prod'}}}
        val = self._executor()._extract_field_from_item(item, 'dn')
        assert val == 'uni/tn-prod'

    def test_flat_dict_format(self):
        item = {'dn': 'uni/tn-prod', 'name': 'prod'}
        val = self._executor()._extract_field_from_item(item, 'name')
        assert val == 'prod'

    def test_dot_notation_path(self):
        item = {'nested': {'deep': {'value': 42}}}
        val = self._executor()._extract_field_from_item(item, 'nested.deep.value')
        assert val == 42

    def test_missing_field_returns_none(self):
        item = {'fvTenant': {'attributes': {'name': 'prod'}}}
        val = self._executor()._extract_field_from_item(item, 'nonexistent')
        assert val is None

    def test_non_dict_returns_none(self):
        val = self._executor()._extract_field_from_item('string', 'field')
        assert val is None

    def test_direct_field_takes_priority(self):
        """If the field exists at root level, use it directly"""
        item = {'name': 'direct', 'fvTenant': {'attributes': {'name': 'wrapped'}}}
        val = self._executor()._extract_field_from_item(item, 'name')
        assert val == 'direct'


# ======================================================================
# _count_results
# ======================================================================


@pytest.mark.unit
class TestCountResults:
    def _executor(self):
        return _make_executor({'nodes': [], 'edges': []})

    def test_dict_with_total_count(self):
        result = {'totalCount': '5', 'imdata': []}
        assert self._executor()._count_results(result) == 5

    def test_dict_with_imdata(self):
        result = {'imdata': [1, 2, 3]}
        assert self._executor()._count_results(result) == 3

    def test_list(self):
        assert self._executor()._count_results([1, 2, 3, 4]) == 4

    def test_empty_list(self):
        assert self._executor()._count_results([]) == 0

    def test_scalar(self):
        assert self._executor()._count_results(42) == 0

    def test_none(self):
        assert self._executor()._count_results(None) == 0


# ======================================================================
# _apply_stage_postprocessors
# ======================================================================


@pytest.mark.unit
class TestApplyStagePostprocessors:
    def _executor(self):
        return _make_executor({'nodes': [], 'edges': []})

    def test_no_pp_nodes_returns_unchanged(self):
        stage = PipelineStage(
            index=0,
            nodes=[_class_node('n1', 'fvTenant')],
            edges=[],
        )
        result = _apic_response('fvTenant', [{'dn': 'uni/tn-prod', 'name': 'prod'}])
        output = self._executor()._apply_stage_postprocessors(stage, result)
        assert output == result

    def test_pp_node_applied(self):
        stage = PipelineStage(
            index=0,
            nodes=[
                _class_node('n1', 'fvTenant'),
                _pp_node('pp1', 'dn-extract', {'extractField': 'name'}),
            ],
            edges=[],
        )
        result = _apic_response(
            'fvTenant',
            [
                {'dn': 'uni/tn-prod', 'name': 'prod'},
                {'dn': 'uni/tn-dev', 'name': 'dev'},
            ],
        )
        output = self._executor()._apply_stage_postprocessors(stage, result)
        assert output == ['prod', 'dev']

    def test_paused_pp_node_skipped(self):
        stage = PipelineStage(
            index=0,
            nodes=[
                _class_node('n1', 'fvTenant'),
                _pp_node('pp1', 'dn-extract', {'extractField': 'name'}),
            ],
            edges=[],
        )
        # Mark the PP node as paused
        stage.nodes[1]['data']['isPaused'] = True

        result = _apic_response('fvTenant', [{'dn': 'uni/tn-prod', 'name': 'prod'}])
        output = self._executor()._apply_stage_postprocessors(stage, result)
        # Should return unchanged since PP is paused
        assert output == result

    def test_pp_failure_returns_original(self):
        """If a post-processor raises, return the original result"""
        stage = PipelineStage(
            index=0,
            nodes=[
                _class_node('n1', 'fvTenant'),
                _pp_node('pp1', 'field-extract', {'fields': []}),  # will raise
            ],
            edges=[],
        )
        result = [{'a': 1}]
        output = self._executor()._apply_stage_postprocessors(stage, result)
        assert output == [{'a': 1}]


# ======================================================================
# _inject_value_into_nodes
# ======================================================================


@pytest.mark.unit
class TestInjectValueIntoNodes:
    def _executor(self):
        return _make_executor({'nodes': [], 'edges': []})

    def test_adds_synthetic_filter_node(self):
        nodes = [_class_node('n1', 'fvTenant')]
        stage = PipelineStage(index=0, nodes=nodes, edges=[])
        modified = self._executor()._inject_value_into_nodes(nodes, 'uni/tn-prod', stage)
        assert len(modified) == 2
        synth = modified[1]
        assert synth['type'] == 'filterNode'
        assert synth['data']['value'] == 'uni/tn-prod'
        assert synth['data']['operator'] == 'eq'

    def test_uses_inject_property(self):
        nodes = [_class_node('n1', 'fvTenant')]
        stage = PipelineStage(
            index=0, nodes=nodes, edges=[], inject_config={'injectProperty': 'name'}
        )
        modified = self._executor()._inject_value_into_nodes(nodes, 'prod', stage)
        assert modified[1]['data']['property'] == 'name'

    def test_default_inject_property_is_dn(self):
        nodes = [_class_node('n1', 'fvTenant')]
        stage = PipelineStage(index=0, nodes=nodes, edges=[])
        modified = self._executor()._inject_value_into_nodes(nodes, 'uni/tn-prod', stage)
        assert modified[1]['data']['property'] == 'dn'

    def test_does_not_mutate_original_nodes(self):
        nodes = [_class_node('n1', 'fvTenant')]
        stage = PipelineStage(index=0, nodes=nodes, edges=[])
        self._executor()._inject_value_into_nodes(nodes, 'val', stage)
        assert len(nodes) == 1  # original unchanged

    def test_no_class_node_returns_unchanged(self):
        nodes = [_output_node('n1')]
        stage = PipelineStage(index=0, nodes=nodes, edges=[])
        modified = self._executor()._inject_value_into_nodes(nodes, 'val', stage)
        # No class node found → just returns modified copy without adding filter
        assert len(modified) == 1


# ======================================================================
# execute() integration (mocked APIC)
# ======================================================================


@pytest.mark.unit
class TestPipelineExecuteIntegration:
    @patch('queries.services.pipeline_executor.ChainIterationResult')
    @patch('channels.layers.get_channel_layer', return_value=None)
    def test_single_stage_execution(self, mock_channel, mock_iter_result):
        """Single-stage pipeline (no pipeline edges) should run the query"""
        flow_data = {
            'nodes': [_class_node('n1', 'fvTenant')],
            'edges': [],
        }
        executor = _make_executor(flow_data)
        apic_result = _apic_response(
            'fvTenant',
            [
                {'dn': 'uni/tn-prod', 'name': 'prod'},
            ],
        )
        executor.apic_client.execute_query.return_value = (True, apic_result, None)

        with (
            patch('queries.services.optimizer.QueryIntent'),
            patch('queries.services.optimizer.QueryExecutor') as mock_executor_cls,
        ):
            mock_qe = MagicMock()
            mock_qe.execute.return_value = ('/api/class/fvTenant.json', {})
            mock_executor_cls.return_value = mock_qe

            result = executor.execute()

        assert result['total_stages'] == 1
        assert result['completed_stages'] == 1
        assert result['failed_stages'] == 0
        assert result['final_result'] is not None

    @patch('queries.services.pipeline_executor.ChainIterationResult')
    @patch('channels.layers.get_channel_layer', return_value=None)
    def test_stage_failure_stops_pipeline(self, mock_channel, mock_iter_result):
        """When a stage fails, the pipeline should stop and record the error"""
        flow_data = {
            'nodes': [_class_node('n1', 'fvTenant')],
            'edges': [],
        }
        executor = _make_executor(flow_data)
        executor.apic_client.execute_query.return_value = (False, None, 'Connection refused')

        with (
            patch('queries.services.optimizer.QueryIntent'),
            patch('queries.services.optimizer.QueryExecutor') as mock_executor_cls,
        ):
            mock_qe = MagicMock()
            mock_qe.execute.return_value = ('/api/class/fvTenant.json', {})
            mock_executor_cls.return_value = mock_qe

            result = executor.execute()

        assert result['failed_stages'] == 1
        assert result['stages'][0]['status'] == 'failed'
        assert 'Connection refused' in result['stages'][0]['error']

    @patch('queries.services.pipeline_executor.ChainIterationResult')
    @patch('channels.layers.get_channel_layer', return_value=None)
    def test_max_stages_exceeded_raises(self, mock_channel, mock_iter_result):
        """Pipeline with too many stages should raise"""
        nodes = [_class_node(f'n{i}', f'class{i}') for i in range(11)]
        edges = [_pipeline_edge(f'pe{i}', f'n{i}', f'n{i + 1}') for i in range(10)]
        executor = _make_executor({'nodes': nodes, 'edges': edges})
        with pytest.raises(ValueError, match='exceeds maximum'):
            executor.execute()

    @patch('queries.services.pipeline_executor.ChainIterationResult')
    @patch('channels.layers.get_channel_layer', return_value=None)
    def test_empty_pipeline_stage_fails(self, mock_channel, mock_iter_result):
        """Empty flow_data produces a stage that fails at execution"""
        executor = _make_executor({'nodes': [], 'edges': []})
        # Empty nodes with no pipeline edges → single stage with no classNode
        # The stage fails when QueryIntent can't find a ClassNode
        result = executor.execute()
        assert result['failed_stages'] == 1
        assert result['stages'][0]['status'] == 'failed'
