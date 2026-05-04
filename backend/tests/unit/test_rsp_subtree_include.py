"""
Unit tests for rsp-subtree-include parameter generation
Tests Phase 2 Feature 1: Supplemental Data (Monitoring)
"""
from queries.query_optimizer import MOQueryStrategy, ClassQueryStrategy, QueryIntent


class TestRspSubtreeInclude:
    """Test rsp-subtree-include parameter generation"""

    def test_build_rsp_subtree_include_health_faults_stats(self):
        """Test basic boolean categories: health, faults, stats"""
        # Create a mock intent with supplementalData
        flow_data = {
            'nodes': [
                {
                    'id': 'node1',
                    'type': 'classNode',
                    'data': {
                        'className': 'fvTenant',
                        'scope': 'self',
                        'supplementalData': {
                            'health': True,
                            'faults': True,
                            'stats': True,
                        }
                    }
                }
            ],
            'edges': []
        }

        intent = QueryIntent(flow_data, target_node_id='node1')
        strategy = MOQueryStrategy()

        result = strategy._build_rsp_subtree_include(intent)

        assert result is not None
        assert 'health' in result
        assert 'faults' in result
        assert 'stats' in result

    def test_build_rsp_subtree_include_audit_logs(self):
        """Test audit logs - only base name, no time suffix"""
        flow_data = {
            'nodes': [
                {
                    'id': 'node1',
                    'type': 'classNode',
                    'data': {
                        'className': 'fvTenant',
                        'scope': 'self',
                        'supplementalData': {
                            'auditLogs': True,
                            'auditLogsTimeRange': '1month',
                        }
                    }
                }
            ],
            'edges': []
        }

        intent = QueryIntent(flow_data, target_node_id='node1')
        strategy = ClassQueryStrategy()

        result = strategy._build_rsp_subtree_include(intent)

        assert result is not None
        assert 'audit-logs' in result
        # APIC does not accept time suffixes like audit-logs-30d
        assert 'audit-logs-' not in result

    def test_build_rsp_subtree_include_multiple_log_categories(self):
        """Test multiple log categories - only base names, no time suffixes"""
        flow_data = {
            'nodes': [
                {
                    'id': 'node1',
                    'type': 'classNode',
                    'data': {
                        'className': 'fvTenant',
                        'scope': 'self',
                        'supplementalData': {
                            'auditLogs': True,
                            'auditLogsTimeRange': '24h',
                            'eventLogs': True,
                            'eventLogsTimeRange': '1week',
                        }
                    }
                }
            ],
            'edges': []
        }

        intent = QueryIntent(flow_data, target_node_id='node1')
        strategy = MOQueryStrategy()

        result = strategy._build_rsp_subtree_include(intent)

        assert result is not None
        assert 'audit-logs' in result
        assert 'event-logs' in result
        # APIC does not accept time suffixes
        assert 'audit-logs-' not in result
        assert 'event-logs-' not in result

    def test_build_rsp_subtree_include_deployment_records(self):
        """Test deployment-records (camelCase to kebab-case conversion)"""
        flow_data = {
            'nodes': [
                {
                    'id': 'node1',
                    'type': 'classNode',
                    'data': {
                        'className': 'fvTenant',
                        'scope': 'self',
                        'supplementalData': {
                            'deploymentRecords': True,
                        }
                    }
                }
            ],
            'edges': []
        }

        intent = QueryIntent(flow_data, target_node_id='node1')
        strategy = ClassQueryStrategy()

        result = strategy._build_rsp_subtree_include(intent)

        assert result is not None
        assert 'deployment-records' in result

    def test_build_rsp_subtree_include_empty_config(self):
        """Test with no supplementalData - should return None"""
        flow_data = {
            'nodes': [
                {
                    'id': 'node1',
                    'type': 'classNode',
                    'data': {
                        'className': 'fvTenant',
                        'scope': 'self',
                    }
                }
            ],
            'edges': []
        }

        intent = QueryIntent(flow_data, target_node_id='node1')
        strategy = MOQueryStrategy()

        result = strategy._build_rsp_subtree_include(intent)

        assert result is None

    def test_build_rsp_subtree_include_all_boolean_categories(self):
        """Test all boolean categories together"""
        flow_data = {
            'nodes': [
                {
                    'id': 'node1',
                    'type': 'classNode',
                    'data': {
                        'className': 'fvTenant',
                        'scope': 'self',
                        'supplementalData': {
                            'health': True,
                            'faults': True,
                            'stats': True,
                            'relations': True,
                            'tasks': True,
                            'deploymentRecords': True,
                            'countOnly': True,
                            'noScoped': True,
                            'required': True,
                        }
                    }
                }
            ],
            'edges': []
        }

        intent = QueryIntent(flow_data, target_node_id='node1')
        strategy = ClassQueryStrategy()

        result = strategy._build_rsp_subtree_include(intent)

        assert result is not None
        # Check all expected APIC parameter names
        assert 'health' in result
        assert 'faults' in result
        assert 'stats' in result
        assert 'relations' in result
        assert 'tasks' in result
        assert 'deployment-records' in result
        assert 'count' in result
        assert 'no-scoped' in result
        assert 'required' in result

    def test_audit_logs_without_time_range(self):
        """Test audit logs without time range - just base name"""
        flow_data = {
            'nodes': [
                {
                    'id': 'node1',
                    'type': 'classNode',
                    'data': {
                        'className': 'fvTenant',
                        'scope': 'self',
                        'supplementalData': {
                            'auditLogs': True,
                            # No auditLogsTimeRange specified
                        }
                    }
                }
            ],
            'edges': []
        }

        intent = QueryIntent(flow_data, target_node_id='node1')
        strategy = MOQueryStrategy()

        result = strategy._build_rsp_subtree_include(intent)

        assert result is not None
        assert result == 'audit-logs'
