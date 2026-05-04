// useCanvasActions.ts
//
// Canvas-level actions: auto-layout (dagre), node/edge deletion with confirmation
// dialogs, drag-and-drop handling, and keyboard shortcuts. Keeps the main canvas
// component focused on rendering.

import { useCallback, useState, useEffect } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useShallow } from 'zustand/react/shallow'
import dagre from 'dagre'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import { NodeType } from '@/types'
import { getDefaultNodeData } from '@/components/query/canvasUtils'

export function useCanvasActions() {
  // IMPORTANT: do not subscribe to `nodes` here. React Flow rewrites the
  // nodes array every frame while dragging — if this hook subscribed to it,
  // every drag tick would re-run all useCallbacks and hand React Flow new
  // handler references, which it then has to reconcile. Read the live array
  // through `useQueryBuilderStore.getState()` instead, only when needed.
  const {
    onNodesChange,
    selectedNode,
    selectNode,
    clearCanvas,
    isInteractive,
    pendingDeleteNodeId,
    deleteNode,
    cancelNodeDeletion,
    pendingDeleteEdgeId,
    deleteEdge,
    cancelEdgeDeletion,
    setNodes,
    togglePanel,
    setPanelSelectedEdge,
  } = useQueryBuilderStore(
    useShallow((s) => ({
      onNodesChange: s.onNodesChange,
      selectedNode: s.selectedNode,
      selectNode: s.selectNode,
      clearCanvas: s.clearCanvas,
      isInteractive: s.isInteractive,
      pendingDeleteNodeId: s.pendingDeleteNodeId,
      deleteNode: s.deleteNode,
      cancelNodeDeletion: s.cancelNodeDeletion,
      pendingDeleteEdgeId: s.pendingDeleteEdgeId,
      deleteEdge: s.deleteEdge,
      cancelEdgeDeletion: s.cancelEdgeDeletion,
      setNodes: s.setNodes,
      togglePanel: s.togglePanel,
      setPanelSelectedEdge: s.setPanelSelectedEdge,
    }))
  )

  const reactFlowInstance = useReactFlow()
  const { screenToFlowPosition } = reactFlowInstance

  // Delete state
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [nodeToDelete, setNodeToDelete] = useState<string | null>(null)
  const [pendingNodesDelete, setPendingNodesDelete] = useState<string[]>([])
  const [showDeleteEdgeConfirm, setShowDeleteEdgeConfirm] = useState(false)
  const [currentZoom, setCurrentZoom] = useState(0.8)

  const autoLayout = useCallback(() => {
    const g = new dagre.graphlib.Graph()
    g.setDefaultEdgeLabel(() => ({}))
    g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 100, marginx: 40, marginy: 40 })

    const currentNodes = useQueryBuilderStore.getState().nodes
    const currentEdges = useQueryBuilderStore.getState().edges

    for (const node of currentNodes) {
      const width = node.type === NodeType.START ? 240
        : node.type === NodeType.OUTPUT ? 200
        : node.type === NodeType.FILTER ? 200
        : 240
      const height = node.type === NodeType.START ? 180
        : node.type === NodeType.OUTPUT ? 160
        : 160
      g.setNode(node.id, { width, height })
    }

    for (const edge of currentEdges) {
      g.setEdge(edge.source, edge.target)
    }

    dagre.layout(g)

    const layoutedNodes = currentNodes.map((node) => {
      // dagre returns undefined when a node wasn't seen during layout — keep
      // the original position in that case rather than crashing.
      const pos = g.node(node.id)
      if (!pos) return node
      const width = pos.width || 240
      const height = pos.height || 160
      return {
        ...node,
        position: { x: pos.x - width / 2, y: pos.y - height / 2 },
      }
    })

    setNodes(layoutedNodes)
    setTimeout(() => {
      reactFlowInstance?.fitView({ padding: 0.2, maxZoom: 1 })
    }, 50)
  }, [setNodes, reactFlowInstance])

  const handleClearCanvas = () => {
    if (useQueryBuilderStore.getState().nodes.length > 0) setShowClearConfirm(true)
  }

  const confirmClearCanvas = () => {
    clearCanvas()
    setShowClearConfirm(false)
  }

  const confirmDeleteNode = () => {
    if (pendingNodesDelete.length > 0) {
      pendingNodesDelete.forEach(id => {
        useQueryBuilderStore.getState().deleteNode(id)
      })
      setPendingNodesDelete([])
    } else if (nodeToDelete) {
      useQueryBuilderStore.getState().deleteNode(nodeToDelete)
    } else if (pendingDeleteNodeId) {
      deleteNode(pendingDeleteNodeId)
    }
    setNodeToDelete(null)
    setShowDeleteConfirm(false)
  }

  const handleNodesDelete = useCallback(
    (deletedNodes: any[]) => {
      if (!isInteractive) {
        deletedNodes.forEach(node => useQueryBuilderStore.getState().addNode(node))
        return
      }
      const hasStartNode = deletedNodes.some(n => n.id === 'start-node')
      if (hasStartNode) {
        deletedNodes.forEach(node => useQueryBuilderStore.getState().addNode(node))
        return
      }
      deletedNodes.forEach(node => useQueryBuilderStore.getState().addNode(node))
      setNodeToDelete(deletedNodes[0].id)
      setPendingNodesDelete(deletedNodes.map(n => n.id))
      setShowDeleteConfirm(true)
    },
    [isInteractive]
  )

  // Intercept remove changes to show confirmation instead of immediate deletion
  const handleNodesChange = useCallback(
    (changes: any[]) => {
      const removeChanges = changes.filter(c => c.type === 'remove')
      if (removeChanges.length > 0) {
        if (!isInteractive) return
        const nodesToDelete = removeChanges.map(c => c.id).filter(id => id !== 'start-node')
        if (nodesToDelete.length === 0) return
        setNodeToDelete(nodesToDelete[0])
        setPendingNodesDelete(nodesToDelete)
        setShowDeleteConfirm(true)
        return
      }
      onNodesChange(changes)
    },
    [onNodesChange, isInteractive]
  )

  const confirmDeleteEdge = () => {
    if (pendingDeleteEdgeId) deleteEdge(pendingDeleteEdgeId)
    setShowDeleteEdgeConfirm(false)
  }

  const closeDeleteConfirm = () => {
    setShowDeleteConfirm(false)
    setNodeToDelete(null)
    setPendingNodesDelete([])
    cancelNodeDeletion()
  }

  const closeDeleteEdgeConfirm = () => {
    setShowDeleteEdgeConfirm(false)
    cancelEdgeDeletion()
  }

  const onNodeClick = useCallback(
    (_: unknown, node: unknown) => {
      if (!isInteractive) return
      selectNode(node as never)
    },
    [selectNode, isInteractive]
  )

  const onEdgeClick = useCallback(
    (_: unknown, edge: { id: string; data?: { edgeType?: string } }) => {
      if (!isInteractive) return
      if (edge.data?.edgeType === 'pipeline') setPanelSelectedEdge(edge.id)
    },
    [setPanelSelectedEdge, isInteractive]
  )

  const onPaneClick = useCallback(() => selectNode(null), [selectNode])

  const onEdgesDelete = useCallback((_deletedEdges: unknown[]) => {
  }, [])

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const type = event.dataTransfer.getData('application/reactflow')
      if (!type) return
      const className = event.dataTransfer.getData('className')
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const newNode = {
        id: `${type}-${Date.now()}`,
        type,
        position,
        data: getDefaultNodeData(type, className),
      }
      useQueryBuilderStore.getState().addNode(newNode as never)
    },
    [screenToFlowPosition]
  )

  // Delete/Backspace key
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedNode) {
        if (!isInteractive) return
        const target = event.target as HTMLElement
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
        event.preventDefault()
        setNodeToDelete(selectedNode.id)
        setShowDeleteConfirm(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedNode, isInteractive])

  // Cmd+B for panel toggle
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'b') {
        event.preventDefault()
        togglePanel()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [togglePanel])

  // Zoom tracking
  useEffect(() => {
    const updateZoom = () => {
      const viewport = reactFlowInstance.getViewport()
      if (viewport) setCurrentZoom(viewport.zoom)
    }
    updateZoom()
    const interval = setInterval(updateZoom, 100)
    return () => clearInterval(interval)
  }, [reactFlowInstance])

  // Sync store-initiated delete requests to confirmation dialogs
  useEffect(() => {
    if (pendingDeleteNodeId) setShowDeleteConfirm(true)
  }, [pendingDeleteNodeId])

  useEffect(() => {
    if (pendingDeleteEdgeId) setShowDeleteEdgeConfirm(true)
  }, [pendingDeleteEdgeId])

  // CanvasDialogs expects either a minimal node descriptor or null. Resolve
  // the node lazily through getState() — we don't subscribe to `nodes`, so
  // drag-tick updates don't re-run this hook.
  const targetDeleteId = nodeToDelete || pendingDeleteNodeId
  const nodeToDeleteData = targetDeleteId
    ? (useQueryBuilderStore.getState().nodes.find(n => n.id === targetDeleteId) ?? null)
    : null

  return {
    currentZoom,
    autoLayout,
    // Clear
    showClearConfirm,
    setShowClearConfirm,
    handleClearCanvas,
    confirmClearCanvas,
    // Node delete
    showDeleteConfirm,
    confirmDeleteNode,
    closeDeleteConfirm,
    nodeToDeleteData,
    handleNodesDelete,
    handleNodesChange,
    // Edge delete
    showDeleteEdgeConfirm,
    confirmDeleteEdge,
    closeDeleteEdgeConfirm,
    // Click handlers
    onNodeClick,
    onEdgeClick,
    onPaneClick,
    onEdgesDelete,
    onDragOver,
    onDrop,
  }
}
