# queries/services/class_hierarchy.py
#
# Static lookup tables for ACI class RN (Relative Name) construction and
# parent-child validation.
#
# Quick background for anyone new to ACI:
#   Every managed object in APIC has a Distinguished Name (DN) — a path like
#   uni/tn-Production/ap-MyApp/epg-Web. Each segment is a Relative Name (RN)
#   built from a class-specific prefix + a key attribute value.
#
# Why this file exists instead of just querying Neo4j every time:
#   For common classes the RN formats and key attributes are static — they
#   don't change between APIC versions in practice. Looking them up from a
#   dict is instantaneous, whereas a Neo4j query adds latency and a potential
#   failure point. We fall back to Neo4j (via the optimizer) for classes not
#   listed here.
#
# Note: this only covers the classes we commonly see in customer environments.
# The full ACI MIM has hundreds of classes; we add entries here as needed.


# Maps each class name to its RN format string. The placeholders (e.g. {name},
# {ip}, {id}) get filled in by build_rn() using the filter values.
#
# The odd ones:
#   fvSubnet — the key is the IP prefix, not a name. e.g. subnet-[10.0.0.0/24]
#   fabricPod / fabricNode — use a numeric id, not a name string
#   fvRsCons / fvRsProv — the relation stores the contract name in tnVzBrCPName
#   fvRsDomAtt — the key is tDn, which is the full DN of the domain being attached
CLASS_RN_FORMATS = {
    'fvTenant': 'tn-{name}',
    'fvCtx': 'ctx-{name}',

    'fvAp': 'ap-{name}',
    'fvAEPg': 'epg-{name}',

    'fvBD': 'BD-{name}',
    'fvSubnet': 'subnet-[{ip}]',

    'vzBrCP': 'brc-{name}',
    'vzSubj': 'subj-{name}',
    'vzFilter': 'flt-{name}',
    'vzEntry': 'e-{name}',

    'l3extOut': 'out-{name}',
    'l3extInstP': 'instP-{name}',
    'l3extExtEncapAllocator': 'extEncapAlloc',
    'l3extRsEctx': 'rsectx',

    'fabricPod': 'pod-{id}',
    'fabricNode': 'node-{id}',
    'fabricPathEp': 'pathep-{name}',
    'fabricProtPol': 'protpol',

    'vmmProvP': 'provc-{name}',
    'vmmDomP': 'dom-{name}',
    'vmmEpPD': 'eppd-{name}',

    'fvRsBd': 'rsbd',
    'fvRsCons': 'rscons-{tnVzBrCPName}',
    'fvRsProv': 'rsprov-{tnVzBrCPName}',
    'fvRsDomAtt': 'rsdomAtt-{tDn}',
}

# Maps each class to the attribute name that serves as its key in the DN.
# Anything not listed here defaults to 'name' in get_key_attribute().
CLASS_KEY_ATTRIBUTES = {
    'fvTenant': 'name',
    'fvCtx': 'name',
    'fvAp': 'name',
    'fvAEPg': 'name',
    'fvBD': 'name',
    'vzBrCP': 'name',
    'vzSubj': 'name',
    'vzFilter': 'name',
    'vzEntry': 'name',
    'l3extOut': 'name',
    'l3extInstP': 'name',
    'vmmProvP': 'name',
    'vmmDomP': 'name',

    'fvSubnet': 'ip',     # key is the subnet prefix, e.g. "10.0.0.0/24"
    'fabricPod': 'id',    # numeric, e.g. "1"
    'fabricNode': 'id',   # numeric, e.g. "101"
    'fabricPathEp': 'name',

    # Relation objects: None means there's no simple single-attribute key
    'fvRsBd': None,
    'fvRsCons': 'tnVzBrCPName',
    'fvRsProv': 'tnVzBrCPName',
}

# Subset of parent-child containment relationships. Used by the optimizer
# to validate connection edges in the query canvas and to build scoped DN
# queries. This doesn't need to be complete — unknown pairs fall back to
# the Neo4j graph which has the full MIM.
PARENT_CHILD_RELATIONSHIPS = {
    'fvTenant': ['fvCtx', 'fvBD', 'fvAp', 'vzBrCP', 'vzFilter', 'l3extOut'],
    'fvAp': ['fvAEPg'],
    'fvAEPg': ['fvRsBd', 'fvRsCons', 'fvRsProv', 'fvRsDomAtt'],
    'fvBD': ['fvSubnet', 'fvRsCtx'],
    'fvCtx': [],
    'vzBrCP': ['vzSubj'],
    'vzSubj': ['vzRsSubjFiltAtt'],
    'vzFilter': ['vzEntry'],
    'l3extOut': ['l3extInstP', 'l3extRsEctx'],
}


def get_rn_format(class_name: str) -> str:
    """Return the RN format string for a class, or None if it's not in our table."""
    return CLASS_RN_FORMATS.get(class_name)


def get_key_attribute(class_name: str) -> str:
    """Return the attribute name that serves as the key for this class's RN.

    Defaults to 'name' for classes not in the table, since that's by far
    the most common case in ACI.
    """
    return CLASS_KEY_ATTRIBUTES.get(class_name, 'name')


def build_rn(class_name: str, value_dict: dict) -> str:
    """Construct the Relative Name segment for a managed object.

    value_dict should contain the key attribute and any other attributes
    referenced in the RN format string. For example, for fvTenant:
        build_rn('fvTenant', {'name': 'Production'})  →  'tn-Production'

    For fvSubnet:
        build_rn('fvSubnet', {'ip': '10.0.1.1/24'})  →  'subnet-[10.0.1.1/24]'

    If the class isn't in our table and a 'name' key is present, we fall back
    to a generic "{className}-{name}" format rather than failing completely.
    This keeps the optimizer from crashing on custom or lesser-known classes.
    """
    rn_format = get_rn_format(class_name)

    if not rn_format:
        if 'name' in value_dict:
            return f"{class_name}-{value_dict['name']}"
        raise ValueError(f"Unknown class '{class_name}' and no name provided")

    try:
        return rn_format.format(**value_dict)
    except KeyError as e:
        raise ValueError(f"Missing required attribute for {class_name}: {e}")


def can_build_dn_from_filter(class_name: str, filter_data: dict) -> bool:
    """Check whether a filter is precise enough to use for DN construction.

    We can build a DN segment from a filter only if:
      1. The operator is 'eq' — prefix, wildcard, or range filters could
         match multiple objects, so we can't pick one specific DN.
      2. The filter is on the key attribute for this class (e.g. 'name' for
         fvTenant, 'ip' for fvSubnet).

    The optimizer uses this to decide whether to narrow a query down to a
    specific DN path or fall back to a class-scope query.
    """
    if filter_data.get('operator') != 'eq':
        return False

    key_attr = get_key_attribute(class_name)
    if not key_attr:
        return False

    return filter_data.get('property') == key_attr


def get_possible_children(class_name: str) -> list:
    """Return the known child classes for a given parent.

    Returns an empty list for classes not in the table — callers treat
    an empty result as "check Neo4j" rather than "no children allowed".
    """
    return PARENT_CHILD_RELATIONSHIPS.get(class_name, [])
