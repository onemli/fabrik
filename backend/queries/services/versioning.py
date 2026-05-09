# queries/services/versioning.py
#
# Versioning support for SavedQuery. Every time a query is saved, we compute
# a hash of its logical structure and compare it against the stored hash. If
# something changed, we bump the version number.
#
# Version scheme:
#   major.minor — e.g. v1.0, v2.3
#
#   Major bump: the query shape changed. That means a class node was added/
#   removed, a connection between nodes was added/removed, or a class node's
#   scope/queryTarget was modified. These changes produce structurally
#   different APIC requests, so Time Machine treats them as a new baseline
#   and won't cross-compare snapshots from before and after the bump.
#
#   Minor bump: the filters or post-processors changed. The query hits the
#   same APIC endpoints but refines or reshapes the results. Time Machine
#   still compares minor-version snapshots to each other.
#
#   None: output node settings, canvas positions, colors — anything that
#   doesn't affect what APIC returns.

import hashlib
import json
from typing import Dict, List, Any, Tuple, Optional
from django.utils import timezone as django_timezone


def normalize_flow_data(flow_data: Dict[str, Any]) -> Dict[str, Any]:
    """Strip canvas-only data from flow_data so the hash only reflects
    things that affect query behaviour.

    Node positions, dimensions, selected state, colors — all stripped.
    Node IDs are kept because edges reference them; if we threw away IDs
    and two different node orderings produced the same hash, edge changes
    would be invisible to the diff.

    OutputNodes are skipped entirely. They control display settings and
    dashboard links, not query structure.
    """
    if not flow_data:
        return {}

    nodes = flow_data.get('nodes', [])
    edges = flow_data.get('edges', [])

    normalized_nodes = []
    for node in nodes:
        node_type = node.get('type', '')
        node_data = node.get('data', {})

        normalized_node = {
            'type': node_type,
            'id': node.get('id'),
        }

        if node_type == 'classNode':
            normalized_node['className'] = node_data.get('className', '')
            normalized_node['scope'] = node_data.get('scope', '')
            normalized_node['queryTarget'] = node_data.get('queryTarget', '')

        elif node_type == 'filterNode':
            normalized_node['filters'] = node_data.get('filters', [])

        elif node_type == 'postProcessorNode':
            normalized_node['processors'] = node_data.get('processors', [])

        elif node_type == 'outputNode':
            # Output nodes don't influence the APIC query — skip their data
            pass

        normalized_nodes.append(normalized_node)

    # Only source/target matter for edge hashing — handle/label/style are canvas-only
    normalized_edges = [
        {
            'source': edge.get('source'),
            'target': edge.get('target'),
        }
        for edge in edges
    ]

    return {
        'nodes': normalized_nodes,
        'edges': normalized_edges,
    }


