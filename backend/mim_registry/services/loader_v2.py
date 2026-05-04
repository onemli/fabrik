"""
MIM Loader v2 — imports ACI Managed Information Model metadata into Neo4j
from the Cisco DevNet (model-doc) JSON format.

Key differences from v1 (loader.py):

1. Input format: devnet bundles use keys like "fv:Tenant" (package-colon-class).
   v2 normalizes to "fvTenant" internally so Neo4j stores, query builder output,
   frontend references, and advisor lookups all stay on the existing convention.
   The original package-qualified form is preserved as Class.qualifiedName
   (e.g. "fv:Tenant") for reverse lookup and to stay source-agnostic — any
   future devnet/cobra/XML schema source provides the same representation.

2. Richer per-property metadata (baseType, modelType, uitype, label, comment,
   validators, validValues, createOnly/readOnly/readWrite/mandatory/secure/
   implicit flags, propGlobalId/propLocalId, platformFlavors).

3. Richer per-class metadata (containedBy, superClasses, subClasses, dnFormats,
   readAccess/writeAccess, isDomainable/isFaultable/isHealthScorable/... flags,
   classId, abstractionLayer, apicNxProcessing, monitoringPolicySource).

4. New relationships:
   - (:Class)-[:CONTAINED_BY]->(:Class)  — inverse of CONTAINS (fast bi-direction)
   - (:Class)-[:SUBCLASS_OF]->(:Class)    — from superClasses list
   - (:Class)-[:RELATES_TO   {via}]->(:Class) — from relationTo
   - (:Class)-[:RELATES_FROM {via}]->(:Class) — from relationFrom
   - (:Class)-[:HAS_STAT     {qualifiedName, comment}]->(:Class) — from stats dict
   - (:Property)-[:HAS_VALUE]->(:EnumValue)        — from validValues

5. New label: :EnumValue (one per enum/bitmask constant).

Preserved from v1 (zero breakage for existing query builder / advisor code):
- (:Class {className})                       — className is still the normalized form
- (:Class)-[:HAS_PROPERTY]->(:Property)
- (:Class)-[:CONTAINS]->(:Class)
- (:Class)-[:RN_MAPPING {rnPrefix}]->(:Class)
- (:MIMMeta {key: 'active'})                 — now also stamps schema_version='v2', source='devnet'

Usage:
    from backend.mim_registry.services.loader_v2 import MIMLoaderV2
    from neo4j import GraphDatabase

    driver = GraphDatabase.driver(uri, auth=(user, pw))
    loader = MIMLoaderV2(driver, progress_callback=my_callback)
    stats = loader.load_from_file(path, apic_version='6.0.8', sha256=sha)
"""

import gzip
import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


# Neo4j signed int64 boundary — values outside get stringified.
NEO4J_INT_MAX = 9_223_372_036_854_775_807
DEFAULT_BATCH_SIZE = 500

# Fields whose presence in a class dict confirms devnet format (vs v1 enhanced).
# Any one of these is a strong signal; we require at least one.
_DEVNET_MARKER_FIELDS = frozenset({
    'containedBy',
    'superClasses',
    'dnFormats',
    'classId',
    'relationTo',
    'relationFrom',
})


ProgressCallback = Callable[[str, int, str], None]


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def normalize_class_name(qualified_name: str) -> str:
    """Convert package-qualified 'fv:Tenant' form to codebase-standard 'fvTenant'.

    Idempotent — already-normalized names pass through unchanged.
    Handles edge cases: empty string, missing colon, multi-colon (rare).
    """
    if not qualified_name or ':' not in qualified_name:
        return qualified_name
    pkg, _sep, cls = qualified_name.partition(':')
    return f"{pkg}{cls}"


def safe_neo4j_value(value: Any) -> Any:
    """Coerce ints outside Neo4j's signed int64 range to strings.

    Neo4j's bolt protocol rejects Python ints larger than 2**63-1.
    Properties like propGlobalId occasionally drift into that range.
    """
    if isinstance(value, int) and abs(value) > NEO4J_INT_MAX:
        return str(value)
    return value


def _open_meta(path: Path):
    """Open a .json or .json.gz file transparently."""
    if path.suffix == '.gz' or path.name.endswith('.json.gz'):
        return gzip.open(path, 'rt', encoding='utf-8')
    return open(path, 'r', encoding='utf-8')


def validate_devnet_payload(data: Any) -> None:
    """Raise ValueError if payload does not look like a devnet MIM dump."""
    if not isinstance(data, dict):
        raise ValueError("MIM payload must be a JSON object")
    if 'classes' not in data:
        raise ValueError("MIM payload missing top-level 'classes' key")
    classes = data['classes']
    if not isinstance(classes, dict):
        raise ValueError("MIM payload 'classes' must be an object")
    if not classes:
        raise ValueError("MIM payload contains no classes")

    first_key = next(iter(classes))
    first_value = classes[first_key]
    if not isinstance(first_value, dict):
        raise ValueError(f"class entry '{first_key}' is not an object")

    if not (_DEVNET_MARKER_FIELDS & first_value.keys()):
        raise ValueError(
            f"Payload does not look like devnet format: class '{first_key}' "
            f"has none of {sorted(_DEVNET_MARKER_FIELDS)}. "
            "If this is the older enhanced-meta format, use MIMLoader (v1)."
        )


# ---------------------------------------------------------------------------
# Stats container
# ---------------------------------------------------------------------------

