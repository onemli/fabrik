// PropertiesSection — every property bucketed by role.
//
// The classifier already returns the right bucket for each property
// (naming / required / configurable / operational / deprecated). This
// component only worries about layout: a search box + collapsible groups
// with a property row that shows everything an ACI engineer cares about
// (name, type, default, enum values, validators, copy snippet).

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  BUCKET_LABEL,
  BUCKET_ORDER,
  groupProperties,
  type PropertyBucket,
} from '@/utils/propertyClassifier'
import type { MIMPropertyFull } from '@/types/mim'
import { CopyButton, EmptyHint, SectionLabel } from './_shared'

const BUCKET_TONE: Record<PropertyBucket, string> = {
  naming: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  required: 'bg-rose-500/10 text-rose-600 border-rose-500/30',
  configurable: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  operational: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
  deprecated: 'bg-muted text-muted-foreground border-border',
}

export function PropertiesSection({ properties }: { properties: MIMPropertyFull[] }) {
  const [query, setQuery] = useState('')

  const grouped = useMemo(() => groupProperties(properties), [properties])

  const visibleByBucket = useMemo(() => {
    if (!query.trim()) return grouped.buckets
    const needle = query.toLowerCase()
    const matches = (p: MIMPropertyFull) =>
      p.name.toLowerCase().includes(needle) ||
      (p.label?.toLowerCase().includes(needle) ?? false) ||
      (p.baseType?.toLowerCase().includes(needle) ?? false)
    const filtered: typeof grouped.buckets = {
      naming: [], required: [], configurable: [], operational: [], deprecated: [],
    }
    for (const bucket of BUCKET_ORDER) {
      filtered[bucket] = grouped.buckets[bucket].filter(matches)
    }
    return filtered
  }, [grouped, query])

  if (grouped.total === 0) {
    return (
      <div>
        <SectionLabel>Properties</SectionLabel>
        <EmptyHint>No queryable properties on this class.</EmptyHint>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <SectionLabel>Properties · {grouped.total}</SectionLabel>
        <div className="relative w-48">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search properties…"
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>
      <div className="space-y-4">
        {BUCKET_ORDER.map((bucket) => {
          const list = visibleByBucket[bucket]
          if (list.length === 0) return null
          return (
            <div key={bucket}>
              <div className="flex items-center gap-2 mb-1.5">
                <Badge variant="outline" className={`text-[10px] ${BUCKET_TONE[bucket]}`}>
                  {BUCKET_LABEL[bucket]}
                </Badge>
                <span className="text-[10px] text-muted-foreground">{list.length}</span>
              </div>
              <ul className="rounded-md border border-border/40 divide-y divide-border/40">
                {list.map((p) => (
                  <PropertyRow key={p.name} prop={p} bucket={bucket} />
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PropertyRow({ prop, bucket }: { prop: MIMPropertyFull; bucket: PropertyBucket }) {
  const typeStr = prop.baseType || prop.type || prop.uitype || ''
  const enumValues = prop.validValues ?? []
  const validators = prop.validators ?? []
  return (
    <li className="px-3 py-2 hover:bg-muted/30 transition-colors">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="font-mono text-xs font-medium">{prop.name}</code>
            {typeStr && (
              <span className="text-[10px] text-muted-foreground font-mono">
                {typeStr}
              </span>
            )}
            {prop.defaultStr && (
              <span className="text-[10px] text-muted-foreground">
                default: <code className="font-mono">{prop.defaultStr}</code>
              </span>
            )}
            {bucket !== 'deprecated' && prop.isDeprecated && (
              <Badge variant="outline" className="text-[9px] bg-muted">
                deprecated
              </Badge>
            )}
            {prop.secure && (
              <Badge variant="outline" className="text-[9px] bg-amber-500/10 text-amber-600 border-amber-500/30">
                secure
              </Badge>
            )}
          </div>
          {prop.label && prop.label !== prop.name && (
            <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
              {prop.label}
            </div>
          )}
          {enumValues.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {enumValues.slice(0, 8).map((v) => (
                <code
                  key={`${v.value}-${v.localName}`}
                  className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded"
                  title={v.label || v.localName}
                >
                  {v.value}
                </code>
              ))}
              {enumValues.length > 8 && (
                <span className="text-[10px] text-muted-foreground">
                  +{enumValues.length - 8}
                </span>
              )}
            </div>
          )}
          {validators.length > 0 && (
            <ValidatorSummary validators={validators} />
          )}
        </div>
        <CopyButton value={`${prop.name}=`} ariaLabel={`Copy ${prop.name}`} />
      </div>
    </li>
  )
}

function ValidatorSummary({ validators }: { validators: NonNullable<MIMPropertyFull['validators']> }) {
  // Only render the most useful summary — avoid drowning the panel in JSON.
  const v = validators[0]
  if (!v) return null
  const parts: string[] = []
  if (typeof v.min === 'number' && typeof v.max === 'number') parts.push(`length ${v.min}–${v.max}`)
  if (v.regexs && v.regexs.length > 0) parts.push(`regex: ${v.regexs[0].regex}`)
  if (parts.length === 0) return null
  return (
    <div className="text-[10px] text-muted-foreground mt-1 truncate" title={parts.join(' · ')}>
      {parts.join(' · ')}
    </div>
  )
}
