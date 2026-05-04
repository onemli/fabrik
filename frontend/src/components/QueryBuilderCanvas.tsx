// QueryBuilderCanvas.tsx
//
// The heart of the query builder — a React Flow canvas where users drag, drop,
// and connect ACI class nodes to build APIC queries visually. Connection rules
// (isValidConnection) enforce the ACI class hierarchy using Neo4j MIM data.
// The Execute button triggers inline query execution.

import { useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  Panel,
  ConnectionMode,
  ConnectionLineType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import { NodeType } from '@/types'
import StartNode from './nodes/StartNode'
import ClassNode from './nodes/ClassNode'
import FilterNode from './nodes/FilterNode'
import PostProcessorNode from './nodes/PostProcessorNode'
import OutputNode from './nodes/OutputNode'
import { ColoredEdge } from './edges/ColoredEdge'
import { PipelineEdge } from './edges/PipelineEdge'
import RightPanel from './query/RightPanel'
import { useQueryExecution } from '@/hooks/useQueryExecution'
import { useQuerySave } from '@/hooks/useQuerySave'
import { useNodeConnection } from '@/hooks/useNodeConnection'
import { useCanvasActions } from '@/hooks/useCanvasActions'
import { CanvasToolbar } from './query/CanvasToolbar'
import { CanvasDialogs } from './query/CanvasDialogs'
import { CanvasZoomControls } from './query/CanvasZoomControls'
import { QueryPreviewBar } from './query/QueryPreviewBar'

export function QueryBuilderCanvas() {
  const {
    nodes,
    edges,
    onEdgesChange,
    onConnect,
    currentQueryName,
    cancelExecution,
    isExecuting,
    isInteractive,
    setIsInteractive,
    previewResult,
    isPreviewMode,
    previewNodeId,
    setIsPreviewMode,
    panelState,
    addNodeMenu,
    closeAddNodeMenu,
  } = useQueryBuilderStore()

  // Extracted hooks
  const {
    executeError,
    showLoginPrompt: execLoginPrompt,
    setShowLoginPrompt: setExecLoginPrompt,
    showVariableDialog,
    setShowVariableDialog,
    hasVariables,
    handleConfigureAndRun,
    handleVariableExecute,
  } = useQueryExecution()

  const {
    showSaveQueryDialog,
    setShowSaveQueryDialog,
    showLoginPromptForSave,
    setShowLoginPromptForSave,
    generatedQueryForSave,
    handleSaveClick,
    saveMutation,
  } = useQuerySave()

  const {
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
  } = useNodeConnection()

  const {
    currentZoom,
    autoLayout,
    showClearConfirm,
    setShowClearConfirm,
    handleClearCanvas,
    confirmClearCanvas,
    showDeleteConfirm,
    confirmDeleteNode,
    closeDeleteConfirm,
    nodeToDeleteData,
    handleNodesDelete,
    handleNodesChange,
    showDeleteEdgeConfirm,
    confirmDeleteEdge,
    closeDeleteEdgeConfirm,
    onNodeClick,
    onEdgeClick,
    onPaneClick,
    onEdgesDelete,
    onDragOver,
    onDrop,
  } = useCanvasActions()

  // Merge login prompts from both execution and save hooks
  const showLoginPrompt = execLoginPrompt || showLoginPromptForSave
  const closeLoginPrompt = () => {
    setExecLoginPrompt(false)
    setShowLoginPromptForSave(false)
  }

  // Dialog toggles
  const [showSavedQueriesDialog, setShowSavedQueriesDialog] = useState(false)
  const [showHistoryDialog, setShowHistoryDialog] = useState(false)

  // Memoized type maps — stable references prevent React Flow warnings
  const nodeTypes = useMemo(() => ({
    [NodeType.START]: StartNode,
    [NodeType.CLASS]: ClassNode,
    [NodeType.FILTER]: FilterNode,
    [NodeType.POST_PROCESSOR]: PostProcessorNode,
    [NodeType.OUTPUT]: OutputNode,
  }), [])

  const edgeTypes = useMemo(() => ({
    smoothstep: ColoredEdge,
    default: ColoredEdge,
    pipeline: PipelineEdge,
  }), [])

  const defaultEdgeOptions = useMemo(
    () => ({ type: 'smoothstep', animated: false, style: { strokeWidth: 3 } }),
    []
  )

  return (
    <>
      <CanvasDialogs
        showClearConfirm={showClearConfirm}
        onCloseClearConfirm={() => setShowClearConfirm(false)}
        onConfirmClear={confirmClearCanvas}
        nodesCount={nodes.length}
        showDeleteConfirm={showDeleteConfirm}
        onCloseDeleteConfirm={closeDeleteConfirm}
        onConfirmDeleteNode={confirmDeleteNode}
        nodeToDeleteData={nodeToDeleteData}
        showDeleteEdgeConfirm={showDeleteEdgeConfirm}
        onCloseDeleteEdgeConfirm={closeDeleteEdgeConfirm}
        onConfirmDeleteEdge={confirmDeleteEdge}
        showLoginPrompt={showLoginPrompt}
        onCloseLoginPrompt={closeLoginPrompt}
        showSaveQueryDialog={showSaveQueryDialog}
        onCloseSaveQueryDialog={() => setShowSaveQueryDialog(false)}
        onSave={(data) => saveMutation.mutate(data)}
        flowData={{ nodes, edges }}
        generatedQueryForSave={generatedQueryForSave}
        addNodeMenuOpen={addNodeMenu.open}
        addNodeMenuPosition={addNodeMenu.position}
        sourceNodeType={addNodeMenu.source?.nodeType || null}
        sourceNodeId={addNodeMenu.source?.nodeId || null}
        onNodeTypeSelect={handleNodeTypeSelect}
        onCloseAddNodeMenu={closeAddNodeMenu}
        onRequestClassBrowser={handleRequestClassBrowser}
        classBrowserOpen={classBrowserOpen}
        onClassBrowserOpenChange={setClassBrowserOpen}
        classBrowserParent={classBrowserParent}
        onClassBrowserSelect={handleClassBrowserSelect}
        showSavedQueriesDialog={showSavedQueriesDialog}
        onSavedQueriesDialogChange={setShowSavedQueriesDialog}
        showHistoryDialog={showHistoryDialog}
        onHistoryDialogChange={setShowHistoryDialog}
        showVariableDialog={showVariableDialog}
        onVariableDialogChange={setShowVariableDialog}
        nodes={nodes}
        onVariableExecute={handleVariableExecute}
        isPreviewMode={isPreviewMode}
        previewResult={previewResult}
        previewNodeId={previewNodeId}
        onClosePreview={() => setIsPreviewMode(false)}
      />

      <div
        className="flex flex-col h-full transition-all duration-300"
        style={{ marginRight: panelState.isOpen ? `${panelState.width}px` : '0px' }}
      >
        <CanvasToolbar
          currentQueryName={currentQueryName}
          isExecuting={isExecuting}
          hasVariables={hasVariables}
          nodesCount={nodes.length}
          onCancelExecution={cancelExecution}
          onConfigureAndRun={handleConfigureAndRun}
          onSaveClick={handleSaveClick}
          onClearCanvas={handleClearCanvas}
          onOpenSavedQueries={() => setShowSavedQueriesDialog(true)}
          onOpenHistory={() => setShowHistoryDialog(true)}
        />

        {/* Canvas */}
        <div className="flex-1 min-h-0 relative">
          <ReactFlow
            key={`reactflow-${isInteractive}`}
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange as never}
            onNodesDelete={handleNodesDelete as never}
            onEdgesChange={onEdgesChange as never}
            onEdgesDelete={onEdgesDelete as never}
            onConnect={onConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            onReconnect={onReconnect as any}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            onDragOver={onDragOver}
            onDrop={onDrop}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={defaultEdgeOptions}
            isValidConnection={isValidConnection}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            minZoom={0.1}
            maxZoom={2}
            defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
            attributionPosition="bottom-left"
            nodesDraggable={isInteractive}
            nodesConnectable={isInteractive}
            elementsSelectable={true}
            elevateEdgesOnSelect={false}
            elevateNodesOnSelect={false}
            connectionMode={ConnectionMode.Loose}
            reconnectRadius={10}
            selectNodesOnDrag={false}
            panOnDrag={true}
            zoomOnDoubleClick={false}
            autoPanOnNodeDrag={false}
            autoPanOnConnect={false}
            connectionLineStyle={{ strokeWidth: 3, stroke: 'var(--primary)' }}
            connectionLineType={ConnectionLineType.SmoothStep}
          >
            <Background gap={20} size={2} color="#9ca3af" className="!opacity-50 dark:!opacity-40" />

            <Panel position="bottom-center" className="mb-6">
              <div className="flex flex-col items-center gap-2 w-[min(600px,80vw)]">
                <QueryPreviewBar />
                <CanvasZoomControls
                  currentZoom={currentZoom}
                  isInteractive={isInteractive}
                  onToggleInteractive={() => setIsInteractive(!isInteractive)}
                  onAutoLayout={autoLayout}
                />
              </div>
            </Panel>

            {executeError && (
              <Panel position="top-center" className="max-w-md">
                <div className="bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-2">
                  <p className="text-sm text-destructive font-medium">{executeError}</p>
                </div>
              </Panel>
            )}

            {nodes.length === 1 && nodes[0]?.type === NodeType.START && (
              <Panel position="top-center" className="text-center pointer-events-none">
                <div className="bg-card/95 backdrop-blur-sm border border-border rounded-lg px-6 py-4 shadow-lg">
                  <h3 className="font-semibold text-base mb-1">Start Building Your Query</h3>
                  <p className="text-xs text-muted-foreground">
                    Drag from the Start node to add your first query component
                  </p>
                </div>
              </Panel>
            )}
          </ReactFlow>
        </div>

        <RightPanel />
      </div>
    </>
  )
}
