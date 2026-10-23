# queries/services/node_scope.py
#
# Node scope: run a class query on chosen switches instead of the whole fabric.
#
# Why this exists: classes that live on the switches (bgpPeerEntry, l1PhysIf,
# ...) are answered by each node from its own tree, where the DN is local
# ("sys/bgp/inst/..."). A query-target-filter on .dn is evaluated there, so
# wcard(bgpPeerEntry.dn,"node-101") never matches: "topology/pod-1/node-101"
# is only prepended after the answers reach the APIC. The one way to pick
# nodes is the URL itself:
#
#     /api/node/class/topology/pod-1/node-101/bgpPeerEntry.json
#
# The APIC has no single call for several nodes, so a query over several
# nodes is written with one path holding them all:
#
#     /api/node/class/topology/{pod-1/node-101,pod-1/node-102}/bgpPeerEntry.json
#
# expand_node_paths() turns that into one real path per node, and
# APICClient.execute_query() sends each and merges the answers. Keeping it a
# single string means every place that stores or runs a query (saved
# queries, scheduled tasks, pipelines, AWX previews, the UI proxy) carries it
# unchanged. frontend/src/lib/nodeScope.ts writes the same form.

import re
from typing import List, Optional, Tuple

DEFAULT_POD = 1

# Each node is one request, sent one after another; past this a class query
# without a node scope is the better tool.
MAX_NODES = 100

_TOKEN = re.compile(r'^(?:(\d+)/)?(\d+)$')
_GROUP = re.compile(r'^(/api/node/(?:class|mo)/topology/)\{([^{}]+)\}(/.*)$')
_MEMBER = re.compile(r'^pod-\d+/node-\d+$')


class NodeScopeError(ValueError):
    """The canvas names its nodes in a way that cannot be a query. Callers
    show this to the user rather than fall back to a query without the scope."""


def parse_node_scope(text: Optional[str]) -> Optional[List[Tuple[int, int]]]:
    """The (pod, node) pairs written in a class node's Node scope field.

    Nodes are separated by commas or spaces: "101, 102" are in pod 1, and
    "2/201" names the pod. Repeats are dropped, order is kept. Returns None
    when the field is empty; raises NodeScopeError naming the first entry that is
    not a node.
    """
    if text is None:
        return None
    if not isinstance(text, str):
        raise NodeScopeError('Node scope must be text, such as "101, 102" or "2/201".')

    pairs: List[Tuple[int, int]] = []
    for token in re.split(r'[\s,]+', text.strip()):
        if not token:
            continue
        match = _TOKEN.match(token)
        if not match:
            raise NodeScopeError(
                f'Node scope: "{token}" is not a node. Write node IDs such as 101, '
                f'or pod/node such as 2/201.'
            )
        pod = int(match.group(1)) if match.group(1) else DEFAULT_POD
        pair = (pod, int(match.group(2)))
        if pair not in pairs:
            pairs.append(pair)

    if not pairs:
        return None
    if len(pairs) > MAX_NODES:
        raise NodeScopeError(
            f'Node scope names {len(pairs)} nodes; at most {MAX_NODES} are allowed.'
        )
    return pairs


def node_path_prefix(pairs: List[Tuple[int, int]]) -> str:
    """The topology part of a node-scoped path: one node, or a {..} group."""
    members = [f'pod-{pod}/node-{node}' for pod, node in pairs]
    if len(members) == 1:
        return f'topology/{members[0]}'
    return f'topology/{{{",".join(members)}}}'


def format_node_scope(pairs: List[Tuple[int, int]]) -> str:
    """The one way a scope is written back: "1/101, 2/201"."""
    return ', '.join(f'{pod}/{node}' for pod, node in pairs)


# A class query, whole fabric or already node-scoped:
#   /api/class/<cls>.json, /api/node/class/<cls>.json,
#   /api/node/class/topology/pod-1/node-101/<cls>.json, .../topology/{..}/<cls>.json
_CLASS_PATH = re.compile(
    r'^/api/(?:node/)?class/(?:topology/(?:pod-\d+/node-\d+|\{[^{}]+\})/)?([A-Za-z0-9]+\.json)(\?.*)?$'
)


def scoped_path(path: str, pairs: List[Tuple[int, int]]) -> str:
    """A saved query's path run on the given nodes instead (the run API's
    "nodes"): its class part moves under topology/..., its parameters stay.
    A node scope the query was saved with is replaced. A query that asks by
    DN (/api/mo/...) has no class to scope: NodeScopeError."""
    match = _CLASS_PATH.match(path)
    if not match:
        raise NodeScopeError(
            'Nodes can be given only for a query that asks by class (/api/class/...); '
            f'this one asks {path.split("?")[0][:120]}.'
        )
    class_file, query = match.group(1), match.group(2) or ''
    return f'/api/node/class/{node_path_prefix(pairs)}/{class_file}{query}'


def expand_node_paths(path: str) -> List[str]:
    """One APIC path per node for a path with a {..} node group; any other
    path comes back alone and unchanged."""
    match = _GROUP.match(path)
    if not match:
        return [path]
    head, group, tail = match.groups()
    members = group.split(',')
    if not all(_MEMBER.match(member) for member in members):
        return [path]
    return [f'{head}{member}{tail}' for member in members]


def node_of_path(path: str) -> str:
    """ "pod-1/node-101" for a node-scoped path, for naming it in errors."""
    match = re.search(r'/topology/(pod-\d+/node-\d+)/', path)
    return match.group(1) if match else path
