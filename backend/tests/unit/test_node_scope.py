# Tests for node scope: running a class query on chosen switches.
#
# Classes that live on the switches (bgpPeerEntry, ...) answer with their
# node-local DN, so only the URL can pick a node:
#   /api/node/class/topology/pod-1/node-101/bgpPeerEntry.json
# Several nodes are one path with a {..} group that the APIC client sends once
# per node and merges. Covered here: reading the field, the optimizer (field and
# a node named higher in the chain), the client's fan-out, and page ordering.

import pytest
import responses
from urllib.parse import unquote

from apic_connections.apic_client import APICClient
from queries.services.node_scope import (
    MAX_NODES,
    NodeScopeError,
    expand_node_paths,
    node_of_path,
    node_path_prefix,
    parse_node_scope,
)
from queries.services.optimizer import (
    ClassQueryStrategy,
    MOQueryStrategy,
    QueryExecutor,
    QueryIntent,
)
from queries.services.query_runner import order_class

APIC = 'https://apic.example.com'


def _class_node(node_id, class_name, node_scope=None):
    data = {'className': class_name, 'scope': 'self', 'propertyInclude': 'all'}
    if node_scope is not None:
        data['nodeScope'] = node_scope
    return {'id': node_id, 'type': 'classNode', 'position': {'x': 0, 'y': 0}, 'data': data}


def _filter_node(node_id, prop, operator, value):
    return {
        'id': node_id,
        'type': 'filterNode',
        'position': {'x': 0, 'y': 0},
        'data': {'filterType': 'property', 'property': prop, 'operator': operator, 'value': value},
    }


def _output_node():
    return {'id': 'out', 'type': 'outputNode', 'position': {'x': 0, 'y': 0}, 'data': {}}


def _chain(*items):
    """A canvas from (class_node, [filter_nodes]) pairs, root first, ending in the output."""
    nodes, edges = [], []
    previous = None
    for class_node, filters in items:
        nodes.append(class_node)
        if previous:
            edges.append(
                {
                    'id': f'{previous}-{class_node["id"]}',
                    'source': previous,
                    'target': class_node['id'],
                    'data': {},
                }
            )
        previous = class_node['id']
        for filter_node in filters:
            nodes.append(filter_node)
            edges.append(
                {
                    'id': f'{previous}-{filter_node["id"]}',
                    'source': previous,
                    'target': filter_node['id'],
                    'data': {},
                }
            )
            previous = filter_node['id']
    nodes.append(_output_node())
    edges.append({'id': f'{previous}-out', 'source': previous, 'target': 'out', 'data': {}})
    return {'nodes': nodes, 'edges': edges}


def _url(flow):
    url, metadata = QueryExecutor().execute(QueryIntent(flow))
    return unquote(url), metadata


def _peer(dn):
    return {'bgpPeerEntry': {'attributes': {'dn': dn, 'operSt': 'established'}}}


# ======================================================================
# Reading the field
# ======================================================================


@pytest.mark.unit
class TestParseNodeScope:
    def test_empty_means_the_whole_fabric(self):
        assert parse_node_scope(None) is None
        assert parse_node_scope('') is None
        assert parse_node_scope('  , ') is None

    def test_node_ids_are_in_pod_1(self):
        assert parse_node_scope('101, 102') == [(1, 101), (1, 102)]

    def test_pod_and_node(self):
        assert parse_node_scope('2/201 101') == [(2, 201), (1, 101)]

    def test_repeats_are_dropped_in_order(self):
        assert parse_node_scope('102,101,102, 1/101') == [(1, 102), (1, 101)]

    @pytest.mark.parametrize('text', ['node-101', '101a', '1/2/3', '/101', '-1', 'all'])
    def test_anything_else_is_an_error_naming_it(self, text):
        with pytest.raises(NodeScopeError, match='is not a node'):
            parse_node_scope(f'101, {text}')

    def test_not_text_is_an_error(self):
        with pytest.raises(NodeScopeError):
            parse_node_scope(101)

    def test_too_many_nodes(self):
        text = ','.join(str(n) for n in range(1, MAX_NODES + 2))
        with pytest.raises(NodeScopeError, match='at most'):
            parse_node_scope(text)

    def test_node_scope_error_is_a_value_error(self):
        # Callers that catch ValueError keep working
        assert issubclass(NodeScopeError, ValueError)


