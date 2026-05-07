"""
Unit tests for the response flattener — the helper that converts APIC
multi-class chain responses (nested children) into a flat list of
target-class objects so PostProcessor pipelines and table renderers
see a uniform shape.
"""
import pytest

from queries.services.response_flattener import (
    detect_target_class_from_url,
    flatten_to_target_class,
    maybe_flatten_response,
)


# ======================================================================
# Fixtures — the response shapes APIC actually returns for chains
# ======================================================================

def _two_level_response():
    """fvTenant → fvBD: one tenant with two BDs as direct children."""
    return {
        'totalCount': '1',
        'imdata': [
            {
                'fvTenant': {
                    'attributes': {'name': 'PROD_WEB', 'dn': 'uni/tn-PROD_WEB'},
                    'children': [
                        {'fvBD': {'attributes': {
                            'name': 'BD_WEB_FRONTEND',
                            'dn': 'uni/tn-PROD_WEB/BD-BD_WEB_FRONTEND',
                        }}},
                        {'fvBD': {'attributes': {
                            'name': 'BD_WEB_BACKEND',
                            'dn': 'uni/tn-PROD_WEB/BD-BD_WEB_BACKEND',
                        }}},
                    ],
                }
            }
        ],
    }


def _three_level_response():
    """fvTenant → fvBD → fvSubnet: the asıl bug case from the lab data."""
    return {
        'totalCount': '1',
        'imdata': [
            {
                'fvTenant': {
                    'attributes': {'name': 'PROD_WEB'},
                    'children': [
                        {
                            'fvBD': {
                                'attributes': {'name': 'BD_WEB_FRONTEND'},
                                'children': [
                                    {'fvSubnet': {'attributes': {
                                        'ip': '10.1.10.1/24',
                                        'scope': 'public',
                                    }}},
                                ],
                            }
                        },
                        {
                            'fvBD': {
                                'attributes': {'name': 'BD_WEB_BACKEND'},
                                'children': [
                                    {'fvSubnet': {'attributes': {
                                        'ip': '10.1.20.1/24',
                                        'scope': 'private',
                                    }}},
                                ],
                            }
                        },
                    ],
                }
            }
        ],
    }


# ======================================================================
# flatten_to_target_class
# ======================================================================

class TestFlattenToTargetClass:

    def test_two_level_chain_returns_direct_children(self):
        result = flatten_to_target_class(_two_level_response(), 'fvBD')
        assert result['totalCount'] == '2'
        names = [item['fvBD']['attributes']['name'] for item in result['imdata']]
        assert names == ['BD_WEB_FRONTEND', 'BD_WEB_BACKEND']

    def test_three_level_chain_returns_grandchildren(self):
        result = flatten_to_target_class(_three_level_response(), 'fvSubnet')
        assert result['totalCount'] == '2'
        ips = [item['fvSubnet']['attributes']['ip'] for item in result['imdata']]
        assert ips == ['10.1.10.1/24', '10.1.20.1/24']

    def test_target_at_root_collects_top_level_objects(self):
        """Single-class case must continue to work — flatten is a no-op
        in spirit but produces an equivalent envelope."""
        response = {
            'totalCount': '2',
            'imdata': [
                {'fvTenant': {'attributes': {'name': 'T1'}}},
                {'fvTenant': {'attributes': {'name': 'T2'}}},
            ],
        }
        result = flatten_to_target_class(response, 'fvTenant')
        assert result['totalCount'] == '2'
        assert [item['fvTenant']['attributes']['name'] for item in result['imdata']] == ['T1', 'T2']

    def test_target_class_missing_returns_empty_imdata(self):
        result = flatten_to_target_class(_two_level_response(), 'fvSubnet')
        assert result == {'totalCount': '0', 'imdata': []}

    def test_target_object_children_are_stripped(self):
        """Once we reach the target, deeper data is irrelevant."""
        response = {
            'imdata': [
                {'fvBD': {
                    'attributes': {'name': 'BD1'},
                    'children': [{'fvSubnet': {'attributes': {'ip': 'x'}}}],
                }}
            ]
        }
        result = flatten_to_target_class(response, 'fvBD')
        assert result['imdata'] == [{'fvBD': {'attributes': {'name': 'BD1'}}}]
        assert 'children' not in result['imdata'][0]['fvBD']

    def test_non_dict_input_returned_unchanged(self):
        assert flatten_to_target_class([1, 2, 3], 'fvBD') == [1, 2, 3]
        assert flatten_to_target_class(None, 'fvBD') is None
        assert flatten_to_target_class('error', 'fvBD') == 'error'

    def test_missing_imdata_returned_unchanged(self):
        envelope = {'error': 'something broke'}
        assert flatten_to_target_class(envelope, 'fvBD') is envelope

    def test_does_not_mutate_input(self):
        original = _three_level_response()
        snapshot = repr(original)
        flatten_to_target_class(original, 'fvSubnet')
        assert repr(original) == snapshot

    def test_same_class_at_multiple_depths_collected_from_all(self):
        """If the user wires a chain where the target class also exists
        as a sibling of intermediate classes, every occurrence is kept."""
        response = {
            'imdata': [
                {'fvTenant': {
                    'attributes': {'name': 'T1'},
                    'children': [
                        {'fvBD': {'attributes': {'name': 'BD-direct'}}},
                        {'fvAp': {
                            'attributes': {'name': 'AP1'},
                            'children': [
                                {'fvBD': {'attributes': {'name': 'BD-nested'}}},
                            ],
                        }},
                    ],
                }}
            ]
        }
        result = flatten_to_target_class(response, 'fvBD')
        names = sorted(item['fvBD']['attributes']['name'] for item in result['imdata'])
        assert names == ['BD-direct', 'BD-nested']


