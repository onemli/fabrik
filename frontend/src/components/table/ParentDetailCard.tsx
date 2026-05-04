// table/ParentDetailCard.tsx
//
// Collapsible card shown above the drilled-down child table. Displays the parent
// MO's key attributes so the user doesn't lose context about what they drilled
// from. Noisy system attributes (status, modTs, etc.) are hidden by default.

import { useState, useMemo } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Attributes that are almost always noise — hide by default */
const NOISE_ATTRS = new Set([
  'childAction', 'status', 'extMngdBy', 'lcOwn', 'uid',
  'monPolDn', 'modTs', 'rn', 'userdom',
])

/** Attributes that should be shown first (most useful) */
const PRIORITY_ATTRS = ['dn', 'name', 'nameAlias', 'descr']

interface ParentDetailCardProps {
  className: string
  attributes: Record<string, unknown>
}

export function ParentDetailCard({ className, attributes }: ParentDetailCardProps) {
  const [isOpen, setIsOpen] = useState(false)

  // Split into priority + rest, filter noise
  const { priorityEntries, restEntries } = useMemo(() => {
    const priority: [string, unknown][] = []
    const rest: [string, unknown][] = []

    // Collect priority attrs first (in order)
    for (const key of PRIORITY_ATTRS) {
      if (key in attributes && attributes[key] !== '' && attributes[key] !== undefined) {
        priority.push([key, attributes[key]])
      }
    }

    // Collect rest (skip noise + priority)
    const prioritySet = new Set(PRIORITY_ATTRS)
    const entries = Object.entries(attributes)
      .filter(([k]) => !NOISE_ATTRS.has(k) && !prioritySet.has(k))
      .filter(([, v]) => v !== '' && v !== undefined && v !== null)
      .sort(([a], [b]) => a.localeCompare(b))

    rest.push(...entries)

    return { priorityEntries: priority, restEntries: rest }
  }, [attributes])

  const previewCount = 4
  const allVisible = isOpen ? [...priorityEntries, ...restEntries] : priorityEntries.slice(0, previewCount)
  const hiddenCount = priorityEntries.length + restEntries.length - previewCount

  return (
    <div className="border border-border/60 rounded-lg bg-card/50 overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/30 transition-colors"
      >
        {isOpen
          ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        }
        <span className="text-xs font-semibold text-primary">{className}</span>
        <span className="text-xs text-muted-foreground truncate flex-1">
          {String(attributes.dn || '')}
        </span>
        {!isOpen && hiddenCount > 0 && (
          <span className="text-[10px] text-muted-foreground/70 tabular-nums shrink-0">
            +{hiddenCount} attrs
          </span>
        )}
      </button>

      {/* Attribute grid — collapsed/expanded */}
      {isOpen && allVisible.length > 0 && (
        <div className="px-3 pb-2 pt-0.5">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-4 gap-y-1">
            {allVisible.map(([key, value]) => (
              <div key={key} className="flex flex-col min-w-0">
                <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider truncate">
                  {key}
                </span>
                <span
                  className={cn(
                    'text-xs truncate',
                    key === 'dn' ? 'text-primary/80 font-mono' : 'text-foreground/90'
                  )}
                  title={String(value)}
                >
                  {String(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
