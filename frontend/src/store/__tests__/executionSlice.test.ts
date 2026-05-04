// store/__tests__/executionSlice.test.ts
//
// Tests for the ExecutionSlice of the composed QueryBuilderStore:
// simple setters, clearCanvas, loadFromSaved, cancelExecution.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from '@testing-library/react'
import { useQueryBuilderStore } from '../index'

vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

function resetStore() {
  useQueryBuilderStore.setState({
    nodes: [
      {
        id: 'start-node',
        type: 'startNode',
        position: { x: 100, y: 250 },
        data: { id: 'start-node', label: 'Start' } as any,
      },
    ],
    edges: [],
    generatedQuery: null,
    actualQueryPath: null,
    queryResult: null,
    cachedQueryResult: null,
    hasViewedCurrentResult: false,
    isExecuting: false,
    currentQueryName: null,
    currentQueryId: null,
    currentQueryMetadata: null,
    executionAbortController: null,
    pipelineProgress: null,
    paginationMetadata: null,
    hasUnsavedChanges: false,
    hasQueryChanged: false,
    canvasMode: 'query-builder',
    isTestMode: false,
  })
}

describe('ExecutionSlice', () => {
  beforeEach(() => {
    resetStore()
  })

  // ─── Simple setters ───────────────────────────────────────────

  describe('setGeneratedQuery', () => {
    it('stores the query and clears hasQueryChanged', () => {
      useQueryBuilderStore.setState({ hasQueryChanged: true })

      const query = { url: '/api/class/fvTenant.json', method: 'GET', params: {} } as any

      act(() => {
        useQueryBuilderStore.getState().setGeneratedQuery(query)
      })

      expect(useQueryBuilderStore.getState().generatedQuery).toEqual(query)
      expect(useQueryBuilderStore.getState().hasQueryChanged).toBe(false)
    })

    it('clears query with null', () => {
      useQueryBuilderStore.setState({
        generatedQuery: { url: '/api/test', method: 'GET' } as any,
      })

      act(() => {
        useQueryBuilderStore.getState().setGeneratedQuery(null)
      })

      expect(useQueryBuilderStore.getState().generatedQuery).toBeNull()
    })
  })

  describe('setQueryResult', () => {
    it('stores result and resets hasViewedCurrentResult', () => {
      useQueryBuilderStore.setState({ hasViewedCurrentResult: true })

      act(() => {
        useQueryBuilderStore.getState().setQueryResult({ data: 'test' })
      })

      expect(useQueryBuilderStore.getState().queryResult).toEqual({ data: 'test' })
      expect(useQueryBuilderStore.getState().hasViewedCurrentResult).toBe(false)
    })
  })

  describe('setHasViewedCurrentResult', () => {
    it('sets the flag', () => {
      act(() => {
        useQueryBuilderStore.getState().setHasViewedCurrentResult(true)
      })

      expect(useQueryBuilderStore.getState().hasViewedCurrentResult).toBe(true)
    })
  })

  describe('setIsExecuting', () => {
    it('sets executing state', () => {
      act(() => {
        useQueryBuilderStore.getState().setIsExecuting(true)
      })

      expect(useQueryBuilderStore.getState().isExecuting).toBe(true)
    })
  })

  describe('setCurrentQueryName', () => {
    it('sets query name', () => {
      act(() => {
        useQueryBuilderStore.getState().setCurrentQueryName('Test Query')
      })

      expect(useQueryBuilderStore.getState().currentQueryName).toBe('Test Query')
    })
  })

  describe('setCurrentQueryId', () => {
    it('sets query id', () => {
      act(() => {
        useQueryBuilderStore.getState().setCurrentQueryId(42)
      })

      expect(useQueryBuilderStore.getState().currentQueryId).toBe(42)
    })
  })

  describe('setPaginationMetadata', () => {
    it('sets pagination data', () => {
      const meta = {
        currentPage: 0,
        pageSize: 50,
        totalCount: 200,
        totalPages: 4,
        hasNextPage: true,
        hasPreviousPage: false,
      }

      act(() => {
        useQueryBuilderStore.getState().setPaginationMetadata(meta)
      })

      expect(useQueryBuilderStore.getState().paginationMetadata).toEqual(meta)
    })
  })

  // ─── cancelExecution ──────────────────────────────────────────

  describe('cancelExecution', () => {
    it('aborts the controller and resets state', () => {
      const abortController = new AbortController()
      const abortSpy = vi.spyOn(abortController, 'abort')

      useQueryBuilderStore.setState({
        isExecuting: true,
        executionAbortController: abortController,
        pipelineProgress: { id: 1, status: 'running' } as any,
      })

      act(() => {
        useQueryBuilderStore.getState().cancelExecution()
      })

      expect(abortSpy).toHaveBeenCalled()
      expect(useQueryBuilderStore.getState().isExecuting).toBe(false)
      expect(useQueryBuilderStore.getState().executionAbortController).toBeNull()
      expect(useQueryBuilderStore.getState().pipelineProgress).toBeNull()
    })

    it('handles missing abort controller', () => {
      useQueryBuilderStore.setState({
        isExecuting: true,
        executionAbortController: null,
      })

      act(() => {
        useQueryBuilderStore.getState().cancelExecution()
      })

      expect(useQueryBuilderStore.getState().isExecuting).toBe(false)
    })
  })

  // ─── clearCanvas ──────────────────────────────────────────────

  describe('clearCanvas', () => {
    it('resets canvas to start node in query-builder mode', () => {
      useQueryBuilderStore.setState({
        canvasMode: 'query-builder',
        nodes: [
          { id: 'start-node', type: 'startNode', position: { x: 0, y: 0 }, data: {} as any },
          { id: 'node-1', type: 'classNode', position: { x: 100, y: 0 }, data: {} as any },
        ],
        edges: [{ id: 'e1', source: 'start-node', target: 'node-1' }],
        queryResult: { data: 'some result' },
        currentQueryName: 'Test',
        currentQueryId: 42,
        hasUnsavedChanges: true,
      })

      act(() => {
        useQueryBuilderStore.getState().clearCanvas()
      })

      const state = useQueryBuilderStore.getState()
      expect(state.nodes).toHaveLength(1)
      expect(state.nodes[0].id).toBe('start-node')
      expect(state.edges).toEqual([])
      expect(state.queryResult).toBeNull()
      expect(state.currentQueryName).toBeNull()
      expect(state.currentQueryId).toBeNull()
      expect(state.hasUnsavedChanges).toBe(false)
    })

    it('resets to empty in non query-builder mode', () => {
      useQueryBuilderStore.setState({
        canvasMode: 'object-explorer',
        nodes: [
          { id: 'node-1', type: 'classNode', position: { x: 0, y: 0 }, data: {} as any },
        ],
      })

      act(() => {
        useQueryBuilderStore.getState().clearCanvas()
      })

      expect(useQueryBuilderStore.getState().nodes).toEqual([])
    })
  })

  // ─── loadFromSaved ────────────────────────────────────────────

  describe('loadFromSaved', () => {
    it('loads nodes, edges, and metadata', () => {
      const savedNodes = [
        { id: 'start-node', type: 'startNode', position: { x: 0, y: 0 }, data: {} as any },
        { id: 'node-1', type: 'classNode', position: { x: 100, y: 0 }, data: { className: 'fvTenant' } as any },
      ]
      const savedEdges = [{ id: 'e1', source: 'start-node', target: 'node-1' }] as any

      act(() => {
        useQueryBuilderStore.getState().loadFromSaved(savedNodes, savedEdges, 'My Query', 99, { version: '1.0' })
      })

      const state = useQueryBuilderStore.getState()
      expect(state.nodes).toHaveLength(2)
      expect(state.edges).toHaveLength(1)
      expect(state.currentQueryName).toBe('My Query')
      expect(state.currentQueryId).toBe(99)
      expect(state.currentQueryMetadata).toEqual({ version: '1.0' })
      expect(state.hasUnsavedChanges).toBe(false)
    })

    it('clears previous execution state', () => {
      useQueryBuilderStore.setState({
        queryResult: { data: 'old' },
        generatedQuery: { url: '/old' } as any,
        actualQueryPath: '/old/path',
        hasViewedCurrentResult: true,
      })

      act(() => {
        useQueryBuilderStore.getState().loadFromSaved([], [])
      })

      const state = useQueryBuilderStore.getState()
      expect(state.queryResult).toBeNull()
      expect(state.generatedQuery).toBeNull()
      expect(state.actualQueryPath).toBeNull()
      expect(state.hasViewedCurrentResult).toBe(false)
    })

    it('handles missing optional parameters', () => {
      act(() => {
        useQueryBuilderStore.getState().loadFromSaved([], [])
      })

      expect(useQueryBuilderStore.getState().currentQueryName).toBeNull()
      expect(useQueryBuilderStore.getState().currentQueryId).toBeNull()
      expect(useQueryBuilderStore.getState().currentQueryMetadata).toBeNull()
    })
  })
})
