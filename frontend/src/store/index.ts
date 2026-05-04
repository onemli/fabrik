// store/index.ts
//
// Composes all query builder slices into the single useQueryBuilderStore hook.
// Each slice is a self-contained set of state + actions; they're merged here via
// Zustand's slice pattern (pass the set/get from this store into each factory).

import { create } from 'zustand'

import { createCanvasSlice } from './slices/canvasSlice'
import { createFlowSlice } from './slices/flowSlice'
import { createExecutionSlice } from './slices/executionSlice'
import { createConnectionSlice } from './slices/connectionSlice'
import { createTestModeSlice } from './slices/testModeSlice'

import type { CanvasSlice } from './slices/canvasSlice'
import type { FlowSlice } from './slices/flowSlice'
import type { ExecutionSlice } from './slices/executionSlice'
import type { ConnectionSlice } from './slices/connectionSlice'
import type { TestModeSlice } from './slices/testModeSlice'

export type { PanelState } from './slices/canvasSlice'

export type QueryBuilderState = CanvasSlice &
  FlowSlice &
  ExecutionSlice &
  ConnectionSlice &
  TestModeSlice

export const useQueryBuilderStore = create<QueryBuilderState>()((...args) => ({
  ...createCanvasSlice(...args),
  ...createFlowSlice(...args),
  ...createExecutionSlice(...args),
  ...createConnectionSlice(...args),
  ...createTestModeSlice(...args),
}))

// ---------------------------------------------------------------------------
// Granular hooks for performance-optimized selectors
// These prevent re-renders in components that only need a subset of state.
// ---------------------------------------------------------------------------

export const useFlowState = () =>
  useQueryBuilderStore((s) => ({
    nodes: s.nodes,
    edges: s.edges,
    selectedNode: s.selectedNode,
  }))

export const useExecutionState = () =>
  useQueryBuilderStore((s) => ({
    isExecuting: s.isExecuting,
    queryResult: s.queryResult,
    actualQueryPath: s.actualQueryPath,
  }))

export const useConnectionState = () =>
  useQueryBuilderStore((s) => ({
    selectedConnectionId: s.selectedConnectionId,
    selectedConnectionIds: s.selectedConnectionIds,
  }))

export const useCanvasState = () =>
  useQueryBuilderStore((s) => ({
    canvasMode: s.canvasMode,
    isInteractive: s.isInteractive,
    panelState: s.panelState,
  }))
