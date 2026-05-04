// store/slices/testModeSlice.ts
//
// Test mode lets users run queries with mock data instead of hitting a live APIC.
// Useful for building and testing post-processor pipelines without network access.

import { StateCreator } from 'zustand'
import type { APICQuery } from '@/types'
import type { QueryBuilderState } from '../index'

export interface TestModeSlice {
  // State
  cachedQueryResult: {
    data: unknown
    timestamp: number
    query: APICQuery
  } | null
  isTestMode: boolean
  previewResult: any | null
  isPreviewMode: boolean
  previewNodeId: string | null

  // Actions
  setCachedQueryResult: (
    result: { data: unknown; timestamp: number; query: APICQuery } | null
  ) => void
  setIsTestMode: (isTestMode: boolean) => void
  setPreviewResult: (result: any) => void
  setIsPreviewMode: (isPreview: boolean) => void
  setPreviewNodeId: (nodeId: string | null) => void
}

type TestModeSliceCreator = StateCreator<QueryBuilderState, [], [], TestModeSlice>

export const createTestModeSlice: TestModeSliceCreator = (set, _get) => ({
  // State
  cachedQueryResult: null,
  isTestMode: false,
  previewResult: null,
  isPreviewMode: false,
  previewNodeId: null,

  // Actions
  setCachedQueryResult: (result) => set({ cachedQueryResult: result }),
  setIsTestMode: (isTestMode) => set({ isTestMode }),
  setPreviewResult: (result) => set({ previewResult: result }),
  setIsPreviewMode: (isPreview) => set({ isPreviewMode: isPreview }),
  setPreviewNodeId: (nodeId) => set({ previewNodeId: nodeId }),
})
