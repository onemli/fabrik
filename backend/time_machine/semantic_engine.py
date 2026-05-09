# time_machine/semantic_engine.py
#
# ACI-aware impact scoring for configuration changes. Instead of treating all
# attribute changes equally, this module assigns severity levels based on deep
# ACI domain knowledge — changing a subnet gateway is CRITICAL, renaming a
# description is INFO.
#
# The registry is intentionally hardcoded rather than stored in a DB or fetched
# from Neo4j. ACI's class semantics don't change between releases in ways that
# would make a dynamic approach worthwhile, and a static registry is fast,
# testable, and doesn't require a Neo4j connection at diff time.

from typing import Dict, List, Any

# Severity levels ordered by operational impact.
# CRITICAL = service-affecting change (traffic loss, routing blackhole)
# HIGH     = security or policy change (contracts, filters, auth)
# MEDIUM   = structural change (new objects, topology shift)
# LOW      = operational tweak (monitoring thresholds, timers)
# INFO     = cosmetic (descriptions, aliases, annotations)
SEVERITY_CRITICAL = 'critical'
SEVERITY_HIGH = 'high'
SEVERITY_MEDIUM = 'medium'
SEVERITY_LOW = 'low'
SEVERITY_INFO = 'info'

SEVERITY_WEIGHT = {
    SEVERITY_CRITICAL: 100,
    SEVERITY_HIGH: 75,
    SEVERITY_MEDIUM: 50,
    SEVERITY_LOW: 25,
    SEVERITY_INFO: 5,
}

# Classes whose creation or deletion is inherently high-impact, regardless
# of which specific attribute changed. Grouped by the ACI functional domain
# so the mapping is easy to audit and extend.
CLASS_SEVERITY: Dict[str, str] = {
    # Fabric & infrastructure — changes here affect every tenant
    'fabricNode': SEVERITY_CRITICAL,
    'fabricPath': SEVERITY_CRITICAL,
    'fabricProtPol': SEVERITY_HIGH,
    'bgpInstPol': SEVERITY_CRITICAL,
    'ospfInstPol': SEVERITY_CRITICAL,
    'isisDomPol': SEVERITY_CRITICAL,
    # Tenant networking — the bread and butter of ACI
    'fvTenant': SEVERITY_HIGH,
    'fvCtx': SEVERITY_CRITICAL,
    'fvBD': SEVERITY_CRITICAL,
    'fvSubnet': SEVERITY_CRITICAL,
    'fvAp': SEVERITY_HIGH,
    'fvAEPg': SEVERITY_HIGH,
    'fvRsBd': SEVERITY_CRITICAL,
    'fvRsCtx': SEVERITY_CRITICAL,
    'fvRsCons': SEVERITY_HIGH,
    'fvRsProv': SEVERITY_HIGH,
    'fvRsDomAtt': SEVERITY_MEDIUM,
    'fvRsPathAtt': SEVERITY_HIGH,
    'fvCEp': SEVERITY_LOW,
    'fvIp': SEVERITY_LOW,
    # Contracts and security policy
    'vzBrCP': SEVERITY_HIGH,
    'vzSubj': SEVERITY_HIGH,
    'vzRsSubjFiltAtt': SEVERITY_HIGH,
    'vzFilter': SEVERITY_HIGH,
    'vzEntry': SEVERITY_HIGH,
    'vzTaboo': SEVERITY_HIGH,
    # L3Out and external routing
    'l3extOut': SEVERITY_CRITICAL,
    'l3extLNodeP': SEVERITY_CRITICAL,
    'l3extLIfP': SEVERITY_CRITICAL,
    'l3extRsEctx': SEVERITY_CRITICAL,
    'l3extSubnet': SEVERITY_CRITICAL,
    'l3extInstP': SEVERITY_HIGH,
    'l3extRsPathL3OutAtt': SEVERITY_CRITICAL,
    # Access policies — physical connectivity
    'infraAccPortP': SEVERITY_MEDIUM,
    'infraHPortS': SEVERITY_MEDIUM,
    'infraPortBlk': SEVERITY_MEDIUM,
    'infraAccBndlGrp': SEVERITY_MEDIUM,
    'infraAccPortGrp': SEVERITY_MEDIUM,
    'infraAttEntityP': SEVERITY_MEDIUM,
    'infraRsDomP': SEVERITY_MEDIUM,
    # VMM and virtualization
    'vmmDomP': SEVERITY_MEDIUM,
    'vmmCtrlrP': SEVERITY_MEDIUM,
    # Monitoring and management — lower impact
    'monEPGPol': SEVERITY_LOW,
    'snmpPol': SEVERITY_LOW,
    'syslogGroup': SEVERITY_LOW,
    'maintMaintP': SEVERITY_LOW,
    'firmwareFwP': SEVERITY_LOW,
    # Health and fault objects are informational
    'healthInst': SEVERITY_INFO,
    'faultInst': SEVERITY_INFO,
    'faultDelegate': SEVERITY_INFO,
}

