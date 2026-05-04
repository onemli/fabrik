// CanvasDialogs.tsx
//
// All modal/dialog renderings for the query builder canvas, grouped here
// to keep the main canvas component focused on layout and flow logic.

import { NodeType } from '@/types'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { SaveQueryDialog } from '@/components/SaveQueryDialog'
import { NodeSelectionMenu } from '@/components/NodeSelectionMenu'
import { ClassBrowserDialog } from '@/components/ClassBrowserDialog'
import { SavedQueriesDialog } from '@/components/SavedQueriesDialog'
import { QueryHistoryDialog } from '@/components/QueryHistoryDialog'
import { RuntimeVariableDialog } from '@/components/RuntimeVariableDialog'
import { PreviewResultsModal } from '@/components/PreviewResultsModal'

interface CanvasDialogsProps {
  // Clear canvas
  showClearConfirm: boolean
  onCloseClearConfirm: () => void
  onConfirmClear: () => void
  nodesCount: number

  // Delete node
  showDeleteConfirm: boolean
  onCloseDeleteConfirm: () => void
  onConfirmDeleteNode: () => void
  nodeToDeleteData: { data?: { label?: string }; type?: string } | null

  // Delete edge
  showDeleteEdgeConfirm: boolean
  onCloseDeleteEdgeConfirm: () => void
  onConfirmDeleteEdge: () => void

  // Login prompt
  showLoginPrompt: boolean
  onCloseLoginPrompt: () => void

  // Save query dialog
  showSaveQueryDialog: boolean
  onCloseSaveQueryDialog: () => void
  onSave: (data: any) => void
  flowData: { nodes: any[]; edges: any[] }
  generatedQueryForSave: string

  // Node selection menu
  addNodeMenuOpen: boolean
  addNodeMenuPosition: { x: number; y: number }
  sourceNodeType: string | null
  sourceNodeId: string | null
  onNodeTypeSelect: (nodeType: NodeType, data?: { className?: string; classInfo?: unknown }) => void
  onCloseAddNodeMenu: () => void
  onRequestClassBrowser: (opts: { isChildClass: boolean }) => void

  // Class browser
  classBrowserOpen: boolean
  onClassBrowserOpenChange: (open: boolean) => void
  classBrowserParent: string | null
  onClassBrowserSelect: (className: string, classInfo?: unknown) => void

  // Saved queries
  showSavedQueriesDialog: boolean
  onSavedQueriesDialogChange: (open: boolean) => void

  // History
  showHistoryDialog: boolean
  onHistoryDialogChange: (open: boolean) => void

  // Variable dialog
  showVariableDialog: boolean
  onVariableDialogChange: (open: boolean) => void
  nodes: any[]
  onVariableExecute: (variableValues: Record<string, any>) => void

  // Preview results
  isPreviewMode: boolean
  previewResult: { results?: any[]; count?: number; query?: string } | null
  previewNodeId: string | null
  onClosePreview: () => void
}

export function CanvasDialogs({
  showClearConfirm,
  onCloseClearConfirm,
  onConfirmClear,
  nodesCount,
  showDeleteConfirm,
  onCloseDeleteConfirm,
  onConfirmDeleteNode,
  nodeToDeleteData,
  showDeleteEdgeConfirm,
  onCloseDeleteEdgeConfirm,
  onConfirmDeleteEdge,
  showLoginPrompt,
  onCloseLoginPrompt,
  showSaveQueryDialog,
  onCloseSaveQueryDialog,
  onSave,
  flowData,
  generatedQueryForSave,
  addNodeMenuOpen,
  addNodeMenuPosition,
  sourceNodeType,
  sourceNodeId,
  onNodeTypeSelect,
  onCloseAddNodeMenu,
  onRequestClassBrowser,
  classBrowserOpen,
  onClassBrowserOpenChange,
  classBrowserParent,
  onClassBrowserSelect,
  showSavedQueriesDialog,
  onSavedQueriesDialogChange,
  showHistoryDialog,
  onHistoryDialogChange,
  showVariableDialog,
  onVariableDialogChange,
  nodes,
  onVariableExecute,
  isPreviewMode,
  previewResult,
  previewNodeId,
  onClosePreview,
}: CanvasDialogsProps) {
  return (
    <>
      <ConfirmDialog
        isOpen={showClearConfirm}
        onClose={onCloseClearConfirm}
        onConfirm={onConfirmClear}
        title="Clear Canvas"
        message={`Are you sure you want to clear the canvas? This will remove all ${nodesCount} node(s) and cannot be undone.`}
        confirmText="Clear All"
        variant="danger"
      />

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={onCloseDeleteConfirm}
        onConfirm={onConfirmDeleteNode}
        title="Delete Node"
        message={`Are you sure you want to delete "${nodeToDeleteData?.data?.label || 'this node'}"? ${
          nodeToDeleteData?.type === NodeType.CLASS
            ? 'All connected nodes will also be removed.'
            : 'This action cannot be undone.'
        }`}
        confirmText="Delete"
        variant="danger"
      />

      <ConfirmDialog
        isOpen={showDeleteEdgeConfirm}
        onClose={onCloseDeleteEdgeConfirm}
        onConfirm={onConfirmDeleteEdge}
        title="Delete Connection"
        message="Are you sure you want to delete this connection? This action cannot be undone."
        confirmText="Delete"
        variant="danger"
      />

      <ConfirmDialog
        isOpen={showLoginPrompt}
        onClose={onCloseLoginPrompt}
        onConfirm={() => window.location.href = '/login'}
        title="Login Required"
        message="You need to be logged in to execute queries. Would you like to go to the login page?"
        confirmText="Go to Login"
        variant="info"
      />

      <SaveQueryDialog
        isOpen={showSaveQueryDialog}
        onClose={onCloseSaveQueryDialog}
        onSave={onSave}
        flowData={flowData}
        generatedQuery={generatedQueryForSave}
      />

      <NodeSelectionMenu
        isOpen={addNodeMenuOpen}
        position={addNodeMenuPosition}
        sourceNodeType={sourceNodeType}
        sourceNodeId={sourceNodeId}
        onSelect={onNodeTypeSelect}
        onClose={onCloseAddNodeMenu}
        onRequestClassBrowser={onRequestClassBrowser}
      />

      <ClassBrowserDialog
        open={classBrowserOpen}
        onOpenChange={onClassBrowserOpenChange}
        parentClass={classBrowserParent}
        onSelect={onClassBrowserSelect}
      />

      <SavedQueriesDialog
        open={showSavedQueriesDialog}
        onOpenChange={onSavedQueriesDialogChange}
      />

      <QueryHistoryDialog
        open={showHistoryDialog}
        onOpenChange={onHistoryDialogChange}
      />

      <RuntimeVariableDialog
        open={showVariableDialog}
        onOpenChange={onVariableDialogChange}
        nodes={nodes}
        onExecute={onVariableExecute}
      />

      {isPreviewMode && previewResult && (
        <PreviewResultsModal
          isOpen={isPreviewMode}
          onClose={onClosePreview}
          results={previewResult.results || []}
          count={previewResult.count || 0}
          nodeName={nodes.find((n: any) => n.id === previewNodeId)?.data?.className || 'Unknown'}
          query={previewResult.query || ''}
        />
      )}
    </>
  )
}
