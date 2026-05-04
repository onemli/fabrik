// nodes/OutputNode.tsx
//
// Terminal node in the query graph — the "end point" that defines how results
// are displayed (table/JSON/chart) and configures Time Machine / pagination.
// Every valid query graph must have exactly one OutputNode.

import { memo, useEffect, useState, type CSSProperties } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { cn } from '@/lib/utils'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import type { OutputNodeData } from '@/types'

type OutputNodeType = Node<OutputNodeData, 'outputNode'>
import { NodeType } from '@/types'
import { NodeIcon } from '@/components/NodeIcon'
import { NodeActionBar } from '@/components/NodeActionBar'
import { QueryImpactArea } from '@/components/QueryImpactArea'
import { CheckCircle2, Info } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useShallow } from 'zustand/react/shallow'

function OutputNode({ data, selected, id }: NodeProps<OutputNodeType>) {
  const { isInteractive, requestNodeDeletion, setPanelSelectedNode } =
    useQueryBuilderStore(
      useShallow((s) => ({
        isInteractive: s.isInteractive,
        requestNodeDeletion: s.requestNodeDeletion,
        setPanelSelectedNode: s.setPanelSelectedNode,
      }))
    )
  const [isHovered, setIsHovered] = useState(false)

  const nodeColor = data.color || 'var(--node-output)'

  // Open panel when node is selected
  useEffect(() => {
    if (selected) {
      setPanelSelectedNode(id)
    }
  }, [selected, id, setPanelSelectedNode])

  return (
    <>
      <div
        className={cn(
          'w-[200px] min-h-[140px] rounded-xl bg-background border-2 transition-all relative group flex flex-col',
          'shadow-md hover:shadow-xl duration-200',
          selected && 'shadow-2xl ring-2 ring-offset-2 ring-offset-background'
        )}
        style={{
          borderColor: nodeColor,
          boxShadow: selected ? `0 0 0 3px color-mix(in oklch, ${nodeColor} 15%, transparent)` : undefined,
          // Tailwind's ring color is driven by the --tw-ring-color custom property.
          ['--tw-ring-color' as const]: selected ? nodeColor : undefined,
        } as CSSProperties}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <Handle type="target" position={Position.Left} />
        <Handle
          type="source"
          position={Position.Right}
          id="pipeline-out"
          className="pipeline-handle"
          style={{ zIndex: 10 }}
        />

        {/* Status Indicator - Always active for Output */}
        <div
          className="absolute -top-1 -right-1 w-3 h-3 rounded-full shadow-lg pointer-events-none z-0"
          style={{ backgroundColor: nodeColor }}
        >
          <div
            className="absolute inset-0 rounded-full animate-ping opacity-75 pointer-events-none"
            style={{ backgroundColor: nodeColor }}
          />
        </div>

        {isInteractive && (
          <NodeActionBar
            nodeId={id}
            onDelete={() => requestNodeDeletion(id)}
          />
        )}

        <div className="p-3.5 space-y-3">
          {/* Header: Icon + Title */}
          <div className="flex items-start gap-2.5">
            <div
              className="flex-shrink-0 p-2 rounded-lg transition-transform duration-200"
              style={{
                color: nodeColor,
                backgroundColor: `color-mix(in oklch, ${nodeColor} 10%, transparent)`
              }}
            >
              <NodeIcon nodeType={NodeType.OUTPUT} className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm truncate text-foreground">
                Output
              </div>
              <div className="text-xs text-muted-foreground truncate mt-0.5">
                Final query results
              </div>
            </div>
          </div>

          {/* Separator */}
          <div className="border-t border-border/50" />

          {/* Info Section */}
          <div className="space-y-2">
            <div className="space-y-1.5">
              <TooltipProvider delayDuration={400}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-3 h-3 text-green-500" />
                      <span className="text-xs text-muted-foreground">
                        Query execution endpoint
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="start" className="max-w-lg">
                    <p className="text-xs">
                      This node represents the final output of your query chain. Results will be displayed in the results panel.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {data.enableTimeMachine && (
                <TooltipProvider delayDuration={400}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className="text-xs h-5 px-2"
                          style={{
                            borderColor: `color-mix(in oklch, ${nodeColor} 30%, transparent)`,
                            backgroundColor: `color-mix(in oklch, ${nodeColor} 5%, transparent)`,
                          }}
                        >
                          Time Machine
                        </Badge>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" align="start" className="max-w-lg">
                      <p className="text-xs">
                        Historical snapshots enabled - Track configuration changes over time
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          </div>

          {/* Hover Info */}
          <div className={cn("space-y-1 text-xs transition-opacity", isHovered ? "opacity-100" : "opacity-0")}>
            <div className="flex items-center gap-1.5 text-muted-foreground/70">
              <Info className="w-3 h-3" />
              <span>Execute query to see results</span>
            </div>
          </div>
        </div>

        <QueryImpactArea nodeType={NodeType.OUTPUT} nodeData={data} />
      </div>
    </>
  )
}

export default memo(OutputNode)