@dataclass
class ImportStatsV2:
    class_count: int = 0
    property_count: int = 0
    enum_value_count: int = 0
    contains_count: int = 0
    contained_by_count: int = 0
    subclass_count: int = 0
    rn_mapping_count: int = 0
    relates_to_count: int = 0
    relates_from_count: int = 0
    has_stat_count: int = 0
    events_written: int = 0    # stored as JSON on Class, count total entries
    faults_written: int = 0

    @property
    def rel_count(self) -> int:
        return (
            self.contains_count
            + self.contained_by_count
            + self.subclass_count
            + self.rn_mapping_count
            + self.relates_to_count
            + self.relates_from_count
            + self.has_stat_count
        )

    def as_dict(self) -> dict:
        return {
            'class_count': self.class_count,
            'property_count': self.property_count,
            'enum_value_count': self.enum_value_count,
            'rel_count': self.rel_count,
            'contains_count': self.contains_count,
            'contained_by_count': self.contained_by_count,
            'subclass_count': self.subclass_count,
            'rn_mapping_count': self.rn_mapping_count,
            'relates_to_count': self.relates_to_count,
            'relates_from_count': self.relates_from_count,
            'has_stat_count': self.has_stat_count,
            'events_written': self.events_written,
            'faults_written': self.faults_written,
        }


# ---------------------------------------------------------------------------
# Prepared (parsed + normalized) batch containers
# ---------------------------------------------------------------------------

@dataclass
class _Prepared:
    classes: list = field(default_factory=list)
    properties: list = field(default_factory=list)
    enum_values: list = field(default_factory=list)
    contains: list = field(default_factory=list)
    contained_by: list = field(default_factory=list)
    subclass_of: list = field(default_factory=list)
    rn_mappings: list = field(default_factory=list)
    relates_to: list = field(default_factory=list)
    relates_from: list = field(default_factory=list)
    has_stat: list = field(default_factory=list)


# ---------------------------------------------------------------------------
# Loader
# ---------------------------------------------------------------------------