@pytest.mark.unit
class TestPaths:
    def test_one_node(self):
        assert node_path_prefix([(1, 101)]) == 'topology/pod-1/node-101'

    def test_several_nodes_are_one_group(self):
        assert node_path_prefix([(1, 101), (2, 201)]) == 'topology/{pod-1/node-101,pod-2/node-201}'

    def test_group_expands_to_one_path_per_node_with_the_query_kept(self):
        path = (
            '/api/node/class/topology/{pod-1/node-101,pod-2/node-201}/bgpPeerEntry.json'
            '?query-target-filter=eq(bgpPeerEntry.operSt,"established")&page=0&page-size=50'
        )
        assert expand_node_paths(path) == [
            '/api/node/class/topology/pod-1/node-101/bgpPeerEntry.json'
            '?query-target-filter=eq(bgpPeerEntry.operSt,"established")&page=0&page-size=50',
            '/api/node/class/topology/pod-2/node-201/bgpPeerEntry.json'
            '?query-target-filter=eq(bgpPeerEntry.operSt,"established")&page=0&page-size=50',
        ]

    @pytest.mark.parametrize(
        'path',
        [
            '/api/class/fvTenant.json',
            '/api/node/class/topology/pod-1/node-101/bgpPeerEntry.json',
            '/api/mo/uni/tn-{x}.json',
            '/api/node/class/topology/{pod-1/node-101,uni}/bgpPeerEntry.json',
        ],
    )
    def test_other_paths_are_left_alone(self, path):
        assert expand_node_paths(path) == [path]

    def test_node_of_path(self):
        assert (
            node_of_path('/api/node/class/topology/pod-2/node-201/bgpPeerEntry.json')
            == 'pod-2/node-201'
        )


# ======================================================================
# The optimizer: Node scope field
# ======================================================================


@pytest.mark.unit
class TestNodeScopeField:
    def test_no_scope_is_unchanged(self):
        url, _ = _url(_chain((_class_node('c1', 'bgpPeerEntry'), [])))
        assert url == '/api/class/bgpPeerEntry.json'

    def test_one_node(self):
        url, metadata = _url(_chain((_class_node('c1', 'bgpPeerEntry', '101'), [])))
        assert url == '/api/node/class/topology/pod-1/node-101/bgpPeerEntry.json'
        assert metadata['strategy'] == 'Class'
        assert metadata['node_scope'] == [{'pod': 1, 'node': 101}]

    def test_several_nodes_keep_the_filter(self):
        flow = _chain(
            (
                _class_node('c1', 'bgpPeerEntry', '101, 2/201'),
                [_filter_node('f1', 'operSt', 'ne', 'established')],
            )
        )
        url, _ = _url(flow)
        assert url == (
            '/api/node/class/topology/{pod-1/node-101,pod-2/node-201}/bgpPeerEntry.json'
            '?query-target-filter=ne(bgpPeerEntry.operSt,"established")'
        )

    def test_mo_is_not_used_with_a_scope(self):
        intent = QueryIntent(_chain((_class_node('c1', 'bgpPeerEntry', '101'), [])))
        assert MOQueryStrategy().can_handle(intent) is False
        url, _ = QueryExecutor().execute(intent, force_strategy='MO')
        assert unquote(url).startswith('/api/node/class/topology/pod-1/node-101/')

    def test_a_chain_is_asked_from_its_root_on_the_nodes(self):
        flow = _chain(
            (_class_node('c1', 'bgpDom', '101'), [_filter_node('f1', 'name', 'eq', 'tn:vrf')]),
            (_class_node('c2', 'bgpPeer'), []),
        )
        url, _ = _url(flow)
        assert url.startswith('/api/node/class/topology/pod-1/node-101/bgpDom.json?')
        assert 'rsp-subtree-class=bgpPeer' in url
        assert 'query-target-filter=eq(bgpDom.name,"tn:vrf")' in url

    def test_a_bad_field_is_an_error(self):
        with pytest.raises(NodeScopeError, match='"leaf1" is not a node'):
            QueryIntent(_chain((_class_node('c1', 'bgpPeerEntry', 'leaf1'), [])))

    def test_a_scope_on_a_later_class_is_an_error(self):
        flow = _chain(
            (_class_node('c1', 'bgpDom'), []),
            (_class_node('c2', 'bgpPeer', '101'), []),
        )
        with pytest.raises(NodeScopeError, match='first class of the chain; clear it on bgpPeer'):
            QueryIntent(flow)

    def test_an_empty_field_on_a_later_class_is_fine(self):
        flow = _chain(
            (_class_node('c1', 'bgpDom'), []),
            (_class_node('c2', 'bgpPeer', ''), []),
        )
        assert QueryIntent(flow).node_scope is None