def generate_query_version_hash(flow_data: Dict[str, Any]) -> str:
    """Produce an 8-character hex hash of the query's logical structure.

    We take the full SHA-256 but only keep the first 8 characters. That's
    enough entropy to detect accidental collisions (birthday collision at 8
    hex chars is ~1 in 4 billion) while keeping the hash short enough to
    appear in URLs and log messages without clutter.

    sort_keys=True is important here — Python dicts are ordered since 3.7
    but we can't guarantee the caller always builds them in the same order,
    so we sort before serializing to make the hash deterministic.
    """
    normalized = normalize_flow_data(flow_data)
    json_str = json.dumps(normalized, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(json_str.encode('utf-8')).hexdigest()[:8]


def categorize_nodes(flow_data: Dict[str, Any]) -> Dict[str, List[Any]]:
    """Split nodes into structural, filter, and processor buckets.

    Used by detect_version_change_type() so each category can be checked
    against the appropriate change level (major vs minor).
    """
    nodes = flow_data.get('nodes', [])

    structural_nodes = []
    filter_nodes = []
    processor_nodes = []

    for node in nodes:
        node_type = node.get('type', '')

        if node_type == 'classNode':
            structural_nodes.append(node)
        elif node_type == 'filterNode':
            filter_nodes.append(node)
        elif node_type == 'postProcessorNode':
            processor_nodes.append(node)

    return {
        'structural_nodes': structural_nodes,
        'filter_nodes': filter_nodes,
        'processor_nodes': processor_nodes,
    }


def detect_version_change_type(
    old_flow_data: Optional[Dict[str, Any]], new_flow_data: Dict[str, Any]
) -> Tuple[str, List[str]]:
    """Figure out whether a save requires a major bump, minor bump, or nothing.

    Returns a tuple (change_type, descriptions) where change_type is one of
    'major', 'minor', or 'none'. The descriptions list is for the version
    history changelog so users can see what changed at a glance.

    If old_flow_data is None the query is brand new — we return 'none'
    because there's nothing to compare against. The initial v1.0 is set
    by the model's save() method directly.

    Edge comparison uses sets so re-ordering edges on the canvas doesn't
    count as a structural change — only actual topology differences matter.
    """
    if not old_flow_data:
        return 'none', ['Initial version']

    old_categories = categorize_nodes(old_flow_data)
    new_categories = categorize_nodes(new_flow_data)

    changes = []
    is_major = False
    is_minor = False

    # --- Structural checks (major version) ---

    old_structural_count = len(old_categories['structural_nodes'])
    new_structural_count = len(new_categories['structural_nodes'])

    if old_structural_count != new_structural_count:
        is_major = True
        diff = new_structural_count - old_structural_count
        if diff > 0:
            changes.append(f'Added {diff} class node(s)')
        else:
            changes.append(f'Removed {abs(diff)} class node(s)')

    old_edge_set = {(e.get('source'), e.get('target')) for e in old_flow_data.get('edges', [])}
    new_edge_set = {(e.get('source'), e.get('target')) for e in new_flow_data.get('edges', [])}

    if old_edge_set != new_edge_set:
        is_major = True
        added_edges = new_edge_set - old_edge_set
        removed_edges = old_edge_set - new_edge_set
        if added_edges:
            changes.append(f'Added {len(added_edges)} connection(s)')
        if removed_edges:
            changes.append(f'Removed {len(removed_edges)} connection(s)')

    # Check scope/queryTarget changes on existing class nodes (matched by node ID)
    for old_node in old_categories['structural_nodes']:
        old_id = old_node.get('id')
        new_node = next(
            (n for n in new_categories['structural_nodes'] if n.get('id') == old_id), None
        )
        if new_node:
            old_data = old_node.get('data', {})
            new_data = new_node.get('data', {})

            if old_data.get('scope') != new_data.get('scope') or old_data.get(
                'queryTarget'
            ) != new_data.get('queryTarget'):
                is_major = True
                changes.append(
                    f"Modified class node '{new_data.get('className', 'unknown')}' properties"
                )

    # --- Filter checks (minor version) ---

    old_filter_count = len(old_categories['filter_nodes'])
    new_filter_count = len(new_categories['filter_nodes'])

    if old_filter_count != new_filter_count:
        is_minor = True
        diff = new_filter_count - old_filter_count
        if diff > 0:
            changes.append(f'Added {diff} filter node(s)')
        else:
            changes.append(f'Removed {abs(diff)} filter node(s)')

    for old_node in old_categories['filter_nodes']:
        old_id = old_node.get('id')
        new_node = next((n for n in new_categories['filter_nodes'] if n.get('id') == old_id), None)
        if new_node:
            old_filters = old_node.get('data', {}).get('filters', [])
            new_filters = new_node.get('data', {}).get('filters', [])

            if old_filters != new_filters:
                is_minor = True
                changes.append('Modified filter conditions')

    # --- Post-processor checks (minor version) ---

    old_processor_count = len(old_categories['processor_nodes'])
    new_processor_count = len(new_categories['processor_nodes'])

    if old_processor_count != new_processor_count:
        is_minor = True
        diff = new_processor_count - old_processor_count
        if diff > 0:
            changes.append(f'Added {diff} post-processor node(s)')
        else:
            changes.append(f'Removed {abs(diff)} post-processor node(s)')

    for old_node in old_categories['processor_nodes']:
        old_id = old_node.get('id')
        new_node = next(
            (n for n in new_categories['processor_nodes'] if n.get('id') == old_id), None
        )
        if new_node:
            old_processors = old_node.get('data', {}).get('processors', [])
            new_processors = new_node.get('data', {}).get('processors', [])

            if old_processors != new_processors:
                is_minor = True
                changes.append('Modified post-processor configuration')

    if is_major:
        return 'major', changes
    elif is_minor:
        return 'minor', changes
    else:
        return 'none', ['No changes detected']


def increment_version(current_major: int, current_minor: int, change_type: str) -> Tuple[int, int]:
    """Apply a major or minor bump to the current version numbers.

    Major bump resets minor to 0 — same convention as semver. So v1.5
    becomes v2.0 not v2.5 when the structure changes.
    """
    if change_type == 'major':
        return (current_major + 1, 0)
    elif change_type == 'minor':
        return (current_major, current_minor + 1)
    else:
        return (current_major, current_minor)


def create_version_history_entry(
    version: str,
    version_hash: str,
    changes: List[str],
    user_id: Optional[int] = None,
    username: Optional[str] = None,
) -> Dict[str, Any]:
    """Build the dict that gets appended to SavedQuery.version_history.

    version_history is a JSONField, so this just returns a plain dict.
    We include user info so the changelog can show who made each change.
    """
    return {
        'version': version,
        'hash': version_hash,
        'changes': changes,
        'created_at': django_timezone.now().isoformat(),
        'created_by_id': user_id,
        'created_by_username': username,
    }


def format_version(major: int, minor: int) -> str:
    """Turn version numbers into a readable string like 'v2.1'."""
    return f'v{major}.{minor}'
