// store/slices/canvasSlice.ts
//
// Canvas-level UI state: current mode (edit/view/readonly), dirty flag for
// unsaved changes, and the pan/zoom viewport position. Not the React Flow
// node/edge data — that lives in flowSlice.

import { StateCreator } from 'zustand'
import { toast as sonnerToast } from 'sonner'
import type { CanvasMode } from '@/types'
import type { QueryBuilderState } from '../index'

export interface PanelState {
  isOpen: boolean
  isPinned: boolean
  width: number
  selectedNodeId: string | null
  selectedEdgeId: string | null
}

export interface AddNodeMenuState {
  open: boolean
  position: { x: number; y: number }
  source: { nodeId: string; nodeType: string } | null
}

export interface CanvasSlice {
  // State
  canvasMode: CanvasMode
  hasUnsavedChanges: boolean
  hasQueryChanged: boolean
  isInteractive: boolean
  isSidebarPinned: boolean
  isSidebarHovered: boolean
  isLogoAnimationsEnabled: boolean
  panelState: PanelState
  addNodeMenu: AddNodeMenuState

  // Actions
  setCanvasMode: (mode: CanvasMode) => void
  openAddNodeMenu: (source: { nodeId: string; nodeType: string }, position: { x: number; y: number }) => void
  closeAddNodeMenu: () => void
  setHasUnsavedChanges: (hasChanges: boolean) => void
  setHasQueryChanged: (hasChanged: boolean) => void
  setIsInteractive: (isInteractive: boolean) => void
  setIsSidebarPinned: (isPinned: boolean) => void
  setIsSidebarHovered: (isHovered: boolean) => void
  showLogoNotification: (notification: {
    message: string
    type: 'error' | 'success' | 'info' | 'loading'
    statusCode?: number
    duration?: number
  }) => void
  setIsLogoAnimationsEnabled: (enabled: boolean) => void
  setPanelOpen: (isOpen: boolean) => void
  setPanelPinned: (isPinned: boolean) => void
  setPanelWidth: (width: number) => void
  setPanelSelectedNode: (nodeId: string | null) => void
  setPanelSelectedEdge: (edgeId: string | null) => void
  togglePanel: () => void
}

type CanvasSliceCreator = StateCreator<QueryBuilderState, [], [], CanvasSlice>

export const createCanvasSlice: CanvasSliceCreator = (set, _get) => ({
  // State
  canvasMode: 'query-builder',
  hasUnsavedChanges: false,
  hasQueryChanged: false,
  isInteractive: true,
  isSidebarPinned: false,
  isSidebarHovered: false,

  isLogoAnimationsEnabled: (() => {
    try {
      const saved = localStorage.getItem('isLogoAnimationsEnabled')
      return saved ? JSON.parse(saved) : true
    } catch {
      return true
    }
  })(),

  panelState: {
    isOpen: false,
    isPinned: false,
    width: 360,
    selectedNodeId: null,
    selectedEdgeId: null,
  },

  addNodeMenu: {
    open: false,
    position: { x: 0, y: 0 },
    source: null,
  },

  // Actions
  setCanvasMode: (mode) => set({ canvasMode: mode }),

  openAddNodeMenu: (source, position) =>
    set({ addNodeMenu: { open: true, position, source } }),

  closeAddNodeMenu: () =>
    set({ addNodeMenu: { open: false, position: { x: 0, y: 0 }, source: null } }),
  setHasUnsavedChanges: (hasChanges) => set({ hasUnsavedChanges: hasChanges }),
  setHasQueryChanged: (hasChanged) => set({ hasQueryChanged: hasChanged }),

  setIsInteractive: (isInteractive) => {
    set({ isInteractive })
    if (!isInteractive) {
      set({ selectedNode: null })
    }
  },

  setIsSidebarPinned: (isPinned) => set({ isSidebarPinned: isPinned }),
  setIsSidebarHovered: (isHovered) => set({ isSidebarHovered: isHovered }),

  showLogoNotification: (notification) => {
    const message = notification.statusCode
      ? `${notification.message} (${notification.statusCode})`
      : notification.message

    const duration = notification.duration || 3000

    switch (notification.type) {
      case 'error':
        sonnerToast.error(message, { duration })
        break
      case 'success':
        sonnerToast.success(message, { duration })
        break
      case 'info':
        sonnerToast.info(message, { duration })
        break
      case 'loading':
        sonnerToast.loading(message, { duration })
        break
    }
  },

  setIsLogoAnimationsEnabled: (enabled) => {
    set({ isLogoAnimationsEnabled: enabled })
    localStorage.setItem('isLogoAnimationsEnabled', JSON.stringify(enabled))
  },

  setPanelOpen: (isOpen) => {
    set((state) => ({
      panelState: { ...state.panelState, isOpen },
    }))
  },

  setPanelPinned: (isPinned) => {
    set((state) => ({
      panelState: { ...state.panelState, isPinned },
    }))
  },

  setPanelWidth: (width) => {
    set((state) => ({
      panelState: { ...state.panelState, width },
    }))
  },

  setPanelSelectedNode: (nodeId) => {
    set((state) => ({
      panelState: {
        ...state.panelState,
        selectedNodeId: nodeId,
        selectedEdgeId: null,
        isOpen: nodeId !== null,
      },
      selectedNode: nodeId ? state.nodes.find((n) => n.id === nodeId) || null : null,
    }))
  },

  setPanelSelectedEdge: (edgeId) => {
    set((state) => ({
      panelState: {
        ...state.panelState,
        selectedEdgeId: edgeId,
        selectedNodeId: null,
        isOpen: edgeId !== null,
      },
      selectedNode: null,
    }))
  },

  togglePanel: () => {
    set((state) => ({
      panelState: {
        ...state.panelState,
        isOpen: !state.panelState.isOpen,
      },
    }))
  },
})
