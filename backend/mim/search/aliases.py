"""Curated ACI shorthand → className mapping.

Network engineers rarely type the exact MIM class name. They type ``vrf``
when they want ``fvCtx``, ``bd`` when they want ``fvBD``, ``aaep`` when they
want ``infraAttEntityP``. Without this mapping, those queries find nothing
relevant and users give up.

Every value in :data:`SINGLE_WORD_ALIASES` and :data:`MULTI_WORD_ALIASES`
is a real ACI class name verified against Cisco APIC documentation. If a
class is missing from a given APIC release the search simply ranks it
lower — nothing breaks.

Aliases are intentionally a static Python dict (not a database table)
because:

  * The mapping is small (under 200 entries).
  * It rarely changes — only when Cisco adds new vocabulary.
  * Edits should go through code review, not through a UI.
"""

import re


# Single-word aliases. Keys are lowercase; values list candidate className(s)
# in priority order — the most common interpretation comes first.
SINGLE_WORD_ALIASES: dict[str, tuple[str, ...]] = {
    # Tenant & networking core
    'vrf': ('fvCtx',),
    'context': ('fvCtx',),
    'bd': ('fvBD',),
    'epg': ('fvAEPg',),
    'tenant': ('fvTenant',),
    'ap': ('fvAp',),
    'subnet': ('fvSubnet',),
    'endpoint': ('fvCEp', 'fvIp'),
    'mac': ('fvCEp',),

    # Contracts / policy
    'contract': ('vzBrCP',),
    'subject': ('vzSubj',),
    'taboo': ('vzTaboo',),

    # L3Out
    'l3out': ('l3extOut',),

    # Fabric / access policies
    'aaep': ('infraAttEntityP',),
    'leaf': ('fabricNode',),
    'spine': ('fabricNode',),
    'pod': ('fabricPod',),
    'fabric': ('fabricInst',),

    # Routing protocols
    'bgp': ('bgpPeerP', 'bgpPeerEntry', 'bgpInst'),
    'ospf': ('ospfIfP', 'ospfInst'),
    'eigrp': ('eigrpIfP',),

    # Misc commonly-asked
    'image': ('firmwareFirmware',),
    'firmware': ('firmwareFirmware',),
    'snapshot': ('configSnapshot',),
    'backup': ('configExportP',),
}


# Multi-word aliases. Matched via substring on lowercased raw query, so the
# user does not need to use quotes. Sorted longest-first at module load to
# avoid "bridge" matching before "bridge domain".
_MULTI_WORD_RAW: dict[str, tuple[str, ...]] = {
    'bridge domain': ('fvBD',),
    'private network': ('fvCtx',),
    'application profile': ('fvAp',),
    'app profile': ('fvAp',),
    'application epg': ('fvAEPg',),
    'app epg': ('fvAEPg',),
    'useg epg': ('fvAEPg',),

    'filter entry': ('vzEntry',),
    'oob contract': ('vzOOBBrCP',),

    'l3 out': ('l3extOut',),
    'external epg': ('l3extInstP',),
    'l3 epg': ('l3extInstP',),
    'node profile': ('l3extLNodeP',),
    'interface profile': ('l3extLIfP',),
    'logical node': ('l3extLNodeP',),
    'logical interface': ('l3extLIfP',),
    'bgp peer': ('bgpPeerP', 'bgpPeerEntry'),
    'ospf interface': ('ospfIfP',),

    'attachable entity profile': ('infraAttEntityP',),
    'access entity profile': ('infraAttEntityP',),
    'vlan pool': ('fvnsVlanInstP',),
    'vlan instance': ('fvnsVlanInstP',),
    'encap block': ('fvnsEncapBlk',),
    'physical domain': ('physDomP',),
    'phys dom': ('physDomP',),
    'l3 domain': ('l3extDomP',),
    'vmm domain': ('vmmDomP',),
    'switch profile': ('infraNodeP',),
    'leaf profile': ('infraNodeP',),
    'spine profile': ('infraSpineP',),
    'pod profile': ('fabricPodP',),
    'interface policy group': ('infraAccPortGrp', 'infraAccBndlGrp'),
    'access policy': ('infraInfra',),

    'config snapshot': ('configSnapshot',),
    'config export': ('configExportP',),
    'config import': ('configImportP',),
}

# Pre-sort longest-first so substring matching is greedy.
MULTI_WORD_ALIASES: tuple[tuple[str, tuple[str, ...]], ...] = tuple(
    sorted(_MULTI_WORD_RAW.items(), key=lambda item: -len(item[0]))
)


_WORD_RE = re.compile(r'[A-Za-z][A-Za-z0-9]*')


def resolve_aliases(raw_query: str) -> list[str]:
    """Return ACI className(s) the user likely meant by their query.

    Matches multi-word aliases first (greedy, longest match), then
    single-word aliases for any remaining tokens. Duplicates are removed
    while preserving the order the user's terms appeared.

    Returns an empty list when nothing matches — callers should treat that
    as "no alias hint" and fall back to plain text search.
    """
    if not raw_query or not raw_query.strip():
        return []

    lower = raw_query.lower()
    matched: list[str] = []
    consumed_spans: list[tuple[int, int]] = []

    for phrase, class_names in MULTI_WORD_ALIASES:
        start = lower.find(phrase)
        if start == -1:
            continue
        end = start + len(phrase)
        if _overlaps(start, end, consumed_spans):
            continue
        consumed_spans.append((start, end))
        matched.extend(class_names)

    for match in _WORD_RE.finditer(lower):
        if _overlaps(match.start(), match.end(), consumed_spans):
            continue
        for class_name in SINGLE_WORD_ALIASES.get(match.group(), ()):
            matched.append(class_name)

    return _dedupe_preserving_order(matched)


def _overlaps(start: int, end: int, spans: list[tuple[int, int]]) -> bool:
    """True when [start, end) intersects any span already consumed by a
    longer multi-word alias — prevents double counting (e.g. "bridge" inside
    "bridge domain")."""
    return any(not (end <= s or start >= e) for s, e in spans)


def _dedupe_preserving_order(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out
