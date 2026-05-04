// nodes/StartNode.tsx
//
// Entry-point node — always the leftmost node in a query chain. Carries the
// APIC connection selection and query scope. Every canvas has exactly one.

import { memo, useState, useEffect, useMemo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { cn } from '@/lib/utils'
import type { StartNodeData } from '@/types'

type StartNodeType = Node<StartNodeData, 'startNode'>
import { NodeType } from '@/types'
import { NodeIcon } from '@/components/NodeIcon'
import { QueryImpactArea } from '@/components/QueryImpactArea'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import { useQuery } from '@tanstack/react-query'
import { apicService } from '@/services/apic'
import { APICConnectionSelector } from '@/components/APICConnectionSelector'
import {
  Server,
  ChevronRight,
  AlertTriangle,
} from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useShallow } from 'zustand/react/shallow'

// How long ago, human-friendly
function timeAgo(dateStr?: string): string {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function StartNode({ data, selected }: NodeProps<StartNodeType>) {
  const [showSelector, setShowSelector] = useState(false)
  const nodeColor = data.color || 'var(--primary)'

  const { selectedConnectionIds, setSelectedConnectionId } =
    useQueryBuilderStore(
      useShallow((s) => ({
        selectedConnectionIds: s.selectedConnectionIds,
        setSelectedConnectionId: s.setSelectedConnectionId,
      }))
    )

  const { data: connections = [] } = useQuery({
    queryKey: ['apic-connections'],
    queryFn: () => apicService.getConnections(),
    staleTime: 30000,
  })

  // Auto-select if only one APIC connection exists
  useEffect(() => {
    if (connections.length === 1 && selectedConnectionIds.length === 0) {
      setSelectedConnectionId(connections[0].id)
    }
  }, [connections, selectedConnectionIds, setSelectedConnectionId])

  const selectedConnections = useMemo(
    () => connections.filter(c => selectedConnectionIds.includes(c.id)),
    [connections, selectedConnectionIds]
  )

  const hasSelection = selectedConnectionIds.length > 0

  // Status indicator based on the single selected connection
  const selectedConn = selectedConnections[0]
  const statusDotColor = !hasSelection
    ? 'bg-zinc-400'
    : selectedConn?.last_test_status === true
    ? 'bg-emerald-500'
    : selectedConn?.last_test_status === false
    ? 'bg-red-500'
    : 'bg-zinc-400'

  return (
    <>
      <div
        className={cn(
          'w-[260px] rounded-xl bg-background border-2 transition-all relative group flex flex-col',
          'shadow-md hover:shadow-xl duration-200',
          selected && 'shadow-2xl ring-2 ring-offset-2 ring-offset-background'
        )}
        style={{
          borderColor: nodeColor,
          boxShadow: selected ? `0 0 0 3px color-mix(in oklch, ${nodeColor} 15%, transparent)` : undefined,
        }}
      >
        {/* Status dot */}
        <div className={cn(
          'absolute -top-1 -right-1 w-3 h-3 rounded-full shadow-lg border-2 border-background transition-colors',
          statusDotColor
        )} />

        <div className="p-3.5 space-y-2.5">
          {/* Header */}
          <div className="flex items-center gap-2.5">
            <div
              className="flex-shrink-0 p-2 rounded-lg"
              style={{
                color: nodeColor,
                backgroundColor: `color-mix(in oklch, ${nodeColor} 10%, transparent)`
              }}
            >
              <NodeIcon nodeType={NodeType.START} className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm text-foreground">Start</div>
              <div className="text-[11px] text-muted-foreground">APIC Connection</div>
            </div>
          </div>

          {/* Separator */}
          <div className="border-t border-border/50" />

          {/* Connection display */}
          {hasSelection && selectedConn ? (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/40 hover:bg-muted/60 transition-colors">
                    <div className={cn(
                      'w-2 h-2 rounded-full flex-shrink-0',
                      selectedConn.last_test_status === true && 'bg-emerald-500',
                      selectedConn.last_test_status === false && 'bg-red-500',
                      selectedConn.last_test_status == null && 'bg-zinc-400',
                    )} />
                    <span className="text-xs font-medium truncate flex-1">{selectedConn.name}</span>
                    {selectedConn.last_tested_at && (
                      <span className="text-[10px] text-muted-foreground flex-shrink-0">
                        {timeAgo(selectedConn.last_tested_at)}
                      </span>
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="space-y-1 text-xs max-w-xs">
                  <div className="font-medium">{selectedConn.name}</div>
                  <div className="text-muted-foreground">{selectedConn.url}</div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">User: {selectedConn.username}</span>
                    <span className="text-muted-foreground">·</span>
                    {selectedConn.last_test_status === true && <span className="text-emerald-400">Healthy</span>}
                    {selectedConn.last_test_status === false && (
                      <span className="text-red-400">{selectedConn.last_test_message || 'Error'}</span>
                    )}
                    {selectedConn.last_test_status == null && <span className="text-zinc-400">Not tested</span>}
                  </div>
                  {selectedConn.verify_ssl === false && (
                    <div className="text-amber-400 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      SSL verification disabled
                    </div>
                  )}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <div className="flex items-center gap-2 px-2 py-2 rounded-md bg-amber-500/5 border border-amber-500/20 text-xs text-amber-500">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>No APIC connection selected</span>
            </div>
          )}

          {/* Action button */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowSelector(true)
            }}
            className={cn(
              'w-full flex items-center justify-between gap-2 py-1.5 px-2.5 rounded-md text-xs font-medium transition-all duration-150',
              hasSelection
                ? 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                : 'bg-primary/10 text-primary hover:bg-primary/20'
            )}
          >
            <span className="flex items-center gap-1.5">
              <Server className="w-3 h-3" />
              {hasSelection ? 'Change' : 'Select APIC'}
            </span>
            <ChevronRight className="w-3 h-3" />
          </button>
        </div>

        <Handle type="source" position={Position.Right} />
        <QueryImpactArea nodeType={NodeType.START} nodeData={data} />
      </div>

      <APICConnectionSelector
        open={showSelector}
        onOpenChange={setShowSelector}
      />
    </>
  )
}

export default memo(StartNode)
