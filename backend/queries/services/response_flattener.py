# queries/services/response_flattener.py
#
# Normalizes APIC multi-class chain responses so downstream consumers
# (PostProcessor pipeline, table renderers, audit counters) see a flat
# list of target-class objects instead of a nested tree.
#
# Background:
#   When the optimizer issues a multi-class chain query, APIC returns
#   the root class at the top level with descendants nested inside its
#   `children` array (and potentially deeper):
#
#     {"imdata": [{"fvTenant": {
#         "attributes": {...},
#         "children": [
#           {"fvBD": {"attributes": {...}, "children": [
#             {"fvSubnet": {"attributes": {...}}}
#           ]}}
#         ]}}]}
#
#   PostProcessors and most table renderers iterate the top-level
#   `imdata` array and never descend into `children`. Without this
#   normalization the chain looks like a single-row response when the
#   user asked for fvSubnet. Flattening here means every backend caller
#   gets a uniform shape regardless of chain depth.

from typing import Any, Optional
from urllib.parse import parse_qs, unquote, urlparse


def flatten_to_target_class(response: Any, target_class: str) -> Any:
    """Collect all instances of ``target_class`` from an APIC response.

    Walks the entire response tree (top-level ``imdata`` plus any nested
    ``children`` arrays) depth-first and returns a new envelope whose
    ``imdata`` contains only the target objects. Children of the target
    objects themselves are stripped, since the target is the leaf the
    consumer asked for and any deeper data is irrelevant.

    The function is safe to call on any value:
      - Non-dict input is returned unchanged (defensive against APIC
        error envelopes or already-processed lists).
      - Dict input without ``imdata`` is returned unchanged (preserves
        non-standard responses).
      - A response where the target class never appears yields an empty
        ``imdata`` list with ``totalCount`` of "0".

    The original input is never mutated; a new dict is returned when
    flattening applies.
    """
    if not isinstance(response, dict) or 'imdata' not in response:
        return response

    flat: list = []

    def walk(node: Any) -> None:
        if not isinstance(node, dict):
            return
        for class_name, body in node.items():
            if not isinstance(body, dict):
                continue
            if class_name == target_class:
                attributes = body.get('attributes', {})
                if isinstance(attributes, dict):
                    flat.append({class_name: {'attributes': attributes}})
            for child in body.get('children') or []:
                walk(child)

    imdata = response.get('imdata')
    if isinstance(imdata, list):
        for item in imdata:
            walk(item)

    return {'totalCount': str(len(flat)), 'imdata': flat}


def detect_target_class_from_url(query_path: Any) -> Optional[str]:
    """Recover the target class name from a backend-generated APIC URL.

    The optimizer encodes multi-class chains with one of two parameters:

      - ``rsp-subtree-class=<intermediate>,<target>`` on /api/class/ queries
      - ``target-subtree-class=<intermediate>,<target>`` on /api/mo/ queries

    In both forms the target class is conventionally the **last** entry
    in the comma-separated list. This matches optimizer.ClassQueryStrategy
    (see _build_child_class_query, which iterates intent.class_chain[1:]
    in topological order).

    Returns None when the URL is not a multi-class chain (single-class
    queries don't need flattening — their imdata is already flat).
    """
    if not isinstance(query_path, str) or not query_path:
        return None

    try:
        parsed = urlparse(query_path)
    except (ValueError, AttributeError):
        return None

    params = parse_qs(parsed.query)

    for param_name in ('rsp-subtree-class', 'target-subtree-class'):
        values = params.get(param_name)
        if not values:
            continue
        # parse_qs already URL-decodes; unquote is defensive for callers
        # that pass a URL where the value was double-encoded.
        raw = unquote(values[0]).strip()
        if not raw:
            continue
        target = raw.split(',')[-1].strip()
        if target:
            return target

    return None


def maybe_flatten_response(response: Any, query_path: Any) -> Any:
    """Convenience wrapper: detect target class from URL and flatten if found.

    Returns the response unchanged when no multi-class chain is detected.
    Use this at execution boundaries (APIC proxy view, scheduled task
    runner, AWX preview) where you have both the query URL and the raw
    APIC response and want a single call to do the right thing.
    """
    target_class = detect_target_class_from_url(query_path)
    if not target_class:
        return response
    return flatten_to_target_class(response, target_class)
