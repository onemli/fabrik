// ChildrenSection — direct CONTAINS children. Splits noisy monitoring/stats
// children into a collapsed sub-list because the full list overwhelms the
// panel for popular classes (``fvAEPg`` has 200+).

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { ClassChip, EmptyHint, SectionLabel } from './_shared'
import { isMonitoringClass } from '@/lib/classFilters'

export interface ChildClass {
  className: string
  label: string
}

export function ChildrenSection({
  children,
  onPickClass,
  initialVisible = 12,
}: {
  children: ChildClass[]
  onPickClass?: (className: string) => void
  initialVisible?: number
}) {
  const [showAll, setShowAll] = useState(false)
  const [showMonitoring, setShowMonitoring] = useState(false)

  if (!children || children.length === 0) {
    return (
      <div>
        <SectionLabel>Child classes</SectionLabel>
        <EmptyHint>This class has no children.</EmptyHint>
      </div>
    )
  }

  const normal = children.filter((c) => !isMonitoringClass(c.className))
  const monitoring = children.filter((c) => isMonitoringClass(c.className))
  const visible = showAll ? normal : normal.slice(0, initialVisible)

  return (
    <div className="space-y-3">
      <div>
        <SectionLabel>
          Child classes ({normal.length}
          {monitoring.length > 0 ? ` + ${monitoring.length} monitoring` : ''})
        </SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {visible.map((child) => (
            <ClassChip
              key={child.className}
              className={child.className}
              label={child.label}
              onClick={onPickClass ? () => onPickClass(child.className) : undefined}
            />
          ))}
        </div>
        {normal.length > initialVisible && (
          <button
            type="button"
            onClick={() => setShowAll(!showAll)}
            className="text-xs text-primary mt-2 hover:underline"
          >
            {showAll ? 'Show fewer' : `Show ${normal.length - initialVisible} more`}
          </button>
        )}
      </div>
      {monitoring.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowMonitoring(!showMonitoring)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {showMonitoring ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            Monitoring & stats children ({monitoring.length})
          </button>
          {showMonitoring && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {monitoring.map((child) => (
                <ClassChip
                  key={child.className}
                  className={child.className}
                  label={child.label}
                  onClick={onPickClass ? () => onPickClass(child.className) : undefined}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
