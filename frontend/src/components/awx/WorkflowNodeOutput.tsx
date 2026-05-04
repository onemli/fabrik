// awx/WorkflowNodeOutput.tsx
//
// Collapsible output viewer for AWX workflow jobs. Each workflow node gets its
// own expandable section with a status indicator (success/failed/running/pending)
// and a JobOutputViewer inside. Mimics the AWX UI layout so the user feels at
// home when reviewing multi-node workflow results.

import { useState } from 'react'
import { ChevronRight, ChevronDown, CheckCircle, XCircle, Clock, AlertCircle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { JobOutputViewer } from './JobOutputViewer'
import { Badge } from '@/components/ui/badge'

interface WorkflowNode {
  id: number
  summary_fields?: {
    job?: {
      id: number
      name: string
      status: string
      elapsed?: number
    }
  }
  status?: string
  created?: string
  modified?: string
}

interface WorkflowNodeOutputProps {
  executionId: string
  nodes: WorkflowNode[]
  isRunning: boolean
  className?: string
}

export function WorkflowNodeOutput({ executionId, nodes, isRunning, className = '' }: WorkflowNodeOutputProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<number>>(new Set())

  const toggleNode = (nodeId: number) => {
    setExpandedNodes(prev => {
      const updated = new Set(prev)
      if (updated.has(nodeId)) {
        updated.delete(nodeId)
      } else {
        updated.add(nodeId)
      }
      return updated
    })
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'successful':
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'failed':
      case 'error':
        return <XCircle className="w-4 h-4 text-red-500" />
      case 'running':
        return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
      case 'pending':
      case 'waiting':
        return <Clock className="w-4 h-4 text-yellow-500" />
      case 'canceled':
        return <AlertCircle className="w-4 h-4 text-muted-foreground" />
      default:
        return <Clock className="w-4 h-4 text-muted-foreground" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'successful':
        return 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800'
      case 'failed':
      case 'error':
        return 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800'
      case 'running':
        return 'bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800'
      case 'pending':
      case 'waiting':
        return 'bg-yellow-50 dark:bg-yellow-950 border-yellow-200 dark:border-yellow-800'
      default:
        return 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700'
    }
  }

  const getStatusBadgeVariant = (status: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
    switch (status) {
      case 'successful':
        return 'default'
      case 'failed':
      case 'error':
        return 'destructive'
      case 'running':
        return 'default'
      default:
        return 'secondary'
    }
  }

  const formatElapsed = (seconds?: number) => {
    if (!seconds) return 'N/A'
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}m ${secs}s`
  }

  if (nodes.length === 0) {
    return (
      <div className={`p-8 text-center text-muted-foreground ${className}`}>
        <p className="text-sm">No workflow nodes to display</p>
      </div>
    )
  }

  // Sort nodes by job ID (ascending order: 150, 151, 152...)
  const sortedNodes = [...nodes].sort((a, b) => {
    const jobIdA = a.summary_fields?.job?.id || 0
    const jobIdB = b.summary_fields?.job?.id || 0
    return jobIdA - jobIdB
  })

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="text-xs text-muted-foreground mb-3 px-1">
        Click on a node to expand its output
      </div>

      {sortedNodes.map((node, index) => {
        const jobData = node.summary_fields?.job
        if (!jobData) return null

        const isExpanded = expandedNodes.has(node.id)
        const status = jobData.status || 'unknown'
        const isNodeRunning = status === 'running' || status === 'pending' || status === 'waiting'

        return (
          <div
            key={node.id}
            className={cn(
              'border rounded-lg overflow-hidden transition-all duration-200',
              getStatusColor(status)
            )}
          >
            {/* Node Header - Clickable */}
            <button
              onClick={() => toggleNode(node.id)}
              className={cn(
                'w-full px-4 py-3 flex items-center justify-between',
                'hover:bg-black/5 dark:hover:bg-white/5 transition-colors',
                'text-left'
              )}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {/* Expand/Collapse Icon */}
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                )}

                {/* Node Number */}
                <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex-shrink-0">
                  {index + 1}
                </div>

                {/* Status Icon */}
                <div className="flex-shrink-0">
                  {getStatusIcon(status)}
                </div>

                {/* Node Name */}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate text-foreground">
                    {jobData.name}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    Job #{jobData.id}
                  </div>
                </div>

                {/* Status Badge */}
                <Badge variant={getStatusBadgeVariant(status)} className="flex-shrink-0">
                  {status}
                </Badge>

                {/* Elapsed Time */}
                {jobData.elapsed !== undefined && (
                  <div className="text-xs text-muted-foreground flex-shrink-0 ml-2">
                    {formatElapsed(jobData.elapsed)}
                  </div>
                )}
              </div>
            </button>

            {/* Node Output - Expandable */}
            {isExpanded && (
              <div className="border-t border-border/50">
                <div className="p-4 bg-background/50">
                  <JobOutputViewer
                    executionId={executionId}
                    isRunning={isRunning || isNodeRunning}
                    awxJobId={jobData.id}
                    isWorkflowNode={true}
                    className="min-h-[300px]"
                  />
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* Summary Footer */}
      <div className="mt-4 pt-4 border-t border-border/50 px-1">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Total nodes: {sortedNodes.length}</span>
          <span>
            {sortedNodes.filter(n => n.summary_fields?.job?.status === 'successful').length} successful,{' '}
            {sortedNodes.filter(n => n.summary_fields?.job?.status === 'failed').length} failed,{' '}
            {sortedNodes.filter(n => ['running', 'pending', 'waiting'].includes(n.summary_fields?.job?.status || '')).length} running
          </span>
        </div>
      </div>
    </div>
  )
}
