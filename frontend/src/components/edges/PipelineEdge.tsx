// edges/PipelineEdge.tsx
//
// Custom React Flow edge for pipeline connections. Renders as a dashed amber
// line with an arrow marker to visually distinguish pipeline data flow from
// ACI containment edges. Shows the injection mode label on the edge.

import { BaseEdge, type EdgeProps, type Edge, getSmoothStepPath, EdgeLabelRenderer } from '@xyflow/react'
import { X, Zap } from 'lucide-react'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import type { PipelineEdgeData, PipelineInjectMode } from '@/types'

const INJECT_MODE_LABELS: Record<PipelineInjectMode, string> = {
  filter_values: 'Filter',
  dn_scope: 'DN Scope',
  iterate: 'Iterate',
}

export function PipelineEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  selected,
  data,
}: EdgeProps<Edge<PipelineEdgeData>>) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  // Use individual primitive selectors so drag-tick updates to `nodes` don't
  // force every pipeline edge to re-render.
  const requestEdgeDeletion = useQueryBuilderStore((s) => s.requestEdgeDeletion)
  const isInteractive = useQueryBuilderStore((s) => s.isInteractive)
  const isExecuting = useQueryBuilderStore((s) => s.isExecuting)

  const injectMode = data?.injectAs || 'filter_values'
  const modeLabel = INJECT_MODE_LABELS[injectMode]

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    requestEdgeDeletion(id)
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: 'var(--amber-500, #f59e0b)',
          strokeWidth: selected ? 4 : 3,
          strokeDasharray: '8 4',
          strokeLinecap: 'round',
          animation: isExecuting ? 'dashMove 0.6s linear infinite' : 'none',
        }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="nodrag nopan"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Pipeline badge */}
          <div className="flex items-center gap-1">
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 text-[10px] font-medium shadow-sm">
              <Zap className="w-2.5 h-2.5" />
              {modeLabel}
            </div>
            {selected && isInteractive && (
              <button
                onClick={handleDelete}
                onMouseDown={(e) => e.stopPropagation()}
                className="w-5 h-5 bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-full flex items-center justify-center shadow-lg hover:scale-110 transition-all border border-background cursor-pointer"
                title="Delete pipeline connection"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