# ======================================================================
# The optimizer: a node named higher in the chain
# ======================================================================


def _bgp_below(*top):
    """top (class nodes with filters) > topSystem's BGP tree down to bgpPeerEntry."""
    return _chain(
        *top,
        (_class_node('b1', 'bgpEntity'), []),
        (_class_node('b2', 'bgpInst'), []),
        (_class_node('b3', 'bgpDom'), []),
        (_class_node('b4', 'bgpPeer'), []),
        (_class_node('b5', 'bgpPeerEntry'), [_filter_node('fb', 'operSt', 'eq', 'established')]),
    )


@pytest.mark.unit
class TestNodeFromChain:
    def test_fabric_node_id_names_the_node(self):
        flow = _bgp_below(
            (_class_node('n', 'fabricNode'), [_filter_node('fn', 'id', 'eq', '101')]),
            (_class_node('s', 'topSystem'), []),
        )
        intent = QueryIntent(flow)
        assert intent.node_scope == [(1, 101)]
        assert [item['class_name'] for item in intent.class_chain] == [
            'bgpEntity',
            'bgpInst',
            'bgpDom',
            'bgpPeer',
            'bgpPeerEntry',
        ]
        url, _ = _url(flow)
        assert url.startswith('/api/node/class/topology/pod-1/node-101/bgpEntity.json?')
        assert 'rsp-subtree-class=bgpInst,bgpDom,bgpPeer,bgpPeerEntry' in url
        assert 'rsp-subtree-filter=eq(bgpPeerEntry.operSt,"established")' in url

    def test_pod_and_node_from_pod_and_node(self):
        flow = _bgp_below(
            (_class_node('p', 'fabricPod'), [_filter_node('fp', 'id', 'eq', '2')]),
            (_class_node('n', 'fabricNode'), [_filter_node('fn', 'id', 'eq', '201')]),
            (_class_node('s', 'topSystem'), []),
        )
        assert QueryIntent(flow).node_scope == [(2, 201)]

    def test_top_system_id_and_pod_id(self):
        flow = _bgp_below(
            (
                _class_node('s', 'topSystem'),
                [_filter_node('fs', 'id', 'eq', '102'), _filter_node('fq', 'podId', 'eq', '3')],
            ),
        )
        assert QueryIntent(flow).node_scope == [(3, 102)]

    def test_target_right_under_top_system(self):
        flow = _chain(
            (_class_node('s', 'topSystem'), [_filter_node('fs', 'id', 'eq', '101')]),
            (_class_node('b', 'bgpEntity'), []),
        )
        url, _ = _url(flow)
        assert url == '/api/node/class/topology/pod-1/node-101/bgpEntity.json'

    def test_top_system_as_target_is_unchanged(self):
        flow = _chain(
            (_class_node('n', 'fabricNode'), [_filter_node('fn', 'id', 'eq', '101')]),
            (_class_node('s', 'topSystem'), []),
        )
        intent = QueryIntent(flow)
        assert intent.node_scope is None
        assert len(intent.class_chain) == 2

    def test_no_node_id_is_unchanged(self):
        flow = _bgp_below(
            (_class_node('s', 'topSystem'), [_filter_node('fs', 'role', 'eq', 'leaf')]),
        )
        intent = QueryIntent(flow)
        assert intent.node_scope is None
        assert intent.class_chain[0]['class_name'] == 'topSystem'

    def test_other_filters_beside_the_node_are_an_error(self):
        flow = _bgp_below(
            (
                _class_node('s', 'topSystem'),
                [_filter_node('fs', 'id', 'eq', '101'), _filter_node('fr', 'role', 'eq', 'leaf')],
            ),
        )
        with pytest.raises(NodeScopeError, match='topSystem.role'):
            QueryIntent(flow)

    def test_a_wildcard_node_id_is_an_error(self):
        flow = _bgp_below(
            (
                _class_node('s', 'topSystem'),
                [_filter_node('fs', 'id', 'eq', '101'), _filter_node('fw', 'id', 'wcard', '10')],
            ),
        )
        with pytest.raises(NodeScopeError, match='topSystem.id'):
            QueryIntent(flow)

    def test_two_different_nodes_are_an_error(self):
        flow = _bgp_below(
            (_class_node('n', 'fabricNode'), [_filter_node('fn', 'id', 'eq', '101')]),
            (_class_node('s', 'topSystem'), [_filter_node('fs', 'id', 'eq', '102')]),
        )
        with pytest.raises(NodeScopeError, match='more than one node'):
            QueryIntent(flow)

    def test_the_same_node_twice_is_fine(self):
        flow = _bgp_below(
            (_class_node('n', 'fabricNode'), [_filter_node('fn', 'id', 'eq', '101')]),
            (_class_node('s', 'topSystem'), [_filter_node('fs', 'id', 'eq', '101')]),
        )
        assert QueryIntent(flow).node_scope == [(1, 101)]

    def test_field_and_chain_together_are_an_error(self):
        flow = _bgp_below(
            (_class_node('s', 'topSystem', '102'), [_filter_node('fs', 'id', 'eq', '101')]),
        )
        with pytest.raises(NodeScopeError, match='given twice'):
            QueryIntent(flow)

    def test_uni_chains_are_untouched(self):
        flow = _chain(
            (_class_node('t', 'fvTenant'), [_filter_node('ft', 'name', 'eq', 'Prod')]),
            (_class_node('b', 'fvBD'), []),
        )
        intent = QueryIntent(flow)
        assert intent.node_scope is None
        url, metadata = QueryExecutor().execute(intent)
        assert metadata['strategy'] == 'MO'
        assert url.startswith('/api/mo/uni/tn-Prod.json')


