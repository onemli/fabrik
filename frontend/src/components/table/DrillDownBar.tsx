// table/DrillDownBar.tsx
//
// Navigation bar that appears above SmartTable when the user drills into nested
// ACI objects. Shows a breadcrumb trail back to the root result set and filter
// chips for each child class group so the user can switch between children types
// without going back to the top level first.

import { Home, ChevronRight, ArrowLeft, Layers, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BreadcrumbLevel, ChildClassGroup } from '@/hooks/useDrillDown'

interface DrillDownBarProps {
  breadcrumb: BreadcrumbLevel[]
  childGroups: ChildClassGroup[] | null
  activeChildClass: string | null
  onNavigate: (index: number) => void
  onFilterByClass: (className: string | null) => void
  onGoBack: () => void
  totalChildCount: number
  /** True when this level has no further expandable rows */
  isLeafLevel?: boolean
  /** Detected scope of the APIC response data */
  detectedScope?: 'self' | 'children' | 'full' | null
}

export function DrillDownBar({
  breadcrumb,
  childGroups,
  activeChildClass,
  onNavigate,
  onFilterByClass,
  onGoBack,
  totalChildCount,
  isLeafLevel = false,
  detectedScope,
}: DrillDownBarProps) {
  if (breadcrumb.length === 0) return null

  // Show hint when query scope is shallow and deeper data may exist
  const showDepthHint = detectedScope === 'children' && (isLeafLevel || breadcrumb.length >= 1)

  return (
    <div className="bg-muted/30 dark:bg-muted/20 border border-border/50 rounded-lg px-3 py-2 space-y-2">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-sm min-w-0 overflow-x-auto">
        <button
          onClick={onGoBack}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors shrink-0 mr-1"
          title="Go back"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>

        <button
          onClick={() => onNavigate(-1)}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title="Back to root"
        >
          <Home className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Root</span>
        </button>

        {breadcrumb.map((level, index) => (
          <div key={index} className="flex items-center gap-1 shrink-0">
            <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
            {index === breadcrumb.length - 1 ? (
              // Active (last) segment — not clickable
              <span className="text-xs font-semibold text-foreground">
                {level.label}
              </span>
            ) : (
              // Clickable ancestor
              <button
                onClick={() => onNavigate(index)}
                className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {level.label}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Child class filter chips */}
      {childGroups && childGroups.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          <Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />

          {/* All chip */}
          <button
            onClick={() => onFilterByClass(null)}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
              activeChildClass === null
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground'
            )}
          >
            All
            <span className={cn(
              'text-[10px] tabular-nums',
              activeChildClass === null ? 'text-primary-foreground/70' : 'text-muted-foreground'
            )}>
              {totalChildCount}
            </span>
          </button>

          {/* Per-class chips */}
          {childGroups.map(group => (
            <button
              key={group.className}
              onClick={() => onFilterByClass(group.className)}
              className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
                activeChildClass === group.className
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground'
              )}
            >
              {group.className}
              <span className={cn(
                'text-[10px] tabular-nums',
                activeChildClass === group.className ? 'text-primary-foreground/70' : 'text-muted-foreground'
              )}>
                {group.count}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Depth hint: only shown when data is shallow and user can't go deeper */}
      {showDepthHint && (
        <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <Info className="h-3 w-3 shrink-0" />
          <span>End of available data. Change scope to <strong>Subtree</strong> for deeper levels.</span>
        </div>
      )}
    </div>
  )
}
