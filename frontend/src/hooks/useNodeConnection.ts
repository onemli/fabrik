// useNodeConnection.ts
//
// Manages the Postman Flows-style connection workflow: tracking drag origin,
// opening the node selection menu on canvas drop, validating connections
// against ACI class hierarchy rules, and wiring up the ClassBrowserDialog.

import { useCallback, useState, useRef } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import { NodeType } from '@/types'
import { getDefaultNodeData } from '@/components/query/canvasUtils'

export function useNodeConnection() {
  const {
    nodes,
    edges,
    isInteractive,
    addNodeMenu,
    openAddNodeMenu,
    closeAddNodeMenu,
  } = useQueryBuilderStore()

  const { screenToFlowPosition } = useReactFlow()

  const [connectingNodeId, setConnectingNodeId] = useState<string | null>(null)
  const [classBrowserOpen, setClassBrowserOpen] = useState(false)
  const [classBrowserParent, setClassBrowserParent] = useState<string | null>(null)

  // NodeSelectionMenu calls onClose() BEFORE onRequestClassBrowser(),
  // which clears addNodeMenu.source. We snapshot it here so it survives.
  const pendingMenuStateRef = useRef<{
    source: { nodeId: string; nodeType: string } | null
    position: { x: number; y: number }
  } | null>(null)

  const onConnectStart = useCallback(
    (_: unknown, { nodeId }: { nodeId: string | null }) => {
      if (!isInteractive) return
      if (nodeId) {
        setConnectingNodeId(nodeId)
      }
    },
    [isInteractive]
  )

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      if (!isInteractive) return

      if (!connectingNodeId) {
        return
      }

      const sourceNode = nodes.find((n) => n.id === connectingNodeId)
      if (!sourceNode) {
        setConnectingNodeId(null)
        return
      }

      // Output/PostProcessor nodes can create pipeline edges even with existing connections
      const isPipelineSource =
        sourceNode.type === NodeType.OUTPUT || sourceNode.type === NodeType.POST_PROCESSOR
      const sourceHasOutgoingConnection = edges.some(
        e => e.source === connectingNodeId && e.data?.edgeType !== 'pipeline'
      )
      if (sourceHasOutgoingConnection && !isPipelineSource) {
        setConnectingNodeId(null)
        return
      }

      const target = event.target as HTMLElement

      let currentElement: HTMLElement | null = target
      let isHandleTarget = false
      let isNodeTarget = false

      while (currentElement && currentElement !== document.body) {
        if (currentElement.classList.contains('react-flow__handle')) {
          isHandleTarget = true
          break
        }
        if (currentElement.classList.contains('react-flow__node')) {
          isNodeTarget = true
          break
        }
        currentElement = currentElement.parentElement
      }

      // If dropped on an existing handle/node, let React Flow handle it natively
      if (isHandleTarget || isNodeTarget) {
        setConnectingNodeId(null)
        return
      }

      const mouseEvent = event as MouseEvent

      openAddNodeMenu(
        { nodeId: sourceNode.id, nodeType: sourceNode.type || '' },
        { x: mouseEvent.clientX, y: mouseEvent.clientY }
      )
      setConnectingNodeId(null)
    },
    [connectingNodeId, nodes, edges, isInteractive, openAddNodeMenu]
  )

  const handleNodeTypeSelect = useCallback(
    (nodeType: NodeType, data?: { className?: string; classInfo?: unknown }) => {
      const { source, position: menuPosition } = addNodeMenu
      if (!source) return

      const position = screenToFlowPosition({
        x: menuPosition.x,
        y: menuPosition.y,
      })

      const newNodeId = `${nodeType}-${Date.now()}`
      const newNode = {
        id: newNodeId,
        type: nodeType,
        position,
        data: {
          ...getDefaultNodeData(nodeType, data?.className),
          ...(data?.classInfo ? { classInfo: data.classInfo } : {}),
        },
      }

      useQueryBuilderStore.getState().addNode(newNode as never)

      // Pipeline edge when source is Output/PostProcessor
      const isPipelineSource =
        source.nodeType === NodeType.OUTPUT || source.nodeType === NodeType.POST_PROCESSOR
      const isPipelineEdge = isPipelineSource && nodeType === NodeType.CLASS

      const newEdge = isPipelineEdge
        ? {
            id: `${source.nodeId}-${newNodeId}`,
            source: source.nodeId,
            target: newNodeId,
            type: 'pipeline' as const,
            data: {
              edgeType: 'pipeline' as const,
              extractField: 'dn',
              injectAs: 'filter_values' as const,
              sourceType: source.nodeType,
            },
          }
        : {
            id: `${source.nodeId}-${newNodeId}`,
            source: source.nodeId,
            target: newNodeId,
            type: 'smoothstep',
            data: { sourceType: source.nodeType },
          }
      useQueryBuilderStore.getState().setEdges([...edges, newEdge])

      closeAddNodeMenu()
    },
    [addNodeMenu, screenToFlowPosition, edges, closeAddNodeMenu]
  )

  // Walk edges backwards to find the nearest ClassNode ancestor
  const findParentClassName = useCallback(
    (nodeId: string): string | null => {
      const node = nodes.find((n) => n.id === nodeId)
      if (!node) return null
      if (node.type === 'classNode') return (node.data as any)?.className || null
      const incomingEdge = edges.find((e) => e.target === nodeId)
      if (incomingEdge) return findParentClassName(incomingEdge.source)
      return null
    },
    [nodes, edges]
  )

  const handleRequestClassBrowser = useCallback(
    ({ isChildClass }: { isChildClass: boolean }) => {
      pendingMenuStateRef.current = {
        source: addNodeMenu.source,
        position: addNodeMenu.position,
      }
      const parentClass =
        isChildClass && addNodeMenu.source?.nodeId
          ? findParentClassName(addNodeMenu.source.nodeId)
          : null
      setClassBrowserParent(parentClass)
      setClassBrowserOpen(true)
    },
    [addNodeMenu.source, addNodeMenu.position, findParentClassName]
  )

  const handleClassBrowserSelect = useCallback(
    (className: string, classInfo?: unknown) => {
      const saved = pendingMenuStateRef.current
      if (!saved?.source) {
        setClassBrowserOpen(false)
        return
      }

      const position = screenToFlowPosition({
        x: saved.position.x,
        y: saved.position.y,
      })

      const newNodeId = `${NodeType.CLASS}-${Date.now()}`
      const newNode = {
        id: newNodeId,
        type: NodeType.CLASS,
        position,
        data: {
          ...getDefaultNodeData(NodeType.CLASS, className),
          ...(classInfo ? { classInfo } : {}),
        },
      }

      useQueryBuilderStore.getState().addNode(newNode as never)

      const currentEdges = useQueryBuilderStore.getState().edges

      const isPipelineSource =
        saved.source.nodeType === NodeType.OUTPUT ||
        saved.source.nodeType === NodeType.POST_PROCESSOR
      const isPipelineEdge = isPipelineSource

      const newEdge = isPipelineEdge
        ? {
            id: `${saved.source.nodeId}-${newNodeId}`,
            source: saved.source.nodeId,
            target: newNodeId,
            type: 'pipeline' as const,
            data: {
              edgeType: 'pipeline' as const,
              extractField: 'dn',
              injectAs: 'filter_values' as const,
              sourceType: saved.source.nodeType,
            },
          }
        : {
            id: `${saved.source.nodeId}-${newNodeId}`,
            source: saved.source.nodeId,
            target: newNodeId,
            type: 'smoothstep',
            data: { sourceType: saved.source.nodeType },
          }
      useQueryBuilderStore.getState().setEdges([...currentEdges, newEdge])

      pendingMenuStateRef.current = null
      setClassBrowserOpen(false)
    },
    [screenToFlowPosition]
  )

  const isValidConnection = useCallback(
    (connection: { source: string | null; target: string | null }) => {
      if (!connection.source || !connection.target) return false

      const sourceNode = nodes.find((n) => n.id === connection.source)
      const targetNode = nodes.find((n) => n.id === connection.target)

      if (!sourceNode || !targetNode) return false

      // Pipeline: Output/PostProcessor -> Class (cross-stage)
      const isPipelineConnection =
        (sourceNode.type === NodeType.OUTPUT || sourceNode.type === NodeType.POST_PROCESSOR) &&
        targetNode.type === NodeType.CLASS

      if (isPipelineConnection) {
        const hasDuplicatePipeline = edges.some(
          e => e.source === connection.source && e.target === connection.target
        )
        return !hasDuplicatePipeline
      }

      // Non-pipeline: single incoming and single outgoing per node
      const targetHasIncomingConnection = edges.some(
        e => e.target === connection.target && e.data?.edgeType !== 'pipeline'
      )
      if (targetHasIncomingConnection) return false

      const sourceHasOutgoingConnection = edges.some(
        e => e.source === connection.source && e.data?.edgeType !== 'pipeline'
      )
      if (sourceHasOutgoingConnection) return false

      // Type-based rules enforcing ACI class hierarchy
      if (sourceNode.type === NodeType.START) {
        return targetNode.type === NodeType.CLASS
      }

      if (targetNode.type === NodeType.CLASS) {
        return sourceNode.type === NodeType.START
      }

      if (targetNode.type === NodeType.FILTER) {
        return sourceNode.type === NodeType.CLASS
      }

      if (targetNode.type === NodeType.POST_PROCESSOR) {
        return sourceNode.type === NodeType.CLASS ||
               sourceNode.type === NodeType.FILTER ||
               sourceNode.type === NodeType.POST_PROCESSOR
      }

      if (targetNode.type === NodeType.OUTPUT) {
        return sourceNode.type === NodeType.CLASS ||
               sourceNode.type === NodeType.FILTER ||
               sourceNode.type === NodeType.POST_PROCESSOR
      }

      return false
    },
    [nodes, edges]
  )

  const onReconnect = useCallback(
    (oldEdge: { id: string }, newConnection: { source: string | null; target: string | null }) => {
      if (!newConnection.source || !newConnection.target) return

      const sourceNode = nodes.find((n) => n.id === newConnection.source)
      if (!sourceNode) return

      const updatedEdges = edges.filter((e) => e.id !== oldEdge.id)
      const newEdge = {
        id: `${newConnection.source}-${newConnection.target}`,
        source: newConnection.source,
        target: newConnection.target,
        type: 'smoothstep',
        data: { sourceType: sourceNode.type || '' },
      }

      useQueryBuilderStore.getState().setEdges([...updatedEdges, newEdge])
    },
    [edges, nodes]
  )

  return {
    connectingNodeId,
    classBrowserOpen,
    setClassBrowserOpen,
    classBrowserParent,
    onConnectStart,
    onConnectEnd,
    handleNodeTypeSelect,
    handleRequestClassBrowser,
    handleClassBrowserSelect,
    isValidConnection,
    onReconnect,
  }
}
