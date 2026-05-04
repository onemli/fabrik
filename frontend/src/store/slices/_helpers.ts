// store/slices/_helpers.ts
//
// Shared factory functions used by multiple slices. Underscore prefix means
// "internal to this directory, not exported from the store barrel".

import type { Node } from '@xyflow/react'
import type { StartNodeData } from '@/types'
import { NodeType } from '@/types'

export const createStartNode = (): Node<StartNodeData> => ({
  id: 'start-node',
  type: NodeType.START,
  position: { x: 100, y: 250 },
  data: { id: 'start-node', label: 'Start' },
  deletable: false,
  draggable: true,
})
