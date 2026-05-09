# queries/services/optimizer.py
#
# Turns a React Flow canvas (nodes + edges) into the most efficient APIC REST
# query URL. Three strategies are available; the optimizer picks the best one
# automatically or lets the caller force a specific one.
#
# Strategy overview:
#
#   MOQueryStrategy (Managed Object)
#     Uses /api/mo/<dn>.json — fastest, but requires every node in the chain
#     to have an 'eq' filter on its key attribute so we can construct the DN.
#     Partial DN mode: if all *parent* nodes have eq filters but the target
#     doesn't, we build up to the parent and add a subtree query for the target.
#
#   ClassQueryStrategy
#     Uses /api/class/<className>.json — always works, but can be slow for
#     large tenants because APIC has to scan more objects. We add DN wildcard
#     filters (wcard on .dn) to scope the results when parent classes have
#     filters.
#
#   NodeClassQueryStrategy
#     Uses /api/node/class/<className>.json — node-local queries for
#     operational/debug data. Not auto-selected; callers must force it.
#
# The executor picks the cheapest strategy (by estimated ms) among the ones
# that can_handle() the intent. In practice it's almost always MO or Class.
#
# APIC filter syntax reminder:
#   query-target-filter requires the class prefix:  eq(fvTenant.name,"Prod")
#   rsp-subtree-filter  requires the class prefix:  eq(fvBD.name,"web-bd")
#   wcard uses REGEX syntax (.* not glob *)
import logging
from typing import List, Dict, Optional, Tuple
from abc import ABC, abstractmethod
from urllib.parse import urlencode
import re
from fabrik.logging import safe
from .class_hierarchy import build_rn, can_build_dn_from_filter, get_rn_format

logger = logging.getLogger(__name__)


