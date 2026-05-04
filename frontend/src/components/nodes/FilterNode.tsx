// nodes/FilterNode.tsx
//
// Standalone filter node on the canvas. Applies additional APIC query filters
// without being tied to a specific class node — useful for cross-cutting
// restrictions like scope or subscription depth.

import { memo, useEffect, useState, type CSSProperties } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { cn } from '@/lib/utils'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import type { FilterNodeData } from '@/types'

type FilterNodeType = Node<FilterNodeData, 'filterNode'>
import { NodeType } from '@/types'
import { NodeIcon } from '@/components/NodeIcon'
import { NodeActionBar } from '@/components/NodeActionBar'
import { QueryImpactArea } from '@/components/QueryImpactArea'
import { Filter, Tag, Code, Info, Zap } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useShallow } from 'zustand/react/shallow'

function FilterNode({ data, selected, id }: NodeProps<FilterNodeType>) {
  const { isInteractive, requestNodeDeletion, setPanelSelectedNode } =
    useQueryBuilderStore(
      useShallow((s) => ({
        isInteractive: s.isInteractive,
        requestNodeDeletion: s.requestNodeDeletion,
        setPanelSelectedNode: s.setPanelSelectedNode,
      }))
    )
  const [isHovered, setIsHovered] = useState(false)

  const nodeColor = data.color || 'var(--node-filter)'

  // Open panel when node is selected
  useEffect(() => {
    if (selected) {
      setPanelSelectedNode(id)
    }
  }, [selected, id, setPanelSelectedNode])

  const getFilterTypeTooltip = (filterType: string) => {
    switch (filterType) {
      case 'property':
        return 'Filter results based on object properties (e.g., name, status)'
      case 'query-target-filter':
        return 'Use wildcard patterns to filter Distinguished Names'
      case 'subscription':
        return 'Subscribe to changes and audit logs'
      default:
        return 'Filter configuration'
    }
  }

  const getOperatorTooltip = (operator: string) => {
    const operators: Record<string, string> = {
      eq: 'Equals - Exact match',
      ne: 'Not equals - Exclude matches',
      lt: 'Less than - Numeric comparison',
      gt: 'Greater than - Numeric comparison',
      ge: 'Greater or equal',
      le: 'Less or equal',
      wcard: 'Wildcard - Regex match',
    }
    return operators[operator] || 'Comparison operator'
  }

  const getFilterTypeIcon = (filterType: string) => {
    switch (filterType) {
      case 'property':
        return Tag
      case 'query-target-filter':
        return Code
      case 'subscription':
        return Zap
      default:
        return Filter
    }
  }

  const FilterTypeIcon = getFilterTypeIcon(data.filterType || 'property')

  return (
    <>
      <div
        className={cn(
          'w-[240px] min-h-[140px] rounded-xl bg-background border-2 transition-all relative group flex flex-col',
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

        {/* Status Indicator */}
        <div
          className="absolute -top-1 -right-1 w-3 h-3 rounded-full shadow-lg"
          style={{ backgroundColor: nodeColor }}
        >
          <div
            className="absolute inset-0 rounded-full animate-ping opacity-75"
            style={{ backgroundColor: nodeColor }}
          />
        </div>

        {isInteractive && (
          <NodeActionBar
            nodeId={id}
            onDelete={() => requestNodeDeletion(id)}
            canPause={false}
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
              <NodeIcon nodeType={NodeType.FILTER} className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm truncate text-foreground">
                Filter
              </div>
              <div className="text-xs text-muted-foreground truncate mt-0.5">
                Query refinement
              </div>
            </div>
          </div>

          {/* Separator */}
          <div className="border-t border-border/50" />

          {/* Filter Configuration */}
          <div className="space-y-2">
            <div className="space-y-1.5">
              {/* Filter Type */}
              <TooltipProvider delayDuration={400}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <FilterTypeIcon className="w-3 h-3" />
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
                        {data.filterType || 'property'}
                      </Badge>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="start" className="max-w-lg">
                    <p className="text-xs">{getFilterTypeTooltip(data.filterType || 'property')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {/* Filter Details */}
              {data.filterType === 'property' && data.property && (
                <TooltipProvider delayDuration={400}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex flex-col gap-1 p-2 rounded-lg bg-muted/30">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-muted-foreground">Property</span>
                          <code className="text-xs font-mono text-foreground">{data.property}</code>
                        </div>
                        {data.operator && (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs text-muted-foreground">Operator</span>
                            <Badge variant="secondary" className="text-xs h-4 px-1.5">
                              {data.operator}
                            </Badge>
                          </div>
                        )}
                        {data.value && (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs text-muted-foreground">Value</span>
                            <code className="text-xs font-mono text-foreground truncate">
                              {data.value}
                            </code>
                          </div>
                        )}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" align="start" className="max-w-lg">
                      <p className="text-xs">{getOperatorTooltip(data.operator || 'eq')}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}

              {data.filterType === 'query-target-filter' && (
                <div className="p-2 rounded-lg bg-muted/30">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">Patterns</span>
                    <Badge variant="secondary" className="text-xs h-4 px-1.5">
                      {data.wildcardPatterns?.length || 0}
                    </Badge>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Hover Info */}
          <div className={cn("space-y-1 text-xs transition-opacity", isHovered ? "opacity-100" : "opacity-0")}>
            <div className="flex items-center gap-1.5 text-muted-foreground/70">
              <Info className="w-3 h-3" />
              <span>Click to configure filter</span>
            </div>
          </div>
        </div>

        <Handle type="source" position={Position.Right} />
        <QueryImpactArea nodeType={NodeType.FILTER} nodeData={data} />
      </div>
    </>
  )
}

export default memo(FilterNode)