# Per-attribute severity overrides. These take precedence over the class-level
# default because certain attributes within a class carry outsized risk.
# Format: { 'className.attributeName': severity }
ATTRIBUTE_SEVERITY: Dict[str, str] = {
    # Subnet changes that affect traffic forwarding
    'fvSubnet.ip': SEVERITY_CRITICAL,
    'fvSubnet.scope': SEVERITY_CRITICAL,
    'fvSubnet.preferred': SEVERITY_HIGH,
    'fvSubnet.virtual': SEVERITY_HIGH,
    # BD forwarding behavior
    'fvBD.unkMacUcastAct': SEVERITY_CRITICAL,
    'fvBD.unkMcastAct': SEVERITY_CRITICAL,
    'fvBD.arpFlood': SEVERITY_HIGH,
    'fvBD.unicastRoute': SEVERITY_CRITICAL,
    'fvBD.limitIpLearnToSubnets': SEVERITY_HIGH,
    'fvBD.ipLearning': SEVERITY_CRITICAL,
    'fvBD.multiDstPktAct': SEVERITY_HIGH,
    # VRF enforcement — controls whether contracts are even applied
    'fvCtx.pcEnfPref': SEVERITY_CRITICAL,
    'fvCtx.pcEnfDir': SEVERITY_CRITICAL,
    'fvCtx.knwMcastAct': SEVERITY_HIGH,
    'fvCtx.bdEnforcedEnable': SEVERITY_HIGH,
    # EPG contract bindings change security posture
    'fvAEPg.prio': SEVERITY_MEDIUM,
    'fvAEPg.prefGrMemb': SEVERITY_HIGH,
    'fvAEPg.floodOnEncap': SEVERITY_HIGH,
    # Contract filter entries — the actual ACL rules
    'vzEntry.etherT': SEVERITY_HIGH,
    'vzEntry.prot': SEVERITY_HIGH,
    'vzEntry.dFromPort': SEVERITY_HIGH,
    'vzEntry.dToPort': SEVERITY_HIGH,
    'vzEntry.sFromPort': SEVERITY_HIGH,
    'vzEntry.sToPort': SEVERITY_HIGH,
    'vzEntry.stateful': SEVERITY_HIGH,
    'vzEntry.tcpRules': SEVERITY_HIGH,
    # L3Out route control — affects external reachability
    'l3extSubnet.scope': SEVERITY_CRITICAL,
    'l3extSubnet.ip': SEVERITY_CRITICAL,
    'l3extSubnet.aggregate': SEVERITY_HIGH,
    # Interface and path bindings — physical connectivity
    'fvRsPathAtt.tDn': SEVERITY_HIGH,
    'fvRsPathAtt.encap': SEVERITY_HIGH,
    'fvRsPathAtt.mode': SEVERITY_HIGH,
    'fvRsBd.tnFvBDName': SEVERITY_CRITICAL,
    'fvRsCtx.tnFvCtxName': SEVERITY_CRITICAL,
    # Cosmetic attributes that exist on many classes — always INFO
    'fvTenant.descr': SEVERITY_INFO,
    'fvBD.descr': SEVERITY_INFO,
    'fvAEPg.descr': SEVERITY_INFO,
    'fvAp.descr': SEVERITY_INFO,
    'fvCtx.descr': SEVERITY_INFO,
    'vzBrCP.descr': SEVERITY_INFO,
    'l3extOut.descr': SEVERITY_INFO,
}

# Attributes that are cosmetic regardless of which class they're on.
# Checked as a fallback when no class-specific override exists.
GLOBAL_INFO_ATTRIBUTES = frozenset(
    {
        'descr',
        'nameAlias',
        'annotation',
        'ownerKey',
        'ownerTag',
        'userdom',
        'uid',
        'extMngdBy',
    }
)

# Attributes that always indicate a structural/operational change
GLOBAL_MEDIUM_ATTRIBUTES = frozenset(
    {
        'name',
        'dn',
        'rn',
        'status',
    }
)


