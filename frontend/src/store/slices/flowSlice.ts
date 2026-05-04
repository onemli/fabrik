// store/slices/flowSlice.ts
//
// React Flow graph state: nodes, edges, and the operations that mutate them
// (add node, delete node, update node data, connect nodes, etc.). This is the
// authoritative source of the canvas graph that gets serialized to flow_data.

import { StateCreator } from 'zustand'
import { type Node, type Edge, type Connection, addEdge, applyNodeChanges, applyEdgeChanges } from '@xyflow/react'
import type { QueryNodeData } from '@/types'
import { toast } from '@/lib/toast'
import { createStartNode } from './_helpers'
import type { QueryBuilderState } from '../index'

export interface FlowSlice {
  // State
  nodes: Node<QueryNodeData>[]
  edges: Edge[]
  selectedNode: Node<QueryNodeData> | null
  pendingDeleteNodeId: string | null
  pendingDeleteEdgeId: string | null

  // Actions
  setNodes: (nodes: Node<QueryNodeData>[]) => void
  setEdges: (edges: Edge[]) => void
  onNodesChange: (changes: unknown[]) => void
  onEdgesChange: (changes: unknown[]) => void
  onConnect: (connection: Connection) => void
  addNode: (node: Node<QueryNodeData>) => void
  updateNode: (id: string, data: Partial<QueryNodeData>) => void
  deleteNode: (id: string) => void
  requestNodeDeletion: (id: string) => void
  cancelNodeDeletion: () => void
  deleteEdge: (id: string) => void
  requestEdgeDeletion: (id: string) => void
  cancelEdgeDeletion: () => void
  selectNode: (node: Node<QueryNodeData> | null) => void
}

type FlowSliceCreator = StateCreator<QueryBuilderState, [], [], FlowSlice>

export const createFlowSlice: FlowSliceCreator = (set, get) => ({
  // State
  nodes: [createStartNode()],
  edges: [],
  selectedNode: null,
  pendingDeleteNodeId: null,
  pendingDeleteEdgeId: null,

  // Actions
  setNodes: (nodes) =>
    set({ nodes, hasUnsavedChanges: !!get().currentQueryId, hasQueryChanged: true }),

  setEdges: (edges) =>
    set({ edges, hasUnsavedChanges: !!get().currentQueryId, hasQueryChanged: true }),

  onNodesChange: (changes: any) => {
    const isPositionOnly = changes.every(
      (c: any) => c.type === 'position' || c.type === 'dimensions' || c.type === 'select'
    )
    const state: any = { nodes: applyNodeChanges(changes as any, get().nodes) }
    if (!isPositionOnly) {
      state.hasUnsavedChanges = !!get().currentQueryId
      state.hasQueryChanged = true
    } else if (changes.some((c: any) => c.type === 'position' && c.dragging === false)) {
      state.hasUnsavedChanges = !!get().currentQueryId
    }
    set(state)
  },

  onEdgesChange: (changes: any) => {
    set({
      edges: applyEdgeChanges(changes as any, get().edges),
      hasUnsavedChanges: !!get().currentQueryId,
      hasQueryChanged: true,
    })
  },

  onConnect: async (connection) => {
    const { nodes, edges } = get()
    const sourceNode = nodes.find((n) => n.id === connection.source)
    const targetNode = nodes.find((n) => n.id === connection.target)

    // Detect pipeline connections: when a PostProcessor or Output connects
    // to a ClassNode, this creates a cross-subgraph pipeline edge
    const isPipelineConnection =
      (sourceNode?.type === 'postProcessorNode' || sourceNode?.type === 'outputNode') &&
      targetNode?.type === 'classNode'

    if (isPipelineConnection) {
      const edgeWithData = {
        ...connection,
        type: 'pipeline' as const,
        data: {
          edgeType: 'pipeline' as const,
          extractField: 'dn',
          injectAs: 'filter_values' as const,
          sourceType: sourceNode?.type || '',
        },
      }

      set({
        edges: addEdge(edgeWithData, edges),
        hasUnsavedChanges: !!get().currentQueryId,
        hasQueryChanged: true,
      })
      toast.success('Pipeline connection created')
      return
    }

    if (sourceNode?.type === 'classNode' && targetNode?.type === 'classNode') {
      const sourceClass = (sourceNode.data as any).className
      const targetClass = (targetNode.data as any).className

      if (sourceClass && targetClass) {
        try {
          const { queriesService } = await import('@/services/queries')
          const validation = await queriesService.validateConnection(sourceClass, targetClass)

          if (!validation.isValid) {
            toast.error(validation.message)
            return
          }
        } catch (error: any) {
          toast.error(error, 'query')
          return
        }
      }
    }

    const edgeWithData = {
      ...connection,
      data: { sourceType: sourceNode?.type || '' },
    }

    set({
      edges: addEdge(edgeWithData, edges),
      hasUnsavedChanges: !!get().currentQueryId,
      hasQueryChanged: true,
    })
  },

  addNode: (node) => {
    set({
      nodes: [...get().nodes, node],
      hasUnsavedChanges: !!get().currentQueryId,
      hasQueryChanged: true,
    })
  },

  updateNode: (id, data) => {
    set({
      nodes: get().nodes.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, ...data } } : node
      ),
      hasUnsavedChanges: !!get().currentQueryId,
      hasQueryChanged: true,
    })
  },

  deleteNode: (id) => {
    set({
      nodes: get().nodes.filter((node) => node.id !== id),
      edges: get().edges.filter((edge) => edge.source !== id && edge.target !== id),
      hasUnsavedChanges: !!get().currentQueryId,
      hasQueryChanged: true,
      pendingDeleteNodeId: null,
    })
  },

  requestNodeDeletion: (id) => {
    if (!get().isInteractive) return
    if (id === 'start-node') return
    set({ pendingDeleteNodeId: id })
  },

  cancelNodeDeletion: () => set({ pendingDeleteNodeId: null }),

  deleteEdge: (id) => {
    set({
      edges: get().edges.filter((edge) => edge.id !== id),
      hasUnsavedChanges: !!get().currentQueryId,
      hasQueryChanged: true,
      pendingDeleteEdgeId: null,
    })
  },

  requestEdgeDeletion: (id) => {
    if (!get().isInteractive) return
    set({ pendingDeleteEdgeId: id })
  },

  cancelEdgeDeletion: () => set({ pendingDeleteEdgeId: null }),

  selectNode: (node) => set({ selectedNode: node }),
})
