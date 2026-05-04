// store/__tests__/flowSlice.test.ts
//
// Tests for the FlowSlice of the composed QueryBuilderStore:
// node CRUD, edge CRUD, deletion requests, and state flag management.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from '@testing-library/react'
import { useQueryBuilderStore } from '../index'

// Mock toast so onConnect pipeline toast doesn't blow up
vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

// Mock @xyflow/react — provide real-enough addEdge/applyNodeChanges/applyEdgeChanges
vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual('@xyflow/react')
  return {
    ...actual as any,
    // Keep real implementations for addEdge, applyNodeChanges, applyEdgeChanges
  }
})

function resetStore() {
  useQueryBuilderStore.setState({
    nodes: [
      {
        id: 'start-node',
        type: 'startNode',
        position: { x: 100, y: 250 },
        data: { id: 'start-node', label: 'Start' } as any,
        deletable: false,
        draggable: true,
      },
    ],
    edges: [],
    selectedNode: null,
    pendingDeleteNodeId: null,
    pendingDeleteEdgeId: null,
    hasUnsavedChanges: false,
    hasQueryChanged: false,
    isInteractive: true,
    currentQueryId: null,
  })
}

describe('FlowSlice', () => {
  beforeEach(() => {
    resetStore()
  })

  // ─── Node operations ──────────────────────────────────────────

  describe('addNode', () => {
    it('appends a node to the list', () => {
      const newNode = {
        id: 'node-1',
        type: 'classNode',
        position: { x: 300, y: 200 },
        data: { id: 'node-1', className: 'fvTenant', label: 'fvTenant' } as any,
      }

      act(() => {
        useQueryBuilderStore.getState().addNode(newNode)
      })

      const nodes = useQueryBuilderStore.getState().nodes
      expect(nodes).toHaveLength(2)
      expect(nodes[1].id).toBe('node-1')
    })

    it('sets hasQueryChanged to true', () => {
      act(() => {
        useQueryBuilderStore.getState().addNode({
          id: 'node-1',
          type: 'classNode',
          position: { x: 0, y: 0 },
          data: { id: 'node-1', className: 'fvBD' } as any,
        })
      })

      expect(useQueryBuilderStore.getState().hasQueryChanged).toBe(true)
    })

    it('sets hasUnsavedChanges when currentQueryId exists', () => {
      useQueryBuilderStore.setState({ currentQueryId: 42 })

      act(() => {
        useQueryBuilderStore.getState().addNode({
          id: 'node-1',
          type: 'classNode',
          position: { x: 0, y: 0 },
          data: { id: 'node-1', className: 'fvBD' } as any,
        })
      })

      expect(useQueryBuilderStore.getState().hasUnsavedChanges).toBe(true)
    })
  })

  describe('updateNode', () => {
    it('updates data of a specific node', () => {
      act(() => {
        useQueryBuilderStore.getState().addNode({
          id: 'node-1',
          type: 'classNode',
          position: { x: 0, y: 0 },
          data: { id: 'node-1', className: 'fvTenant', label: 'fvTenant' } as any,
        })
      })

      act(() => {
        useQueryBuilderStore.getState().updateNode('node-1', { label: 'Updated' } as any)
      })

      const node = useQueryBuilderStore.getState().nodes.find((n) => n.id === 'node-1')
      expect(node?.data.label).toBe('Updated')
    })

    it('does not modify other nodes', () => {
      act(() => {
        useQueryBuilderStore.getState().addNode({
          id: 'node-1',
          type: 'classNode',
          position: { x: 0, y: 0 },
          data: { id: 'node-1', className: 'fvTenant', label: 'A' } as any,
        })
        useQueryBuilderStore.getState().addNode({
          id: 'node-2',
          type: 'classNode',
          position: { x: 100, y: 0 },
          data: { id: 'node-2', className: 'fvBD', label: 'B' } as any,
        })
      })

      act(() => {
        useQueryBuilderStore.getState().updateNode('node-1', { label: 'Changed' } as any)
      })

      const node2 = useQueryBuilderStore.getState().nodes.find((n) => n.id === 'node-2')
      expect(node2?.data.label).toBe('B')
    })
  })

  describe('deleteNode', () => {
    it('removes the node and connected edges', () => {
      useQueryBuilderStore.setState({
        nodes: [
          { id: 'start-node', type: 'startNode', position: { x: 0, y: 0 }, data: {} as any },
          { id: 'node-1', type: 'classNode', position: { x: 100, y: 0 }, data: {} as any },
          { id: 'node-2', type: 'classNode', position: { x: 200, y: 0 }, data: {} as any },
        ],
        edges: [
          { id: 'e1', source: 'start-node', target: 'node-1' },
          { id: 'e2', source: 'node-1', target: 'node-2' },
        ],
      })

      act(() => {
        useQueryBuilderStore.getState().deleteNode('node-1')
      })

      const { nodes, edges } = useQueryBuilderStore.getState()
      expect(nodes).toHaveLength(2)
      expect(nodes.find((n) => n.id === 'node-1')).toBeUndefined()
      // Both edges connecting to node-1 should be removed
      expect(edges).toHaveLength(0)
    })

    it('clears pendingDeleteNodeId', () => {
      useQueryBuilderStore.setState({ pendingDeleteNodeId: 'node-1' })

      act(() => {
        useQueryBuilderStore.getState().deleteNode('node-1')
      })

      expect(useQueryBuilderStore.getState().pendingDeleteNodeId).toBeNull()
    })
  })

  describe('setNodes', () => {
    it('replaces all nodes', () => {
      const newNodes = [
        { id: 'a', type: 'classNode', position: { x: 0, y: 0 }, data: {} as any },
      ]

      act(() => {
        useQueryBuilderStore.getState().setNodes(newNodes)
      })

      expect(useQueryBuilderStore.getState().nodes).toHaveLength(1)
      expect(useQueryBuilderStore.getState().nodes[0].id).toBe('a')
    })
  })

  // ─── Edge operations ──────────────────────────────────────────

  describe('setEdges', () => {
    it('replaces all edges', () => {
      const newEdges = [{ id: 'e1', source: 'a', target: 'b' }]

      act(() => {
        useQueryBuilderStore.getState().setEdges(newEdges as any)
      })

      expect(useQueryBuilderStore.getState().edges).toHaveLength(1)
      expect(useQueryBuilderStore.getState().hasQueryChanged).toBe(true)
    })
  })

  describe('deleteEdge', () => {
    it('removes the specific edge', () => {
      useQueryBuilderStore.setState({
        edges: [
          { id: 'e1', source: 'a', target: 'b' },
          { id: 'e2', source: 'b', target: 'c' },
        ],
      })

      act(() => {
        useQueryBuilderStore.getState().deleteEdge('e1')
      })

      const edges = useQueryBuilderStore.getState().edges
      expect(edges).toHaveLength(1)
      expect(edges[0].id).toBe('e2')
    })

    it('clears pendingDeleteEdgeId', () => {
      useQueryBuilderStore.setState({
        edges: [{ id: 'e1', source: 'a', target: 'b' }],
        pendingDeleteEdgeId: 'e1',
      })

      act(() => {
        useQueryBuilderStore.getState().deleteEdge('e1')
      })

      expect(useQueryBuilderStore.getState().pendingDeleteEdgeId).toBeNull()
    })
  })

  // ─── Deletion request flow ────────────────────────────────────

  describe('requestNodeDeletion', () => {
    it('sets pendingDeleteNodeId', () => {
      act(() => {
        useQueryBuilderStore.getState().requestNodeDeletion('node-1')
      })

      expect(useQueryBuilderStore.getState().pendingDeleteNodeId).toBe('node-1')
    })

    it('does not allow deleting start-node', () => {
      act(() => {
        useQueryBuilderStore.getState().requestNodeDeletion('start-node')
      })

      expect(useQueryBuilderStore.getState().pendingDeleteNodeId).toBeNull()
    })

    it('does nothing when not interactive', () => {
      useQueryBuilderStore.setState({ isInteractive: false })

      act(() => {
        useQueryBuilderStore.getState().requestNodeDeletion('node-1')
      })

      expect(useQueryBuilderStore.getState().pendingDeleteNodeId).toBeNull()
    })
  })

  describe('cancelNodeDeletion', () => {
    it('clears pendingDeleteNodeId', () => {
      useQueryBuilderStore.setState({ pendingDeleteNodeId: 'node-1' })

      act(() => {
        useQueryBuilderStore.getState().cancelNodeDeletion()
      })

      expect(useQueryBuilderStore.getState().pendingDeleteNodeId).toBeNull()
    })
  })

  describe('requestEdgeDeletion', () => {
    it('sets pendingDeleteEdgeId', () => {
      act(() => {
        useQueryBuilderStore.getState().requestEdgeDeletion('e1')
      })

      expect(useQueryBuilderStore.getState().pendingDeleteEdgeId).toBe('e1')
    })

    it('does nothing when not interactive', () => {
      useQueryBuilderStore.setState({ isInteractive: false })

      act(() => {
        useQueryBuilderStore.getState().requestEdgeDeletion('e1')
      })

      expect(useQueryBuilderStore.getState().pendingDeleteEdgeId).toBeNull()
    })
  })

  describe('cancelEdgeDeletion', () => {
    it('clears pendingDeleteEdgeId', () => {
      useQueryBuilderStore.setState({ pendingDeleteEdgeId: 'e1' })

      act(() => {
        useQueryBuilderStore.getState().cancelEdgeDeletion()
      })

      expect(useQueryBuilderStore.getState().pendingDeleteEdgeId).toBeNull()
    })
  })

  // ─── Selection ────────────────────────────────────────────────

  describe('selectNode', () => {
    it('sets selected node', () => {
      const node = { id: 'node-1', type: 'classNode', position: { x: 0, y: 0 }, data: {} as any }

      act(() => {
        useQueryBuilderStore.getState().selectNode(node)
      })

      expect(useQueryBuilderStore.getState().selectedNode).toEqual(node)
    })

    it('clears selection with null', () => {
      useQueryBuilderStore.setState({
        selectedNode: { id: 'node-1', type: 'classNode', position: { x: 0, y: 0 }, data: {} as any },
      })

      act(() => {
        useQueryBuilderStore.getState().selectNode(null)
      })

      expect(useQueryBuilderStore.getState().selectedNode).toBeNull()
    })
  })
})
