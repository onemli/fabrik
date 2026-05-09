// ACI Distinguished Name (DN) builder helpers.
//
// A class node carries an ``rnFormat`` (its own relative-name template, e.g.
// ``epg-{name}``) and optionally one or more ``dnFormats`` strings that
// already encode the entire ancestor chain. The detail panel needs:
//
//   1. A canonical DN template for display & copy.
//   2. A "live" example with placeholder values substituted so newcomers can
//      see what the URL actually looks like.
//   3. REST URL variants — Cisco APIC exposes both ``/api/mo/<dn>.json`` and
//      ``/api/class/<class>.json``.

import type { ClassRef } from '@/types/mim'

export interface DnBuilderInput {
  /** Codebase name (``fvAEPg``). */
  className: string
  /** Class node ``rnFormat`` (``epg-{name}``). May be empty for abstracts. */
  rnFormat?: string
  /** Pre-built DN strings published by pubhub on the Class node. */
  dnFormats?: string[]
  /** Direct containment parents resolved from CONTAINED_BY. */
  parents?: ClassRef[]
}

const PLACEHOLDER_FALLBACKS: Record<string, string> = {
  tnName: 'TenantName',
  tn: 'TenantName',
  apName: 'AppProfile',
  epgName: 'EPGName',
  bdName: 'BridgeDomain',
  ctxName: 'VRF',
  name: 'Example',
  rn: 'rn',
}

/**
 * Pick the best DN template for display.
 *
 * Priority:
 *   1. The first ``dnFormats[]`` entry from the Class node (already the
 *      canonical full path published by Cisco).
 *   2. A composed chain — ``rnFormat`` of the immediate parent (recursing in
 *      practice means following the breadcrumb caller already loaded) joined
 *      with this class's ``rnFormat``. In Fabrik the parents list is one
 *      level deep, so this returns ``parent-rn/this-rn`` and the caller can
 *      decide whether to recurse further.
 *   3. Just this class's ``rnFormat``.
 *   4. ``''`` when nothing is known (abstract leaves).
 */
export function buildDnTemplate(input: DnBuilderInput): string {
  const { dnFormats, rnFormat, parents } = input
  if (dnFormats && dnFormats.length > 0 && dnFormats[0]) {
    return dnFormats[0]
  }
  const chain: string[] = []
  if (parents && parents.length > 0) {
    // Convention: prepend a single parent's RN-shaped hint so the user
    // sees that *some* parent precedes this class. Full ancestry comes
    // from the breadcrumb component, not from this synth helper.
    chain.push(`{${parents[0].className}-rn}`)
  }
  if (rnFormat) chain.push(rnFormat)
  return chain.join('/')
}

/**
 * Substitute ``{placeholder}`` segments with friendlier example values so
 * the user can see what a real DN looks like. Unknown placeholders fall back
 * to a humanised form of the placeholder name itself.
 */
export function buildLiveExample(template: string): string {
  if (!template) return ''
  return template.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    const trimmed = key.trim()
    if (PLACEHOLDER_FALLBACKS[trimmed]) return PLACEHOLDER_FALLBACKS[trimmed]
    // Heuristic: ``fooName`` → ``FooName``, ``tn`` → ``Tn``.
    return capitalise(trimmed)
  })
}

/**
 * APIC REST URLs. ``mode='mo'`` queries a specific managed object by DN;
 * ``mode='class'`` queries every instance of a class fabric-wide.
 */
export function buildRestUrl(
  className: string,
  template: string,
  mode: 'mo' | 'class',
): string {
  if (mode === 'class') {
    return `/api/class/${className}.json`
  }
  if (!template) return `/api/mo.json`
  return `/api/mo/${template}.json`
}

/**
 * Pubhub documentation URL for the class — opens Cisco's own browser.
 */
export function buildDevNetUrl(versionKey: string, classPkg: string, className: string): string {
  // Strip the package prefix that the codebase puts on ``className`` so
  // ``fvTenant`` becomes ``Tenant`` for the URL segment Cisco uses.
  const shortClass = className.startsWith(classPkg) && className.length > classPkg.length
    ? className.slice(classPkg.length)
    : className
  const base = `https://pubhub.devnetcloud.com/media/model-doc-${versionKey}`
  return `${base}/docs/doc/jsonmeta/${classPkg}/${shortClass}.json`
}

function capitalise(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)
}