# ======================================================================
# The APIC client: one request per node, merged
# ======================================================================


def _login():
    responses.add(
        responses.POST,
        f'{APIC}/api/aaaLogin.json',
        json={'imdata': [{'aaaLogin': {'attributes': {'token': 't'}}}]},
        status=200,
        headers={'Set-Cookie': 'APIC-cookie=t'},
    )


def _client():
    return APICClient(url=APIC, username='admin', password='pw')


GROUP = '/api/node/class/topology/{pod-1/node-101,pod-1/node-102}/bgpPeerEntry.json'
NODE_101 = f'{APIC}/api/node/class/topology/pod-1/node-101/bgpPeerEntry.json'
NODE_102 = f'{APIC}/api/node/class/topology/pod-1/node-102/bgpPeerEntry.json'


@pytest.mark.unit
class TestClientFanOut:
    @responses.activate
    def test_each_node_is_asked_and_the_answers_merged(self):
        _login()
        a = _peer('topology/pod-1/node-101/sys/bgp/inst/dom-x/peer-[1.1.1.1/32]/ent-[1.1.1.1]')
        b = _peer('topology/pod-1/node-102/sys/bgp/inst/dom-x/peer-[2.2.2.2/32]/ent-[2.2.2.2]')
        c = _peer('topology/pod-1/node-102/sys/bgp/inst/dom-x/peer-[3.3.3.3/32]/ent-[3.3.3.3]')
        responses.add(responses.GET, NODE_101, json={'totalCount': '1', 'imdata': [a]})
        responses.add(responses.GET, NODE_102, json={'totalCount': '2', 'imdata': [b, c]})

        success, data, error = _client().execute_query(GROUP + '?page=0&page-size=50')

        assert (success, error) == (True, None)
        assert data == {'totalCount': '3', 'imdata': [a, b, c]}
        sent = [call.request.url for call in responses.calls[1:]]
        assert sent == [NODE_101 + '?page=0&page-size=50', NODE_102 + '?page=0&page-size=50']

    @responses.activate
    def test_one_node_failing_fails_the_query_naming_it(self):
        _login()
        responses.add(responses.GET, NODE_101, json={'totalCount': '0', 'imdata': []})
        responses.add(
            responses.GET,
            NODE_102,
            json={'imdata': [{'error': {'attributes': {'text': 'Node not found'}}}]},
            status=400,
        )

        success, data, error = _client().execute_query(GROUP)

        assert success is False
        assert data is None
        assert error == 'HTTP 400: Node not found (on pod-1/node-102)'

    @responses.activate
    def test_counts_are_added_up(self):
        _login()
        count = lambda n: {
            'totalCount': '1',
            'imdata': [  # noqa: E731
                {'moCount': {'attributes': {'count': str(n), 'dn': ''}}}
            ],
        }
        responses.add(responses.GET, NODE_101, json=count(4))
        responses.add(responses.GET, NODE_102, json=count(3))

        success, data, _ = _client().execute_query(GROUP + '?rsp-subtree-include=count')

        assert success is True
        assert data == {'totalCount': '1', 'imdata': [{'moCount': {'attributes': {'count': '7'}}}]}

    @responses.activate
    def test_one_node_is_a_plain_request(self):
        _login()
        responses.add(responses.GET, NODE_101, json={'totalCount': '0', 'imdata': []})

        success, data, _ = _client().execute_query(
            '/api/node/class/topology/pod-1/node-101/bgpPeerEntry.json'
        )

        assert success is True
        assert data == {'totalCount': '0', 'imdata': []}
        assert len(responses.calls) == 2

    @responses.activate
    def test_only_get_is_fanned_out(self):
        _login()
        responses.add(responses.POST, f'{APIC}{GROUP}', json={'imdata': []})

        success, _, _ = _client().execute_query(GROUP, method='POST', data={})

        assert success is True
        assert len(responses.calls) == 2


# ======================================================================
# Reading every page in order
# ======================================================================


@pytest.mark.unit
class TestOrderClass:
    def test_node_scoped_paths_are_ordered_by_their_class(self):
        assert (
            order_class('/api/node/class/topology/pod-1/node-101/bgpPeerEntry.json?page=0')
            == 'bgpPeerEntry'
        )
        assert order_class(GROUP) == 'bgpPeerEntry'

    def test_the_class_is_not_taken_from_the_query_string(self):
        assert (
            order_class(
                '/api/class/fvTenant.json?query-target-filter=wcard(fvTenant.dn,"a/b.json")'
            )
            == 'fvTenant'
        )


@pytest.mark.unit
class TestStrategyClasses:
    def test_class_strategy_handles_a_scope(self):
        intent = QueryIntent(_chain((_class_node('c1', 'l1PhysIf', '101'), [])))
        assert ClassQueryStrategy().can_handle(intent) is True
