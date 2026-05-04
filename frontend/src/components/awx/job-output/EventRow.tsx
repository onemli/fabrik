// awx/job-output/EventRow.tsx
//
// A single row in the virtualized event list. Two modes:
//   - grouped: one-line summary with badge, task, host, duration
//   - raw:     ANSI-rendered stdout block, preserving Ansible's formatting

import { memo, useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { ChevronRight } from 'lucide-react'
import type { JobEvent, ViewMode } from './types'
import { eventBadgeClass, shortEventLabel } from './types'
import { ansiToHtml, stripAnsi } from './ansi'

interface EventRowProps {
  event: JobEvent
  mode: ViewMode
  onClick: () => void
}

export const EventRow = memo(function EventRow({ event, mode, onClick }: EventRowProps) {
  if (mode === 'raw') return <RawRow event={event} onClick={onClick} />
  return <GroupedRow event={event} onClick={onClick} />
})

function GroupedRow({ event, onClick }: { event: JobEvent; onClick: () => void }) {
  const isPlayStart = event.event_type === 'playbook_on_play_start'
  const isTaskStart = event.event_type === 'playbook_on_task_start'
  const isHeader = isPlayStart || isTaskStart

  const duration = event.event_data?.duration
  const task = event.task || (event.event_data?.task as string) || ''
  const host = event.host_name || (event.event_data?.host as string) || ''

  // First line of stdout minus ANSI — a quick summary if task name is missing
  const summaryLine = useMemo(() => {
    if (task) return ''
    const text = stripAnsi(event.stdout || '').split('\n').find(l => l.trim()) || ''
    return text.slice(0, 200)
  }, [event.stdout, task])

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs border-b border-border/30 hover:bg-muted/40 transition-colors',
        isPlayStart && 'bg-violet-500/5 font-semibold',
        isTaskStart && 'bg-blue-500/5 font-medium',
      )}
    >
      <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />

      <span className="font-mono text-[10px] text-muted-foreground w-12 flex-shrink-0 text-right">
        #{event.counter}
      </span>

      <Badge
        variant="outline"
        className={cn(
          'text-[10px] px-1.5 py-0 border-0 flex-shrink-0 min-w-[4rem] justify-center',
          eventBadgeClass(event.event_type),
        )}
      >
        {shortEventLabel(event.event_type)}
      </Badge>

      <span className={cn(
        'flex-1 font-mono truncate',
        isHeader ? 'text-foreground' : 'text-foreground/80',
      )}>
        {task || summaryLine || '—'}
      </span>

      {host && (
        <span className="font-mono text-[10px] text-muted-foreground truncate max-w-[8rem] flex-shrink-0">
          {host}
        </span>
      )}

      {typeof duration === 'number' && duration > 0 && (
        <span className="font-mono text-[10px] text-muted-foreground flex-shrink-0">
          {duration.toFixed(2)}s
        </span>
      )}
    </button>
  )
}

function RawRow({ event, onClick }: { event: JobEvent; onClick: () => void }) {
  const html = useMemo(() => ansiToHtml(event.stdout || ''), [event.stdout])
  const stderrHtml = useMemo(() => ansiToHtml(event.stderr || ''), [event.stderr])

  if (!html && !stderrHtml) return null

  return (
    <div
      onClick={onClick}
      className="px-3 py-0.5 cursor-pointer hover:bg-muted/30 font-mono text-xs leading-snug whitespace-pre-wrap break-all"
    >
      {html && <span dangerouslySetInnerHTML={{ __html: html }} />}
      {stderrHtml && (
        <span className="ansi-red-fg" dangerouslySetInnerHTML={{ __html: stderrHtml }} />
      )}
    </div>
  )
}
