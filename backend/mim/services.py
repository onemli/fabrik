# mim/services.py
#
# Query layer between the MIM views and Neo4j. All Cypher queries live here;
# views never call neo4j_connection directly. Results are cached at multiple
# TTL tiers (see MIMCache) — class details at 30 min, tree structures at 1h,
# stats at 24h. Cache misses fall through to Neo4j automatically.

from typing import Optional

from .neo4j_connection import neo4j_connection
from .cache import MIMCache
from .search import build_search_query, resolve_aliases


# Cypher fragment that derives the ``searchMethod`` chip the frontend
# uses (``exact``/``prefix``/``contains``/``label``/``description``/
# ``fulltext``). Kept as a module-level constant because it appears in
# multiple search queries and the values are part of the API contract.
#
# ``comment`` is an array of paragraphs in the live MIM schema, so the
# label/description checks unwind it into a single concatenated string.
_SEARCH_METHOD_CASE = """
CASE
    WHEN toLower(node.className) = toLower($rawTerm) THEN 'exact'
    WHEN toLower(node.className) STARTS WITH toLower($rawTerm) THEN 'prefix'
    WHEN toLower(node.className) CONTAINS toLower($rawTerm) THEN 'contains'
    WHEN toLower(coalesce(node.label, '')) CONTAINS toLower($rawTerm) THEN 'label'
    WHEN toLower(reduce(s = '', x IN coalesce(node.comment, []) | s + ' ' + x))
         CONTAINS toLower($rawTerm) THEN 'description'
    ELSE 'fulltext'
END
"""

# Live name of the Neo4j fulltext index — matches the one created by
# ``mim_registry.services.loader_v2`` during MIM ingestion. Older code
# referenced a different name; this constant is the single source of
# truth for the new search path.
_FULLTEXT_INDEX = 'class_search'


