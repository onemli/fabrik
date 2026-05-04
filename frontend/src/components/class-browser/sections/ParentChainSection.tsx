// ParentChainSection — DN-style breadcrumb showing the immediate
// containment parent(s). A single click navigates to the parent's detail.
//
// We intentionally render only one level. Following the chain further would
// duplicate the work the right-pane breadcrumb already does, and ACI classes
// often have multiple legitimate parents (e.g. ``fvAEPg`` is contained by
// both ``fvAp`` and the ``fv:Tenant`` collection in some contexts) — listing
// them all flat is honest about that ambiguity.

import { ChevronRight } from 'lucide-react'
import { ClassChip, EmptyHint, SectionLabel } from './_shared'
import type { ClassRef } from '@/types/mim'

export function ParentChainSection({
  className,
  parents,
  onPickClass,
}: {
  className: string
  parents: ClassRef[]
  onPickClass?: (className: string) => void
}) {
  if (!parents || parents.length === 0) {
    return (
      <div>
        <SectionLabel>Containment</SectionLabel>
        <EmptyHint>This class has no containment parents (root object).</EmptyHint>
      </div>
    )
  }
  return (
    <div>
      <SectionLabel>Contained by</SectionLabel>
      <div className="flex items-center flex-wrap gap-1.5">
        {parents.map((p, i) => (
          <span key={p.className} className="flex items-center gap-1.5">
            <ClassChip
              className={p.className}
              label={p.label}
              classPkg={p.classPkg}
              onClick={onPickClass ? () => onPickClass(p.className) : undefined}
            />
            {i < parents.length - 1 && <span className="text-muted-foreground">|</span>}
          </span>
        ))}
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
        <code className="font-mono text-xs font-semibold">{className}</code>
      </div>
    </div>
  )
}