class MIMLoaderV2:
    """Imports a devnet-format MIM dump into Neo4j.

    Strategy: wipe-and-reload (same as v1). A single MIM version is active
    at a time; MIMMeta(active) identifies which version that is.
    """

    def __init__(
        self,
        neo4j_driver,
        progress_callback: Optional[ProgressCallback] = None,
        batch_size: int = DEFAULT_BATCH_SIZE,
    ):
        self._driver = neo4j_driver
        self._progress = progress_callback or (lambda *a, **kw: None)
        self._batch_size = batch_size

    # ---- Public API ----

    def load_from_file(
        self,
        path: Path,
        apic_version: str,
        sha256: str,
    ) -> ImportStatsV2:
        path = Path(path)
        self._emit('parse', 0, f'Reading {path.name}...')
        with _open_meta(path) as fh:
            data = json.load(fh)
        validate_devnet_payload(data)

        raw_classes = data['classes']
        total_raw = len(raw_classes)
        self._emit('parse', 3, f'{total_raw:,} classes found')

        stats = ImportStatsV2()
        prepared = self._prepare(raw_classes, stats)
        self._emit('parse', 8, 'Preparation complete')

        self._emit('wipe', 10, 'Wiping existing MIM graph...')
        self._clear_database()

        self._emit('index', 13, 'Creating indexes and constraints...')
        self._create_indexes()

        # Progress plan: 15..98 reserved for writes (meta stamp at 99, done at 100).
        # Distribute proportionally to work estimate.
        self._run_writes(prepared, stats)

        self._emit('meta', 99, 'Stamping MIMMeta node...')
        self._stamp_meta(apic_version=apic_version, sha256=sha256)

        self._emit('done', 100, 'MIM import complete')
        return stats

    # ---- Streaming public API (used by the devnet scraper) ----

    def prepare_for_streaming(self, version_key: str, total_classes: int) -> None:
        """Wipe Neo4j, create indexes, mark MIMMeta as importing.

        Call once at the start of a streaming import. Subsequent
        ``write_class_batch`` calls populate the graph; ``finalize_streaming``
        flips MIMMeta from importing to active.
        """
        self._emit('wipe', 0, 'Wiping existing MIM graph...')
        self._clear_database()
        self._emit('index', 5, 'Creating indexes...')
        self._create_indexes()
        self._stamp_meta_importing(version_key=version_key, total_classes=total_classes)

    def write_class_batch(self, items: List[dict]) -> ImportStatsV2:
        """Write a batch of devnet classes — nodes + properties + enum values.

        ``items`` is a list of ``{'qualified_name': str, 'class_data': dict,
        'source_version': str}`` entries.

        Relationships are NOT written here — they are deferred to
        ``write_relationships_batch`` so that every Class node exists before
        edges reference it (avoids stub-class explosion on MERGE).
        """
        prepared = _Prepared()
        stats = ImportStatsV2()
        for item in items:
            qualified_name = item.get('qualified_name')
            cdata = item.get('class_data')
            source_version = item.get('source_version', '')
            if not qualified_name or not isinstance(cdata, dict):
                logger.warning('write_class_batch: skipping malformed item %r', item)
                continue
            self._prepare_single(qualified_name, cdata, source_version, prepared, stats)
        self._write_nodes_only(prepared)
        return stats

    def write_relationships_batch(self, items: List[dict]) -> ImportStatsV2:
        """Write relationship edges for a batch of classes (MATCH-only).

        ``items`` is the same shape as ``write_class_batch``. The Cypher in
        this path uses ``MATCH ... MATCH`` for both ends of every edge — if
        a target class isn't in Neo4j yet (shouldn't happen by this phase),
        the edge is silently skipped instead of creating a stub class.
        """
        prepared = _Prepared()
        stats = ImportStatsV2()
        for item in items:
            qualified_name = item.get('qualified_name')
            cdata = item.get('class_data')
            source_version = item.get('source_version', '')
            if not qualified_name or not isinstance(cdata, dict):
                continue
            self._prepare_single(qualified_name, cdata, source_version, prepared, stats)
        self._write_relationships_only(prepared)
        return stats

    def finalize_streaming(
        self,
        version_key: str,
        sha256: str = '',
        summary: Optional[dict] = None,
    ) -> None:
        """Stamp MIMMeta as active. Call after the last ``write_class_batch``."""
        self._stamp_meta_active(version_key=version_key, sha256=sha256, summary=summary or {})

    # ---- Preparation ----

    def _prepare(self, raw_classes: Dict[str, dict], stats: ImportStatsV2) -> _Prepared:
        """Transform raw devnet JSON into normalized batch-write payloads."""
        out = _Prepared()

        for qualified_name, cdata in raw_classes.items():
            if not isinstance(cdata, dict):
                logger.warning(f"Skipping '{qualified_name}': class entry is not an object")
                continue
            self._prepare_single(qualified_name, cdata, '', out, stats)

        return out

    def _prepare_single(
        self,
        qualified_name: str,
        cdata: dict,
        source_version: str,
        out: _Prepared,
        stats: ImportStatsV2,
    ) -> None:
        """Process a single class entry into the shared ``_Prepared`` accumulator.

        Used by both the file-load path (via ``_prepare``) and the streaming
        path (via ``write_class_batch``). The two share zero divergence.
        """
        class_name = normalize_class_name(qualified_name)

        # ---- Events / faults — serialize as JSON on the class node ----
        events_serialized = self._serialize_event_like(cdata.get('events', {}))
        faults_serialized = self._serialize_event_like(cdata.get('faults', {}))
        stats.events_written += len(events_serialized)
        stats.faults_written += len(faults_serialized)

        # ---- Class node payload ----
        out.classes.append({
            # Identity
            'className': class_name,
            'qualifiedName': qualified_name,
            'sourceVersion': source_version,
            'classPkg': cdata.get('classPkg', ''),
            'classId': str(cdata.get('classId', '')),
            'label': cdata.get('label', ''),
            'comment': cdata.get('comment', []) or [],
            # v1-compatible booleans
            'isAbstract': bool(cdata.get('isAbstract', False)),
            'isConfigurable': bool(cdata.get('isConfigurable', False)),
            'isContextRoot': bool(cdata.get('isContextRoot', False)),
            'isDeprecated': bool(cdata.get('isDeprecated', False)),
            'isHidden': bool(cdata.get('isHidden', False)),
            # v2 additions — behavioral flags
            'isDomainable': bool(cdata.get('isDomainable', False)),
            'isFaultable': bool(cdata.get('isFaultable', False)),
            'isHealthScorable': bool(cdata.get('isHealthScorable', False)),
            'isEncrypted': bool(cdata.get('isEncrypted', False)),
            'isExportable': bool(cdata.get('isExportable', False)),
            'isPersistent': bool(cdata.get('isPersistent', False)),
            'isCreatableDeletable': bool(cdata.get('isCreatableDeletable', False)),
            'isObservable': bool(cdata.get('isObservable', False)),
            'isStat': bool(cdata.get('isStat', False)),
            'isSubjectToQuota': bool(cdata.get('isSubjectToQuota', False)),
            'isNxosConverged': bool(cdata.get('isNxosConverged', False)),
            'hasStats': bool(cdata.get('hasStats', False)),
            'hasEventRules': bool(cdata.get('hasEventRules', False)),
            'shouldCollectHealthStats': bool(cdata.get('shouldCollectHealthStats', False)),
            # Metadata strings
            'moCategory': cdata.get('moCategory', ''),
            'featureTag': cdata.get('featureTag', ''),
            'abstractionLayer': cdata.get('abstractionLayer', ''),
            'apicNxProcessing': cdata.get('apicNxProcessing', ''),
            'healthCollectionSource': cdata.get('healthCollectionSource', ''),
            'monitoringPolicySource': cdata.get('monitoringPolicySource', ''),
            'rnFormat': cdata.get('rnFormat', ''),
            # Lists
            'dnFormats': self._coerce_str_list(cdata.get('dnFormats', [])),
            'identifiedBy': self._coerce_str_list(cdata.get('identifiedBy', [])),
            'platformFlavors': self._coerce_str_list(cdata.get('platformFlavors', [])),
            'readAccess': self._coerce_str_list(cdata.get('readAccess', [])),
            'writeAccess': self._coerce_str_list(cdata.get('writeAccess', [])),
            # superClasses normalized to codebase form
            'superClasses': [
                normalize_class_name(s) for s in (cdata.get('superClasses') or [])
                if isinstance(s, str) and s
            ],
            # Events/faults as JSON strings (consumers parse)
            'events': json.dumps(events_serialized, ensure_ascii=False),
            'faults': json.dumps(faults_serialized, ensure_ascii=False),
        })
        stats.class_count += 1

        # ---- Properties ----
        properties = cdata.get('properties') or {}
        if not isinstance(properties, dict):
            logger.warning(f"Class '{qualified_name}': 'properties' is not an object, skipping")
            properties = {}

        for prop_name, pdata in properties.items():
            if not isinstance(pdata, dict):
                logger.warning(f"{qualified_name}.{prop_name}: property entry is not an object, skipping")
                continue

            out.properties.append({
                'className': class_name,
                'propName': prop_name,
                # Semantic metadata (new in v2 — the key win for advisor/UI)
                'label': pdata.get('label', ''),
                'comment': pdata.get('comment', []) or [],
                'baseType': pdata.get('baseType', ''),
                'modelType': pdata.get('modelType', ''),
                'uitype': pdata.get('uitype', ''),
                'propGlobalId': str(pdata.get('propGlobalId', '')),
                'propLocalId': str(pdata.get('propLocalId', '')),
                # Boolean flags
                'isConfigurable': bool(pdata.get('isConfigurable', False)),
                'isDeprecated': bool(pdata.get('isDeprecated', False)),
                'isHidden': bool(pdata.get('isHidden', False)),
                'isNaming': bool(pdata.get('isNaming', False)),
                'readOnly': bool(pdata.get('readOnly', False)),
                'readWrite': bool(pdata.get('readWrite', False)),
                'createOnly': bool(pdata.get('createOnly', False)),
                'mandatory': bool(pdata.get('mandatory', False)),
                'secure': bool(pdata.get('secure', False)),
                'implicit': bool(pdata.get('implicit', False)),
                'isOverride': bool(pdata.get('isOverride', False)),
                'isLike': bool(pdata.get('isLike', False)),
                'isNxosConverged': bool(pdata.get('isNxosConverged', False)),
                'needsPropDelimiters': bool(pdata.get('needsPropDelimiters', False)),
                # Default value (may be str / int / None)
                'default': self._scalar_to_str(pdata.get('default')),
                # Reference to another property (for inherited/like props)
                'likeProp': pdata.get('likeProp', ''),
                'platformFlavors': self._coerce_str_list(pdata.get('platformFlavors', [])),
                # Validators as JSON (always consumed as a whole)
                'validators': json.dumps(pdata.get('validators') or [], ensure_ascii=False),
            })
            stats.property_count += 1

            # ---- Enum values → separate :EnumValue nodes ----
            for vv in (pdata.get('validValues') or []):
                if not isinstance(vv, dict):
                    continue
                out.enum_values.append({
                    'className': class_name,
                    'propName': prop_name,
                    'value': self._scalar_to_str(vv.get('value', '')),
                    'localName': vv.get('localName', ''),
                    'label': vv.get('label', ''),
                    'comment': vv.get('comment', []) or [],
                    'platformFlavors': self._coerce_str_list(vv.get('platformFlavors', [])),
                })
                stats.enum_value_count += 1

        # ---- contains (Class → Class) ----
        for child_qualified in (cdata.get('contains') or {}).keys():
            if child_qualified:
                out.contains.append({
                    'parentClass': class_name,
                    'childClass': normalize_class_name(child_qualified),
                })
                stats.contains_count += 1

        # ---- containedBy (Class → Class, inverse of CONTAINS) ----
        for parent_qualified in (cdata.get('containedBy') or {}).keys():
            if parent_qualified:
                out.contained_by.append({
                    'childClass': class_name,
                    'parentClass': normalize_class_name(parent_qualified),
                })
                stats.contained_by_count += 1

        # ---- superClasses → SUBCLASS_OF ----
        for super_qualified in (cdata.get('superClasses') or []):
            if isinstance(super_qualified, str) and super_qualified:
                out.subclass_of.append({
                    'childClass': class_name,
                    'parentClass': normalize_class_name(super_qualified),
                })
                stats.subclass_count += 1

        # ---- rnMap (Class → Class with RN prefix) ----
        for rn_prefix, target_qualified in (cdata.get('rnMap') or {}).items():
            if target_qualified:
                out.rn_mappings.append({
                    'parentClass': class_name,
                    'childClass': normalize_class_name(target_qualified),
                    'rnPrefix': rn_prefix,
                })
                stats.rn_mapping_count += 1

        # ---- relationTo ----
        for reln_key, target_qualified in (cdata.get('relationTo') or {}).items():
            if target_qualified:
                out.relates_to.append({
                    'fromClass': class_name,
                    'toClass': normalize_class_name(target_qualified),
                    'via': normalize_class_name(reln_key),
                })
                stats.relates_to_count += 1

        # ---- relationFrom ----
        for reln_key, target_qualified in (cdata.get('relationFrom') or {}).items():
            if target_qualified:
                out.relates_from.append({
                    'toClass': class_name,
                    'fromClass': normalize_class_name(target_qualified),
                    'via': normalize_class_name(reln_key),
                })
                stats.relates_from_count += 1

        # ---- stats (Class → stat Class) ----
        # NOTE: In devnet format, `stats` is {qualifiedStatClass: {comment: [...]}}
        # — the KEY is the stat class itself, the VALUE is metadata (comment).
        # This differs from contains/rnMap/relationTo/... where the VALUE holds
        # the target. Do not confuse the two shapes.
        for stat_qualified, stat_metadata in (cdata.get('stats') or {}).items():
            if not stat_qualified:
                continue
            comment: list = []
            if isinstance(stat_metadata, dict):
                raw_comment = stat_metadata.get('comment')
                if isinstance(raw_comment, list):
                    comment = [str(c) for c in raw_comment if c is not None]
                elif isinstance(raw_comment, str):
                    comment = [raw_comment]
            out.has_stat.append({
                'className': class_name,
                'targetClass': normalize_class_name(stat_qualified),
                'qualifiedName': stat_qualified,
                'comment': comment,
            })
            stats.has_stat_count += 1

    # ---- Write pipeline ----

    def _run_writes(self, prepared: _Prepared, stats: ImportStatsV2) -> None:
        """Emit batched writes in the correct dependency order.

        Classes first (other nodes reference them). Then properties & enum
        values. Then the relationship edges. Progress percentages span 15..98.
        """
        # Work estimate (rough) for proportional progress
        total_work = max(
            1,
            stats.class_count * 3           # classes are fattest
            + stats.property_count * 2
            + stats.enum_value_count
            + stats.contains_count
            + stats.contained_by_count
            + stats.subclass_count
            + stats.rn_mapping_count
            + stats.relates_to_count
            + stats.relates_from_count
            + stats.has_stat_count,
        )
        budget = 98 - 15  # 83 percentage points to distribute
        pct = 15

        def alloc(weight: int) -> int:
            return max(1, int(budget * weight / total_work))

        # Classes
        w = alloc(stats.class_count * 3)
        self._emit('classes', pct, f'Writing {stats.class_count:,} classes...')
        self._batch_iter(prepared.classes, 'classes', pct, pct + w, _CYPHER_WRITE_CLASSES)
        pct += w

        # Properties
        w = alloc(stats.property_count * 2)
        self._emit('properties', pct, f'Writing {stats.property_count:,} properties...')
        self._batch_iter(prepared.properties, 'properties', pct, pct + w, _CYPHER_WRITE_PROPERTIES)
        pct += w

        # Enum values
        w = alloc(stats.enum_value_count)
        self._emit('enum_values', pct, f'Writing {stats.enum_value_count:,} enum values...')
        self._batch_iter(prepared.enum_values, 'enum_values', pct, pct + w, _CYPHER_WRITE_ENUM_VALUES)
        pct += w

        # CONTAINS
        w = alloc(stats.contains_count)
        self._emit('contains', pct, f'Writing {stats.contains_count:,} CONTAINS edges...')
        self._batch_iter(prepared.contains, 'contains', pct, pct + w, _CYPHER_WRITE_CONTAINS)
        pct += w

        # CONTAINED_BY
        w = alloc(stats.contained_by_count)
        self._emit('contained_by', pct, f'Writing {stats.contained_by_count:,} CONTAINED_BY edges...')
        self._batch_iter(prepared.contained_by, 'contained_by', pct, pct + w, _CYPHER_WRITE_CONTAINED_BY)
        pct += w

        # SUBCLASS_OF
        w = alloc(stats.subclass_count)
        self._emit('subclass', pct, f'Writing {stats.subclass_count:,} SUBCLASS_OF edges...')
        self._batch_iter(prepared.subclass_of, 'subclass', pct, pct + w, _CYPHER_WRITE_SUBCLASS)
        pct += w

        # RN_MAPPING
        w = alloc(stats.rn_mapping_count)
        self._emit('rn_mapping', pct, f'Writing {stats.rn_mapping_count:,} RN_MAPPING edges...')
        self._batch_iter(prepared.rn_mappings, 'rn_mapping', pct, pct + w, _CYPHER_WRITE_RN_MAPPING)
        pct += w

        # RELATES_TO
        w = alloc(stats.relates_to_count)
        self._emit('relates_to', pct, f'Writing {stats.relates_to_count:,} RELATES_TO edges...')
        self._batch_iter(prepared.relates_to, 'relates_to', pct, pct + w, _CYPHER_WRITE_RELATES_TO)
        pct += w

        # RELATES_FROM
        w = alloc(stats.relates_from_count)
        self._emit('relates_from', pct, f'Writing {stats.relates_from_count:,} RELATES_FROM edges...')
        self._batch_iter(prepared.relates_from, 'relates_from', pct, pct + w, _CYPHER_WRITE_RELATES_FROM)
        pct += w

        # HAS_STAT
        w = alloc(stats.has_stat_count)
        self._emit('has_stat', pct, f'Writing {stats.has_stat_count:,} HAS_STAT edges...')
        self._batch_iter(prepared.has_stat, 'has_stat', pct, pct + w, _CYPHER_WRITE_HAS_STAT)
        pct += w

    # ---- Neo4j primitives ----

    def _clear_database(self) -> None:
        """Drop constraints, indexes, then all nodes in chunks."""
        # Constraints before indexes: dropping an index that backs a constraint
        # raises. Constraints auto-drop their backing index.
        for rec in self._execute("SHOW CONSTRAINTS"):
            name = rec.get('name')
            if name:
                self._execute(f"DROP CONSTRAINT {name} IF EXISTS")

        for rec in self._execute("SHOW INDEXES"):
            name = rec.get('name')
            idx_type = rec.get('type', '')
            # Skip LOOKUP indexes — they're internal and can't be dropped.
            if name and idx_type != 'LOOKUP':
                self._execute(f"DROP INDEX {name} IF EXISTS")

        # Two-phase wipe: drop relationships first, then nodes. DETACH DELETE on
        # a single highly-connected node (e.g. topRoot with 10k+ inbound edges)
        # loads every one of its relationships into the same transaction chunk,
        # which can exceed dbms.memory.transaction.total.max. Splitting the
        # work lets Neo4j commit each batch cleanly.
        #
        # CALL IN TRANSACTIONS requires auto-commit — session.run() provides it.
        self._execute(
            "MATCH ()-[r]->() CALL { WITH r DELETE r } IN TRANSACTIONS OF 5000 ROWS"
        )
        self._execute(
            "MATCH (n) CALL { WITH n DELETE n } IN TRANSACTIONS OF 5000 ROWS"
        )

    def _create_indexes(self) -> None:
        """Create constraints + indexes. v1-compatible ones first, v2 additions after."""
        statements = [
            # v1 constraints/indexes — preserve exact names for compatibility
            "CREATE CONSTRAINT class_unique IF NOT EXISTS FOR (c:Class) REQUIRE c.className IS UNIQUE",
            "CREATE INDEX class_pkg_idx IF NOT EXISTS FOR (c:Class) ON (c.classPkg)",
            "CREATE INDEX property_name_idx IF NOT EXISTS FOR (p:Property) ON (p.name)",
            "CREATE CONSTRAINT mim_meta_unique IF NOT EXISTS FOR (m:MIMMeta) REQUIRE m.key IS UNIQUE",
            # v2 additions — search-friendly fields
            "CREATE INDEX class_qualified_name_idx IF NOT EXISTS FOR (c:Class) ON (c.qualifiedName)",
            "CREATE INDEX class_label_idx IF NOT EXISTS FOR (c:Class) ON (c.label)",
            "CREATE INDEX class_mo_category_idx IF NOT EXISTS FOR (c:Class) ON (c.moCategory)",
            "CREATE INDEX class_feature_tag_idx IF NOT EXISTS FOR (c:Class) ON (c.featureTag)",
            "CREATE INDEX property_class_idx IF NOT EXISTS FOR (p:Property) ON (p.className)",
            "CREATE INDEX property_label_idx IF NOT EXISTS FOR (p:Property) ON (p.label)",
            "CREATE INDEX property_base_type_idx IF NOT EXISTS FOR (p:Property) ON (p.baseType)",
            "CREATE INDEX property_ui_type_idx IF NOT EXISTS FOR (p:Property) ON (p.uitype)",
            "CREATE INDEX enumvalue_value_idx IF NOT EXISTS FOR (v:EnumValue) ON (v.value)",
            "CREATE INDEX enumvalue_local_name_idx IF NOT EXISTS FOR (v:EnumValue) ON (v.localName)",
        ]
        for stmt in statements:
            try:
                self._execute(stmt)
            except Exception as e:
                # Index creation on existing Neo4j can warn rather than fail;
                # don't abort the whole import over index hygiene.
                logger.warning(f"Index creation warning: {e}")

    def _execute(self, query: str, parameters: Optional[dict] = None) -> list:
        with self._driver.session() as session:
            result = session.run(query, parameters or {})
            return [record.data() for record in result]

    @staticmethod
    def _assert_neo4j_safe(items: list, stage: str) -> None:
        """Fail fast if any payload field is a type Neo4j rejects as a property.

        Neo4j property values must be primitives (bool/int/float/str) or arrays
        of primitives. A nested map/list-of-maps slips through Python happily
        but crashes at bolt-protocol time — mid-import — with a confusing
        error message. This catches the mistake during preparation.
        """
        if not items:
            return
        sample = items[0]
        for key, value in sample.items():
            if isinstance(value, dict):
                raise ValueError(
                    f"[{stage}] payload field '{key}' is a dict — "
                    f"Neo4j properties must be primitives or arrays of primitives"
                )
            if isinstance(value, list):
                for element in value:
                    if isinstance(element, (dict, list)):
                        raise ValueError(
                            f"[{stage}] payload field '{key}' is a nested/complex list — "
                            f"Neo4j properties must be primitives or flat arrays of primitives"
                        )

    def _batch_iter(
        self,
        items: list,
        stage: str,
        pct_start: int,
        pct_end: int,
        query: str,
    ) -> None:
        total = len(items)
        if total == 0:
            return
        self._assert_neo4j_safe(items, stage)
        span = max(pct_end - pct_start, 1)
        for i in range(0, total, self._batch_size):
            batch = items[i:i + self._batch_size]
            self._execute(query, {'batch': batch})
            done = min(i + self._batch_size, total)
            pct = pct_start + int(span * done / total)
            self._emit(stage, pct, f'{done:,}/{total:,}')

    def _stamp_meta(self, apic_version: str, sha256: str) -> None:
        """Stamp MIMMeta as fully-loaded (file-load path)."""
        self._stamp_meta_active(version_key=apic_version, sha256=sha256, summary={})

    def _stamp_meta_importing(self, version_key: str, total_classes: int) -> None:
        """Mark MIMMeta as in-progress so the rest of the app can detect a partial load."""
        self._execute(
            """
            MERGE (m:MIMMeta {key: 'active'})
            SET m.apic_version   = $version,
                m.state          = 'importing',
                m.total_classes  = $total,
                m.schema_version = 'v2',
                m.source         = 'devnet',
                m.import_started_at = datetime(),
                m.imported_at    = null
            """,
            {'version': version_key, 'total': int(total_classes)},
        )

    def _stamp_meta_active(self, version_key: str, sha256: str, summary: dict) -> None:
        """Mark MIMMeta as fully-loaded (active)."""
        self._execute(
            """
            MERGE (m:MIMMeta {key: 'active'})
            SET m.apic_version    = $version,
                m.state           = 'active',
                m.sha256           = $sha,
                m.schema_version  = 'v2',
                m.source          = 'devnet',
                m.imported_at     = datetime(),
                m.fallback_count  = $fallback,
                m.not_found_count = $not_found
            """,
            {
                'version': version_key,
                'sha': sha256 or '',
                'fallback': int(summary.get('fallback_count', 0)),
                'not_found': int(summary.get('not_found_count', 0)),
            },
        )

    # ---- Streaming-mode write helpers ----

    def _write_chunked(self, items: list, stage: str, query: str) -> None:
        """Send ``items`` to Neo4j in batches of ``self._batch_size`` rows.

        Mirrors the old ``_batch_iter`` semantics so each transaction stays
        well below ``dbms.memory.transaction.total.max``. The streaming path
        used to push the whole accumulated payload in one tx — fine for nodes
        but explosive for relationship tables where 200 classes can produce
        ~1k+ rows per type.
        """
        if not items:
            return
        self._assert_neo4j_safe(items, stage)
        for i in range(0, len(items), self._batch_size):
            self._execute(query, {'batch': items[i:i + self._batch_size]})

    def _write_nodes_only(self, prepared: _Prepared) -> None:
        """Write Class nodes + Properties + EnumValues. No edges between Classes."""
        self._write_chunked(prepared.classes, 'classes', _CYPHER_WRITE_CLASSES)
        self._write_chunked(prepared.properties, 'properties', _CYPHER_WRITE_PROPERTIES)
        self._write_chunked(prepared.enum_values, 'enum_values', _CYPHER_WRITE_ENUM_VALUES)

    def _write_relationships_only(self, prepared: _Prepared) -> None:
        """Write Class<->Class edges with MATCH-only Cypher.

        Skips silently if either endpoint is missing from Neo4j; relies on
        the caller having written every Class node first via
        ``write_class_batch``.
        """
        self._write_chunked(prepared.contains, 'contains', _CYPHER_WRITE_CONTAINS_MATCH)
        self._write_chunked(prepared.contained_by, 'contained_by', _CYPHER_WRITE_CONTAINED_BY_MATCH)
        self._write_chunked(prepared.subclass_of, 'subclass', _CYPHER_WRITE_SUBCLASS_MATCH)
        self._write_chunked(prepared.rn_mappings, 'rn_mapping', _CYPHER_WRITE_RN_MAPPING_MATCH)
        self._write_chunked(prepared.relates_to, 'relates_to', _CYPHER_WRITE_RELATES_TO_MATCH)
        self._write_chunked(prepared.relates_from, 'relates_from', _CYPHER_WRITE_RELATES_FROM_MATCH)
        self._write_chunked(prepared.has_stat, 'has_stat', _CYPHER_WRITE_HAS_STAT_MATCH)

    def create_fulltext_indexes(self) -> None:
        """Create full-text search indexes on Class and Property after import."""
        statements = [
            "CREATE FULLTEXT INDEX class_search IF NOT EXISTS "
            "FOR (c:Class) ON EACH [c.className, c.label, c.classPkg, c.qualifiedName]",
            "CREATE FULLTEXT INDEX property_search IF NOT EXISTS "
            "FOR (p:Property) ON EACH [p.name, p.label, p.className]",
        ]
        for stmt in statements:
            try:
                self._execute(stmt)
            except Exception as e:
                logger.warning('Fulltext index creation warning: %s', e)

    # ---- Progress callback safety ----

    def _emit(self, stage: str, percent: int, message: str) -> None:
        try:
            self._progress(stage, percent, message)
        except Exception:
            logger.exception('Progress callback raised; continuing')

    # ---- Helpers ----

    @staticmethod
    def _coerce_str_list(value: Any) -> List[str]:
        """Ensure a list-of-strings Neo4j property, even from weird inputs."""
        if value is None:
            return []
        if isinstance(value, list):
            return [str(v) for v in value if v is not None]
        return [str(value)]

    @staticmethod
    def _scalar_to_str(value: Any) -> Optional[str]:
        """Convert default/validValue scalars to a Neo4j-safe representation.

        Returns None for missing; string for everything else. We stringify
        numerics here so enum 'value' fields compare cleanly across types.
        """
        if value is None:
            return None
        coerced = safe_neo4j_value(value)
        if isinstance(coerced, (str, int, float, bool)):
            return str(coerced)
        return json.dumps(coerced, ensure_ascii=False)

    @staticmethod
    def _serialize_event_like(entries: Any) -> List[dict]:
        """Flatten an events/faults dict {id: 'type||target'} into structured list."""
        if not isinstance(entries, dict):
            return []
        out: List[dict] = []
        for entry_id, entry_value in entries.items():
            event_type = ''
            target_qualified = ''
            target_normalized = ''
            if isinstance(entry_value, str) and '||' in entry_value:
                event_type, _, target_qualified = entry_value.partition('||')
            elif isinstance(entry_value, str):
                event_type = entry_value
            if target_qualified:
                target_normalized = normalize_class_name(target_qualified)
            out.append({
                'id': str(entry_id),
                'type': event_type,
                'target': target_normalized,
                'targetQualified': target_qualified,
            })
        return out


