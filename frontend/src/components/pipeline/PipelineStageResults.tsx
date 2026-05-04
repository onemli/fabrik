// PipelineStageResults.tsx
//
// Renders a vertical list of expandable stage cards after a pipeline execution
// completes. Each card shows the class name, status, result count, execution
// time, and query URL. Expanding a card reveals a JSON preview of that stage's
// result. Failed stages surface the error message prominently.

import { useState } from 'react'
import {
  Check, X, Clock, Database, ChevronDown, ChevronRight,
  ExternalLink, AlertTriangle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { MonacoJsonViewer } from '@/components/MonacoJsonViewer'
import type { PipelineStageResult } from '@/types/query'
import { cn } from '@/lib/utils'

interface PipelineStageResultsProps {
  stages: PipelineStageResult[]
  totalExecutionMs?: number
  pipelineError?: string
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function getResultCount(result: unknown): number {
  if (!result || typeof result !== 'object') return 0
  if (Array.isArray(result)) return result.length
  if ('imdata' in result && Array.isArray((result as any).imdata)) {
    return (result as any).imdata.length
  }
  if ('totalCount' in result) return Number((result as any).totalCount) || 0
  return 0
}

function StageCard({ stage }: { stage: PipelineStageResult }) {
  const [expanded, setExpanded] = useState(false)
  const isSuccess = stage.status === 'success'
  const resultCount = stage.result_count ?? getResultCount(stage.result)

  return (
    <div className={cn(
      'rounded-lg border transition-colors',
      isSuccess
        ? 'border-border hover:border-emerald-500/30 bg-card'
        : 'border-red-500/30 bg-red-500/5'
    )}>
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-3 text-left"
      >
        {/* Status icon */}
        <div className={cn(
          'w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0',
          isSuccess ? 'bg-emerald-500/15' : 'bg-red-500/15'
        )}>
          {isSuccess
            ? <Check className="w-3.5 h-3.5 text-emerald-500" />
            : <X className="w-3.5 h-3.5 text-red-500" />
          }
        </div>

        {/* Stage number + class name */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium">
              Stage {stage.stage_index + 1}
            </span>
            <span className="text-sm font-semibold text-foreground truncate">
              {stage.class_name}
            </span>
          </div>
          {!isSuccess && stage.error_message && (
            <p className="text-xs text-red-400 mt-0.5 truncate">{stage.error_message}</p>
          )}
        </div>

        {/* Stats */}
        <div className="flex items-center gap-3 flex-shrink-0 text-xs text-muted-foreground">
          {isSuccess && (
            <span className="flex items-center gap-1">
              <Database className="w-3 h-3" />
              <span className="tabular-nums">{resultCount.toLocaleString()}</span>
            </span>
          )}
          {stage.execution_time_ms != null && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span className="tabular-nums">{formatMs(stage.execution_time_ms)}</span>
            </span>
          )}
          {expanded
            ? <ChevronDown className="w-4 h-4" />
            : <ChevronRight className="w-4 h-4" />
          }
        </div>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="border-t border-border">
          {/* Query URL */}
          {stage.query_url && (
            <div className="px-3 py-2 border-b border-border bg-muted/20 flex items-center gap-2 text-xs">
              <ExternalLink className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              <code className="font-mono text-emerald-600 dark:text-emerald-400 truncate">
                {stage.query_url}
              </code>
            </div>
          )}

          {/* Error details for failed stages */}
          {!isSuccess && stage.error_message && (
            <div className="px-3 py-2.5 bg-red-500/5 border-b border-red-500/20">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-red-400 mt-0.5 flex-shrink-0" />
                <div className="text-xs">
                  {stage.error_type && (
                    <Badge variant="outline" className="text-red-400 border-red-500/30 mb-1 text-[10px]">
                      {stage.error_type}
                    </Badge>
                  )}
                  <p className="text-red-300">{stage.error_message}</p>
                </div>
              </div>
            </div>
          )}

          {/* Result preview */}
          {isSuccess && Boolean(stage.result) && (
            <div className="h-64">
              <MonacoJsonViewer data={stage.result} height="100%" className="h-full" />
            </div>
          )}

          {isSuccess && !stage.result && (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              No result data available for this stage
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function PipelineStageResults({ stages, totalExecutionMs, pipelineError }: PipelineStageResultsProps) {
  const successCount = stages.filter((s) => s.status === 'success').length
  const failedCount = stages.filter((s) => s.status === 'failed').length

  return (
    <div className="p-4 space-y-3">
      {/* Summary header */}
      <div className="flex items-center gap-3 mb-1">
        <h3 className="text-sm font-semibold text-foreground">Pipeline Stages</h3>
        <div className="flex items-center gap-2 text-xs">
          <Badge variant="outline" className="text-emerald-500 border-emerald-500/30">
            {successCount} passed
          </Badge>
          {failedCount > 0 && (
            <Badge variant="outline" className="text-red-400 border-red-500/30">
              {failedCount} failed
            </Badge>
          )}
          {totalExecutionMs != null && (
            <span className="text-muted-foreground">{formatMs(totalExecutionMs)} total</span>
          )}
        </div>
      </div>

      {/* Pipeline-level error banner */}
      {pipelineError && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/5 border border-red-500/20 text-sm text-red-400">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{pipelineError}</span>
        </div>
      )}

      {/* Stage cards */}
      <div className="space-y-2">
        {stages.map((stage) => (
          <StageCard key={stage.stage_index} stage={stage} />
        ))}
      </div>
    </div>
  )
}
