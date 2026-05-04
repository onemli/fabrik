// nodes/ClassNode.tsx
//
// React Flow node representing an ACI class (fvTenant, fvBD, etc.). Renders
// the class name, active filter count badge, and the source/target handles
// used to draw containment edges.

import { memo, useState, useEffect, useRef, type CSSProperties } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { cn } from '@/lib/utils'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import type { ClassNodeData } from '@/types'

type ClassNodeType = Node<ClassNodeData, 'classNode'>
import { NodeType } from '@/types'
import { NodeIcon } from '@/components/NodeIcon'
import { NodeActionBar } from '@/components/NodeActionBar'
import { QueryImpactArea } from '@/components/QueryImpactArea'
import { PlayCircle, Loader2, Layers, Database, Info, X, Filter as FilterIcon, GitBranch } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useShallow } from 'zustand/react/shallow'

function ClassNode({ data, selected, id }: NodeProps<ClassNodeType>) {
  const {
    isInteractive,
    requestNodeDeletion,
    selectedConnectionId,
    setPreviewResult,
    setIsPreviewMode,
    setPreviewNodeId,
    showLogoNotification,
    setPanelSelectedNode
  } = useQueryBuilderStore(
    useShallow((s) => ({
      isInteractive: s.isInteractive,
      requestNodeDeletion: s.requestNodeDeletion,
      selectedConnectionId: s.selectedConnectionId,
      setPreviewResult: s.setPreviewResult,
      setIsPreviewMode: s.setIsPreviewMode,
      setPreviewNodeId: s.setPreviewNodeId,
      showLogoNotification: s.showLogoNotification,
      setPanelSelectedNode: s.setPanelSelectedNode,
    }))
  )

  // Derive parent info with stable primitive selectors
  const nodeExists = useQueryBuilderStore((s) => s.nodes.some(n => n.id === id))
  const parentClassName = useQueryBuilderStore(
    (s) => {
      const parentEdge = s.edges.find(e => e.target === id)
      if (!parentEdge) return null
      const parentNode = s.nodes.find(n => n.id === parentEdge.source)
      if (!parentNode || parentNode.type !== 'classNode') return null
      return (parentNode.data as any)?.className || null
    }
  )
  const isChildClass = !!parentClassName

  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  const nodeColor = data.color || 'var(--node-class)'

  // Auto-open side panel when class node is created without a className
  useEffect(() => {
    if (!data.className && nodeExists) {
      const timer = setTimeout(() => {
        setPanelSelectedNode(id)
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [])

  // Open panel when node is selected
  useEffect(() => {
    if (selected) {
      setPanelSelectedNode(id)
    }
  }, [selected, id, setPanelSelectedNode])

  const handlePreview = async (e: React.MouseEvent) => {
    e.stopPropagation()

    if (!selectedConnectionId) {
      showLogoNotification({
        message: 'Please select an APIC connection first',
        type: 'error',
        duration: 3000
      })
      return
    }

    if (!data.className) {
      showLogoNotification({
        message: 'Please configure class first',
        type: 'error',
        duration: 3000
      })
      return
    }

    // Create abort controller for cancellation
    abortControllerRef.current = new AbortController()
    setIsPreviewing(true)

    try {
      const { queriesService } = await import('@/services/queries')
      const state = useQueryBuilderStore.getState()
      const result = await queriesService.previewQuery(
        { nodes: state.nodes, edges: state.edges },
        id,
        selectedConnectionId,
        abortControllerRef.current.signal
      )

      setPreviewResult(result)
      setIsPreviewMode(true)
      setPreviewNodeId(id)
    } catch (error: any) {
      if (error.name === 'AbortError' || error.message?.includes('cancel')) {
        showLogoNotification({
          message: 'Preview cancelled',
          type: 'info',
          duration: 2000
        })
      } else {
        showLogoNotification({
          message: `Preview failed: ${error.message}`,
          type: 'error',
          duration: 5000
        })
      }
    } finally {
      setIsPreviewing(false)
      abortControllerRef.current = null
    }
  }

  const handleCancelPreview = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }

  const getScopeTooltip = (scope: string) => {
    switch (scope) {
      case 'self':
        return 'Query only this class\'s direct properties'
      case 'children':
        return 'Include immediate child objects'
      default:
        return 'Query scope configuration'
    }
  }

  const getPropertyTooltip = (propInclude: string) => {
    switch (propInclude) {
      case 'all':
        return 'Include all properties of this class'
      case 'naming':
        return 'Include only naming properties (dn, name, etc.)'
      case 'config':
        return 'Include only configuration properties'
      default:
        return 'Selected properties only'
    }
  }

  return (
    <>
      <div
        className={cn(
          'w-[240px] min-h-[160px] rounded-xl bg-background border-2 transition-all relative group flex flex-col',
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

        {/* Action Bar */}
        {isInteractive && (
          <NodeActionBar
            nodeId={id}
            onDelete={() => requestNodeDeletion(id)}
            canPause={false}
          />
        )}

        {/* Node Content */}
        <div className="p-3.5 space-y-3">
          {/* Header: Icon + Class Name */}
          <div className="flex items-start gap-2.5">
            <div
              className="flex-shrink-0 p-2 rounded-lg transition-transform duration-200"
              style={{
                color: nodeColor,
                backgroundColor: `color-mix(in oklch, ${nodeColor} 10%, transparent)`
              }}
            >
              <NodeIcon nodeType={NodeType.CLASS} className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm truncate text-foreground">
                {data.className || 'Class'}
              </div>
              {data.classInfo?.label && (
                <div className="text-xs text-muted-foreground truncate mt-0.5">
                  {data.classInfo.label}
                </div>
              )}
            </div>
          </div>

          {/* Separator */}
          <div className="border-t border-border/50" />

          {/* Configuration Section */}
          <div className="space-y-2">
            <div className="space-y-1.5">
              {/* Scope - Show differently for child classes */}
              {!isChildClass && (
                <TooltipProvider delayDuration={400}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Layers className="w-3 h-3" />
                          Scope
                        </span>
                        <Badge
                          variant="outline"
                          className="text-xs h-5 px-2 font-mono"
                          style={{
                            borderColor: `color-mix(in oklch, ${nodeColor} 30%, transparent)`,
                            backgroundColor: `color-mix(in oklch, ${nodeColor} 5%, transparent)`,
                          }}
                        >
                          {data.scope || 'self'}
                        </Badge>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" align="start" className="max-w-lg">
                      <p className="text-xs">{getScopeTooltip(data.scope || 'self')}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}

              {/* Property Include */}
              <TooltipProvider delayDuration={400}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Database className="w-3 h-3" />
                        Properties
                      </span>
                      <Badge
                        variant="outline"
                        className="text-xs h-5 px-2 font-mono"
                        style={{
                          borderColor: `color-mix(in oklch, ${nodeColor} 30%, transparent)`,
                          backgroundColor: `color-mix(in oklch, ${nodeColor} 5%, transparent)`,
                        }}
                      >
                        {data.propertyInclude || 'all'}
                      </Badge>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="start" className="max-w-lg">
                    <p className="text-xs">{getPropertyTooltip(data.propertyInclude || 'all')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {/* Supplemental Data (Filters) */}
              {data.supplementalData && Object.values(data.supplementalData).some(v => v) && (
                <TooltipProvider delayDuration={400}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <FilterIcon className="w-3 h-3" />
                          Filters
                        </span>
                        <Badge
                          variant="outline"
                          className="text-xs h-5 px-2"
                          style={{
                            borderColor: `color-mix(in oklch, ${nodeColor} 30%, transparent)`,
                            backgroundColor: `color-mix(in oklch, ${nodeColor} 5%, transparent)`,
                          }}
                        >
                          {Object.entries(data.supplementalData).filter(([k, v]) => k && v).map(([k]) => k.charAt(0).toUpperCase()).join(', ')}
                        </Badge>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" align="start" className="max-w-lg">
                      <p className="text-xs">
                        Active filters: {Object.entries(data.supplementalData).filter(([k, v]) => k && v).map(([k]) => k).join(', ')}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}

              {/* Parent Class */}
              {parentClassName && (
                <TooltipProvider delayDuration={400}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <GitBranch className="w-3 h-3" />
                          Parent
                        </span>
                        <Badge
                          variant="outline"
                          className="text-xs h-5 px-2 font-mono"
                          style={{
                            borderColor: `color-mix(in oklch, ${nodeColor} 30%, transparent)`,
                            backgroundColor: `color-mix(in oklch, ${nodeColor} 5%, transparent)`,
                          }}
                        >
                          {parentClassName}
                        </Badge>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" align="start" className="max-w-lg">
                      <p className="text-xs">Parent class in query chain</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          </div>

          {/* Hover Info - Additional Details */}
          <div className={cn("space-y-1 text-xs transition-opacity", isHovered ? "opacity-100" : "opacity-0")}>
            <div className="flex items-center gap-1.5 text-muted-foreground/70">
              <Info className="w-3 h-3" />
              <span>Click to configure</span>
            </div>
          </div>
        </div>

        <Handle type="source" position={Position.Right} />

        {/* Preview Button */}
        <div className="mt-3 pt-3 pb-3 border-t border-border/30">
          {isInteractive && data.className && (
            <>
              {isPreviewing ? (
                <div className="w-full flex items-center justify-between gap-2 py-2.5 px-3 bg-gradient-to-r from-blue-500/10 to-blue-600/10 shadow-sm rounded-lg">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                    <span className="text-xs text-blue-600 font-medium">Loading...</span>
                  </div>
                  <TooltipProvider delayDuration={400}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={handleCancelPreview}
                          className="p-1 rounded hover:bg-red-100 transition-colors"
                        >
                          <X className="w-4 h-4 text-red-500" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p className="text-xs">Cancel preview</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              ) : (
                <TooltipProvider delayDuration={400}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handlePreview}
                        className={cn(
                          "w-full flex items-center justify-center gap-2 py-2.5 px-3 transition-all duration-200 rounded-lg",
                          "opacity-0 group-hover:opacity-100",
                          "hover:bg-gradient-to-r hover:from-blue-500/10 hover:to-blue-600/10 hover:shadow-sm"
                        )}
                      >
                        <PlayCircle className="w-4 h-4 text-blue-600 transition-transform group-hover:scale-105" />
                        <span className="text-xs text-blue-600 font-medium">Preview Query</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" align="start" className="max-w-lg">
                      <p className="text-xs">Preview query results up to this node</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </>
          )}
        </div>

        {/* Query Impact Area */}
        <QueryImpactArea nodeType={NodeType.CLASS} nodeData={data} />
      </div>
    </>
  )
}

export default memo(ClassNode)