# ======================================================================
# detect_target_class_from_url
# ======================================================================

class TestDetectTargetClassFromUrl:

    def test_class_query_with_chain_returns_last_subtree_class(self):
        url = (
            '/api/class/fvTenant.json'
            '?query-target-filter=eq(fvTenant.name,"PROD_WEB")'
            '&rsp-subtree=full&rsp-subtree-class=fvBD,fvSubnet'
        )
        assert detect_target_class_from_url(url) == 'fvSubnet'

    def test_class_query_single_subtree_class(self):
        url = '/api/class/fvTenant.json?rsp-subtree=full&rsp-subtree-class=fvBD'
        assert detect_target_class_from_url(url) == 'fvBD'

    def test_mo_query_target_subtree_class(self):
        url = '/api/mo/uni/tn-PROD_WEB.json?query-target=subtree&target-subtree-class=fvSubnet'
        assert detect_target_class_from_url(url) == 'fvSubnet'

    def test_single_class_query_returns_none(self):
        """No rsp-subtree-class means no chain; PostProcessor already sees
        a flat imdata, no flattening needed."""
        url = '/api/class/fvTenant.json?query-target-filter=eq(fvTenant.name,"PROD_WEB")'
        assert detect_target_class_from_url(url) is None

    def test_url_encoded_chain_decoded_correctly(self):
        url = '/api/class/fvTenant.json?rsp-subtree-class=fvBD%2CfvSubnet'
        assert detect_target_class_from_url(url) == 'fvSubnet'

    def test_empty_or_missing_inputs_return_none(self):
        assert detect_target_class_from_url('') is None
        assert detect_target_class_from_url(None) is None
        assert detect_target_class_from_url(123) is None

    def test_malformed_url_returns_none(self):
        # No params at all
        assert detect_target_class_from_url('/api/class/fvTenant.json') is None

    def test_empty_subtree_class_value_returns_none(self):
        url = '/api/class/fvTenant.json?rsp-subtree-class='
        assert detect_target_class_from_url(url) is None


# ======================================================================
# maybe_flatten_response
# ======================================================================

class TestMaybeFlattenResponse:

    def test_flattens_when_chain_detected(self):
        url = '/api/class/fvTenant.json?rsp-subtree=full&rsp-subtree-class=fvBD,fvSubnet'
        result = maybe_flatten_response(_three_level_response(), url)
        assert result['totalCount'] == '2'
        assert all('fvSubnet' in item for item in result['imdata'])

    def test_passthrough_when_no_chain(self):
        url = '/api/class/fvTenant.json?query-target-filter=eq(fvTenant.name,"X")'
        original = _two_level_response()
        result = maybe_flatten_response(original, url)
        assert result is original  # exact passthrough

    def test_passthrough_when_response_is_not_envelope(self):
        url = '/api/class/fvTenant.json?rsp-subtree-class=fvBD'
        result = maybe_flatten_response({'error': 'auth'}, url)
        assert result == {'error': 'auth'}