# ---------------------------------------------------------------------------
# Cypher statements (module-level constants — easier to read + test)
# ---------------------------------------------------------------------------

_CYPHER_WRITE_CLASSES = """
UNWIND $batch AS c
MERGE (n:Class {className: c.className})
SET n.qualifiedName           = c.qualifiedName,
    n.sourceVersion           = c.sourceVersion,
    n.classPkg                = c.classPkg,
    n.classId                 = c.classId,
    n.label                   = c.label,
    n.comment                 = c.comment,
    n.isAbstract              = c.isAbstract,
    n.isConfigurable          = c.isConfigurable,
    n.isContextRoot           = c.isContextRoot,
    n.isDeprecated            = c.isDeprecated,
    n.isHidden                = c.isHidden,
    n.isDomainable            = c.isDomainable,
    n.isFaultable             = c.isFaultable,
    n.isHealthScorable        = c.isHealthScorable,
    n.isEncrypted             = c.isEncrypted,
    n.isExportable            = c.isExportable,
    n.isPersistent            = c.isPersistent,
    n.isCreatableDeletable    = c.isCreatableDeletable,
    n.isObservable            = c.isObservable,
    n.isStat                  = c.isStat,
    n.isSubjectToQuota        = c.isSubjectToQuota,
    n.isNxosConverged         = c.isNxosConverged,
    n.hasStats                = c.hasStats,
    n.hasEventRules           = c.hasEventRules,
    n.shouldCollectHealthStats = c.shouldCollectHealthStats,
    n.moCategory              = c.moCategory,
    n.featureTag              = c.featureTag,
    n.abstractionLayer        = c.abstractionLayer,
    n.apicNxProcessing        = c.apicNxProcessing,
    n.healthCollectionSource  = c.healthCollectionSource,
    n.monitoringPolicySource  = c.monitoringPolicySource,
    n.rnFormat                = c.rnFormat,
    n.dnFormats               = c.dnFormats,
    n.identifiedBy            = c.identifiedBy,
    n.platformFlavors         = c.platformFlavors,
    n.readAccess              = c.readAccess,
    n.writeAccess             = c.writeAccess,
    n.superClasses            = c.superClasses,
    n.events                  = c.events,
    n.faults                  = c.faults
"""