class MIMService:
    """Runs Cypher queries against the Neo4j MIM graph and returns plain dicts."""

    def get_all_classes(self, limit: int = 100) -> list[dict]:
        """Return all ACI class nodes, ordered alphabetically, up to limit."""
        query = """
        MATCH (c:Class)
        RETURN c.className as className,
               c.label as label,
               c.classPkg as classPkg,
               c.rnFormat as rnFormat,
               c.isContextRoot as isContextRoot,
               c.isConfigurable as isConfigurable,
               c.comment as comment
        ORDER BY c.className
        LIMIT $limit
        """
        return neo4j_connection.execute_query(query, {'limit': limit})

    @MIMCache.cached('class_detail_v2', ttl=MIMCache.TTL_MEDIUM)
    def get_class_by_name(self, class_name: str) -> Optional[dict]:
        """Return full detail for a single ACI class. Cached 30 min.

        Cache key bumped to v2 to invalidate older payloads that lacked
        ``dnFormats``, ``identifiedBy`` and ``superClasses``.
        """
        query = """
        MATCH (c:Class {className: $className})
        RETURN c.className as className,
               c.label as label,
               c.classPkg as classPkg,
               c.rnFormat as rnFormat,
               c.isContextRoot as isContextRoot,
               c.isConfigurable as isConfigurable,
               c.isAbstract as isAbstract,
               c.isDeprecated as isDeprecated,
               c.comment as comment,
               coalesce(c.dnFormats, []) as dnFormats,
               coalesce(c.identifiedBy, []) as identifiedBy,
               coalesce(c.superClasses, []) as superClasses,
               c.moCategory as moCategory,
               c.featureTag as featureTag,
               c.abstractionLayer as abstractionLayer
        """
        results = neo4j_connection.execute_query(query, {'className': class_name})
        return results[0] if results else None

    def get_class_properties(self, class_name: str) -> list[dict]:
        """Return queryable properties for a class.

        Filters out internal-only properties (CHILD_ACTION, RN) and hidden
        ones. STATUS category properties (operSt, adminSt) are kept because
        they're useful as query filters. coalesce() treats NULL category as
        queryable so properties without a category aren't accidentally dropped.
        """
        query = """
        MATCH (c:Class {className: $className})-[:HAS_PROPERTY]->(p:Property)
        WHERE NOT coalesce(p.category, '') IN ['CHILD_ACTION', 'RN']
          AND NOT p.name IN ['childAction', 'monPolDn']
          AND coalesce(p.isHidden, false) = false
        RETURN p.name as name,
               p.isConfigurable as isConfigurable,
               p.isDeprecated as isDeprecated,
               p.isHidden as isHidden,
               p.type as type,
               p.category as category,
               p.values as values,
               p.range as range,
               p.defaultValue as defaultValue,
               p.isNaming as isNaming
        ORDER BY p.name
        """
        return neo4j_connection.execute_query(query, {'className': class_name})

    def get_class_children(self, class_name: str) -> list[dict]:
        """Return direct children of a class via CONTAINS relationships."""
        query = """
        MATCH (parent:Class {className: $className})-[:CONTAINS]->(child:Class)
        RETURN child.className as className,
               child.label as label
        ORDER BY child.className
        """
        return neo4j_connection.execute_query(query, {'className': class_name})

    def search_child_classes(
        self, parent_class: str, search_term: str, limit: int = 100
    ) -> list[dict]:
        """Search within direct children of ``parent_class``.

        Strategy mirrors :meth:`enhanced_search_classes`:

          1. Multi-word and quoted phrases go through Lucene via the
             shared ``classSearchIndex`` — match candidates are then
             intersected with the parent's CONTAINS edges.
          2. If the index is unavailable (fresh install, schema change),
             falls back to a per-token AND substring match so multi-word
             queries still narrow the result set instead of widening it.

        ``searchMethod`` is derived per-result so the UI chips
        (``exact``, ``prefix``, ``contains``, ``label``, ``description``,
        ``fulltext``) keep working even though the underlying engine
        changed.
        """
        term = (search_term or '').strip()
        if not term:
            return self._list_all_children(parent_class, limit)

        lucene_query = build_search_query(term)
        if lucene_query:
            results = self._child_search_via_fulltext(parent_class, term, lucene_query, limit)
            if results:
                return results
        return self._child_search_fallback(parent_class, term, limit)

    def _list_all_children(self, parent_class: str, limit: int) -> list[dict]:
        """Return every direct child of ``parent_class`` — used when the
        caller passes an empty search term to populate the full child set."""
        query = """
        MATCH (parent:Class {className: $parentClass})-[:CONTAINS]->(child:Class)
        RETURN child.className as className,
               child.label as label,
               child.classPkg as classPkg,
               child.comment as comment,
               head(coalesce(child.comment, [])) as description,
               0.0 as relevance,
               'all' as searchMethod
        ORDER BY child.className ASC
        LIMIT $limit
        """
        try:
            return neo4j_connection.execute_query(
                query,
                {'parentClass': parent_class, 'limit': limit},
            )
        except Exception:
            return []

    def _child_search_via_fulltext(
        self,
        parent_class: str,
        raw_term: str,
        lucene_query: str,
        limit: int,
    ) -> list[dict]:
        """Run the compiled Lucene query and constrain to parent's children."""
        query = f"""
        CALL db.index.fulltext.queryNodes('{_FULLTEXT_INDEX}', $luceneQuery)
        YIELD node, score
        MATCH (parent:Class {{className: $parentClass}})-[:CONTAINS]->(node)
        RETURN node.className as className,
               node.label as label,
               node.classPkg as classPkg,
               node.comment as comment,
               head(coalesce(node.comment, [])) as description,
               score as relevance,
               {_SEARCH_METHOD_CASE} as searchMethod
        ORDER BY score DESC, node.className ASC
        LIMIT $limit
        """
        try:
            return neo4j_connection.execute_query(
                query,
                {
                    'parentClass': parent_class,
                    'luceneQuery': lucene_query,
                    'rawTerm': raw_term,
                    'limit': limit,
                },
            )
        except Exception:
            return []

    def _child_search_fallback(
        self,
        parent_class: str,
        raw_term: str,
        limit: int,
    ) -> list[dict]:
        """Per-token AND substring match — used when the fulltext index is
        not yet built. Each whitespace-separated token must appear in at
        least one of className/label/classPkg."""
        tokens = [t for t in raw_term.lower().split() if t]
        if not tokens:
            return []
        per_token = []
        for index, _ in enumerate(tokens):
            param = f'tok{index}'
            per_token.append(
                f'(toLower(child.className) CONTAINS ${param} '
                f"OR toLower(coalesce(child.label, '')) CONTAINS ${param} "
                f'OR toLower(child.classPkg) CONTAINS ${param} '
                f"OR toLower(coalesce(child.qualifiedName, '')) CONTAINS ${param} "
                f"OR toLower(reduce(s = '', x IN coalesce(child.comment, []) | s + ' ' + x)) "
                f'CONTAINS ${param})'
            )
        where_clause = ' AND '.join(per_token)
        query = f"""
        MATCH (parent:Class {{className: $parentClass}})-[:CONTAINS]->(child:Class)
        WHERE {where_clause}
        WITH child, $rawTerm as raw,
             toLower(reduce(s = '', x IN coalesce(child.comment, []) | s + ' ' + x)) as flatComment
        RETURN child.className as className,
               child.label as label,
               child.classPkg as classPkg,
               child.comment as comment,
               head(coalesce(child.comment, [])) as description,
               CASE
                   WHEN toLower(child.className) = toLower(raw) THEN 100.0
                   WHEN toLower(child.className) STARTS WITH toLower(raw) THEN 75.0
                   WHEN toLower(child.className) CONTAINS toLower(raw) THEN 50.0
                   ELSE 25.0
               END as relevance,
               CASE
                   WHEN toLower(child.className) = toLower(raw) THEN 'exact'
                   WHEN toLower(child.className) STARTS WITH toLower(raw) THEN 'prefix'
                   WHEN toLower(child.className) CONTAINS toLower(raw) THEN 'contains'
                   WHEN toLower(coalesce(child.label, '')) CONTAINS toLower(raw) THEN 'label'
                   WHEN flatComment CONTAINS toLower(raw) THEN 'description'
                   ELSE 'fulltext'
               END as searchMethod
        ORDER BY relevance DESC, child.className ASC
        LIMIT $limit
        """
        params: dict = {
            'parentClass': parent_class,
            'rawTerm': raw_term,
            'limit': limit,
        }
        for index, token in enumerate(tokens):
            params[f'tok{index}'] = token
        return neo4j_connection.execute_query(query, params)

    def get_rn_mappings(self, class_name: str) -> list[dict]:
        """Return Relative Name mappings for a class (RN_MAPPING relationships)."""
        query = """
        MATCH (parent:Class {className: $className})-[r:RN_MAPPING]->(child:Class)
        RETURN r.rnPrefix as rnPrefix,
               child.className as className,
               child.label as label
        ORDER BY r.rnPrefix
        """
        return neo4j_connection.execute_query(query, {'className': class_name})

    def search_classes(self, search_term: str, limit: int = 50) -> list[dict]:
        """Search classes by className or label (case-insensitive substring)."""
        query = """
        MATCH (c:Class)
        WHERE toLower(c.className) CONTAINS toLower($searchTerm)
           OR toLower(c.label) CONTAINS toLower($searchTerm)
        RETURN c.className as className,
               c.label as label,
               c.classPkg as classPkg
        ORDER BY c.className
        LIMIT $limit
        """
        return neo4j_connection.execute_query(query, {'searchTerm': search_term, 'limit': limit})

    def get_context_roots(self) -> list[dict]:
        """Return all classes that are context roots (top-level containment anchors)."""
        query = """
        MATCH (c:Class)
        WHERE c.isContextRoot = true
        RETURN c.className as className,
               c.label as label,
               c.classPkg as classPkg
        ORDER BY c.className
        """
        return neo4j_connection.execute_query(query)

    def get_class_hierarchy(self, class_name: str, depth: int = 3) -> list[dict]:
        """Return parent-child containment chain up to `depth` levels deep."""
        depth = min(max(int(depth), 1), 10)
        query = """
        MATCH path = (parent:Class {{className: $className}})-[:CONTAINS*1..{depth}]->(child:Class)
        RETURN parent.className as parent,
               child.className as child,
               length(path) as depth
        ORDER BY depth, child.className
        """.format(depth=depth)
        return neo4j_connection.execute_query(query, {'className': class_name})

    def get_related_classes(self, class_name: str) -> list[dict]:
        """Return all classes connected via CONTAINS or RN_MAPPING relationships."""
        query = """
        MATCH (parent:Class {className: $className})

        // CONTAINS relationships
        OPTIONAL MATCH (parent)-[:CONTAINS]->(child:Class)
        WITH parent, collect(DISTINCT child) as containsNodes

        // RN_MAPPING relationships
        OPTIONAL MATCH (parent)-[r:RN_MAPPING]->(rnChild:Class)
        WITH containsNodes, collect(DISTINCT {child: rnChild, rnPrefix: r.rnPrefix}) as rnNodes

        // Build result arrays
        WITH [node IN containsNodes WHERE node IS NOT NULL | {
            className: node.className,
            label: node.label,
            type: 'CONTAINS'
        }] as containsChildren,
        [item IN rnNodes WHERE item.child IS NOT NULL | {
            className: item.child.className,
            label: item.child.label,
            rnPrefix: item.rnPrefix,
            type: 'RN_MAPPING'
        }] as rnChildren

        RETURN containsChildren + rnChildren as relatedClasses
        """
        result = neo4j_connection.execute_query(query, {'className': class_name})

        if not result or not result[0]:
            return []

        # Return the combined list
        return result[0].get('relatedClasses', [])

    # Patterns for monitoring/stats class names — kept in sync with the
    # frontend `classFilters.ts` MONITORING_REGEX so server-side and
    # client-side hide-monitoring give the same result.
    MONITORING_PATTERN = (
        r'(?i)(stats|ag15min|ag1h|ag5min|fault|health|trend|threshold|event|record)'
    )

    def enhanced_search_classes(
        self,
        search_term: str,
        limit: int = 50,
        package_filter: Optional[str] = None,
        exclude_deprecated: bool = False,
        exclude_abstract: bool = False,
        exclude_hidden: bool = False,
        exclude_monitoring: bool = False,
    ) -> list[dict]:
        """
        Enhanced class search using Neo4j full-text index with weighted results.

        Strategy:
            1. Empty term + package filter → browse mode (all classes in pkg)
            2. Term contains '/' → DN pattern search (Faz 2.4)
            3. Try full-text index (fuzzy)
            4. Fall back to manual weighted UNION

        All branches honor the same filter flags so the response is consistent
        regardless of which path executed.
        """
        filter_args = dict(
            exclude_deprecated=exclude_deprecated,
            exclude_abstract=exclude_abstract,
            exclude_hidden=exclude_hidden,
            exclude_monitoring=exclude_monitoring,
        )

        # Browse mode: empty term + package filter
        if not search_term and package_filter:
            return self._browse_package(package_filter, limit, **filter_args)

        # DN pattern search: term contains slash
        if '/' in search_term:
            return self._dn_pattern_search(search_term, limit, package_filter, **filter_args)

        # Compile the user query into Lucene syntax — multi-word AND,
        # phrase support, field-weighted boosts, ACI alias expansion.
        # Empty output means we have no usable terms; fall through to the
        # manual fallback so the user still sees something useful.
        lucene_query = build_search_query(search_term)
        if lucene_query:
            results = self._fulltext_search(
                lucene_query,
                search_term,
                limit,
                package_filter,
                filter_args,
            )
            if results:
                return self._reorder_alias_hits(search_term, results)

        # Fallback: Multi-tier manual search (exact, prefix, contains)
        return self._fallback_weighted_search(search_term, limit, package_filter, **filter_args)

    def _fulltext_search(
        self,
        lucene_query: str,
        raw_term: str,
        limit: int,
        package_filter: Optional[str],
        filter_args: dict,
    ) -> list[dict]:
        """Run the compiled Lucene query against the class index. Returns
        an empty list if the index does not exist or Lucene rejects the
        query — caller falls back to the manual UNION search."""
        extra_where = self._build_filter_where('node', **filter_args)
        query = f"""
        CALL db.index.fulltext.queryNodes('{_FULLTEXT_INDEX}', $luceneQuery)
        YIELD node, score
        WHERE ($packageFilter IS NULL OR node.classPkg = $packageFilter)
        {extra_where}
        RETURN node.className as className,
               node.label as label,
               node.classPkg as classPkg,
               head(coalesce(node.comment, [])) as description,
               coalesce(node.isAbstract, false) as isAbstract,
               coalesce(node.isDeprecated, false) as isDeprecated,
               coalesce(node.isHidden, false) as isHidden,
               coalesce(node.isContextRoot, false) as isContextRoot,
               score as relevance,
               {_SEARCH_METHOD_CASE} as searchMethod
        ORDER BY score DESC
        LIMIT $limit
        """
        try:
            return neo4j_connection.execute_query(
                query,
                {
                    'luceneQuery': lucene_query,
                    'rawTerm': raw_term,
                    'packageFilter': package_filter,
                    'limit': limit,
                    'monitoringPattern': self.MONITORING_PATTERN,
                },
            )
        except Exception:
            return []

    @staticmethod
    def _reorder_alias_hits(raw_term: str, results: list[dict]) -> list[dict]:
        """Pin alias-matched classNames to the top of the result list.

        Lucene boosts already favour them, but a bad description match in
        a different class can still outrank an alias hit. Manually moving
        the alias targets to the front guarantees ``vrf`` always shows
        ``fvCtx`` first."""
        alias_targets = resolve_aliases(raw_term)
        if not alias_targets:
            return results
        target_index = {name: pos for pos, name in enumerate(alias_targets)}
        pinned, others = [], []
        for row in results:
            (pinned if row.get('className') in target_index else others).append(row)
        pinned.sort(key=lambda row: target_index.get(row.get('className'), 0))
        return pinned + others

    @staticmethod
    def _build_filter_where(alias: str = 'c', **flags) -> str:
        """Compose extra Cypher WHERE clauses for filter flags. Empty string
        when nothing is excluded — so the surrounding query stays valid."""
        clauses = []
        if flags.get('exclude_deprecated'):
            clauses.append(f'coalesce({alias}.isDeprecated, false) = false')
        if flags.get('exclude_abstract'):
            clauses.append(f'coalesce({alias}.isAbstract, false) = false')
        if flags.get('exclude_hidden'):
            clauses.append(f'coalesce({alias}.isHidden, false) = false')
        if flags.get('exclude_monitoring'):
            clauses.append(f"NOT toLower({alias}.className) =~ '.*' + $monitoringPattern + '.*'")
        return ('AND ' + ' AND '.join(clauses)) if clauses else ''

    def _browse_package(self, package: str, limit: int, **flags) -> list[dict]:
        """List all classes in a package. Used when the user picks a package
        and clears the search term — power-user discovery for niche packages."""
        extra_where = self._build_filter_where('c', **flags)
        query = f"""
        MATCH (c:Class)
        WHERE c.classPkg = $package
        {extra_where}
        RETURN c.className as className,
               c.label as label,
               c.classPkg as classPkg,
               c.description as description,
               coalesce(c.isAbstract, false) as isAbstract,
               coalesce(c.isDeprecated, false) as isDeprecated,
               coalesce(c.isHidden, false) as isHidden,
               coalesce(c.isContextRoot, false) as isContextRoot,
               40.0 as relevance,
               'package' as searchMethod
        ORDER BY c.className
        LIMIT $limit
        """
        return neo4j_connection.execute_query(
            query,
            {
                'package': package,
                'limit': limit,
                'monitoringPattern': self.MONITORING_PATTERN,
            },
        )

    def _dn_pattern_search(
        self,
        search_term: str,
        limit: int,
        package_filter: Optional[str],
        **flags,
    ) -> list[dict]:
        """Search the dnFormats array — power users hand-typing path fragments
        like ``uni/tn-`` or ``/BD-``. dnFormats is populated for every class
        that has a canonical DN (most concrete classes)."""
        extra_where = self._build_filter_where('c', **flags)
        query = f"""
        MATCH (c:Class)
        WHERE any(dn IN coalesce(c.dnFormats, []) WHERE toLower(dn) CONTAINS toLower($searchTerm))
          AND ($packageFilter IS NULL OR c.classPkg = $packageFilter)
        {extra_where}
        RETURN c.className as className,
               c.label as label,
               c.classPkg as classPkg,
               c.description as description,
               coalesce(c.isAbstract, false) as isAbstract,
               coalesce(c.isDeprecated, false) as isDeprecated,
               coalesce(c.isHidden, false) as isHidden,
               coalesce(c.isContextRoot, false) as isContextRoot,
               60.0 as relevance,
               'dn' as searchMethod
        ORDER BY size(coalesce(c.dnFormats, [])) ASC, c.className
        LIMIT $limit
        """
        return neo4j_connection.execute_query(
            query,
            {
                'searchTerm': search_term,
                'packageFilter': package_filter,
                'limit': limit,
                'monitoringPattern': self.MONITORING_PATTERN,
            },
        )

    def _fallback_weighted_search(
        self,
        search_term: str,
        limit: int = 50,
        package_filter: Optional[str] = None,
        exclude_deprecated: bool = False,
        exclude_abstract: bool = False,
        exclude_hidden: bool = False,
        exclude_monitoring: bool = False,
    ) -> list[dict]:
        """
        Fallback search when full-text index is not available
        Uses weighted UNION of exact, prefix, and contains matches
        """
        flags = dict(
            exclude_deprecated=exclude_deprecated,
            exclude_abstract=exclude_abstract,
            exclude_hidden=exclude_hidden,
            exclude_monitoring=exclude_monitoring,
        )
        extra = self._build_filter_where('c', **flags)
        # Helper macros: project the same metadata columns from every UNION
        # branch so the consumer (and chips in the UI) see consistent shape.
        projection = """
               c.className as className,
               c.label as label,
               c.classPkg as classPkg,
               c.description as description,
               coalesce(c.isAbstract, false) as isAbstract,
               coalesce(c.isDeprecated, false) as isDeprecated,
               coalesce(c.isHidden, false) as isHidden,
               coalesce(c.isContextRoot, false) as isContextRoot
        """
        query = f"""
        // Exact match (score: 100)
        MATCH (c:Class)
        WHERE toLower(c.className) = toLower($searchTerm)
          AND ($packageFilter IS NULL OR c.classPkg = $packageFilter)
          {extra}
        RETURN {projection},
               100.0 as relevance,
               'exact' as searchMethod

        UNION

        // Prefix match (score: 75)
        MATCH (c:Class)
        WHERE toLower(c.className) STARTS WITH toLower($searchTerm)
          AND toLower(c.className) <> toLower($searchTerm)
          AND ($packageFilter IS NULL OR c.classPkg = $packageFilter)
          {extra}
        RETURN {projection},
               75.0 as relevance,
               'prefix' as searchMethod

        UNION

        // Contains match in className (score: 50)
        MATCH (c:Class)
        WHERE toLower(c.className) CONTAINS toLower($searchTerm)
          AND NOT toLower(c.className) STARTS WITH toLower($searchTerm)
          AND ($packageFilter IS NULL OR c.classPkg = $packageFilter)
          {extra}
        RETURN {projection},
               50.0 as relevance,
               'contains' as searchMethod

        UNION

        // Label match (score: 25)
        MATCH (c:Class)
        WHERE toLower(c.label) CONTAINS toLower($searchTerm)
          AND NOT toLower(c.className) CONTAINS toLower($searchTerm)
          AND ($packageFilter IS NULL OR c.classPkg = $packageFilter)
          {extra}
        RETURN {projection},
               25.0 as relevance,
               'label' as searchMethod

        UNION

        // Description match (score: 20)
        MATCH (c:Class)
        WHERE c.description IS NOT NULL
          AND toLower(c.description) CONTAINS toLower($searchTerm)
          AND NOT toLower(c.className) CONTAINS toLower($searchTerm)
          AND NOT toLower(c.label) CONTAINS toLower($searchTerm)
          AND ($packageFilter IS NULL OR c.classPkg = $packageFilter)
          {extra}
        RETURN {projection},
               20.0 as relevance,
               'description' as searchMethod

        ORDER BY relevance DESC, className ASC
        LIMIT $limit
        """

        return neo4j_connection.execute_query(
            query,
            {
                'searchTerm': search_term,
                'packageFilter': package_filter,
                'limit': limit,
                'monitoringPattern': self.MONITORING_PATTERN,
            },
        )

    def search_classes_by_property(
        self,
        term: str,
        limit: int = 50,
        package_filter: Optional[str] = None,
        exclude_deprecated: bool = False,
        exclude_abstract: bool = False,
        exclude_hidden: bool = False,
        exclude_monitoring: bool = False,
    ) -> list[dict]:
        """Find classes that own a property whose name or label matches `term`.

        Used by Faz 2.2 — power-user search like "encap" → fvAEPg, l3extInstP,
        infraInfra, … each annotated with the matched property names so the
        UI can show why the class qualified. Honors the same filter flags as
        enhanced_search_classes so the chip toggles in the dialog narrow
        property-mode results too."""
        flags = dict(
            exclude_deprecated=exclude_deprecated,
            exclude_abstract=exclude_abstract,
            exclude_hidden=exclude_hidden,
            exclude_monitoring=exclude_monitoring,
        )
        extra = self._build_filter_where('c', **flags)
        query = f"""
        MATCH (c:Class)-[:HAS_PROPERTY]->(p:Property)
        WHERE (toLower(p.name) CONTAINS toLower($term) OR toLower(coalesce(p.label, '')) CONTAINS toLower($term))
          AND coalesce(p.isHidden, false) = false
          AND ($packageFilter IS NULL OR c.classPkg = $packageFilter)
          {extra}
        WITH c, collect(DISTINCT p.name) as matchedProps
        RETURN c.className as className,
               c.label as label,
               c.classPkg as classPkg,
               c.description as description,
               coalesce(c.isAbstract, false) as isAbstract,
               coalesce(c.isDeprecated, false) as isDeprecated,
               coalesce(c.isHidden, false) as isHidden,
               coalesce(c.isContextRoot, false) as isContextRoot,
               matchedProps[..5] as matchedProperties,
               (50.0 + size(matchedProps) * 5.0) as relevance,
               'property' as searchMethod
        ORDER BY size(matchedProps) DESC, c.className
        LIMIT $limit
        """
        return neo4j_connection.execute_query(
            query,
            {
                'term': term,
                'packageFilter': package_filter,
                'limit': limit,
                'monitoringPattern': self.MONITORING_PATTERN,
            },
        )

    def get_package_list(self) -> list[dict]:
        """
        Get list of all unique packages with class counts
        Useful for category filtering in UI
        """
        query = """
        MATCH (c:Class)
        WHERE c.classPkg IS NOT NULL
        RETURN c.classPkg as package,
               count(c) as classCount
        ORDER BY package
        """
        return neo4j_connection.execute_query(query)

    def get_top_packages(self, limit: int = 20) -> list[dict]:
        """
        Get most common packages (by class count)
        Useful for showing popular categories first
        """
        query = """
        MATCH (c:Class)
        WHERE c.classPkg IS NOT NULL
        RETURN c.classPkg as package,
               count(c) as classCount
        ORDER BY classCount DESC
        LIMIT $limit
        """
        return neo4j_connection.execute_query(query, {'limit': limit})

    # ========================================================================
    # MODEL EXPLORER - UNIVERSAL SEARCH
    # ========================================================================

    @MIMCache.cached('universal_search', ttl=MIMCache.TTL_SHORT)
    def universal_search(self, search_query: str, limit: int = 20) -> dict:
        """
        Universal search across classes, properties, and relationships
        Searches in: className, label, description, comment, properties
        CACHED: 5 min TTL (search results change frequently)

        Returns categorized results with relevance scores:
        {
            'classes': [...],
            'properties': [...],
            'relationships': [...]
        }
        """
        if not search_query or len(search_query.strip()) < 2:
            return {'classes': [], 'properties': [], 'relationships': []}

        search_term = search_query.strip()

        # Try full-text search first (if indexes exist)
        try:
            results = self._fulltext_universal_search(search_term, limit)
            if results['classes'] or results['properties']:
                return results
        except Exception:
            # Indexes might not exist, fall back to manual search
            pass

        # Fallback to manual search
        return self._manual_universal_search(search_term, limit)

    def _fulltext_universal_search(self, search_term: str, limit: int) -> dict:
        """Universal search using Neo4j full-text indexes"""

        # Search classes using full-text index
        class_query = """
        CALL db.index.fulltext.queryNodes('classSearchIndex', $searchTerm)
        YIELD node, score
        RETURN node.className as className,
               node.label as label,
               node.description as description,
               node.comment as comment,
               node.classPkg as classPkg,
               score
        ORDER BY score DESC
        LIMIT $limit
        """

        classes = neo4j_connection.execute_query(
            class_query, {'searchTerm': f'{search_term}~ OR {search_term}', 'limit': limit}
        )

        # Search properties using full-text index
        property_query = """
        CALL db.index.fulltext.queryNodes('propertySearchIndex', $searchTerm)
        YIELD node, score
        RETURN node.className as className,
               node.name as propertyName,
               node.description as description,
               node.type as type,
               node.category as category,
               score
        ORDER BY score DESC
        LIMIT $limit
        """

        properties = neo4j_connection.execute_query(
            property_query, {'searchTerm': f'{search_term}~ OR {search_term}', 'limit': limit}
        )

        # Find relationship matches
        relationships = self._search_relationships(search_term, limit // 2)

        return {
            'classes': classes or [],
            'properties': properties or [],
            'relationships': relationships or [],
        }

    def _manual_universal_search(self, search_term: str, limit: int) -> dict:
        """Fallback manual search when full-text indexes don't exist"""

        # Search classes
        # Note: comment field is stored as array, use reduce() to convert to string for search
        class_query = """
        MATCH (c:Class)
        WITH c, reduce(s = '', x IN coalesce(c.comment, []) | s + ' ' + x) as commentStr
        WHERE toLower(c.className) CONTAINS toLower($searchTerm)
           OR toLower(coalesce(c.label, '')) CONTAINS toLower($searchTerm)
           OR toLower(commentStr) CONTAINS toLower($searchTerm)
        RETURN c.className as className,
               c.label as label,
               c.description as description,
               c.comment as comment,
               c.classPkg as classPkg,
               CASE
                 WHEN toLower(c.className) = toLower($searchTerm) THEN 100.0
                 WHEN toLower(c.className) STARTS WITH toLower($searchTerm) THEN 75.0
                 WHEN toLower(coalesce(c.label, '')) CONTAINS toLower($searchTerm) THEN 50.0
                 ELSE 25.0
               END as score
        ORDER BY score DESC, c.className
        LIMIT $limit
        """

        classes = neo4j_connection.execute_query(
            class_query, {'searchTerm': search_term, 'limit': limit}
        )

        # Search properties
        property_query = """
        MATCH (c:Class)-[:HAS_PROPERTY]->(p:Property)
        WHERE toLower(p.name) CONTAINS toLower($searchTerm)
           OR toLower(p.description) CONTAINS toLower($searchTerm)
        RETURN c.className as className,
               p.name as propertyName,
               p.description as description,
               p.type as type,
               p.category as category,
               CASE
                 WHEN toLower(p.name) = toLower($searchTerm) THEN 100.0
                 WHEN toLower(p.name) STARTS WITH toLower($searchTerm) THEN 75.0
                 ELSE 25.0
               END as score
        ORDER BY score DESC, c.className, p.name
        LIMIT $limit
        """

        properties = neo4j_connection.execute_query(
            property_query, {'searchTerm': search_term, 'limit': limit}
        )

        # Find relationships
        relationships = self._search_relationships(search_term, limit // 2)

        return {
            'classes': classes or [],
            'properties': properties or [],
            'relationships': relationships or [],
        }

    def _search_relationships(self, search_term: str, limit: int) -> list[dict]:
        """Search for relationships (contains/parent-child)"""
        query = """
        MATCH (parent:Class)-[:CONTAINS]->(child:Class)
        WHERE toLower(parent.className) CONTAINS toLower($searchTerm)
           OR toLower(child.className) CONTAINS toLower($searchTerm)
           OR toLower(parent.label) CONTAINS toLower($searchTerm)
           OR toLower(child.label) CONTAINS toLower($searchTerm)
        RETURN parent.className as parentClass,
               parent.label as parentLabel,
               child.className as childClass,
               child.label as childLabel,
               'CONTAINS' as relationshipType
        ORDER BY parent.className, child.className
        LIMIT $limit
        """

        return neo4j_connection.execute_query(query, {'searchTerm': search_term, 'limit': limit})

    # ========================================================================
    # MODEL EXPLORER - CLASS TREE
    # ========================================================================

    @MIMCache.cached('class_tree', ttl=MIMCache.TTL_LONG)
    def get_class_tree(self, root_class: str = 'polUni', max_depth: int = 1) -> list[dict]:
        """
        Get hierarchical tree structure starting from root class
        OPTIMIZED: Returns flat list with childCount, UI does lazy loading
        CACHED: 1 hour TTL (tree structure rarely changes)

        Args:
            root_class: Starting point (default: polUni - Policy Universe)
            max_depth: Maximum depth to traverse (ignored, always returns depth=1)

        Returns:
            Simple list with root + direct children
        """
        # Simple query - just root and its direct children
        # Fixed: Can't use aggregate inside aggregate, so calculate childCount separately
        query = """
        MATCH (root:Class {className: $rootClass})
        OPTIONAL MATCH (root)-[:CONTAINS]->(child:Class)

        // Calculate grandchild count for each child separately
        OPTIONAL MATCH (child)-[:CONTAINS]->(grandchild:Class)
        WITH root,
             child.className as childClassName,
             child.label as childLabel,
             child.description as childDescription,
             child.classPkg as childClassPkg,
             count(DISTINCT grandchild) as grandchildCount

        // Group back by root to build final structure
        WITH root,
             collect({
                 className: childClassName,
                 label: childLabel,
                 description: childDescription,
                 classPkg: childClassPkg,
                 childCount: grandchildCount
             }) as children

        RETURN root.className as className,
               root.label as label,
               root.description as description,
               root.classPkg as classPkg,
               0 as depth,
               size([c IN children WHERE c.className IS NOT NULL]) as childCount,
               [c IN children WHERE c.className IS NOT NULL] as children
        """

        results = neo4j_connection.execute_query(query, {'rootClass': root_class})

        if not results or len(results) == 0:
            return []

        # Format result
        root = results[0]
        # Filter out null children
        children = [c for c in root.get('children', []) if c.get('className')]

        return [
            {
                'className': root['className'],
                'label': root['label'],
                'description': root['description'],
                'classPkg': root['classPkg'],
                'childCount': root['childCount'],
                'children': children,
            }
        ]

    @MIMCache.cached('relationships', ttl=MIMCache.TTL_STATIC)
    def get_all_relationships(
        self, class_name: str, children_limit: Optional[int] = None, children_offset: int = 0
    ) -> dict:
        """
        Get comprehensive relationship information for a class
        CACHED: 24 hour TTL (relationships rarely change)
        OPTIMIZED: Supports pagination for children to improve performance

        Args:
            class_name: Target class name
            children_limit: Max children to return (None = all, recommended: 50)
            children_offset: Pagination offset for children (default: 0)

        Returns:
        {
            'parents': [...],           # Classes that contain this class
            'children': [...],          # Classes this contains (paginated)
            'properties': [...],        # All properties
            'rnMappings': [...],        # RN mapping relationships
            'childrenTotal': int,       # Total number of children (for pagination)
            'childrenHasMore': bool     # Whether more children exist
        }
        """
        # OPTIMIZED: Single efficient query with modern Neo4j syntax
        # Uses CALL (variable) subquery for best performance
        query = """
        MATCH (target:Class {className: $className})

        // Get parents - simple traversal
        CALL (target) {
            OPTIONAL MATCH (parent:Class)-[:CONTAINS]->(target)
            RETURN collect({
                className: parent.className,
                label: parent.label,
                classPkg: parent.classPkg
            }) as parents
        }

        // Get total children count
        CALL (target) {
            MATCH (target)-[:CONTAINS]->(child:Class)
            RETURN count(child) as childCount
        }

        // Get paginated children with grandchild counts
        CALL (target) {
            MATCH (target)-[:CONTAINS]->(child:Class)
            OPTIONAL MATCH (child)-[:CONTAINS]->(grandchild:Class)
            WITH child, count(DISTINCT grandchild) as gcCount
            ORDER BY child.className
            SKIP $skip
            LIMIT $limit
            RETURN collect({
                className: child.className,
                label: child.label,
                classPkg: child.classPkg,
                childCount: gcCount
            }) as children
        }

        // Get properties - filtered (handle NULL categories)
        // Note: STATUS category kept for operSt, adminSt etc. Only filter specific useless properties.
        CALL (target) {
            MATCH (target)-[:HAS_PROPERTY]->(prop:Property)
            WHERE NOT coalesce(prop.category, '') IN ['CHILD_ACTION', 'RN']
              AND NOT prop.name IN ['childAction', 'monPolDn']
              AND coalesce(prop.isHidden, false) = false
            RETURN collect({
                name: prop.name,
                type: prop.type,
                category: prop.category,
                isConfigurable: prop.isConfigurable,
                values: prop.values
            }) as properties
        }

        // Get RN mappings
        CALL (target) {
            OPTIONAL MATCH (target)-[rn:RN_MAPPING]->(rnChild:Class)
            RETURN collect({
                className: rnChild.className,
                label: rnChild.label,
                rnPrefix: rn.rnPrefix
            }) as rnMappings
        }

        RETURN
            [p IN parents WHERE p.className IS NOT NULL] as parents,
            childCount,
            children,
            [p IN properties WHERE p.name IS NOT NULL] as properties,
            [r IN rnMappings WHERE r.className IS NOT NULL] as rnMappings
        """

        skip = children_offset
        limit = children_limit if children_limit is not None else 1000

        result = neo4j_connection.execute_query(
            query, {'className': class_name, 'skip': skip, 'limit': limit}
        )

        if not result or not result[0]:
            return {
                'parents': [],
                'children': [],
                'properties': [],
                'rnMappings': [],
                'childrenTotal': 0,
                'childrenHasMore': False,
            }

        data = result[0]
        total_children = data.get('childCount', 0)
        children = data.get('children', [])
        has_more = (children_offset + len(children)) < total_children

        return {
            'parents': data.get('parents', []),
            'children': children,
            'properties': data.get('properties', []),
            'rnMappings': data.get('rnMappings', []),
            'childrenTotal': total_children,
            'childrenHasMore': has_more,
        }

    # ========================================================================
    # PHASE 1 QUICK WINS - CLASS INSIGHTS
    # ========================================================================

    def filter_smart_children(self, children: list[dict]) -> dict:
        """
        Filter out stats/monitoring classes, prioritize configurable ones

        Algorithm:
        1. Exclude stats/monitoring classes (Stats, Ag15min, Hist, Counter, etc.)
        2. Exclude fault/health internal classes
        3. Prioritize configurable classes
        4. Return top 25 (configurable + non-configurable mix)

        Args:
            children: List of child class dicts with className, label, classPkg

        Returns:
            {
                'common': [...],       # Top 25 useful children
                'statsCount': int,     # Number of stats classes filtered out
                'totalCount': int      # Original total count
            }
        """
        if not children:
            return {'common': [], 'statsCount': 0, 'totalCount': 0}

        # Stats/monitoring class patterns to exclude
        stats_patterns = [
            'Stats',
            'Ag15min',
            'Ag1h',
            'Ag1d',
            'Ag1mo',
            'Ag1qtr',
            'Ag1w',
            'Ag1year',
            'Ag5min',
            'AgHist',
            'Hist15min',
            'Hist1d',
            'Hist1h',
            'Counter',
            'OverallHealth',
            'Fault',
            'Health',
            'Db',
            'DbgAc',
        ]

        total_count = len(children)

        # Filter out stats/monitoring classes
        filtered = []
        for child in children:
            class_name = child.get('className', '')
            # Check if any stats pattern is in the class name
            if any(pattern in class_name for pattern in stats_patterns):
                continue
            filtered.append(child)

        stats_count = total_count - len(filtered)

        # Prioritize important operational/config classes
        priority_patterns = ['ethpm', 'fabric', 'l1', 'l2', 'l3', 'fv', 'vz', 'ip']

        priority_children = []
        regular_children = []

        for child in filtered:
            class_name = child.get('className', '').lower()
            # Check if starts with priority pattern
            if any(class_name.startswith(pattern) for pattern in priority_patterns):
                priority_children.append(child)
            else:
                regular_children.append(child)

        # Sort both groups alphabetically
        priority_sorted = sorted(priority_children, key=lambda x: x.get('className', ''))
        regular_sorted = sorted(regular_children, key=lambda x: x.get('className', ''))

        # Combine: priority first, then regular
        filtered_sorted = priority_sorted + regular_sorted

        # Return top 50 (increased from 25)
        common = filtered_sorted[:50]

        return {'common': common, 'statsCount': stats_count, 'totalCount': total_count}

    def _find_canonical_path(self, class_name: str) -> list[dict]:
        """
        Find the canonical DN containment path from polUni to the target class.

        The challenge: Neo4j's shortestPath picks by hop count only, which returns
        incorrect "shortcut" paths in the ACI MIM. Two failure modes:

          1. vnsSDEPpInfo (isConfigurable=false, depth=1) → fvCEp: shorter than the
             correct fvAEPg (depth=3) → fvCEp path.

          2. fvCtx (VRF, depth=2) → fvCEp: shorter than fvAEPg (depth=3) → fvCEp.
             fvCtx is fully configurable, so filtering by isConfigurable alone is
             insufficient. The VRF contains fvCEp for operational (endpoint table)
             access, but the canonical ACI DN for fvCEp is always under fvAEPg.

        Solution (three-stage with parent-depth scoring):

          Stage 1 — Find the "best" direct parent of the target:
            - Among all configurable parents, find the one with the maximum depth
              from polUni via a configurable-only path. Deeper parent = more
              specific policy container (fvAEPg at depth 3 wins over fvCtx at 2).
            - Tiebreak by number of direct children (more children = more
              important container — fvAEPg 369 children > fvESg 343).

          Stage 2 — Build the full path by finding the canonical path to that
            parent (configurable-only) and appending the target.

          Stage 3 — Fallback: any shortest path from polUni to target, used when
            all parents are non-configurable (VNS-only classes etc.).

        Returns list of {className, rnFormat} dicts from polUni to target inclusive.
        """
        if class_name == 'polUni':
            return [{'className': 'polUni', 'rnFormat': 'uni'}]

        # Stage 1: Pick the deepest configurable direct parent.
        # polUni is excluded as a parent to avoid shortestPath self-loop errors.
        # When the parent IS polUni (i.e. target is a direct child of polUni like
        # fvTenant), depth = 0, which is still preferred over a null-depth parent.
        best_parent_query = """
        MATCH (parent:Class)-[:CONTAINS]->(target:Class {className: $className})
        WHERE coalesce(parent.isConfigurable, true) = true
        WITH parent,
             CASE WHEN parent.className = 'polUni' THEN 0 ELSE null END as fixedDepth
        OPTIONAL MATCH depthPath = shortestPath(
            (root:Class {className: 'polUni'})-[:CONTAINS*]->(parent)
        )
        WHERE parent.className <> 'polUni'
          AND NONE(n IN nodes(depthPath)[1..-1] WHERE n.isConfigurable = false)
        WITH parent,
             coalesce(fixedDepth, length(depthPath)) as depth
        OPTIONAL MATCH (parent)-[:CONTAINS]->(child:Class)
        RETURN parent.className as parentClass,
               parent.rnFormat as parentRn,
               depth,
               count(DISTINCT child) as childCount
        ORDER BY CASE WHEN depth IS NULL THEN -1 ELSE depth END DESC,
                 childCount DESC
        LIMIT 1
        """

        parent_result = neo4j_connection.execute_query(best_parent_query, {'className': class_name})

        # Maximum configurable depth for the preferred parent.
        # Classes like faultInst have 1000+ parents at all depth levels; without a cap
        # the algorithm picks a very deep, specific parent (e.g. a 10-hop l3ext path).
        # Most ACI policy objects are within 5 hops of polUni, so parents beyond
        # this depth are usually operational-specific, not canonical containment.
        MAX_PARENT_DEPTH = 5

        preferred_parent = None
        if parent_result and parent_result[0]:
            row = parent_result[0]
            depth = row.get('depth')
            # Only use the preferred parent if a valid configurable depth was found
            # and the parent is not unreasonably deep (avoids l3ext/vns operational paths
            # for polymorphic classes like faultInst that have thousands of parents).
            if depth is not None and depth <= MAX_PARENT_DEPTH:
                preferred_parent = row.get('parentClass')

        if preferred_parent:
            # Stage 2: Recursively build the canonical path to the preferred parent,
            # then append the target class.
            # Recursion depth is naturally bounded by the ACI DN depth (≤15 levels).
            parent_path = self._find_canonical_path(preferred_parent)
            if parent_path:
                # Fetch target's rnFormat for the final node.
                target_rn_query = """
                MATCH (t:Class {className: $className})
                RETURN t.rnFormat as rnFormat
                """
                rn_result = neo4j_connection.execute_query(
                    target_rn_query, {'className': class_name}
                )
                target_rn = rn_result[0].get('rnFormat', '') if rn_result and rn_result[0] else ''
                return parent_path + [{'className': class_name, 'rnFormat': target_rn}]

        # Stage 3: Fallback — any shortest path regardless of configurability.
        # Used for classes that only exist under operational/read-only parents.
        fallback_query = """
        MATCH (root:Class {className: 'polUni'}), (target:Class {className: $className})
        WHERE target.className <> 'polUni'
        OPTIONAL MATCH path = shortestPath((root)-[:CONTAINS*]->(target))
        RETURN [n IN nodes(path) | {className: n.className, rnFormat: n.rnFormat}] as pathNodes
        """
        result = neo4j_connection.execute_query(fallback_query, {'className': class_name})
        if result and result[0]:
            return result[0].get('pathNodes') or []
        return []

    def build_dn_pattern(self, class_name: str) -> dict:
        """
        Build DN pattern with example for a class.

        Generates full DN path from polUni (root) to target class.
        Example: uni/tn-{tenant}/BD-{name}

        Args:
            class_name: Target class name

        Returns:
            {
                'pattern': 'uni/tn-{tenant}/BD-{name}',
                'example': 'uni/tn-production/BD-web-bd',
                'rnFormat': 'BD-{name}',
                'isContextRoot': False
            }
        """
        # Fetch class metadata (rnFormat, isContextRoot) independently of the path.
        meta_query = """
        MATCH (target:Class {className: $className})
        RETURN target.rnFormat as rnFormat, target.isContextRoot as isContextRoot
        """
        meta_result = neo4j_connection.execute_query(meta_query, {'className': class_name})
        if not meta_result or not meta_result[0]:
            return {'pattern': None, 'example': None, 'rnFormat': None, 'isContextRoot': False}

        rn_format = meta_result[0].get('rnFormat', '')
        is_context_root = meta_result[0].get('isContextRoot', False)

        # Get canonical containment path (prefers configurable-only routes).
        path_nodes = self._find_canonical_path(class_name)

        # Build DN pattern from path.
        if not path_nodes or len(path_nodes) < 2:
            # No parent path — root-level or context root class.
            pattern = rn_format or class_name
            example = self._generate_example_dn(rn_format)
        else:
            dn_parts = []
            example_parts = []
            for i, node in enumerate(path_nodes):
                node_rn = node.get('rnFormat', '')
                if i == 0:
                    # polUni maps to the literal "uni" segment.
                    dn_parts.append('uni')
                    example_parts.append('uni')
                else:
                    dn_parts.append(node_rn)
                    example_parts.append(self._generate_example_dn(node_rn))
            pattern = '/'.join(dn_parts)
            example = '/'.join(example_parts)

        return {
            'pattern': pattern,
            'example': example,
            'rnFormat': rn_format,
            'isContextRoot': is_context_root,
        }

    def get_class_ancestors(self, class_name: str) -> list[dict]:
        """
        Get the containment path from polUni to the target class.

        Used for lazy-load tree deep-linking — determines which tree nodes
        need to be expanded to reveal the target class.

        Returns list of {className, label, classPkg, childCount} dicts ordered
        from polUni (root) to the target class, or empty list if not found.
        Uses _find_canonical_path to prefer configurable containment routes
        over shorter operational/read-only paths.
        """
        if class_name == 'polUni':
            # polUni is the root; return just itself with its child count.
            count_query = """
            MATCH (root:Class {className: 'polUni'})-[:CONTAINS]->(child:Class)
            RETURN count(DISTINCT child) as childCount
            """
            count_result = neo4j_connection.execute_query(count_query, {})
            child_count = (
                count_result[0].get('childCount', 0) if count_result and count_result[0] else 0
            )
            return [
                {
                    'className': 'polUni',
                    'label': 'Policy Universe',
                    'classPkg': 'top',
                    'childCount': child_count,
                }
            ]

        # Get canonical path nodes (className + rnFormat only, minimal query).
        path_nodes = self._find_canonical_path(class_name)
        if not path_nodes:
            return []

        class_names = [n['className'] for n in path_nodes if n.get('className')]
        if not class_names:
            return []

        # Fetch full metadata + childCount for all path nodes in one query.
        detail_query = """
        UNWIND $classNames as cn
        MATCH (node:Class {className: cn})
        OPTIONAL MATCH (node)-[:CONTAINS]->(child:Class)
        RETURN node.className as className,
               node.label as label,
               node.classPkg as classPkg,
               count(DISTINCT child) as childCount
        """
        detail_result = neo4j_connection.execute_query(detail_query, {'classNames': class_names})

        # Build a lookup dict and reassemble in path order.
        detail_map = {}
        for row in detail_result or []:
            if row and row.get('className'):
                detail_map[row['className']] = {
                    'className': row['className'],
                    'label': row.get('label'),
                    'classPkg': row.get('classPkg'),
                    'childCount': row.get('childCount', 0),
                }

        return [detail_map[cn] for cn in class_names if cn in detail_map]

    def _generate_example_dn(self, rn_format: str) -> str:
        """
        Generate example DN from RN format

        Converts template variables to realistic examples:
        - tn-{name} -> tn-production
        - BD-{name} -> BD-web-bd
        - ctx-{name} -> ctx-default
        """
        if not rn_format:
            return 'example'

        # Common variable name mappings
        examples = {
            '{name}': 'example',
            '{tenant}': 'production',
            '{ctx}': 'default',
            '{bd}': 'web-bd',
            '{ap}': 'web-app',
            '{epg}': 'web-epg',
            '{ctrct}': 'web-contract',
            '{brc}': 'web-contract',
            '{subj}': 'default',
            '{vrf}': 'default',
            '{dn}': 'example-dn',
            '{id}': '1',
        }

        result = rn_format
        for var, example in examples.items():
            result = result.replace(var, example)

        return result

    def categorize_properties(self, class_name: str) -> dict:
        """
        Categorize properties into required, configurable, and read-only

        Categories:
        - required: isNaming=true (must be provided)
        - configurable: isConfigurable=true (user can set)
        - readOnly: isConfigurable=false (system-managed)

        Args:
            class_name: Target class name

        Returns:
            {
                'required': [...],      # Naming properties (DN components)
                'configurable': [...],  # User-settable properties
                'readOnly': [...]       # System-managed properties
            }
        """
        query = """
        MATCH (c:Class {className: $className})-[:HAS_PROPERTY]->(p:Property)
        WHERE NOT coalesce(p.category, '') IN ['CHILD_ACTION', 'RN']
          AND NOT p.name IN ['childAction', 'monPolDn']
          AND coalesce(p.isHidden, false) = false
        RETURN
            p.name as name,
            p.type as type,
            p.category as category,
            p.isNaming as isNaming,
            p.isConfigurable as isConfigurable,
            p.description as description,
            p.values as values
        ORDER BY p.name
        """

        result = neo4j_connection.execute_query(query, {'className': class_name})

        if not result:
            return {'required': [], 'configurable': [], 'readOnly': []}

        required = []
        configurable = []
        read_only = []

        for prop in result:
            prop_data = {
                'name': prop.get('name'),
                'type': prop.get('type'),
                'description': prop.get('description'),
                'values': prop.get('values', []),
            }

            # Categorize
            if prop.get('isNaming'):
                required.append(prop_data)
            elif prop.get('isConfigurable'):
                configurable.append(prop_data)
            else:
                read_only.append(prop_data)

        return {'required': required, 'configurable': configurable, 'readOnly': read_only}

    @MIMCache.cached('class_insights', ttl=MIMCache.TTL_STATIC)
    def get_class_insights(self, class_name: str) -> dict:
        """
        Get comprehensive insights for a class to help users build queries
        CACHED: 24 hour TTL (insights are static metadata)

        Combines:
        - DN pattern with examples
        - Smart filtered children (excluding stats)
        - Query optimization hints
        - Property categorization

        Args:
            class_name: Target class name

        Returns:
            {
                'dnPattern': {...},
                'smartChildren': {...},
                'optimization': {...},
                'properties': {...}
            }
        """
        # Get DN pattern
        dn_pattern = self.build_dn_pattern(class_name)

        # Get relationships to extract children
        relationships = self.get_all_relationships(class_name, children_limit=1000)
        children = relationships.get('children', [])

        # Filter children smartly
        smart_children = self.filter_smart_children(children)

        # Get property categorization
        properties = self.categorize_properties(class_name)

        # Build optimization hints
        optimization = {
            'isContextRoot': dn_pattern.get('isContextRoot', False),
            'preferredMethod': 'class' if dn_pattern.get('isContextRoot') else 'mo',
            'requiresParent': not dn_pattern.get('isContextRoot', False),
            'dnPattern': dn_pattern.get('pattern'),
        }

        # Add parent class hint if not context root
        if not optimization['isContextRoot'] and relationships.get('parents'):
            parents = relationships.get('parents', [])
            if parents:
                optimization['parentClass'] = parents[0].get('className')

        return {
            'dnPattern': dn_pattern,
            'smartChildren': smart_children,
            'optimization': optimization,
            'properties': properties,
        }

    def get_class_stats(self) -> dict:
        """
        Get statistics about the ACI model
        Useful for dashboard/overview
        """
        query = """
        MATCH (c:Class)
        WITH count(c) as totalClasses

        MATCH (p:Property)
        WITH totalClasses, count(p) as totalProperties

        MATCH ()-[r:CONTAINS]->()
        WITH totalClasses, totalProperties, count(r) as totalRelationships

        MATCH (c:Class)
        WHERE c.classPkg IS NOT NULL
        WITH totalClasses, totalProperties, totalRelationships,
             count(DISTINCT c.classPkg) as totalPackages

        RETURN totalClasses, totalProperties, totalRelationships, totalPackages
        """

        result = neo4j_connection.execute_query(query)
        return result[0] if result else {}

    # -----------------------------------------------------------------------
    # Pro-detail queries (used by GET /api/mim/classes/<name>/)
    # -----------------------------------------------------------------------

    @MIMCache.cached('class_parents', ttl=MIMCache.TTL_MEDIUM)
    def get_class_parents(self, class_name: str) -> list[dict]:
        """Direct containment parents via CONTAINED_BY (the inverse of CONTAINS).

        Used to build the DN breadcrumb in the class detail panel.
        """
        query = """
        MATCH (c:Class {className: $className})-[:CONTAINED_BY]->(p:Class)
        RETURN p.className as className,
               p.label as label,
               p.classPkg as classPkg
        ORDER BY p.className
        """
        return neo4j_connection.execute_query(query, {'className': class_name})

    @MIMCache.cached('class_super_classes', ttl=MIMCache.TTL_MEDIUM)
    def get_class_super_classes(self, class_name: str) -> list[dict]:
        """Direct super-classes via SUBCLASS_OF (inheritance chain, one level)."""
        query = """
        MATCH (c:Class {className: $className})-[:SUBCLASS_OF]->(s:Class)
        RETURN s.className as className,
               s.label as label,
               s.classPkg as classPkg
        ORDER BY s.className
        """
        return neo4j_connection.execute_query(query, {'className': class_name})

    @MIMCache.cached('class_relations_to', ttl=MIMCache.TTL_MEDIUM)
    def get_class_relations_to(self, class_name: str) -> list[dict]:
        """Outbound `Rs*` style references (this class → another)."""
        query = """
        MATCH (c:Class {className: $className})-[r:RELATES_TO]->(t:Class)
        RETURN t.className as className,
               t.label as label,
               t.classPkg as classPkg,
               r.via as via
        ORDER BY r.via, t.className
        """
        return neo4j_connection.execute_query(query, {'className': class_name})

    @MIMCache.cached('class_relations_from', ttl=MIMCache.TTL_MEDIUM)
    def get_class_relations_from(self, class_name: str) -> list[dict]:
        """Inbound `Rs*` references (another class → this one).

        Power-user view: who points at this class? E.g. for ``fvBD`` we'd see
        ``fvRsBd`` (the EPg→BD link), ``l3extRsEctx``, etc.
        """
        query = """
        MATCH (c:Class {className: $className})-[r:RELATES_FROM]->(s:Class)
        RETURN s.className as className,
               s.label as label,
               s.classPkg as classPkg,
               r.via as via
        ORDER BY r.via, s.className
        """
        return neo4j_connection.execute_query(query, {'className': class_name})

    @MIMCache.cached('class_stats', ttl=MIMCache.TTL_MEDIUM)
    def get_class_stat_relations(self, class_name: str) -> list[dict]:
        """Stat / counter classes related via HAS_STAT.

        Distinct from the ``get_class_stats`` method above (which returns
        graph-wide totals for the dashboard); this one returns per-class
        statistic targets like ``eqptIngrTotalPkts``.
        """
        query = """
        MATCH (c:Class {className: $className})-[r:HAS_STAT]->(s:Class)
        RETURN s.className as className,
               s.label as label,
               s.classPkg as classPkg,
               r.qualifiedName as qualifiedName,
               r.comment as comment
        ORDER BY s.className
        """
        return neo4j_connection.execute_query(query, {'className': class_name})

    @MIMCache.cached('class_faults_events', ttl=MIMCache.TTL_MEDIUM)
    def get_class_faults_events(self, class_name: str) -> dict:
        """Parse the JSON-encoded faults/events bundles stored on the Class node.

        Returns ``{'faults': [...], 'events': [...]}`` — both lists hold the
        flat ``{id, type, target, targetQualified}`` shape the loader emits.
        On a parse error the offending bundle becomes an empty list and the
        problem is logged; the import never fails the whole detail call.
        """
        import json
        import logging

        logger = logging.getLogger(__name__)

        query = """
        MATCH (c:Class {className: $className})
        RETURN c.faults as faults, c.events as events
        """
        results = neo4j_connection.execute_query(query, {'className': class_name})
        if not results:
            return {'faults': [], 'events': []}

        def _parse(raw: object, label: str) -> list:
            if not isinstance(raw, str) or not raw:
                return []
            try:
                parsed = json.loads(raw)
                return parsed if isinstance(parsed, list) else []
            except (ValueError, TypeError) as exc:
                logger.warning('class %s: failed to parse %s JSON: %s', class_name, label, exc)
                return []

        row = results[0]
        return {
            'faults': _parse(row.get('faults'), 'faults'),
            'events': _parse(row.get('events'), 'events'),
        }

    @MIMCache.cached('class_props_full', ttl=MIMCache.TTL_MEDIUM)
    def get_class_properties_full(self, class_name: str) -> list[dict]:
        """Like ``get_class_properties`` but with every flag the loader writes.

        Adds: readWrite, createOnly, mandatory, secure, readOnly,
        baseType, modelType, uitype, label, comment, propGlobalId, propLocalId,
        validators (parsed JSON array), validValues (collected from
        :HAS_VALUE EnumValue nodes).
        """
        import json
        import logging

        logger = logging.getLogger(__name__)

        query = """
        MATCH (c:Class {className: $className})-[:HAS_PROPERTY]->(p:Property)
        WHERE NOT coalesce(p.category, '') IN ['CHILD_ACTION', 'RN']
          AND NOT p.name IN ['childAction', 'monPolDn']
          AND coalesce(p.isHidden, false) = false
        OPTIONAL MATCH (p)-[:HAS_VALUE]->(v:EnumValue)
        WITH p,
             collect(DISTINCT CASE WHEN v IS NULL THEN null ELSE {
                value: v.value,
                localName: v.localName,
                label: v.label
             } END) as enumValues
        RETURN p.name           as name,
               p.label          as label,
               p.comment        as comment,
               p.baseType       as baseType,
               p.modelType      as modelType,
               p.uitype         as uitype,
               p.type           as type,
               p.category       as category,
               p.defaultValue   as defaultValue,
               p.default        as defaultStr,
               p.isNaming       as isNaming,
               p.isConfigurable as isConfigurable,
               p.isDeprecated   as isDeprecated,
               p.isHidden       as isHidden,
               coalesce(p.readWrite, false)  as readWrite,
               coalesce(p.readOnly, false)   as readOnly,
               coalesce(p.createOnly, false) as createOnly,
               coalesce(p.mandatory, false)  as mandatory,
               coalesce(p.secure, false)     as secure,
               coalesce(p.implicit, false)   as implicit,
               p.propGlobalId   as propGlobalId,
               p.propLocalId    as propLocalId,
               p.range          as range,
               p.values         as legacyValues,
               p.validators     as validatorsRaw,
               [e IN enumValues WHERE e IS NOT NULL] as validValues
        ORDER BY p.name
        """
        rows = neo4j_connection.execute_query(query, {'className': class_name})

        for row in rows:
            raw = row.pop('validatorsRaw', None)
            if isinstance(raw, str) and raw:
                try:
                    parsed = json.loads(raw)
                    row['validators'] = parsed if isinstance(parsed, list) else []
                except (ValueError, TypeError) as exc:
                    logger.warning(
                        'class %s prop %s: failed to parse validators JSON: %s',
                        class_name,
                        row.get('name'),
                        exc,
                    )
                    row['validators'] = []
            else:
                row['validators'] = []
            # Loader v1 wrote ``values`` (list of strings); v2 attaches a
            # ``validValues`` sub-array on each property via :HAS_VALUE.
            # Prefer v2 when present, fall back to legacy.
            legacy = row.pop('legacyValues', None)
            if not row['validValues'] and legacy:
                row['validValues'] = [{'value': v, 'localName': '', 'label': ''} for v in legacy]
        return rows


# Global instance
mim_service = MIMService()
