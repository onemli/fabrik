// LifecycleBar — one tile per snapshot showing whether the tracked DN was
// present (green) or absent (gray). Transitions are annotated:
//   • first green-after-gray  → "created"
//   • first gray-after-green  → "deleted"
//   • subsequent flips        → "re-created" / "deleted again"
//
// Critical UX value: the original AttributeTimeline silently dropped absent
// snapshots, hiding the most important fact ("this object was deleted last
// Tuesday"). Surfacing absence lets an engineer answer that in one glance.

import { format } from 'date-fns'
import { CircleDashed, CircleDot } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface LifecyclePoint {
  executed_at: string
  present: boolean
}

export interface LifecycleBarProps {
  points: LifecyclePoint[]
}

interface AnnotatedPoint extends LifecyclePoint {
  marker: 'created' | 'deleted' | null
}

function annotate(points: LifecyclePoint[]): AnnotatedPoint[] {
  const out: AnnotatedPoint[] = []
  let prevPresent: boolean | null = null
  for (const p of points) {
    let marker: AnnotatedPoint['marker'] = null
    if (prevPresent !== null) {
      if (!prevPresent && p.present) marker = 'created'
      else if (prevPresent && !p.present) marker = 'deleted'
    }
    out.push({ ...p, marker })
    prevPresent = p.present
  }
  return out
}

export function LifecycleBar({ points }: LifecycleBarProps) {
  if (!points || points.length === 0) return null
  const annotated = annotate(points)
  const presentCount = annotated.filter((p) => p.present).length
  const absentCount = annotated.length - presentCount

  return (
    <div className="px-4 py-3 border-b border-border bg-muted/20">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          Lifecycle
        </span>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <LegendDot color="emerald" label={`${presentCount} present`} />
          <LegendDot color="muted" label={`${absentCount} absent`} />
        </div>
      </div>
      {/* py-1.5 so the focus rings on created/deleted tiles aren't clipped
          by the scroll container, gap-0.5 to give each tile a touch of air. */}
      <div className="flex items-stretch gap-0.5 overflow-x-auto py-1.5">
        {annotated.map((p, i) => (
          <Tile key={p.executed_at + i} point={p} />
        ))}
      </div>
    </div>
  )
}

function Tile({ point }: { point: AnnotatedPoint }) {
  const dt = new Date(point.executed_at)
  const tooltip = `${format(dt, 'PPpp')} — ${point.present ? 'present' : 'absent'}${
    point.marker ? ` (${point.marker})` : ''
  }`
  return (
    <div className="flex flex-col items-center gap-0.5 shrink-0" title={tooltip}>
      <div
        className={cn(
          'w-3 h-7 rounded-sm transition-colors',
          point.present
            ? 'bg-emerald-500/70 hover:bg-emerald-500'
            : 'bg-muted-foreground/20 hover:bg-muted-foreground/40',
          point.marker === 'created' &&
            'ring-2 ring-emerald-500 ring-offset-1 ring-offset-background',
          point.marker === 'deleted' &&
            'ring-2 ring-rose-500 ring-offset-1 ring-offset-background',
        )}
      />
      {point.marker && (
        <span
          className={cn(
            'text-[9px] font-medium',
            point.marker === 'created' ? 'text-emerald-600' : 'text-rose-600',
          )}
        >
          {point.marker === 'created' ? 'new' : 'gone'}
        </span>
      )}
    </div>
  )
}

function LegendDot({ color, label }: { color: 'emerald' | 'muted'; label: string }) {
  const cls =
    color === 'emerald' ? 'bg-emerald-500/70' : 'bg-muted-foreground/20'
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn('w-2.5 h-2.5 rounded-sm', cls)} />
      {label}
    </span>
  )
}

// Re-export icons used by callers that want to mirror the lifecycle palette.
export { CircleDot, CircleDashed }
