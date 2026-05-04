// edges/ColoredEdge.tsx
//
// Custom React Flow edge that renders as a smooth step curve with a small
// delete button in the middle. Color is derived from the source node's type
// so the user can visually distinguish different containment paths.

import { BaseEdge, type EdgeProps, getSmoothStepPath, EdgeLabelRenderer } from '@xyflow/react'
import { X } from 'lucide-react'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import { NodeType } from '@/types'

const getNodeColor = (nodeType: string | undefined, nodeData: any): string => {
  if (nodeData?.color) return nodeData.color
  switch (nodeType) {
    case NodeType.CLASS: return 'var(--node-class)'
    case NodeType.FILTER: return 'var(--node-filter)'
    case NodeType.POST_PROCESSOR: return 'var(--node-processor)'
    case NodeType.OUTPUT: return 'var(--node-output)'
    case NodeType.START: return 'var(--primary)'
    default: return 'var(--muted-foreground)'
  }
}

export function ColoredEdge({
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
  source,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  // Subscribe to primitives only — selector returns a string, so React-Flow
  // drag updates (which rewrite the nodes array every frame) no longer force
  // every edge to re-render. The selector only fires a new render if the
  // resolved edge color actually changes.
  const edgeColor = useQueryBuilderStore((s) => {
    const sourceNode = s.nodes.find(n => n.id === source)
    return sourceNode ? getNodeColor(sourceNode.type, sourceNode.data) : 'var(--muted-foreground)'
  })
  const isInteractive = useQueryBuilderStore((s) => s.isInteractive)
  const isExecuting = useQueryBuilderStore((s) => s.isExecuting)
  const requestEdgeDeletion = useQueryBuilderStore((s) => s.requestEdgeDeletion)

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
          stroke: edgeColor,
          strokeWidth: selected ? 4 : 3,
          strokeDasharray: isExecuting ? '3 8' : 'none',
          strokeLinecap: isExecuting ? 'round' : undefined,
          animation: isExecuting ? 'dashMove 0.8s linear infinite' : 'none',
        }}
      />
      {selected && isInteractive && (
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
            <button
              onClick={handleDelete}
              onMouseDown={(e) => e.stopPropagation()}
              className="w-6 h-6 bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-full flex items-center justify-center shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-110 border-2 border-background cursor-pointer"
              title="Delete connection"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
