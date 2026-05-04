// StatsSection — counter / statistic classes wired to this object via
// HAS_STAT. Common case: every config object has dozens of stats classes
// (``eqptIngrTotalPkts``, ``eqptIngrBytes`` …). We collapse by package and
// initial visible window so the panel stays usable for a tenant root.

import { useState } from 'react'
import { ClassChip, EmptyHint, SectionLabel } from './_shared'
import type { StatRef } from '@/types/mim'

export function StatsSection({
  stats,
  onPickClass,
  initialVisible = 12,
}: {
  stats: StatRef[]
  onPickClass?: (className: string) => void
  initialVisible?: number
}) {
  const [showAll, setShowAll] = useState(false)
  if (!stats || stats.length === 0) {
    return (
      <div>
        <SectionLabel>Statistics</SectionLabel>
        <EmptyHint>No stat counters are attached to this class.</EmptyHint>
      </div>
    )
  }
  const visible = showAll ? stats : stats.slice(0, initialVisible)
  return (
    <div>
      <SectionLabel>Statistics · {stats.length}</SectionLabel>
      <div className="flex flex-wrap gap-1.5">
        {visible.map((s) => (
          <ClassChip
            key={s.qualifiedName || s.className}
            className={s.className}
            label={s.label}
            classPkg={s.classPkg}
            onClick={onPickClass ? () => onPickClass(s.className) : undefined}
          />
        ))}
      </div>
      {stats.length > initialVisible && (
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          className="text-xs text-primary mt-2 hover:underline"
        >
          {showAll ? 'Show fewer' : `Show ${stats.length - initialVisible} more`}
        </button>
      )}
    </div>
  )
}
