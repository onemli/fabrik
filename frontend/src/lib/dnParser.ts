// DN (Distinguished Name) Parser for Cisco ACI
// Parses hierarchical DNs like "uni/tn-ACME/ap-WebApp/epg-Frontend"

export interface DNComponent {
  prefix: string      // e.g., "tn", "ap", "epg", "bd"
  name: string        // e.g., "ACME", "WebApp", "Frontend"
  full: string        // e.g., "tn-ACME"
  className: string   // e.g., "fvTenant", "fvAp", "fvAEPg"
}

export interface ParsedDN {
  dn: string
  components: DNComponent[]
  parent: string | null
  depth: number
  type: string        // The class type of this DN
  name: string        // The name of this object
}

// Map DN prefixes to ACI class names
const PREFIX_TO_CLASS: Record<string, string> = {
  'uni': 'polUni',
  'tn': 'fvTenant',
  'ap': 'fvAp',
  'epg': 'fvAEPg',
  'bd': 'fvBD',
  'ctx': 'fvCtx',
  'brc': 'vzBrCP',
  'subj': 'vzSubj',
  'rscons': 'fvRsCons',
  'rsprov': 'fvRsProv',
  'rsbd': 'fvRsBd',
  'rsctx': 'fvRsCtx',
  'out': 'l3extOut',
  'instP': 'l3extInstP',
  'rspathAtt': 'fvRsPathAtt',
  'subnet': 'fvSubnet',
  'l3out': 'l3extOut',
  'lnodep': 'l3extLNodeP',
  'lifp': 'l3extLIfP',
  'rsnodeL3OutAtt': 'l3extRsNodeL3OutAtt',
  'rspathL3OutAtt': 'l3extRsPathL3OutAtt',
}

// Get readable class name from prefix
const PREFIX_TO_LABEL: Record<string, string> = {
  'uni': 'Universe',
  'tn': 'Tenant',
  'ap': 'Application Profile',
  'epg': 'Endpoint Group',
  'bd': 'Bridge Domain',
  'ctx': 'VRF',
  'brc': 'Contract',
  'subj': 'Subject',
  'rscons': 'Consumed Contract',
  'rsprov': 'Provided Contract',
  'rsbd': 'Bridge Domain Relation',
  'rsctx': 'VRF Relation',
  'out': 'L3Out',
  'l3out': 'L3Out',
  'instP': 'External EPG',
  'rspathAtt': 'Path Attachment',
  'subnet': 'Subnet',
  'lnodep': 'Logical Node Profile',
  'lifp': 'Logical Interface Profile',
}

/**
 * Parse a DN component (e.g., "tn-ACME" or "ap-WebApp")
 */
function parseComponent(component: string): DNComponent {
  // Handle special cases
  if (component === 'uni') {
    return {
      prefix: 'uni',
      name: 'uni',
      full: 'uni',
      className: 'polUni',
    }
  }

  // Standard format: prefix-name
  const dashIndex = component.indexOf('-')
  if (dashIndex === -1) {
    // No dash - might be a relationship or special node
    return {
      prefix: component,
      name: component,
      full: component,
      className: PREFIX_TO_CLASS[component] || 'unknown',
    }
  }

  const prefix = component.substring(0, dashIndex)
  const name = component.substring(dashIndex + 1)

  return {
    prefix,
    name,
    full: component,
    className: PREFIX_TO_CLASS[prefix] || 'unknown',
  }
}

/**
 * Parse a full Distinguished Name
 */
export function parseDN(dn: string): ParsedDN {
  if (!dn) {
    throw new Error('DN is required')
  }

  // Split DN by forward slash
  const parts = dn.split('/').filter(Boolean)

  if (parts.length === 0) {
    throw new Error('Invalid DN format')
  }

  // Parse each component
  const components = parts.map(parseComponent)

  // Get parent DN (all parts except the last one)
  const parent = parts.length > 1 ? parts.slice(0, -1).join('/') : null

  // Get the type and name from the last component
  const lastComponent = components[components.length - 1]

  return {
    dn,
    components,
    parent,
    depth: parts.length - 1, // Depth from root (uni = 0)
    type: lastComponent.className,
    name: lastComponent.name,
  }
}

/**
 * Get the human-readable label for a DN component
 */
export function getDNComponentLabel(prefix: string): string {
  return PREFIX_TO_LABEL[prefix] || prefix.toUpperCase()
}

/**
 * Extract all parent-child relationships from a DN
 * Returns an array of [parent, child] tuples
 */
export function extractHierarchy(dn: string): Array<[string, string]> {
  const parts = dn.split('/').filter(Boolean)
  const relationships: Array<[string, string]> = []

  for (let i = 1; i < parts.length; i++) {
    const parent = parts.slice(0, i).join('/')
    const child = parts.slice(0, i + 1).join('/')
    relationships.push([parent, child])
  }

  return relationships
}

/**
 * Check if a DN represents a relationship class (starts with rs)
 */
export function isRelationshipClass(dn: string): boolean {
  const parts = dn.split('/').filter(Boolean)
  const lastPart = parts[parts.length - 1]
  return lastPart?.startsWith('rs') || false
}

/**
 * Get the target DN from a relationship
 * For example, if we have a fvRsBd with tnFvBDName="Web", construct the target DN
 */
export function getRelationshipTarget(
  relationshipDN: string,
  targetName: string,
  targetClass: string
): string {
  // Get the tenant from the relationship DN
  const parsed = parseDN(relationshipDN)
  const tenantComponent = parsed.components.find(c => c.prefix === 'tn')

  if (!tenantComponent) {
    return ''
  }

  // Construct target DN based on class type
  const tenantDN = `uni/tn-${tenantComponent.name}`

  // Map class names to DN prefixes
  const classToPrefix: Record<string, string> = {
    'fvBD': 'bd',
    'fvCtx': 'ctx',
    'vzBrCP': 'brc',
    'fvAp': 'ap',
    'fvAEPg': 'epg',
    'l3extOut': 'out',
  }

  const prefix = classToPrefix[targetClass]
  if (!prefix) {
    return ''
  }

  return `${tenantDN}/${prefix}-${targetName}`
}

/**
 * Compare two DNs to determine their relationship
 */
export function getDNRelationship(dn1: string, dn2: string): 'parent' | 'child' | 'sibling' | 'unrelated' {
  if (dn1.startsWith(dn2 + '/')) {
    return 'child'
  }
  if (dn2.startsWith(dn1 + '/')) {
    return 'parent'
  }

  const parsed1 = parseDN(dn1)
  const parsed2 = parseDN(dn2)

  if (parsed1.parent === parsed2.parent) {
    return 'sibling'
  }

  return 'unrelated'
}