class QueryIntent:
    """Parses a React Flow canvas and exposes the information the strategies need.

    Separates "what to query" (this class) from "how to query it" (strategies).
    The constructor does all the graph walking once so strategies don't repeat it.
    """

    def __init__(
        self,
        flow_data: dict,
        target_node_id: str = None,
        enable_pagination: bool = False,
        page: int = 0,
        page_size: int = 50,
    ):
        """Parse the canvas and build the class chain.

        target_node_id is used by the preview endpoint to run the query only
        up to a specific node in the canvas instead of the full graph.
        If omitted, we walk backwards from the OutputNode to find the final
        ClassNode.
        """
        self.nodes = flow_data.get('nodes', [])
        self.edges = flow_data.get('edges', [])
        self.target_node_id = target_node_id

        # Pagination parameters
        self.enable_pagination = enable_pagination
        self.page = page
        self.page_size = page_size

        # Find target class node
        if target_node_id:
            self.target_node = self._find_node_by_id(target_node_id)
        else:
            self.target_node = self._find_final_class_node()

        if not self.target_node or self.target_node.get('type') != 'classNode':
            raise ValueError('No valid ClassNode found in flow')

        self.class_name = self.target_node.get('data', {}).get('className')
        self.scope = self.target_node.get('data', {}).get('scope', 'self')
        self.property_include = self.target_node.get('data', {}).get('propertyInclude', 'all')

        if not self.class_name:
            raise ValueError('ClassNode must have className configured')

        # Build class chain (parent hierarchy)
        self.class_chain = self._build_class_chain()

    def _find_node_by_id(self, node_id: str) -> Optional[dict]:
        """Find node by ID"""
        return next((n for n in self.nodes if n['id'] == node_id), None)

    def _find_final_class_node(self) -> Optional[dict]:
        """Walk backwards from the OutputNode to find the last ClassNode.

        The user's intended target is the ClassNode that feeds into the
        OutputNode. If there's no OutputNode (shouldn't happen in a valid
        canvas, but can happen during construction), we fall back to the
        last ClassNode by position in the nodes list.
        """
        # Find OutputNode
        output_node = next((n for n in self.nodes if n['type'] == 'outputNode'), None)

        if output_node:
            # Walk backwards from OutputNode
            current_id = output_node['id']
            visited = set()

            while current_id and current_id not in visited:
                visited.add(current_id)

                # Skip pipeline edges during backward traversal
                incoming_edge = next(
                    (
                        e
                        for e in self.edges
                        if e['target'] == current_id
                        and e.get('data', {}).get('edgeType') != 'pipeline'
                    ),
                    None,
                )
                if not incoming_edge:
                    break

                source_node = self._find_node_by_id(incoming_edge['source'])
                if not source_node:
                    break

                if source_node['type'] == 'classNode':
                    return source_node

                current_id = source_node['id']

        # Fallback: Last ClassNode
        class_nodes = [n for n in self.nodes if n['type'] == 'classNode']
        return class_nodes[-1] if class_nodes else None

    def _build_class_chain(self) -> List[Dict]:
        """Walk backwards from the target node to build the full ancestor chain.

        Each entry in the chain has the class node, its first filter (for backward
        compat), all its filters, and the class name. The chain is ordered
        root-first so strategies can iterate parent → child.

        We keep both filter_node (first filter) and filter_nodes (all filters)
        because MOQueryStrategy only uses the first one to build the DN, while
        ClassQueryStrategy needs all of them for the query-target-filter.

        Pipeline edges (edgeType='pipeline') are skipped during traversal —
        they connect separate pipeline stages, not ACI containment relationships.
        """
        logger.info(
            '[QueryIntent._build_class_chain] Starting with target_node: id=%s, class=%s',
            safe(self.target_node.get('id')),
            safe(self.target_node.get('data', {}).get('className')),
        )

        chain = []

        # Start with target node itself (it's a ClassNode)
        path_nodes = [self.target_node]
        current_id = self.target_node['id']
        visited = set()

        # Walk backwards to root to find parent class nodes
        while current_id and current_id not in visited:
            visited.add(current_id)

            # Skip pipeline edges — they connect separate stages, not ACI containment
            incoming_edge = next(
                (
                    e
                    for e in self.edges
                    if e['target'] == current_id and e.get('data', {}).get('edgeType') != 'pipeline'
                ),
                None,
            )
            if not incoming_edge:
                break

            source_node = self._find_node_by_id(incoming_edge['source'])
            if not source_node:
                break

            if source_node['type'] == 'classNode':
                path_nodes.insert(0, source_node)  # Insert parent at beginning
                logger.info(
                    '[QueryIntent._build_class_chain] Found parent class: id=%s, class=%s',
                    safe(source_node.get('id')),
                    safe(source_node.get('data', {}).get('className')),
                )

            current_id = source_node['id']

        logger.info(
            '_build_class_chain: Found %d class nodes in path: %s',
            len(path_nodes),
            [safe(n.get('data', {}).get('className')) for n in path_nodes],
        )

        # Build chain with filters
        for node in path_nodes:
            node_id = node['id']
            # Find ALL filters for this class node (not just the first one)
            filter_nodes = self._find_all_connected_filters(node_id)
            # For backward compatibility, also keep first filter as 'filter_node'
            filter_node = filter_nodes[0] if filter_nodes else None

            logger.info(
                '_build_class_chain: Node %s, filters_found=%d', safe(node_id), len(filter_nodes)
            )
            if filter_nodes:
                for idx, f in enumerate(filter_nodes):
                    logger.info('_build_class_chain: Filter %d: %s', idx + 1, safe(f.get('data')))

            chain.append(
                {
                    'class_node': node,
                    'filter_node': filter_node,  # First filter (for backward compatibility)
                    'filter_nodes': filter_nodes,  # ALL filters (new)
                    'class_name': node.get('data', {}).get('className'),
                }
            )

        logger.info('_build_class_chain: Built chain with %d items', len(chain))
        return chain

    def _find_connected_filter(self, node_id: str) -> Optional[dict]:
        """
        Find filter node connected to a class node

        Filter must be AFTER the class node in the flow (ClassNode → Filter)
        NOT before (Filter → ClassNode), as that filter belongs to a previous node

        Accepts both 'property' and 'query-target-filter' types
        """
        for edge in self.edges:
            # Only look for filters that come AFTER this class node (source = class, target = filter)
            if edge['source'] == node_id:
                target = self._find_node_by_id(edge['target'])
                if target and target['type'] == 'filterNode':
                    data = target.get('data', {})
                    filter_type = data.get('filterType')
                    # Accept both property and query-target-filter types
                    if filter_type in ['property', 'query-target-filter']:
                        logger.info(
                            f'_find_connected_filter: Found {filter_type} filter for {node_id}'
                        )
                        return target

        logger.info(f'_find_connected_filter: No filter found for {node_id}')
        return None

    def _find_all_connected_filters(self, node_id: str) -> List[dict]:
        """Collect all FilterNodes that belong to a ClassNode.

        We follow outgoing edges from the node and collect consecutive
        FilterNodes until we hit another ClassNode, an OutputNode, or a
        dead end. This handles the pattern:

            ClassNode → Filter1 → Filter2 → ClassNode2

        where both Filter1 and Filter2 apply to ClassNode's results.
        """
        filters = []
        current_id = node_id
        visited = set()

        while current_id and current_id not in visited:
            visited.add(current_id)

            # Find next node
            edge = next((e for e in self.edges if e['source'] == current_id), None)
            if not edge:
                break

            next_node = self._find_node_by_id(edge['target'])
            if not next_node:
                break

            # If it's a filter, add it and continue
            if next_node['type'] == 'filterNode':
                data = next_node.get('data', {})
                filter_type = data.get('filterType')
                if filter_type in ['property', 'query-target-filter']:
                    filters.append(next_node)
                    current_id = next_node['id']
                    continue

            # If it's another class node or output, stop
            if next_node['type'] in ['classNode', 'outputNode']:
                break

            current_id = next_node['id']

        logger.info(
            '_find_all_connected_filters: Found %d filters for %s', len(filters), safe(node_id)
        )
        return filters

    def can_build_dn(self) -> bool:
        """Check whether every node in the chain has an eq filter on its key attribute.

        If yes, we can construct the complete DN (e.g. uni/tn-Prod/ap-MyApp/epg-Web)
        and use the fast MO query path. Even one missing filter means we can't build
        the full DN and have to fall back to partial DN or class query.
        """
        if not self.class_chain:
            logger.debug('can_build_dn: No class_chain')
            return False

        for item in self.class_chain:
            filter_node = item['filter_node']
            class_name = item['class_name']

            logger.debug(
                f'can_build_dn: Checking {class_name}, filter_node={filter_node is not None}'
            )

            if not filter_node or not class_name:
                logger.debug(f'can_build_dn: Missing filter or class_name for {class_name}')
                return False

            filter_data = filter_node.get('data', {})
            logger.debug(f'can_build_dn: filter_data={filter_data}')

            if not can_build_dn_from_filter(class_name, filter_data):
                logger.debug(f'can_build_dn: Cannot build DN from filter for {class_name}')
                return False

        logger.debug('can_build_dn: Success! DN can be built')
        return True

    def build_dn(self) -> Optional[str]:
        """
        Build DN from class chain

        Returns:
            DN string (e.g., 'uni/tn-Prod/BD-web-bd') or None if cannot build
        """
        if not self.can_build_dn():
            return None

        dn_parts = ['uni']

        for item in self.class_chain:
            class_name = item['class_name']
            filter_node = item['filter_node']

            if not filter_node:
                return None

            filter_data = filter_node.get('data', {})
            property_name = filter_data.get('property')
            value = filter_data.get('value')

            if not property_name or not value:
                return None

            try:
                rn = build_rn(class_name, {property_name: value})
                dn_parts.append(rn)
            except ValueError:
                logger.exception('Cannot build RN for %s', class_name)
                return None

        return '/'.join(dn_parts) if len(dn_parts) > 1 else None

    def can_build_partial_dn(self) -> bool:
        """Check if we can build a DN for the parent and use a subtree query for the target.

        This handles the common pattern: user knows they want "all BDs under tenant Prod"
        but hasn't filtered to a specific BD. We build uni/tn-Prod and then add
        query-target=subtree&target-subtree-class=fvBD.

        Conditions:
          - Chain has 2+ nodes (need at least one parent)
          - All parent nodes have eq filters (so we can build the parent DN)
          - The last node has no filter (if it did, full DN would work)
        """
        if not self.class_chain or len(self.class_chain) < 2:
            return False

        # Check all nodes except last
        for item in self.class_chain[:-1]:
            filter_node = item['filter_node']
            class_name = item['class_name']

            if not filter_node or not class_name:
                return False

            filter_data = filter_node.get('data', {})
            if not can_build_dn_from_filter(class_name, filter_data):
                return False

        # Last node should NOT have a filter (otherwise full DN would work)
        last_item = self.class_chain[-1]
        if last_item['filter_node']:
            return False

        logger.info('can_build_partial_dn: True (parent DN available for subtree query)')
        return True

    def build_partial_dn(self) -> Optional[str]:
        """
        Build partial DN from parent nodes (excluding last node)

        Returns:
            Partial DN string (e.g., 'uni/tn-Prod') or None
        """
        if not self.can_build_partial_dn():
            return None

        dn_parts = ['uni']

        # Build DN from all nodes except last
        for item in self.class_chain[:-1]:
            class_name = item['class_name']
            filter_node = item['filter_node']

            filter_data = filter_node.get('data', {})
            property_name = filter_data.get('property')
            value = filter_data.get('value')

            try:
                rn = build_rn(class_name, {property_name: value})
                dn_parts.append(rn)
            except ValueError:
                logger.exception('Cannot build RN for %s', class_name)
                return None

        partial_dn = '/'.join(dn_parts) if len(dn_parts) > 1 else None
        logger.info(f'build_partial_dn: Built partial DN: {partial_dn}')
        return partial_dn

    def get_filters_for_node(self, node_id: str) -> List[dict]:
        """
        Get all filter nodes that belong to a specific class node.

        IMPORTANT: Only returns filters that come AFTER the node in the flow
        (node → filter), NOT filters that connect TO the node (filter → node).

        This is because in the flow structure:
            ClassNode → FilterNode → NextClassNode
        The filter belongs to the ClassNode it comes FROM, not the one it goes TO.

        Example flow: fvAEPg → Filter(name=db) → fvRsCons
        - Filter(name=db) belongs to fvAEPg (filters EPG results)
        - fvRsCons has NO filter (returns all consumed contracts under that EPG)
        """
        filters = []
        for edge in self.edges:
            # Only look for filters that come AFTER this node
            # (source = this node, target = filter)
            if edge['source'] == node_id:
                target = self._find_node_by_id(edge['target'])
                if target and target['type'] == 'filterNode':
                    filters.append(target)

        return filters

    def estimate_result_count(self) -> str:
        """
        Estimate result set size

        Returns:
            'low' | 'medium' | 'high'
        """
        # If we have exact filters (eq), likely low result count
        filters = self.get_filters_for_node(self.target_node['id'])

        has_eq_filter = any(f.get('data', {}).get('operator') == 'eq' for f in filters)

        if has_eq_filter:
            return 'low'

        # Wildcard or no filters = potentially high result count
        has_wildcard = any(
            f.get('data', {}).get('operator') in ['wcard', 'contains'] for f in filters
        )

        if has_wildcard or not filters:
            return 'high'

        return 'medium'