def get_attribute_severity(class_name: str, attr_name: str) -> str:
    """Return the severity level for a specific attribute change on a given class.

    Resolution order:
      1. Exact class.attribute match in ATTRIBUTE_SEVERITY
      2. Global info/medium attribute lists
      3. Class-level default from CLASS_SEVERITY
      4. Fallback to MEDIUM (unknown class, unknown attribute — be cautious)
    """
    # Exact match is the most specific signal we have
    exact_key = f'{class_name}.{attr_name}'
    if exact_key in ATTRIBUTE_SEVERITY:
        return ATTRIBUTE_SEVERITY[exact_key]

    # Global cosmetic attributes are always low-risk
    if attr_name in GLOBAL_INFO_ATTRIBUTES:
        return SEVERITY_INFO

    # Name/status changes are structurally meaningful
    if attr_name in GLOBAL_MEDIUM_ATTRIBUTES:
        return SEVERITY_MEDIUM

    # Fall back to the class-level default
    if class_name in CLASS_SEVERITY:
        return CLASS_SEVERITY[class_name]

    # Unknown class, unknown attribute — default to medium so it doesn't
    # get ignored but also doesn't create false alarms
    return SEVERITY_MEDIUM


def get_class_severity(class_name: str) -> str:
    """Return the base severity for object-level changes (add/delete) on a class."""
    return CLASS_SEVERITY.get(class_name, SEVERITY_MEDIUM)


def score_attribute_changes(
    class_name: str,
    attribute_changes: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Enrich a list of attribute changes with severity and weight.

    Takes the raw attribute_changes list from _attribute_diff() and returns
    the same list with 'severity' and 'weight' added to each entry.
    """
    enriched = []
    for change in attribute_changes:
        attr_name = change['key']
        severity = get_attribute_severity(class_name, attr_name)
        enriched.append(
            {
                **change,
                'severity': severity,
                'weight': SEVERITY_WEIGHT[severity],
            }
        )
    return enriched


def compute_risk_score(
    added: List[Dict],
    modified: List[Dict],
    deleted: List[Dict],
) -> Dict[str, Any]:
    """Compute an overall risk score and severity breakdown for a comparison.

    The risk_score is a 0-100 value that reflects the worst-case impact
    of the combined changes. It's weighted toward the highest-severity items
    because a single critical change matters more than ten info changes.
    """
    severity_counts = {
        SEVERITY_CRITICAL: 0,
        SEVERITY_HIGH: 0,
        SEVERITY_MEDIUM: 0,
        SEVERITY_LOW: 0,
        SEVERITY_INFO: 0,
    }
    max_weight = 0
    total_weight = 0
    change_count = 0

    # Added/deleted objects scored at their class level
    for item in added + deleted:
        class_name = _extract_class_name(item.get('object', {}))
        severity = item.get('severity', get_class_severity(class_name))
        weight = SEVERITY_WEIGHT[severity]
        severity_counts[severity] += 1
        total_weight += weight
        max_weight = max(max_weight, weight)
        change_count += 1

    # Modified objects scored by their worst attribute change
    for item in modified:
        attr_changes = item.get('attribute_changes', [])
        item_max = 0
        for ac in attr_changes:
            sev = ac.get('severity', SEVERITY_MEDIUM)
            weight = SEVERITY_WEIGHT[sev]
            severity_counts[sev] += 1
            item_max = max(item_max, weight)
            change_count += 1
        total_weight += item_max
        max_weight = max(max_weight, item_max)

    # Risk score blends the worst single change (60%) with the average (40%).
    # This means one critical change in a sea of info changes still scores high,
    # but many medium changes also accumulate into a concerning score.
    if change_count == 0:
        risk_score = 0
    else:
        avg_weight = total_weight / max(len(added) + len(modified) + len(deleted), 1)
        risk_score = min(100, int(max_weight * 0.6 + avg_weight * 0.4))

    return {
        'risk_score': risk_score,
        'risk_level': _score_to_level(risk_score),
        'severity_counts': severity_counts,
        'total_scored_changes': change_count,
    }


def _score_to_level(score: int) -> str:
    """Map a numeric risk score to a human-readable level."""
    if score >= 80:
        return SEVERITY_CRITICAL
    elif score >= 60:
        return SEVERITY_HIGH
    elif score >= 40:
        return SEVERITY_MEDIUM
    elif score >= 20:
        return SEVERITY_LOW
    return SEVERITY_INFO


def _extract_class_name(obj: dict) -> str:
    """Pull the ACI class name from an imdata-style object wrapper.

    APIC objects look like {"fvTenant": {"attributes": {...}}} — the outer
    key is the class name. Returns empty string if the structure is unexpected.
    """
    if isinstance(obj, dict):
        keys = [k for k in obj.keys() if k != 'dn']
        if keys:
            return keys[0]
    return ''
