// AttributeTimeline.tsx
//
// Tracks how a single DN's attributes evolved across snapshots. The view
// has three layers an operator can flip between:
//
//   1. LifecycleBar  — green/grey tiles per snapshot showing presence with
//                      "new" / "gone" markers at transitions.
//   2. Range picker  — quick-pick (24h / 7d / 30d / all) + custom from/to,
//                      so the operator can scope the timeline to an
//                      incident window without scrolling 100 columns.
//   3. Matrix / Diff — the actual attribute table. Matrix is the original
//                      "every value at every snapshot" grid; Diff collapses
//                      to volatile rows only and renders ``old → new``
//                      pairs at the moment of change.

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, subDays } from 'date-fns'
import { Clock, GitCompare, Minus, Table2, X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { timeMachineService } from '@/services/timeMachine'
import type { AttributeTimelineResult } from '@/services/timeMachine'

import { LifecycleBar } from './LifecycleBar'

// ---------------------------------------------------------------------------
// Range picker
// ---------------------------------------------------------------------------

type Quick = '24h' | '7d' | '30d' | 'all' | 'custom'

interface DateRange {
  from?: string
  to?: string
}

const QUICK_LABEL: Record<Exclude<Quick, 'custom'>, string> = {
  '24h': 'Last 24h',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  all: 'All',
}

function rangeForQuick(quick: Exclude<Quick, 'custom'>): DateRange {
  const now = new Date()
  if (quick === 'all') return {}
  const days = quick === '24h' ? 1 : quick === '7d' ? 7 : 30
  return {
    from: subDays(now, days).toISOString(),
    to: now.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Top-level component
// ---------------------------------------------------------------------------

interface AttributeTimelineProps {
  savedQueryId: number
  dn: string
  onClose: () => void
}

export default function AttributeTimeline({
  savedQueryId,
  dn,
  onClose,
}: AttributeTimelineProps) {
  const [quick, setQuick] = useState<Quick>('7d')
  const [customRange, setCustomRange] = useState<DateRange>({})
  const [viewMode, setViewMode] = useState<'matrix' | 'diff'>('matrix')

  // Memoise so the quick range doesn't recompute new ISO timestamps every
  // render — that would invalidate the React Query key and trigger an
  // infinite refetch loop.
  const range = useMemo<DateRange>(
    () => (quick === 'custom' ? customRange : rangeForQuick(quick)),
    [quick, customRange],
  )

  const { data, isLoading } = useQuery({
    queryKey: ['attribute-timeline', savedQueryId, dn, range.from, range.to],
    queryFn: () =>
      timeMachineService.getAttributeTimeline({
        saved_query_id: savedQueryId,
        dn,
        limit: 100,
        from_date: range.from,
        to_date: range.to,
      }),
  })

  if (isLoading) {
    return (
      <div className="bg-violet-500/5 border border-violet-500/20 rounded-lg p-6">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-violet-600 dark:text-violet-400">
            Loading attribute timeline…
          </span>
        </div>
      </div>
    )
  }

  if (!data || data.snapshot_count === 0) {
    return (
      <div className="bg-muted/50 border border-border rounded-lg p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            No timeline data found for this DN in the selected range.
          </span>
          <button onClick={onClose} className="p-1 hover:bg-accent rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-violet-500/5 border border-violet-500/20 rounded-lg overflow-hidden">
      <TimelineHeader
        data={data}
        viewMode={viewMode}
        onViewMode={setViewMode}
        onClose={onClose}
      />
      <RangePicker
        quick={quick}
        customRange={customRange}
        onQuick={setQuick}
        onCustomRange={setCustomRange}
      />
      <LifecycleBar points={data.points.map((p) => ({
        executed_at: p.executed_at,
        present: p.present,
      }))} />
      {viewMode === 'matrix' ? (
        <MatrixGrid data={data} />
      ) : (
        <DiffList data={data} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Header — DN + counts + view toggle
// ---------------------------------------------------------------------------

function TimelineHeader({
  data,
  viewMode,
  onViewMode,
  onClose,
}: {
  data: AttributeTimelineResult
  viewMode: 'matrix' | 'diff'
  onViewMode: (m: 'matrix' | 'diff') => void
  onClose: () => void
}) {
  const volatileCount = data.attribute_evolution.filter((a) => !a.is_stable).length
  const stableCount = data.attribute_evolution.filter((a) => a.is_stable).length
  const presentCount = data.points.filter((p) => p.present).length

  return (
    <div className="px-4 py-3 bg-violet-500/10 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="min-w-0 flex-1">
          <span className="font-semibold text-sm block">Attribute Timeline</span>
          <span className="text-xs font-mono text-muted-foreground truncate block">
            {data.dn}
          </span>
        </div>
        <div className="flex gap-1.5 flex-shrink-0 flex-wrap">
          <Badge variant="secondary" className="text-xs bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20">
            {presentCount}/{data.snapshot_count} present
          </Badge>
          {volatileCount > 0 && (
            <Badge variant="outline" className="text-xs text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/10">
              {volatileCount} volatile
            </Badge>
          )}
          {stableCount > 0 && (
            <Badge variant="outline" className="text-xs text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10">
              {stableCount} stable
            </Badge>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <ToggleButton
          active={viewMode === 'matrix'}
          onClick={() => onViewMode('matrix')}
          icon={<Table2 className="w-3.5 h-3.5" />}
          label="Matrix"
        />
        <ToggleButton
          active={viewMode === 'diff'}
          onClick={() => onViewMode('diff')}
          icon={<GitCompare className="w-3.5 h-3.5" />}
          label="Diff"
        />
        <button onClick={onClose} className="p-1 hover:bg-accent rounded ml-1" aria-label="Close">
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>
    </div>
  )
}

function ToggleButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors',
        active
          ? 'bg-violet-500/20 text-violet-700 dark:text-violet-300'
          : 'text-muted-foreground hover:bg-accent',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Range picker
// ---------------------------------------------------------------------------

function RangePicker({
  quick,
  customRange,
  onQuick,
  onCustomRange,
}: {
  quick: Quick
  customRange: DateRange
  onQuick: (q: Quick) => void
  onCustomRange: (r: DateRange) => void
}) {
  const buttons: Exclude<Quick, 'custom'>[] = ['24h', '7d', '30d', 'all']
  return (
    <div className="px-4 py-2 border-t border-violet-500/20 bg-violet-500/[0.03] flex items-center gap-2 flex-wrap">
      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
        Range
      </span>
      <div className="flex items-center gap-1">
        {buttons.map((q) => (
          <Button
            key={q}
            type="button"
            size="sm"
            variant={quick === q ? 'default' : 'outline'}
            className="h-7 px-2.5 text-[11px]"
            onClick={() => onQuick(q)}
          >
            {QUICK_LABEL[q]}
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant={quick === 'custom' ? 'default' : 'outline'}
          className="h-7 px-2.5 text-[11px]"
          onClick={() => onQuick('custom')}
        >
          Custom
        </Button>
      </div>
      {quick === 'custom' && (
        <div className="flex items-center gap-1.5 ml-auto">
          <Input
            type="datetime-local"
            value={customRange.from?.slice(0, 16) ?? ''}
            onChange={(e) => onCustomRange({ ...customRange, from: e.target.value ? new Date(e.target.value).toISOString() : undefined })}
            className="h-7 text-[11px] w-44"
          />
          <span className="text-[11px] text-muted-foreground">→</span>
          <Input
            type="datetime-local"
            value={customRange.to?.slice(0, 16) ?? ''}
            onChange={(e) => onCustomRange({ ...customRange, to: e.target.value ? new Date(e.target.value).toISOString() : undefined })}
            className="h-7 text-[11px] w-44"
          />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Matrix view — full attribute × snapshot grid
// ---------------------------------------------------------------------------

function MatrixGrid({ data }: { data: AttributeTimelineResult }) {
  // Show every snapshot — present *and* absent — so the user can see when
  // the object was missing. Absent cells render as "—".
  const allPoints = data.points
  const volatileAttrs = data.attribute_evolution.filter((a) => !a.is_stable)
  const stableAttrs = data.attribute_evolution.filter((a) => a.is_stable)

  if (allPoints.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground text-center">
        No snapshots in the selected range.
      </div>
    )
  }

  return (
    <div className="p-4 overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            <th className="text-left px-2 py-1.5 sticky left-0 bg-violet-500/5 z-10 min-w-[140px]">
              Attribute
            </th>
            <th className="text-center px-2 py-1.5 sticky left-[140px] bg-violet-500/5 z-10 w-16">
              Changes
            </th>
            {allPoints.map((point, i) => (
              <th key={i} className="text-center px-2 py-1.5 min-w-[100px]">
                <div className="flex flex-col items-center gap-0.5">
                  <Clock className="w-3 h-3 text-muted-foreground" />
                  <span className={cn('font-normal', point.present ? 'text-muted-foreground' : 'text-muted-foreground/40')}>
                    {format(new Date(point.executed_at), 'MM/dd')}
                  </span>
                  <span className={cn('font-normal', point.present ? 'text-muted-foreground/60' : 'text-muted-foreground/30')}>
                    {format(new Date(point.executed_at), 'HH:mm')}
                  </span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {volatileAttrs.map((attr) => (
            <MatrixRow key={attr.attribute} attr={attr} points={allPoints} isVolatile />
          ))}
          {volatileAttrs.length > 0 && stableAttrs.length > 0 && (
            <tr>
              <td colSpan={allPoints.length + 2} className="px-2 py-1 text-muted-foreground/60 text-center border-t border-border">
                <span className="text-xs">
                  {stableAttrs.length} stable attribute{stableAttrs.length !== 1 ? 's' : ''} (unchanged)
                </span>
              </td>
            </tr>
          )}
          {stableAttrs.slice(0, 10).map((attr) => (
            <MatrixRow key={attr.attribute} attr={attr} points={allPoints} isVolatile={false} />
          ))}
          {stableAttrs.length > 10 && (
            <tr>
              <td colSpan={allPoints.length + 2} className="px-2 py-1 text-xs text-muted-foreground/60 text-center">
                +{stableAttrs.length - 10} more stable attributes
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function MatrixRow({
  attr,
  points,
  isVolatile,
}: {
  attr: AttributeTimelineResult['attribute_evolution'][0]
  points: AttributeTimelineResult['points']
  isVolatile: boolean
}) {
  const valuesByTime = useMemo(
    () => new Map(attr.values.map((v) => [v.executed_at, v])),
    [attr.values],
  )

  return (
    <tr className={cn('border-t border-border', !isVolatile && 'opacity-50')}>
      <td className="px-2 py-1.5 font-mono font-medium sticky left-0 bg-background z-10">
        {attr.attribute}
      </td>
      <td className="px-2 py-1.5 text-center sticky left-[140px] bg-background z-10">
        {isVolatile ? (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-violet-500/15 text-violet-700 dark:text-violet-300 rounded font-medium">
            {attr.change_count}
          </span>
        ) : (
          <Minus className="w-3 h-3 text-muted-foreground/40 mx-auto" />
        )}
      </td>
      {points.map((point, i) => {
        if (!point.present) {
          return (
            <td
              key={i}
              className="px-2 py-1.5 text-center bg-muted/30 text-muted-foreground/40 italic"
              title="absent"
            >
              —
            </td>
          )
        }
        const entry = valuesByTime.get(point.executed_at)
        const val = entry?.value
        const isChanged = entry?.changed || false
        return (
          <td
            key={i}
            className={cn(
              'px-2 py-1.5 font-mono text-center max-w-[120px] truncate',
              isChanged && 'bg-violet-500/10 font-semibold text-violet-700 dark:text-violet-300',
            )}
            title={val !== null && val !== undefined ? String(val) : 'null'}
          >
            {val === null || val === undefined ? (
              <span className="italic text-muted-foreground/40">-</span>
            ) : (
              String(val)
            )}
          </td>
        )
      })}
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Diff view — only the *moments* an attribute changed, with old → new
// ---------------------------------------------------------------------------

interface DiffEntry {
  attribute: string
  at: string
  oldValue: any
  newValue: any
  isInitial: boolean
}

function buildDiffEntries(data: AttributeTimelineResult): DiffEntry[] {
  const entries: DiffEntry[] = []
  for (const attr of data.attribute_evolution) {
    if (attr.is_stable) continue
    const sorted = [...attr.values].sort((a, b) => a.executed_at.localeCompare(b.executed_at))
    let lastValue: any = undefined
    let initialised = false
    for (const v of sorted) {
      if (!v.changed && initialised) {
        lastValue = v.value
        continue
      }
      entries.push({
        attribute: attr.attribute,
        at: v.executed_at,
        oldValue: lastValue,
        newValue: v.value,
        isInitial: !initialised,
      })
      lastValue = v.value
      initialised = true
    }
  }
  // Most recent change first — operators usually want "what just happened?".
  entries.sort((a, b) => b.at.localeCompare(a.at))
  return entries
}

function DiffList({ data }: { data: AttributeTimelineResult }) {
  const entries = useMemo(() => buildDiffEntries(data), [data])

  if (entries.length === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground text-center">
        No attribute changes in the selected range.
      </div>
    )
  }

  return (
    <div className="p-4 space-y-1.5 max-h-[420px] overflow-y-auto">
      {entries.map((e, i) => (
        <DiffRow key={i} entry={e} />
      ))}
    </div>
  )
}

function DiffRow({ entry }: { entry: DiffEntry }) {
  const dt = new Date(entry.at)
  return (
    <div className="grid grid-cols-[120px,160px,1fr] gap-3 items-center px-3 py-1.5 rounded border border-border/40 bg-background hover:bg-muted/30">
      <div className="flex flex-col">
        <span className="text-xs text-muted-foreground">
          {format(dt, 'MMM d')}
        </span>
        <span className="text-[10px] text-muted-foreground/70">
          {format(dt, 'HH:mm:ss')}
        </span>
      </div>
      <code className="font-mono text-xs font-medium truncate" title={entry.attribute}>
        {entry.attribute}
      </code>
      <div className="flex items-center gap-2 text-xs font-mono min-w-0">
        {entry.isInitial ? (
          <span className="italic text-muted-foreground/70">(initial)</span>
        ) : (
          <span className="text-muted-foreground line-through truncate" title={String(entry.oldValue ?? '')}>
            {entry.oldValue === null || entry.oldValue === undefined ? '—' : String(entry.oldValue)}
          </span>
        )}
        <span className="text-violet-500">→</span>
        <span className="text-violet-700 dark:text-violet-300 font-semibold truncate" title={String(entry.newValue ?? '')}>
          {entry.newValue === null || entry.newValue === undefined ? '—' : String(entry.newValue)}
        </span>
      </div>
    </div>
  )
}