class QueryStrategy(ABC):
    """Base class for the three APIC query strategies.

    can_handle() — returns True if this strategy can produce a valid URL for
    the given intent. MOQueryStrategy returns False if no DN can be built.

    execute() — produces the query URL and a metadata dict. The metadata is
    included in the API response so the frontend can show which strategy was
    used and why.

    estimate_cost() — rough millisecond estimate. QueryExecutor picks the
    strategy with the lowest cost among those that can_handle() the intent.
    """

    @abstractmethod
    def can_handle(self, intent: QueryIntent) -> bool:
        """Check if this strategy can handle the intent"""

    @abstractmethod
    def execute(self, intent: QueryIntent) -> Tuple[str, dict]:
        """
        Execute the strategy

        Returns:
            Tuple of (query_url, metadata)
        """

    @abstractmethod
    def estimate_cost(self, intent: QueryIntent) -> int:
        """
        Estimate query cost (lower is better)

        Returns:
            Estimated response time in milliseconds
        """


class MOQueryStrategy(QueryStrategy):
    """The fast path — uses /api/mo/<dn>.json when a full or partial DN is available.

    APIC can resolve a DN directly without scanning any class indexes, so these
    queries are typically an order of magnitude faster than class queries on large
    fabrics. The trade-off is that every parent in the chain must have an exact
    value (eq filter) so we know exactly which DN to construct.
    """

    def can_handle(self, intent: QueryIntent) -> bool:
        """MO strategy requires buildable DN (full or partial)"""
        can_full = intent.can_build_dn()
        can_partial = intent.can_build_partial_dn()
        logger.info(f'[MOQueryStrategy] can_handle: full_dn={can_full}, partial_dn={can_partial}')
        return can_full or can_partial

    def _build_rsp_subtree_include(self, intent: QueryIntent) -> Optional[str]:
        """
        Build rsp-subtree-include parameter from node's supplementalData config

        Converts frontend supplementalData configuration to APIC REST API format.

        Args:
            intent: QueryIntent with target node configuration

        Returns:
            rsp-subtree-include parameter value (e.g., "health,faults,stats") or None
        """
        target_node = intent.target_node
        if not target_node:
            return None

        supplemental = target_node.get('data', {}).get('supplementalData', {})
        if not supplemental:
            return None

        categories = []

        # Boolean categories (simple flags)
        boolean_map = {
            'health': 'health',
            'faults': 'faults',
            'stats': 'stats',
            'relations': 'relations',
            'tasks': 'tasks',
            'deploymentRecords': 'deployment-records',
            'countOnly': 'count',
            'noScoped': 'no-scoped',
            'required': 'required',
        }

        for frontend_key, apic_key in boolean_map.items():
            if supplemental.get(frontend_key):
                categories.append(apic_key)

        # Time-range categories (audit-logs, event-logs, fault-records, health-records)
        # APIC only accepts the base name (e.g. "audit-logs"), NOT "audit-logs-1d"
        time_range_map = {
            'auditLogs': 'audit-logs',
            'eventLogs': 'event-logs',
            'faultRecords': 'fault-records',
            'healthRecords': 'health-records',
        }

        for frontend_key, apic_key in time_range_map.items():
            if supplemental.get(frontend_key):
                categories.append(apic_key)

        if categories:
            result = ','.join(categories)
            logger.info(f'[MOQueryStrategy] rsp-subtree-include: {result}')
            return result

        return None

    def execute(self, intent: QueryIntent) -> Tuple[str, dict]:
        """Execute MO query with full or partial DN"""
        # Try full DN first
        dn = intent.build_dn()
        is_partial = False

        # Fallback to partial DN
        if not dn:
            dn = intent.build_partial_dn()
            is_partial = True

        if not dn:
            raise ValueError('Cannot build DN for MO query')

        base_url = f'/api/mo/{dn}.json'
        params = {}

        # For partial DN, query the target class under the parent DN
        if is_partial:
            params['query-target'] = 'subtree'
            params['target-subtree-class'] = intent.class_name
            # If scope=children/subtree, also fetch children of the target class
            if intent.scope == 'children':
                params['rsp-subtree'] = 'children'
            elif intent.scope == 'subtree':
                params['rsp-subtree'] = 'full'
            logger.info(f'[MOQueryStrategy] Using partial DN: {dn} → {intent.class_name}')
        else:
            # Full DN: Add scope if not self
            if intent.scope != 'self':
                params['query-target'] = intent.scope
                # NOTE: Do NOT add target-subtree-class here for single-node
                # queries. When scope=children on a full DN like /api/mo/uni/tn-common.json,
                # adding target-subtree-class=fvTenant would wrongly filter children
                # to only fvTenant objects (which don't exist as children of a tenant).
                # The scope parameter alone is sufficient — APIC returns all children.

        # Build filters for target node (excluding filters used in DN)
        filter_expr = self._build_filter_expression(intent)
        if filter_expr:
            params['query-target-filter'] = filter_expr

        # Add supplemental data (monitoring, health, faults, etc.)
        rsp_subtree_include = self._build_rsp_subtree_include(intent)
        if rsp_subtree_include:
            params['rsp-subtree-include'] = rsp_subtree_include

        # Property include mode (naming-only, config-only)
        if intent.property_include and intent.property_include != 'all':
            params['rsp-prop-include'] = intent.property_include

        # Add pagination parameters
        if intent.enable_pagination:
            params['page'] = str(intent.page)
            params['page-size'] = str(intent.page_size)
            logger.info(
                f'[MOQueryStrategy] Pagination enabled: page={intent.page}, page_size={intent.page_size}'
            )

        # Build URL with proper encoding
        query_url = self._build_url(base_url, params)

        metadata = {
            'strategy': 'MO',
            'dn': dn,
            'uses_dn': True,
            'is_partial_dn': is_partial,
            'explanation': f'DN-based query for optimal performance (DN: {dn}{"[partial]" if is_partial else ""})',
        }

        logger.info(f'[MOQueryStrategy] Generated: {query_url}')

        return query_url, metadata

    def estimate_cost(self, intent: QueryIntent) -> int:
        """MO queries are fastest - estimated 200-500ms"""
        return 300

    def _build_filter_expression(self, intent: QueryIntent) -> Optional[str]:
        """
        Build filter expression for target node

        Excludes filters that were used in DN construction
        """
        filters = intent.get_filters_for_node(intent.target_node['id'])

        if not filters:
            return None

        # Get DN values to exclude
        dn_values = set()
        if intent.class_chain:
            for item in intent.class_chain:
                filter_node = item.get('filter_node')
                if filter_node:
                    value = filter_node.get('data', {}).get('value')
                    if value:
                        dn_values.add(value)

        # Build filter expressions
        filter_exprs = []
        for filter_node in filters:
            data = filter_node.get('data', {})

            if data.get('filterType') != 'property':
                continue

            prop = data.get('property')
            operator = data.get('operator', 'eq')
            value = data.get('value')
            if not prop or value is None:
                continue

            # Skip if value is already in DN
            if operator == 'eq' and value in dn_values:
                continue

            # Build expression
            attr = f'{intent.class_name}.{prop}'
            expr = self._build_operator_expression(operator, attr, value)

            if expr:
                filter_exprs.append(expr)

        if not filter_exprs:
            return None

        if len(filter_exprs) == 1:
            return filter_exprs[0]

        return f'and({",".join(filter_exprs)})'

    def _build_operator_expression(self, operator: str, attr: str, value: str) -> Optional[str]:
        """Build filter expression for an operator

        Note: APIC wcard uses REGEX syntax (.*) not glob syntax (*)
        """
        if operator == 'eq':
            return f'eq({attr},"{value}")'
        elif operator == 'ne':
            return f'ne({attr},"{value}")'
        elif operator == 'gt':
            return f'gt({attr},"{value}")'
        elif operator == 'lt':
            return f'lt({attr},"{value}")'
        elif operator == 'ge':
            return f'ge({attr},"{value}")'
        elif operator == 'le':
            return f'le({attr},"{value}")'
        elif operator == 'contains':
            # Contains: .*value.* (matches value anywhere in the string)
            return f'wcard({attr},".*{value}.*")'
        elif operator == 'wcard':
            # Wildcard: if user provided regex pattern, use as-is; otherwise treat as starts-with
            if '.*' in value or value.startswith('^') or value.endswith('$'):
                return f'wcard({attr},"{value}")'
            else:
                return f'wcard({attr},"{value}.*")'
        return None

    def _build_url(self, base: str, params: dict) -> str:
        """Build URL with proper encoding"""
        if not params:
            return base

        # Use urlencode for proper URL encoding
        # IMPORTANT: APIC requires parentheses to be encoded in query strings
        # Do NOT use safe='(),' - encode everything for APIC compatibility
        query_string = urlencode(params)
        return f'{base}?{query_string}'