_CYPHER_WRITE_PROPERTIES = """
UNWIND $batch AS p
MATCH (c:Class {className: p.className})
MERGE (prop:Property {name: p.propName, className: p.className})
SET prop.label               = p.label,
    prop.comment             = p.comment,
    prop.baseType            = p.baseType,
    prop.modelType           = p.modelType,
    prop.uitype              = p.uitype,
    prop.propGlobalId        = p.propGlobalId,
    prop.propLocalId         = p.propLocalId,
    prop.isConfigurable      = p.isConfigurable,
    prop.isDeprecated        = p.isDeprecated,
    prop.isHidden            = p.isHidden,
    prop.isNaming            = p.isNaming,
    prop.readOnly            = p.readOnly,
    prop.readWrite           = p.readWrite,
    prop.createOnly          = p.createOnly,
    prop.mandatory           = p.mandatory,
    prop.secure              = p.secure,
    prop.implicit            = p.implicit,
    prop.isOverride          = p.isOverride,
    prop.isLike              = p.isLike,
    prop.isNxosConverged     = p.isNxosConverged,
    prop.needsPropDelimiters = p.needsPropDelimiters,
    prop.default             = p.default,
    prop.likeProp            = p.likeProp,
    prop.platformFlavors     = p.platformFlavors,
    prop.validators          = p.validators
MERGE (c)-[:HAS_PROPERTY]->(prop)
"""

