// awx/job-output/types.ts
//
// Shared types for the AWX job output viewer. The shape mirrors the payload
// that backend/awx/services/job_events_poller.py forwards over WebSocket and
// that /api/awx/executions/<id>/output/ returns in its `chunks` array.

export interface AnsibleModuleResult {
  changed?: boolean
  failed?: boolean
  msg?: string | string[]
  // ACI-specific keys — surfaced prominently in the detail dialog
  current?: unknown
  mo?: unknown
  previous?: unknown
  proposed?: unknown
  // Failure diagnostics
  module_stdout?: string
  module_stderr?: string
  exception?: string
  // What was invoked
  invocation?: {
    module_args?: Record<string, unknown>
  }
  [key: string]: unknown
}

export interface JobEventData {
  res?: AnsibleModuleResult
  task?: string
  play?: string
  role?: string
  host?: string
  host_name?: string
  task_action?: string
  start?: string
  end?: string
  duration?: number
  changed?: boolean
  [key: string]: unknown
}

export interface JobEvent {
  counter: number
  event_type: string
  stdout: string
  stderr: string
  timestamp?: string
  awx_job_id?: number
  task?: string
  play?: string
  role?: string
  host_name?: string
  event_data?: JobEventData
}

export type ViewMode = 'grouped' | 'raw'

// Events worth surfacing in the filter chips + event list.
// Anything outside this set (verbose, warning, debug) still streams in Raw
// view but is collapsed out of Grouped view to match AWX's default signal/noise.
export const INSPECTABLE_EVENTS = new Set([
  'runner_on_ok',
  'runner_on_changed',
  'runner_on_failed',
  'runner_on_skipped',
  'runner_on_unreachable',
  'playbook_on_task_start',
  'playbook_on_play_start',
  'playbook_on_stats',
])

export const FILTERABLE_OUTCOMES = ['ok', 'changed', 'failed', 'skipped'] as const
export type FilterOutcome = typeof FILTERABLE_OUTCOMES[number]

export function outcomeOf(eventType: string): FilterOutcome | null {
  switch (eventType) {
    case 'runner_on_ok': return 'ok'
    case 'runner_on_changed': return 'changed'
    case 'runner_on_failed':
    case 'runner_on_unreachable':
      return 'failed'
    case 'runner_on_skipped': return 'skipped'
    default: return null
  }
}

export const EVENT_BADGE_COLORS: Record<string, string> = {
  runner_on_ok:          'bg-green-500/10 text-green-600 dark:text-green-400',
  runner_on_changed:     'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  runner_on_failed:      'bg-red-500/10 text-red-600 dark:text-red-400',
  runner_on_skipped:     'bg-gray-500/10 text-gray-500',
  runner_on_unreachable: 'bg-red-700/10 text-red-700 dark:text-red-500',
  playbook_on_task_start: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  playbook_on_play_start: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  playbook_on_stats:      'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
}

export function eventBadgeClass(eventType: string): string {
  return EVENT_BADGE_COLORS[eventType] ?? 'bg-muted/50 text-muted-foreground'
}

export function shortEventLabel(eventType: string): string {
  return eventType.replace('runner_on_', '').replace('playbook_on_', 'pb:')
}
