// ExecutionHistoryDialog.tsx
//
// Modal showing the execution history for a saved query — timestamps, result
// counts, execution times, and whether each run succeeded or failed.

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CheckCircle2, XCircle, Clock, PlayCircle, Eye } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/services/api'
import { ExecutionResultViewer } from './ExecutionResultViewer'
import { useFormatters } from '@/contexts/TimezoneContext'

interface ExecutionHistoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  task: {
    id: string
    name: string
  }
}

interface Execution {
  id: string
  apic_connection_name: string
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled'
  result?: any
  result_count?: number
  error_message?: string
  retry_attempt: number
  is_retry: boolean
  created_at: string
  completed_at?: string
  duration_seconds?: number
  execution_time_ms?: number
}

const statusConfig = {
  pending: { label: 'Pending', color: 'bg-muted/50 text-muted-foreground border-border', icon: Clock },
  running: { label: 'Running', color: 'bg-blue-500/20 text-blue-400 border-blue-500/40', icon: PlayCircle },
  success: { label: 'Success', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40', icon: CheckCircle2 },
  failed: { label: 'Failed', color: 'bg-red-500/20 text-red-400 border-red-500/40', icon: XCircle },
  cancelled: { label: 'Cancelled', color: 'bg-amber-500/20 text-amber-400 border-amber-500/40', icon: XCircle },
}

export function ExecutionHistoryDialog({ open, onOpenChange, task }: ExecutionHistoryDialogProps) {
  const { formatDateTime } = useFormatters()
  const [viewingExecution, setViewingExecution] = useState<Execution | null>(null)

  const { data: executionsData, isLoading } = useQuery({
    queryKey: ['scheduled-executions', task.id],
    queryFn: async () => {
      const response = await api.get(`/api/queries/scheduled-tasks/${task.id}/executions/`)
      return response.data
    },
    enabled: open,
  })

  // Backend may return either a raw array or a paginated `{ results: [...] }`
  // envelope, depending on the endpoint — normalize to a typed array here.
  const executions = useMemo<Execution[]>(() => {
    if (
      executionsData &&
      typeof executionsData === 'object' &&
      'results' in executionsData &&
      Array.isArray((executionsData as { results: unknown }).results)
    ) {
      return (executionsData as { results: Execution[] }).results
    }
    if (Array.isArray(executionsData)) {
      return executionsData as Execution[]
    }
    return []
  }, [executionsData])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Execution History: {task.name}</DialogTitle>
          <DialogDescription>
            View all execution logs for this scheduled task
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
          {/* Executions Table */}
          <div className="border rounded-lg flex-1 overflow-auto min-h-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <p className="text-muted-foreground">Loading executions...</p>
              </div>
            ) : executions.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <p className="text-muted-foreground">No execution history</p>
              </div>
            ) : (
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Connection</TableHead>
                    <TableHead>Execution Time</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Results</TableHead>
                    <TableHead>Retry</TableHead>
                    <TableHead>Error</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {executions.map((execution) => {
                    const statusConf = statusConfig[execution.status]
                    const StatusIcon = statusConf.icon

                    return (
                      <TableRow key={execution.id}>
                        <TableCell>
                          <Badge variant="outline" className={cn('gap-1 border', statusConf.color)}>
                            <StatusIcon className="w-3 h-3" />
                            {statusConf.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">{execution.apic_connection_name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDateTime(execution.created_at)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {execution.duration_seconds ? `${execution.duration_seconds.toFixed(2)}s` : '-'}
                        </TableCell>
                        <TableCell className="text-sm">
                          {execution.result_count !== undefined ? `${execution.result_count} items` : '-'}
                        </TableCell>
                        <TableCell>
                          {execution.is_retry && (
                            <Badge variant="outline" className="text-xs">
                              #{execution.retry_attempt}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-destructive max-w-xs truncate">
                          {execution.error_message || '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setViewingExecution(execution)}
                            className="gap-2"
                          >
                            <Eye className="w-4 h-4" />
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </div>

        {/* Execution Result Viewer */}
        {viewingExecution && (
          <ExecutionResultViewer
            open={!!viewingExecution}
            onOpenChange={(open) => !open && setViewingExecution(null)}
            execution={viewingExecution}
            task={task}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