# Enum values are private to their property. Use CREATE (not MERGE) because:
# - There can be duplicate (value, localName) pairs in different contexts;
# - They're always re-created from scratch on import;
# - The owning Property was just MERGE'd above, so CREATE here is safe.
_CYPHER_WRITE_ENUM_VALUES = """
UNWIND $batch AS v
MATCH (prop:Property {name: v.propName, className: v.className})
CREATE (ev:EnumValue {
    value: v.value,
    localName: v.localName,
    label: v.label,
    comment: v.comment,
    platformFlavors: v.platformFlavors
})
CREATE (prop)-[:HAS_VALUE]->(ev)
"""

_CYPHER_WRITE_CONTAINS = """
UNWIND $batch AS rel
MATCH (parent:Class {className: rel.parentClass})
MERGE (child:Class {className: rel.childClass})
MERGE (parent)-[:CONTAINS]->(child)
"""

_CYPHER_WRITE_CONTAINED_BY = """
UNWIND $batch AS rel
MATCH (child:Class {className: rel.childClass})
MERGE (parent:Class {className: rel.parentClass})
MERGE (child)-[:CONTAINED_BY]->(parent)
"""

_CYPHER_WRITE_SUBCLASS = """
UNWIND $batch AS rel
MATCH (child:Class {className: rel.childClass})
MERGE (parent:Class {className: rel.parentClass})
MERGE (child)-[:SUBCLASS_OF]->(parent)
"""

