// awx/JobOutputViewer.tsx
//
// AWX job output stream, rendered the way AWX's own UI renders it: events are
// grouped rows (play/task headers, module results), the detail dialog surfaces
// `event_data.res` as a JSON tree, and scrolling 10k+ events stays smooth via
// @tanstack/react-virtual. Replaces the previous xterm.js-backed LiveTerminal.
//
// Loads historical events from /api/awx/executions/<id>/output/, then opens a
// WebSocket for the live tail. Reconnection, heartbeat-based stall detection,
// and task stall warnings are preserved from the previous component.

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import axios from 'axios'
import { useVirtualizer } from '@tanstack/react-virtual'
import { toast } from 'sonner'
import {
  Download, Copy, Lock, Unlock, RefreshCw, Loader2, AlertTriangle,
  ArrowDownToLine, List, Terminal as TerminalIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { getWsTicket } from '@/lib/wsTicket'

import type { JobEvent, ViewMode, FilterOutcome } from './job-output/types'
import { FILTERABLE_OUTCOMES, outcomeOf, eventBadgeClass } from './job-output/types'
import { EventRow } from './job-output/EventRow'
import { EventDetailDialog } from './job-output/EventDetailDialog'
import { stripAnsi } from './job-output/ansi'
import './job-output/ansi.css'

// ── Props ──────────────────────────────────────────────────────────────────────

interface JobOutputViewerProps {
  executionId: string
  isRunning: boolean
  className?: string
  awxJobId?: number | null
  isWorkflowNode?: boolean
}

// ── Tuning knobs ───────────────────────────────────────────────────────────────

const MAX_RECONNECT_ATTEMPTS = 5
const RECONNECT_DELAY_MS = 3000
const STALL_THRESHOLD_MS = 30_000
const TASK_STALL_THRESHOLD_S = 30
const MAX_RETAINED_EVENTS = 20_000 // soft cap; keeps the latest N after trim
const TRIM_TO = 15_000

// ── Component ──────────────────────────────────────────────────────────────────

export function JobOutputViewer({
  executionId,
  isRunning,
  className = '',
  awxJobId = null,
  isWorkflowNode = false,
}: JobOutputViewerProps) {
  // Data
  const [events, setEvents] = useState<JobEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)
  const [streamStalled, setStreamStalled] = useState(false)
  const [stalledTask, setStalledTask] = useState<{ name: string; elapsedSeconds: number } | null>(null)

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('grouped')
  const [autoScroll, setAutoScroll] = useState(true)
  const autoScrollRef = useRef(true)
  const [outcomeFilter, setOutcomeFilter] = useState<Set<FilterOutcome>>(
    () => new Set(FILTERABLE_OUTCOMES),
  )
  const [selectedEvent, setSelectedEvent] = useState<JobEvent | null>(null)

  // WebSocket refs
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const lastCounterRef = useRef(0)
  const lastMessageTimeRef = useRef<number>(Date.now())
  const heartbeatCheckRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const currentTaskRef = useRef<{ name: string; startedAt: number } | null>(null)
  const taskStallIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Scroll container for the virtual list
  const scrollRef = useRef<HTMLDivElement>(null)

  // ── Derived events for display ──────────────────────────────────────────────

  const visibleEvents = useMemo(() => {
    if (viewMode === 'raw') {
      // Raw mode: everything with stdout, no outcome filter
      return events.filter(e => e.stdout && e.stdout.length > 0)
    }
    return events.filter(e => {
      const outcome = outcomeOf(e.event_type)
      // Non-outcome events (play/task headers, stats) always show
      if (!outcome) return true
      return outcomeFilter.has(outcome)
    })
  }, [events, viewMode, outcomeFilter])

  // ── Virtualizer ─────────────────────────────────────────────────────────────

  const rowVirtualizer = useVirtualizer({
    count: visibleEvents.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (viewMode === 'raw' ? 20 : 28),
    overscan: 20,
    measureElement: (el) => el.getBoundingClientRect().height,
  })

  // ── Historical fetch ────────────────────────────────────────────────────────

  const loadHistoricalOutput = useCallback(async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('access_token')
      const endpoint = isWorkflowNode && awxJobId
        ? `/api/awx/executions/${executionId}/node-output/${awxJobId}/`
        : `/api/awx/executions/${executionId}/output/`

      const response = await axios.get(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
      })

      let sorted: JobEvent[] = (response.data.chunks || []).sort(
        (a: JobEvent, b: JobEvent) => a.counter - b.counter,
      )

      if (awxJobId !== null) {
        sorted = sorted.filter(c => Number(c.awx_job_id) === Number(awxJobId))
      }

      // Merge with existing state. The live WebSocket often delivers a richer
      // `event_data` (including `res` with ACI module results) than what the
      // backend poller persisted — AWX occasionally writes `event_data.res`
      // later than the event row itself. Replacing state wholesale on reload
      // would strip that richer payload after the job completes.
      setEvents(prev => {
        if (prev.length === 0) return sorted
        const merged = new Map<number, JobEvent>()
        for (const e of prev) merged.set(e.counter, e)
        for (const dbEvt of sorted) {
          const existing = merged.get(dbEvt.counter)
          if (!existing) {
            merged.set(dbEvt.counter, dbEvt)
            continue
          }
          const existingHasRes = !!existing.event_data?.res
          const dbHasRes = !!dbEvt.event_data?.res
          merged.set(dbEvt.counter, existingHasRes && !dbHasRes ? existing : dbEvt)
        }
        return Array.from(merged.values()).sort((a, b) => a.counter - b.counter)
      })
      if (sorted.length > 0) {
        lastCounterRef.current = Math.max(
          lastCounterRef.current,
          sorted[sorted.length - 1].counter,
        )
      }
    } catch {
      toast.error('Failed to load job output')
    } finally {
      setLoading(false)
    }
  }, [executionId, isWorkflowNode, awxJobId])

  // ── WebSocket ───────────────────────────────────────────────────────────────

  const getWebSocketUrl = useCallback(async () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = import.meta.env.DEV
      ? window.location.host
      : import.meta.env.VITE_API_URL?.replace(/^https?:\/\//, '') || window.location.host

    let ticket = ''
    try { ticket = await getWsTicket() } catch { /* fallback: no auth param */ }
    const authParam = ticket ? `?ticket=${ticket}` : ''
    return `${protocol}//${host}/ws/awx/execution/${executionId}/${authParam}`
  }, [executionId])

  const connectWebSocket = useCallback(() => {
    getWebSocketUrl().then((url) => {
      wsRef.current = new WebSocket(url)

      wsRef.current.onopen = () => {
        setConnected(true)
        setStreamStalled(false)
        reconnectAttemptsRef.current = 0
        lastMessageTimeRef.current = Date.now()
      }

      wsRef.current.onmessage = (event) => {
        lastMessageTimeRef.current = Date.now()
        setStreamStalled(false)

        try {
          const message = JSON.parse(event.data)
          if (message.type !== 'execution_output') return

          const chunk = message.data as JobEvent & { type?: string }
          if (chunk.type === 'heartbeat') return

          // Filter by awxJobId for workflow nodes
          if (awxJobId !== null && Number(chunk.awx_job_id) !== Number(awxJobId)) return

          // Dedupe by counter
          if (chunk.counter != null && chunk.counter <= lastCounterRef.current) return

          // Task stall tracking
          if (chunk.event_type === 'playbook_on_task_start') {
            const taskName = chunk.task
              || (chunk.stdout || '').match(/TASK \[(.+?)\]/)?.[1]
              || 'Unknown task'
            currentTaskRef.current = { name: taskName, startedAt: Date.now() }
            setStalledTask(null)
          } else if (/^runner_on_(ok|changed|failed|skipped|unreachable)$/.test(chunk.event_type)) {
            currentTaskRef.current = null
            setStalledTask(null)
          }

          setEvents(prev => {
            const next = [...prev, chunk]
            // Soft retention cap — avoid unbounded memory on very long runs
            if (next.length > MAX_RETAINED_EVENTS) {
              return next.slice(next.length - TRIM_TO)
            }
            return next
          })
          if (chunk.counter != null) lastCounterRef.current = chunk.counter
        } catch {
          /* ignore parse errors */
        }
      }

      wsRef.current.onerror = () => setConnected(false)

      wsRef.current.onclose = () => {
        setConnected(false)
        if (isRunning && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptsRef.current++
          reconnectTimeoutRef.current = setTimeout(connectWebSocket, RECONNECT_DELAY_MS)
        } else if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
          toast.error('Lost connection to live output stream')
        }
      }
    }).catch(() => setConnected(false))
  }, [getWebSocketUrl, isRunning, awxJobId])

  const disconnectWebSocket = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    if (heartbeatCheckRef.current) {
      clearInterval(heartbeatCheckRef.current)
      heartbeatCheckRef.current = null
    }
    if (taskStallIntervalRef.current) {
      clearInterval(taskStallIntervalRef.current)
      taskStallIntervalRef.current = null
    }
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    currentTaskRef.current = null
    setStalledTask(null)
    setConnected(false)
  }, [])

  const handleReconnect = useCallback(() => {
    disconnectWebSocket()
    reconnectAttemptsRef.current = 0
    setStreamStalled(false)
    connectWebSocket()
    toast.info('Reconnecting to output stream...')
  }, [connectWebSocket, disconnectWebSocket])

  // ── Heartbeat stall detection ───────────────────────────────────────────────

  useEffect(() => {
    if (!isRunning || !connected) {
      if (heartbeatCheckRef.current) {
        clearInterval(heartbeatCheckRef.current)
        heartbeatCheckRef.current = null
      }
      return
    }

    heartbeatCheckRef.current = setInterval(() => {
      const elapsed = Date.now() - lastMessageTimeRef.current
      if (elapsed > STALL_THRESHOLD_MS) {
        setStreamStalled(true)
        handleReconnect()
      }
    }, 10_000)

    return () => {
      if (heartbeatCheckRef.current) {
        clearInterval(heartbeatCheckRef.current)
        heartbeatCheckRef.current = null
      }
    }
  }, [isRunning, connected, handleReconnect])

  // ── Task stall warning ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!isRunning || !connected) {
      if (taskStallIntervalRef.current) {
        clearInterval(taskStallIntervalRef.current)
        taskStallIntervalRef.current = null
      }
      currentTaskRef.current = null
      setStalledTask(null)
      return
    }

    taskStallIntervalRef.current = setInterval(() => {
      if (currentTaskRef.current) {
        const elapsed = Math.floor((Date.now() - currentTaskRef.current.startedAt) / 1000)
        if (elapsed >= TASK_STALL_THRESHOLD_S) {
          setStalledTask({ name: currentTaskRef.current.name, elapsedSeconds: elapsed })
        } else {
          setStalledTask(null)
        }
      } else {
        setStalledTask(null)
      }
    }, 5_000)

    return () => {
      if (taskStallIntervalRef.current) {
        clearInterval(taskStallIntervalRef.current)
        taskStallIntervalRef.current = null
      }
    }
  }, [isRunning, connected])

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  // Reload when execution/job changes
  useEffect(() => {
    setEvents([])
    lastCounterRef.current = 0
    loadHistoricalOutput()
  }, [executionId, awxJobId, loadHistoricalOutput])

  // Connect WS after historical load when running
  useEffect(() => {
    if (!loading && isRunning) connectWebSocket()
    return () => disconnectWebSocket()
  }, [loading, isRunning, connectWebSocket, disconnectWebSocket])

  // On job finish: final reload to capture any trailing events
  const prevIsRunningRef = useRef(isRunning)
  useEffect(() => {
    if (prevIsRunningRef.current === true && isRunning === false) {
      setTimeout(() => loadHistoricalOutput(), 2000)
    }
    prevIsRunningRef.current = isRunning
  }, [isRunning, loadHistoricalOutput])

  useEffect(() => () => disconnectWebSocket(), [disconnectWebSocket])

  // ── Auto-scroll to bottom on new events ─────────────────────────────────────

  useEffect(() => {
    if (!autoScrollRef.current) return
    const last = visibleEvents.length - 1
    if (last >= 0) {
      rowVirtualizer.scrollToIndex(last, { align: 'end' })
    }
  }, [visibleEvents.length, rowVirtualizer])

  // ── Actions ─────────────────────────────────────────────────────────────────

  const handleDownload = useCallback(() => {
    const text = events.map(e => stripAnsi(e.stdout || '')).join('')
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `execution_${executionId}_output.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success('Output downloaded')
  }, [events, executionId])

  const handleCopy = useCallback(async () => {
    const text = events.map(e => stripAnsi(e.stdout || '')).join('')
    await navigator.clipboard.writeText(text)
    toast.success('Output copied to clipboard')
  }, [events])

  const handleToggleAutoScroll = useCallback(() => {
    setAutoScroll(prev => {
      const next = !prev
      autoScrollRef.current = next
      if (next && visibleEvents.length > 0) {
        rowVirtualizer.scrollToIndex(visibleEvents.length - 1, { align: 'end' })
      }
      return next
    })
  }, [visibleEvents.length, rowVirtualizer])

  const handleReload = useCallback(() => {
    setEvents([])
    lastCounterRef.current = 0
    loadHistoricalOutput()
  }, [loadHistoricalOutput])

  const toggleOutcomeFilter = useCallback((outcome: FilterOutcome) => {
    setOutcomeFilter(prev => {
      const next = new Set(prev)
      if (next.has(outcome)) next.delete(outcome)
      else next.add(outcome)
      return next
    })
  }, [])

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className={cn('flex flex-col border rounded-lg bg-card w-full min-w-0 overflow-hidden', className)}>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-muted/60 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xs text-muted-foreground font-mono whitespace-nowrap">
            {events.length} events{visibleEvents.length !== events.length && ` · ${visibleEvents.length} shown`}
          </span>

          {loading && (
            <div className="flex items-center gap-1.5 text-xs text-blue-500">
              <Loader2 className="w-3 h-3 animate-spin" /> Loading...
            </div>
          )}
          {!loading && isRunning && !streamStalled && (
            <div className="flex items-center gap-1.5 text-xs text-green-500">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" /> Live
            </div>
          )}
          {streamStalled && (
            <div className="flex items-center gap-1.5 text-xs text-amber-500">
              <div className="w-2 h-2 bg-amber-400 rounded-full" /> Stream stalled — reconnecting...
            </div>
          )}
          {!loading && !isRunning && (
            <span className="text-xs text-muted-foreground">Completed</span>
          )}
          {connected && !streamStalled && (
            <span className="text-xs text-blue-400/70">● WS</span>
          )}
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          {/* View mode toggle */}
          <div className="flex items-center rounded border overflow-hidden h-7">
            <button
              type="button"
              onClick={() => setViewMode('grouped')}
              className={cn(
                'h-full px-2 text-xs inline-flex items-center gap-1',
                viewMode === 'grouped' ? 'bg-background text-foreground' : 'bg-transparent text-muted-foreground hover:bg-muted',
              )}
              title="Grouped — one row per event"
            >
              <List className="w-3.5 h-3.5" /> Grouped
            </button>
            <button
              type="button"
              onClick={() => setViewMode('raw')}
              className={cn(
                'h-full px-2 text-xs inline-flex items-center gap-1 border-l',
                viewMode === 'raw' ? 'bg-background text-foreground' : 'bg-transparent text-muted-foreground hover:bg-muted',
              )}
              title="Raw — ANSI-rendered stdout"
            >
              <TerminalIcon className="w-3.5 h-3.5" /> Raw
            </button>
          </div>

          {/* Outcome filter chips (Grouped only) */}
          {viewMode === 'grouped' && FILTERABLE_OUTCOMES.map(outcome => (
            <button
              key={outcome}
              type="button"
              onClick={() => toggleOutcomeFilter(outcome)}
              title={`Toggle ${outcome}`}
            >
              <Badge
                variant="outline"
                className={cn(
                  'text-[10px] px-1.5 py-0.5 cursor-pointer border-0',
                  outcomeFilter.has(outcome) ? eventBadgeClass(`runner_on_${outcome}`) : 'bg-muted text-muted-foreground line-through opacity-60',
                )}
              >
                {outcome}
              </Badge>
            </button>
          ))}

          <Button size="sm" variant="ghost" onClick={handleReload} disabled={loading} title="Reload output" className="h-7 px-2">
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          </Button>

          {isRunning && (!connected || streamStalled) && !loading && (
            <Button size="sm" variant="ghost" onClick={handleReconnect} title="Reconnect" className="h-7 px-2">
              <ArrowDownToLine className="w-3.5 h-3.5" />
            </Button>
          )}

          <Button size="sm" variant="ghost" onClick={handleToggleAutoScroll} title={autoScroll ? 'Disable auto-scroll' : 'Enable auto-scroll'} className="h-7 px-2">
            {autoScroll ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
          </Button>

          <Button size="sm" variant="ghost" onClick={handleCopy} title="Copy to clipboard" className="h-7 px-2" disabled={events.length === 0}>
            <Copy className="w-3.5 h-3.5" />
          </Button>

          <Button size="sm" variant="ghost" onClick={handleDownload} title="Download" className="h-7 px-2" disabled={events.length === 0}>
            <Download className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Task stall warning */}
      {stalledTask && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border-b border-amber-500/20 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>
            Task <span className="font-mono font-semibold">[{stalledTask.name}]</span> has been running for{' '}
            <span className="font-semibold">{stalledTask.elapsedSeconds}s</span> — waiting for AWX response.
          </span>
        </div>
      )}

      {/* Virtualized event list */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-auto"
        style={{ minHeight: '360px' }}
      >
        {visibleEvents.length === 0 ? (
          <div className="flex items-center justify-center h-full py-10 text-xs text-muted-foreground">
            {loading ? 'Loading output...' : 'No events yet'}
          </div>
        ) : (
          <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
            {rowVirtualizer.getVirtualItems().map(virtualItem => {
              const event = visibleEvents[virtualItem.index]
              return (
                <div
                  key={event.counter}
                  data-index={virtualItem.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <EventRow
                    event={event}
                    mode={viewMode}
                    onClick={() => setSelectedEvent(event)}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>

      <EventDetailDialog event={selectedEvent} onClose={() => setSelectedEvent(null)} />
    </div>
  )
}
