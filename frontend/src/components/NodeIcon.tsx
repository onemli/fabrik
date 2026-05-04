// NodeIcon.tsx
//
// Maps a NodeType enum value to the corresponding Lucide icon component.
// Used in node headers, the node selection menu, and the sidebar legend so
// every place that renders a node type uses the same icon without duplicating the switch.

import { CirclePlay, Boxes, SlidersHorizontal, Workflow, ArrowDownToLine, type LucideIcon } from 'lucide-react'
import { NodeType } from '@/types'

interface NodeIconProps {
  nodeType: NodeType
  className?: string
}

const ICON_MAP: Record<NodeType, LucideIcon> = {
  [NodeType.START]: CirclePlay,
  [NodeType.CLASS]: Boxes,
  [NodeType.FILTER]: SlidersHorizontal,
  [NodeType.POST_PROCESSOR]: Workflow,
  [NodeType.OUTPUT]: ArrowDownToLine,
}

export function NodeIcon({ nodeType, className = 'w-6 h-6' }: NodeIconProps) {
  const Icon = ICON_MAP[nodeType]
  if (!Icon) return null
  return <Icon className={className} />
}
