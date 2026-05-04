// Group MIM properties into UX-friendly buckets.
//
// Cisco's raw flag set (``isNaming``, ``mandatory``, ``readWrite``,
// ``createOnly``, ``readOnly``, ``isDeprecated`` …) is precise but noisy.
// In the detail panel we want a single, mutually-exclusive bucket per
// property so an ACI engineer can answer "which fields do I set on POST?"
// in one glance.
//
// Bucket priority (higher wins on overlap):
//   naming      → forms part of the DN; rare, very important
//   required    → mandatory + createOnly (must supply at create time)
//   deprecated  → keep visible but de-emphasised; user shouldn't reach for it
//   configurable→ writable any time after create
//   operational → read-only runtime / oper state
//
// Properties that are simultaneously e.g. naming + mandatory collapse into
// ``naming`` because that's the more actionable label.

import type { MIMPropertyFull } from '@/types/mim'

export type PropertyBucket =
  | 'naming'
  | 'required'
  | 'deprecated'
  | 'configurable'
  | 'operational'

export const BUCKET_ORDER: PropertyBucket[] = [
  'naming',
  'required',
  'configurable',
  'operational',
  'deprecated',
]

export const BUCKET_LABEL: Record<PropertyBucket, string> = {
  naming: 'Naming (DN keys)',
  required: 'Required on create',
  configurable: 'Configurable',
  operational: 'Operational (read-only)',
  deprecated: 'Deprecated',
}

/**
 * Decide which bucket a single property belongs in. The first matching rule
 * (in ``BUCKET_ORDER``) wins.
 */
export function classifyProperty(p: MIMPropertyFull): PropertyBucket {
  if (p.isNaming) return 'naming'
  if (p.isDeprecated) return 'deprecated'
  if (p.mandatory && p.createOnly) return 'required'
  if (p.isConfigurable || p.readWrite || p.createOnly) return 'configurable'
  return 'operational'
}

export interface GroupedProperties {
  buckets: Record<PropertyBucket, MIMPropertyFull[]>
  total: number
}

export function groupProperties(props: MIMPropertyFull[]): GroupedProperties {
  const buckets: Record<PropertyBucket, MIMPropertyFull[]> = {
    naming: [],
    required: [],
    configurable: [],
    operational: [],
    deprecated: [],
  }
  for (const p of props) {
    buckets[classifyProperty(p)].push(p)
  }
  for (const bucket of BUCKET_ORDER) {
    buckets[bucket].sort((a, b) => a.name.localeCompare(b.name))
  }
  return { buckets, total: props.length }
}