class ClassQueryStrategy(QueryStrategy):
    """Fallback strategy — uses /api/class/<className>.json.

    Always works, but APIC has to scan all objects of that class across the fabric.
    We mitigate this by adding wcard(.dn,...) filters when parent classes are present
    so APIC can at least limit the scan to the right subtree. For multi-node chains
    we also use rsp-subtree-class to pull child objects in a single request rather
    than N+1 queries.
    """

    def can_handle(self, intent: QueryIntent) -> bool:
        # Class queries can always be generated — there's no precondition
        return True

    def _build_rsp_subtree_include(self, intent: QueryIntent) -> Optional[str]:
        """
        Build rsp-subtree-include parameter from node's supplementalData config

        Converts frontend supplementalData configuration to APIC REST API format.

        Args:
            intent: QueryIntent with target node configuration

        Returns:
            rsp-subtree-include parameter value (e.g., "health,faults,stats") or None
        """
        target_node = intent.target_node
        if not target_node:
            return None

        supplemental = target_node.get('data', {}).get('supplementalData', {})
        if not supplemental:
            return None

        categories = []

        # Boolean categories (simple flags)
        boolean_map = {
            'health': 'health',
            'faults': 'faults',
            'stats': 'stats',
            'relations': 'relations',
            'tasks': 'tasks',
            'deploymentRecords': 'deployment-records',
            'countOnly': 'count',
            'noScoped': 'no-scoped',
            'required': 'required',
        }

        for frontend_key, apic_key in boolean_map.items():
            if supplemental.get(frontend_key):
                categories.append(apic_key)

        # Time-range categories (audit-logs, event-logs, fault-records, health-records)
        # APIC only accepts the base name (e.g. "audit-logs"), NOT "audit-logs-1d"
        time_range_map = {
            'auditLogs': 'audit-logs',
            'eventLogs': 'event-logs',
            'faultRecords': 'fault-records',
            'healthRecords': 'health-records',
        }

        for frontend_key, apic_key in time_range_map.items():
            if supplemental.get(frontend_key):
                categories.append(apic_key)

        if categories:
            result = ','.join(categories)
            logger.info(f'[ClassQueryStrategy] rsp-subtree-include: {result}')
            return result

        return None

    def execute(self, intent: QueryIntent) -> Tuple[str, dict]:
        """Execute class query"""
        # DEBUG: Log full class chain structure
        logger.info(f'[ClassQueryStrategy] Class chain length: {len(intent.class_chain)}')
        for idx, item in enumerate(intent.class_chain):
            class_name = item.get('class_name')
            filter_nodes = item.get('filter_nodes', [])
            logger.info(
                f'[ClassQueryStrategy] Chain[{idx}]: class={class_name}, num_filters={len(filter_nodes)}'
            )
            for f_idx, f_node in enumerate(filter_nodes):
                f_data = f_node.get('data', {})
                logger.info(
                    f'[ClassQueryStrategy]   Filter[{f_idx}]: type={f_data.get("filterType")}, prop={f_data.get("property")}, value={f_data.get("value")}'
                )

        # For multi-class chains, use root class as base URL
        # For single class, use target class
        if len(intent.class_chain) > 1:
            root_class = intent.class_chain[0].get('class_name')
            base_url = f'/api/class/{root_class}.json'
            logger.info(
                f'[ClassQueryStrategy] Multi-class chain detected, using root class: {root_class}'
            )
        else:
            base_url = f'/api/class/{intent.class_name}.json'

        params = {}

        # Add scope using rsp-subtree (NOT query-target!)
        if intent.scope == 'children':
            params['rsp-subtree'] = 'children'
        elif intent.scope == 'subtree':
            params['rsp-subtree'] = 'full'

        # Build filters for root class
        filter_expr = self._build_filter_expression(intent)
        if filter_expr:
            params['query-target-filter'] = filter_expr

        # DN wildcard scoping is only meaningful for single-class queries.
        # In multi-class chains the base URL is the root class, but
        # _build_dn_wildcard_filter emits wcard(<target>.dn,...) — and APIC
        # rejects query-target-filter referencing a class other than the base,
        # which silently returns zero rows. rsp-subtree-class + rsp-subtree-filter
        # already scope multi-class chains correctly.
        if len(intent.class_chain) <= 1:
            dn_filter = self._build_dn_wildcard_filter(intent)
            if dn_filter:
                if 'query-target-filter' in params:
                    params['query-target-filter'] = (
                        f'and({params["query-target-filter"]},{dn_filter})'
                    )
                else:
                    params['query-target-filter'] = dn_filter

        # Handle multi-class chains: Add child class filters
        # If we have child classes in the chain, include them with their filters
        if len(intent.class_chain) > 1:
            child_classes, child_filter = self._build_child_class_query(intent)
            if child_classes:
                # Use 'full' so grandchildren are returned too. rsp-subtree-class
                # still limits the response to the requested classes.
                params['rsp-subtree'] = 'full'
                params['rsp-subtree-class'] = ','.join(child_classes)
                if child_filter:
                    params['rsp-subtree-filter'] = child_filter
                logger.info(
                    f'[ClassQueryStrategy] Added child classes: {child_classes}, filter: {child_filter}'
                )

        # Add supplemental data (monitoring, health, faults, etc.)
        rsp_subtree_include = self._build_rsp_subtree_include(intent)
        if rsp_subtree_include:
            params['rsp-subtree-include'] = rsp_subtree_include

        # Property include mode (naming-only, config-only)
        if intent.property_include and intent.property_include != 'all':
            params['rsp-prop-include'] = intent.property_include

        # Add pagination parameters
        if intent.enable_pagination:
            params['page'] = str(intent.page)
            params['page-size'] = str(intent.page_size)
            logger.info(
                f'[ClassQueryStrategy] Pagination enabled: page={intent.page}, page_size={intent.page_size}'
            )

        query_url = self._build_url(base_url, params)

        metadata = {
            'strategy': 'Class',
            'uses_dn': False,
            'explanation': 'Class-based query (DN could not be constructed or has wildcards)',
        }

        logger.info(f'[ClassQueryStrategy] Generated: {query_url}')

        return query_url, metadata

    def estimate_cost(self, intent: QueryIntent) -> int:
        """Class queries vary - estimated 1000-5000ms"""
        # With filters: lower cost
        filters = intent.get_filters_for_node(intent.target_node['id'])
        if filters:
            return 1500

        # Without filters: higher cost
        return 4000

    def _build_filter_expression(self, intent: QueryIntent) -> Optional[str]:
        """
        Build filter expression for class query

        For multi-class chains, builds filter for root class only.
        Child class filters are handled in _build_child_class_query.
        """
        # Determine which node to get filters from
        if len(intent.class_chain) > 1:
            # Multi-class chain: use root class filters (ALL of them)
            root_item = intent.class_chain[0]
            filter_nodes = root_item.get('filter_nodes', [])
            class_name = root_item.get('class_name')

            logger.info(
                f'[ClassQueryStrategy._build_filter_expression] Root class: {class_name}, filter_nodes count: {len(filter_nodes)}'
            )

            if not filter_nodes:
                logger.info(
                    '[ClassQueryStrategy._build_filter_expression] No filters for root class'
                )
                return None

            filters = filter_nodes
            logger.info(
                f'[ClassQueryStrategy._build_filter_expression] Building {len(filters)} filter(s) for root class: {class_name}'
            )
        else:
            # Single class: use target node filters
            filters = intent.get_filters_for_node(intent.target_node['id'])
            class_name = intent.class_name

        if not filters:
            return None

        filter_exprs = []
        for filter_node in filters:
            data = filter_node.get('data', {})

            # Handle property filters
            if data.get('filterType') == 'property':
                prop = data.get('property')
                operator = data.get('operator', 'eq')
                value = data.get('value')

                if not prop or value is None:
                    continue

                # IMPORTANT: APIC query-target-filter REQUIRES class prefix
                # Use className.property format (e.g., "l1PhysIf.adminSt")
                full_prop = f'{class_name}.{prop}'
                expr = MOQueryStrategy()._build_operator_expression(operator, full_prop, value)

                if expr:
                    filter_exprs.append(expr)

            # Handle query-target-filter (wildcard patterns)
            elif data.get('filterType') == 'query-target-filter':
                pattern_groups = data.get('patternGroups')

                if pattern_groups and len(pattern_groups) > 0:
                    # Grouped patterns — each group has its own logical operator
                    group_exprs = []
                    for group in pattern_groups:
                        grp_exprs = self._build_pattern_exprs(class_name, group.get('patterns', []))
                        if not grp_exprs:
                            continue
                        grp_op = group.get('logicalOperator', 'and')
                        if len(grp_exprs) == 1:
                            group_exprs.append(grp_exprs[0])
                        else:
                            group_exprs.append(f'{grp_op}({",".join(grp_exprs)})')

                    if group_exprs:
                        combine_op = data.get('groupCombineOperator', 'and')
                        if len(group_exprs) == 1:
                            filter_exprs.append(group_exprs[0])
                        else:
                            filter_exprs.append(f'{combine_op}({",".join(group_exprs)})')
                else:
                    # Legacy flat patterns (backward compat)
                    flat_patterns = data.get('wildcardPatterns', [])
                    flat_exprs = self._build_pattern_exprs(class_name, flat_patterns)

                    if flat_exprs:
                        logical_op = data.get('logicalOperator', 'and')
                        if len(flat_exprs) == 1:
                            filter_exprs.append(flat_exprs[0])
                        else:
                            filter_exprs.append(f'{logical_op}({",".join(flat_exprs)})')

        if not filter_exprs:
            return None

        if len(filter_exprs) == 1:
            return filter_exprs[0]

        return f'and({",".join(filter_exprs)})'

    def _build_pattern_exprs(self, class_name: str, patterns: list) -> List[str]:
        """Build APIC filter expressions from a list of pattern dicts."""
        exprs = []
        for p in patterns:
            prop = p.get('property')
            pattern = p.get('pattern')
            operator = p.get('operator', 'wcard')
            match_type = p.get('type', 'starts')
            negate = p.get('negate', False)

            if not prop or pattern is None:
                continue

            full_prop = f'{class_name}.{prop}'

            if operator == 'wcard':
                if match_type == 'starts':
                    pattern = f'{pattern}.*'
                elif match_type == 'ends':
                    pattern = f'.*{pattern}'
                elif match_type == 'contains':
                    pattern = f'.*{pattern}.*'
                expr = f'wcard({full_prop},"{pattern}")'
            else:
                expr = MOQueryStrategy()._build_operator_expression(operator, full_prop, pattern)
                if expr is None:
                    continue

            if negate:
                expr = f'not({expr})'

            exprs.append(expr)
        return exprs

    def _build_dn_wildcard_filter(self, intent: QueryIntent) -> Optional[str]:
        """
        Build DN wildcard filter to scope results to parent classes

        For each class in the chain (except target):
        - If it has an eq filter: use exact RN (e.g., "tn-Prod")
        - If it has no filter or wildcard: use RN pattern with .* (e.g., "tn-.*")

        This ensures the DN pattern matches the ACI hierarchy correctly.

        Example outputs:
        - With tenant filter: wcard(fvBD.dn,"uni/tn-Prod/.*")
        - Without tenant filter: wcard(fvBD.dn,"uni/tn-.*/ap-backend/.*")
        """
        if not intent.class_chain or len(intent.class_chain) < 2:
            return None

        # Build DN pattern from parent classes
        dn_parts = ['uni']
        has_any_constraint = False

        for item in intent.class_chain[:-1]:  # Exclude target node
            filter_node = item.get('filter_node')
            class_name = item.get('class_name')

            if not class_name:
                continue

            # Get RN format for this class
            try:
                rn_format = get_rn_format(class_name)
            except ValueError:
                # Unknown class, skip
                continue

            if filter_node:
                data = filter_node.get('data', {})
                operator = data.get('operator', 'eq')
                prop = data.get('property')
                value = data.get('value')

                if operator == 'eq' and prop and value:
                    # Exact match - use specific RN
                    try:
                        rn = build_rn(class_name, {prop: value})
                        dn_parts.append(rn)
                        has_any_constraint = True
                        continue
                    except ValueError:
                        pass

                # Wildcard or other operator - use RN pattern
                # e.g., for fvTenant with wcard filter: tn-.*
                if rn_format:
                    # Replace {name} or similar with .*
                    rn_pattern = re.sub(r'\{[^}]+\}', '.*', rn_format)
                    # For wildcard filters with value, try to use the value
                    if value and operator in ['wcard', 'contains', 'starts', 'ends']:
                        # Build pattern based on operator
                        if operator == 'starts':
                            rn_pattern = re.sub(r'\.\*', f'{value}.*', rn_pattern)
                        elif operator == 'ends':
                            rn_pattern = re.sub(r'\.\*', f'.*{value}', rn_pattern)
                        elif operator == 'contains':
                            rn_pattern = re.sub(r'\.\*', f'.*{value}.*', rn_pattern)
                    dn_parts.append(rn_pattern)
                    has_any_constraint = True
            else:
                # No filter - use wildcard RN pattern
                # e.g., for fvTenant without filter: tn-.*
                if rn_format:
                    rn_pattern = re.sub(r'\{[^}]+\}', '.*', rn_format)
                    dn_parts.append(rn_pattern)

        # Only return filter if we have some constraints
        if not has_any_constraint or len(dn_parts) <= 1:
            return None

        # APIC wcard uses regex syntax: .* instead of *
        dn_pattern = '/'.join(dn_parts) + '/.*'
        return f'wcard({intent.class_name}.dn,"{dn_pattern}")'

    def _build_child_class_query(self, intent: QueryIntent) -> Tuple[List[str], Optional[str]]:
        """
        Build child class query parameters for multi-node chains

        Returns:
            Tuple of (child_class_names, filter_expression)
            - child_class_names: List of child class names for rsp-subtree-class
            - filter_expression: Combined filter for rsp-subtree-filter
        """
        logger.info(
            f'[ClassQueryStrategy._build_child_class_query] Processing child classes from chain (total items: {len(intent.class_chain)})'
        )
        child_classes = []
        child_filters = []

        # Skip first item (root class) - we're only interested in child classes
        for idx, item in enumerate(intent.class_chain[1:], start=1):
            class_name = item.get('class_name')
            filter_nodes = item.get('filter_nodes', [])
            logger.info(
                f'[ClassQueryStrategy._build_child_class_query] Child[{idx}]: class={class_name}, filter_nodes count={len(filter_nodes)}'
            )

            if not class_name:
                continue

            child_classes.append(class_name)

            # Build filter expression for this child class - process ALL filters
            for filter_node in filter_nodes:
                data = filter_node.get('data', {})

                # Handle property filters
                if data.get('filterType') == 'property':
                    prop = data.get('property')
                    operator = data.get('operator', 'eq')
                    value = data.get('value')

                    if prop and value is not None:
                        # IMPORTANT: APIC rsp-subtree-filter REQUIRES class prefix
                        # Use className.property format (e.g., "ethpmPhysIf.operSt")
                        full_prop = f'{class_name}.{prop}'
                        expr = MOQueryStrategy()._build_operator_expression(
                            operator, full_prop, value
                        )
                        if expr:
                            child_filters.append(expr)

                # Handle query-target-filter (wildcard patterns)
                elif data.get('filterType') == 'query-target-filter':
                    patterns = data.get('wildcardPatterns', [])
                    pattern_exprs = []

                    for p in patterns:
                        prop = p.get('property')
                        pattern = p.get('pattern')
                        operator = p.get('operator', 'wcard')
                        match_type = p.get('type', 'starts')

                        if not prop or pattern is None:
                            continue

                        # IMPORTANT: APIC rsp-subtree-filter REQUIRES class prefix
                        full_prop = f'{class_name}.{prop}'

                        # For wcard, apply match type patterns
                        if operator == 'wcard':
                            if match_type == 'starts':
                                pattern = f'{pattern}.*'
                            elif match_type == 'ends':
                                pattern = f'.*{pattern}'
                            elif match_type == 'contains':
                                pattern = f'.*{pattern}.*'
                            pattern_exprs.append(f'wcard({full_prop},"{pattern}")')
                        else:
                            # Other operators (eq, ne, etc.)
                            pattern_exprs.append(f'{operator}({full_prop},"{pattern}")')

                    if pattern_exprs:
                        logical_op = data.get('logicalOperator', 'and')
                        if len(pattern_exprs) == 1:
                            child_filters.append(pattern_exprs[0])
                        else:
                            child_filters.append(f'{logical_op}({",".join(pattern_exprs)})')

        # Combine child filters
        combined_filter = None
        if child_filters:
            if len(child_filters) == 1:
                combined_filter = child_filters[0]
            else:
                combined_filter = f'and({",".join(child_filters)})'

        return child_classes, combined_filter

    def _build_url(self, base: str, params: dict) -> str:
        """Build URL with proper encoding"""
        if not params:
            return base

        # IMPORTANT: APIC requires parentheses to be encoded in query strings
        # Do NOT use safe='(),' - encode everything for APIC compatibility
        query_string = urlencode(params)
        return f'{base}?{query_string}'


