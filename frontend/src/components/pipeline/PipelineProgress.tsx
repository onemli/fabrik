// PipelineProgress.tsx
//
// Live progress indicator shown while a pipeline execution is running.
// Renders a horizontal stepper with per-stage status, a progress bar,
// and elapsed time. Designed to replace the empty state in ExecutionResults
// so the user can watch stages complete in real time.

import { Check, Loader2, Circle, X } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import type { PipelineExecution } from '@/types/query'
import { cn } from '@/lib/utils'

interface PipelineProgressProps {
  progress: PipelineExecution
  onCancel?: () => void
}

const INJECT_MODE_LABELS: Record<string, string> = {
  filter_values: 'Filter',
  dn_scope: 'DN Scope',
  iterate: 'Iterate',
}

function StageIcon({ status, isCurrent }: { status: 'done' | 'running' | 'failed' | 'pending'; isCurrent: boolean }) {
  if (status === 'done') {
    return (
      <div className="w-7 h-7 rounded-full bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center">
        <Check className="w-3.5 h-3.5 text-emerald-500" />
      </div>
    )
  }
  if (status === 'running' || isCurrent) {
    return (
      <div className="w-7 h-7 rounded-full bg-amber-500/15 border border-amber-500/40 flex items-center justify-center">
        <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin" />
      </div>
    )
  }
  if (status === 'failed') {
    return (
      <div className="w-7 h-7 rounded-full bg-red-500/15 border border-red-500/40 flex items-center justify-center">
        <X className="w-3.5 h-3.5 text-red-500" />
      </div>
    )
  }
  return (
    <div className="w-7 h-7 rounded-full bg-muted border border-border flex items-center justify-center">
      <Circle className="w-3 h-3 text-muted-foreground/40" />
    </div>
  )
}

function useElapsedTime(startedAt?: string) {
  const [elapsed, setElapsed] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  useEffect(() => {
    if (!startedAt) return

    const start = new Date(startedAt).getTime()

    const tick = () => {
      setElapsed(Math.floor((Date.now() - start) / 1000))
    }
    tick()
    intervalRef.current = setInterval(tick, 1000)

    return () => clearInterval(intervalRef.current)
  }, [startedAt])

  return elapsed
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}m ${secs}s`
}

export function PipelineProgress({ progress, onCancel }: PipelineProgressProps) {
  const elapsed = useElapsedTime(progress.started_at)
  const stages = progress.pipeline_stages || []
  const percentage = progress.progress_percentage ?? 0

  const getStageStatus = (index: number): 'done' | 'running' | 'failed' | 'pending' => {
    if (index < progress.completed_stages) return 'done'
    if (progress.status === 'failed' && index === progress.current_stage_index) return 'failed'
    if (index === progress.current_stage_index && progress.status === 'running') return 'running'
    return 'pending'
  }

  return (
    <div className="flex flex-col items-center justify-center flex-1 p-8 max-w-2xl mx-auto w-full">
      {/* Title */}
      <div className="text-center mb-8">
        <h2 className="text-lg font-semibold text-foreground mb-1">Pipeline Running</h2>
        <p className="text-sm text-muted-foreground">
          Stage {Math.min(progress.current_stage_index + 1, progress.total_stages)} of {progress.total_stages}
          {elapsed > 0 && <span className="ml-1.5">· {formatElapsed(elapsed)}</span>}
        </p>
      </div>

      {/* Stage stepper */}
      <div className="w-full mb-8">
        <div className="flex items-start gap-0">
          {stages.map((stage, idx) => {
            const status = getStageStatus(stage.index)
            const isCurrent = stage.index === progress.current_stage_index
            const isLast = idx === stages.length - 1

            return (
              <div key={stage.index} className="flex items-start flex-1 min-w-0">
                <div className="flex flex-col items-center">
                  <StageIcon status={status} isCurrent={isCurrent} />
                  <div className="mt-2 text-center px-1">
                    <p className={cn(
                      'text-xs font-medium truncate max-w-[100px]',
                      isCurrent ? 'text-foreground' : 'text-muted-foreground'
                    )}>
                      {stage.class_name}
                    </p>
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                      {INJECT_MODE_LABELS[stage.inject_mode] || stage.inject_mode}
                    </p>
                  </div>
                </div>

                {/* Connector line between stages */}
                {!isLast && (
                  <div className="flex-1 mt-3.5 mx-1">
                    <div className={cn(
                      'h-px w-full',
                      status === 'done' ? 'bg-emerald-500/40' : 'bg-border'
                    )} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full mb-6">
        <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-amber-500 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${Math.max(percentage, 2)}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground text-center mt-2 tabular-nums">
          {Math.round(percentage)}% complete
        </p>
      </div>

      {/* Cancel */}
      {onCancel && (
        <button
          onClick={onCancel}
          className="text-xs text-muted-foreground hover:text-red-400 transition-colors"
        >
          Cancel execution
        </button>
      )}
    </div>
  )
}