_CYPHER_WRITE_RN_MAPPING = """
UNWIND $batch AS rel
MATCH (parent:Class {className: rel.parentClass})
MERGE (child:Class {className: rel.childClass})
MERGE (parent)-[:RN_MAPPING {rnPrefix: rel.rnPrefix}]->(child)
"""

_CYPHER_WRITE_RELATES_TO = """
UNWIND $batch AS rel
MATCH (src:Class {className: rel.fromClass})
MERGE (dst:Class {className: rel.toClass})
MERGE (src)-[:RELATES_TO {via: rel.via}]->(dst)
"""

_CYPHER_WRITE_RELATES_FROM = """
UNWIND $batch AS rel
MATCH (dst:Class {className: rel.toClass})
MERGE (src:Class {className: rel.fromClass})
MERGE (dst)-[:RELATES_FROM {via: rel.via}]->(src)
"""

_CYPHER_WRITE_HAS_STAT = """
UNWIND $batch AS s
MATCH (src:Class {className: s.className})
MERGE (dst:Class {className: s.targetClass})
MERGE (src)-[r:HAS_STAT {qualifiedName: s.qualifiedName}]->(dst)
SET r.comment = s.comment
"""

# ---------------------------------------------------------------------------
# MATCH-only relationship Cyphers — used during the indexing_relationships
# phase. Both endpoints must already exist as Class nodes; if not, the row is
# silently dropped (no stub-class explosion). This is the safe path because
# every Class node was written by `write_class_batch` in the prior phase.
# ---------------------------------------------------------------------------

