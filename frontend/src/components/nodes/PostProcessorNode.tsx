// nodes/PostProcessorNode.tsx
//
// Pipeline step node that transforms APIC results after execution — sort,
// filter, flatten, regex, field-extract, etc. Multiple PostProcessorNodes
// can be chained; they run in visual order (top-to-bottom by Y position).

import { memo, useEffect, useState, type CSSProperties } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { cn } from '@/lib/utils'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import type { PostProcessorNodeData } from '@/types'

type PostProcessorNodeType = Node<PostProcessorNodeData, 'postProcessorNode'>
import { NodeType } from '@/types'
import { NodeIcon } from '@/components/NodeIcon'
import { NodeActionBar } from '@/components/NodeActionBar'
import { QueryImpactArea } from '@/components/QueryImpactArea'
import { Cpu, Info, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useShallow } from 'zustand/react/shallow'

function PostProcessorNode({ data, selected, id }: NodeProps<PostProcessorNodeType>) {
  const { isInteractive, requestNodeDeletion, updateNode, setPanelSelectedNode } =
    useQueryBuilderStore(
      useShallow((s) => ({
        isInteractive: s.isInteractive,
        requestNodeDeletion: s.requestNodeDeletion,
        updateNode: s.updateNode,
        setPanelSelectedNode: s.setPanelSelectedNode,
      }))
    )
  const [isHovered, setIsHovered] = useState(false)

  const nodeColor = data.color || 'var(--node-processor)'
  const isPaused = data.isPaused || false

  // Open panel when node is selected
  useEffect(() => {
    if (selected) {
      setPanelSelectedNode(id)
    }
  }, [selected, id, setPanelSelectedNode])

  const getProcessorTooltip = (processorType: string) => {
    const tooltips: Record<string, string> = {
      'extract_dn': 'Extract Distinguished Names from results',
      'flatten': 'Flatten nested JSON structures into flat arrays',
      'filter': 'Filter results based on custom criteria',
      'transform': 'Transform data using custom mapping',
      'aggregate': 'Aggregate and group results',
      'sort': 'Sort results by specified fields',
    }
    return tooltips[processorType] || 'Data transformation and processing'
  }

  const getProcessorDisplay = (processorType: string) => {
    const displays: Record<string, string> = {
      'extract_dn': 'Extract DN',
      'flatten': 'Flatten',
      'filter': 'Filter',
      'transform': 'Transform',
      'aggregate': 'Aggregate',
      'sort': 'Sort',
    }
    return displays[processorType] || processorType || 'none'
  }

  return (
    <>
      <div
        className={cn(
          'w-[200px] min-h-[140px] rounded-xl bg-background border-2 transition-all relative group flex flex-col',
          'shadow-md hover:shadow-xl duration-200',
          isPaused && 'opacity-30 border-dashed',
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

        {/* Status Indicator */}
        {!isPaused && (
          <div
            className="absolute -top-1 -right-1 w-3 h-3 rounded-full shadow-lg"
            style={{ backgroundColor: nodeColor }}
          >
            <div
              className="absolute inset-0 rounded-full animate-ping opacity-75"
              style={{ backgroundColor: nodeColor }}
            />
          </div>
        )}

        {isInteractive && (
          <NodeActionBar
            nodeId={id}
            isPaused={isPaused}
            onTogglePause={() => updateNode(id, { isPaused: !isPaused })}
            onDelete={() => requestNodeDeletion(id)}
            canPause={true}
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
              <NodeIcon nodeType={NodeType.POST_PROCESSOR} className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm truncate text-foreground">
                Processor
              </div>
              <div className="text-xs text-muted-foreground truncate mt-0.5">
                Data transformation
              </div>
            </div>
          </div>

          {/* Separator */}
          <div className="border-t border-border/50" />

          {/* Processor Configuration */}
          <div className="space-y-2">
            <div className="space-y-1.5">
              <TooltipProvider delayDuration={400}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Cpu className="w-3 h-3" />
                        Type
                      </span>
                      <Badge
                        variant="outline"
                        className="text-xs h-5 px-2 font-mono"
                        style={{
                          borderColor: `color-mix(in oklch, ${nodeColor} 30%, transparent)`,
                          backgroundColor: `color-mix(in oklch, ${nodeColor} 5%, transparent)`,
                        }}
                      >
                        {getProcessorDisplay(data.processorType)}
                      </Badge>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="start" className="max-w-lg">
                    <p className="text-xs">{getProcessorTooltip(data.processorType)}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {data.processorType && (
                <div className="flex items-center gap-1.5 p-2 rounded-lg bg-muted/30">
                  <Sparkles className="w-3 h-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    Active transformation
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Hover Info */}
          <div className={cn("space-y-1 text-xs transition-opacity", isHovered ? "opacity-100" : "opacity-0")}>
            <div className="flex items-center gap-1.5 text-muted-foreground/70">
              <Info className="w-3 h-3" />
              <span>Click to configure processor</span>
            </div>
          </div>
        </div>

        <Handle type="source" position={Position.Right} />
        <QueryImpactArea nodeType={NodeType.POST_PROCESSOR} nodeData={data} />
      </div>
    </>
  )
}

export default memo(PostProcessorNode)