class NodeClassQueryStrategy(QueryStrategy):
    """Node-local class query — /api/node/class/<className>.json.

    Useful for checking per-node operational state (e.g. interfaces on a specific
    leaf). Not auto-selected because most queries don't need per-node scoping and
    it adds overhead. Callers can force it via QueryExecutor.execute(force_strategy='NodeClass').
    """

    def can_handle(self, intent: QueryIntent) -> bool:
        # Never auto-selected; only runs when explicitly forced
        return False

    def execute(self, intent: QueryIntent) -> Tuple[str, dict]:
        """Execute node/class query"""
        # Similar to ClassQueryStrategy but uses /api/node/class/
        base_url = f'/api/node/class/{intent.class_name}.json'
        # ... rest similar to ClassQueryStrategy

        return base_url, {'strategy': 'NodeClass'}

    def estimate_cost(self, intent: QueryIntent) -> int:
        """Node/Class queries are expensive - 5000+ms"""
        return 6000


class QueryExecutor:
    """Picks the best strategy and runs it.

    Normal flow: strategies are sorted by estimated cost and the first one
    that can_handle() the intent wins. The caller can bypass this by passing
    force_strategy — used by the canvas toolbar's "Force Class" / "Force MO"
    buttons that let power users override the optimizer decision.
    """

    def __init__(self):
        self.strategies = [
            MOQueryStrategy(),
            ClassQueryStrategy(),
            # NodeClassQueryStrategy(),  # Not auto-selected
        ]

    def execute(self, intent: QueryIntent, force_strategy: str = None) -> Tuple[str, dict]:
        """Generate the query URL for the given intent.

        Returns (url, metadata). metadata includes the strategy name, cost
        estimate, and optimization suggestions — shown in the query builder
        UI's info panel so users understand why they got a class vs MO query.
        """
        # Let the user force a specific strategy (expert mode from the toolbar)
        if force_strategy:
            strategy = self._get_strategy_by_name(force_strategy)
            if strategy and strategy.can_handle(intent):
                url, metadata = strategy.execute(intent)
                metadata['forced'] = True
                return url, metadata

        # Auto-select best strategy
        best_strategy = self._select_best_strategy(intent)

        if not best_strategy:
            raise ValueError('No suitable query strategy found')

        url, metadata = best_strategy.execute(intent)

        # Add cost estimate and suggestions
        metadata['estimated_cost'] = self._estimate_cost_level(best_strategy.estimate_cost(intent))
        metadata['suggestions'] = self._generate_suggestions(intent, best_strategy)

        return url, metadata

    def _select_best_strategy(self, intent: QueryIntent) -> Optional[QueryStrategy]:
        """Pick the strategy with the lowest estimated cost that can handle the intent.

        In practice:
          - If a DN can be built → MOQueryStrategy wins (cost ~300ms)
          - Otherwise → ClassQueryStrategy (cost 1500-4000ms)
        """
        candidates = [(s, s.estimate_cost(intent)) for s in self.strategies if s.can_handle(intent)]

        if not candidates:
            return None

        # Select strategy with lowest cost
        best_strategy, best_cost = min(candidates, key=lambda x: x[1])

        logger.info(
            f'[QueryExecutor] Selected {best_strategy.__class__.__name__} (estimated {best_cost}ms)'
        )

        return best_strategy

    def _get_strategy_by_name(self, name: str) -> Optional[QueryStrategy]:
        """Get strategy by name"""
        mapping = {
            'MO': MOQueryStrategy,
            'Class': ClassQueryStrategy,
            'NodeClass': NodeClassQueryStrategy,
        }

        strategy_class = mapping.get(name)
        return strategy_class() if strategy_class else None

    def _estimate_cost_level(self, cost_ms: int) -> str:
        """Convert cost in ms to level"""
        if cost_ms < 1000:
            return 'low'
        elif cost_ms < 3000:
            return 'medium'
        else:
            return 'high'

    def _generate_suggestions(self, intent: QueryIntent, strategy: QueryStrategy) -> List[str]:
        """Generate optimization suggestions for user"""
        suggestions = []

        if isinstance(strategy, ClassQueryStrategy):
            # Suggest using exact match instead of wildcard
            filters = intent.get_filters_for_node(intent.target_node['id'])
            has_wildcard = any(
                f.get('data', {}).get('operator') in ['wcard', 'contains'] for f in filters
            )

            if has_wildcard:
                suggestions.append(
                    'Using wildcard filters. Consider using exact matches (eq) for 10x faster queries.'
                )

            if not filters:
                suggestions.append(
                    'No filters applied. Add filters to improve performance and reduce result size.'
                )

        if isinstance(strategy, MOQueryStrategy):
            suggestions.append('Great! Using DN-based query for optimal performance.')

        return suggestions