_CYPHER_WRITE_CONTAINS_MATCH = """
UNWIND $batch AS rel
MATCH (parent:Class {className: rel.parentClass})
MATCH (child:Class {className: rel.childClass})
MERGE (parent)-[:CONTAINS]->(child)
"""

_CYPHER_WRITE_CONTAINED_BY_MATCH = """
UNWIND $batch AS rel
MATCH (child:Class {className: rel.childClass})
MATCH (parent:Class {className: rel.parentClass})
MERGE (child)-[:CONTAINED_BY]->(parent)
"""

_CYPHER_WRITE_SUBCLASS_MATCH = """
UNWIND $batch AS rel
MATCH (child:Class {className: rel.childClass})
MATCH (parent:Class {className: rel.parentClass})
MERGE (child)-[:SUBCLASS_OF]->(parent)
"""

_CYPHER_WRITE_RN_MAPPING_MATCH = """
UNWIND $batch AS rel
MATCH (parent:Class {className: rel.parentClass})
MATCH (child:Class {className: rel.childClass})
MERGE (parent)-[:RN_MAPPING {rnPrefix: rel.rnPrefix}]->(child)
"""

_CYPHER_WRITE_RELATES_TO_MATCH = """
UNWIND $batch AS rel
MATCH (src:Class {className: rel.fromClass})
MATCH (dst:Class {className: rel.toClass})
MERGE (src)-[:RELATES_TO {via: rel.via}]->(dst)
"""

_CYPHER_WRITE_RELATES_FROM_MATCH = """
UNWIND $batch AS rel
MATCH (dst:Class {className: rel.toClass})
MATCH (src:Class {className: rel.fromClass})
MERGE (dst)-[:RELATES_FROM {via: rel.via}]->(src)
"""

_CYPHER_WRITE_HAS_STAT_MATCH = """
UNWIND $batch AS s
MATCH (src:Class {className: s.className})
MATCH (dst:Class {className: s.targetClass})
MERGE (src)-[r:HAS_STAT {qualifiedName: s.qualifiedName}]->(dst)
SET r.comment = s.comment
"""
