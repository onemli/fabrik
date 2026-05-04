// store/slices/executionSlice.ts
//
// Query execution state: runs the APIC query from the current canvas and stores
// the result. Handles inline (synchronous) execution, background (Celery) execution,
// AbortController-based cancellation, and Time Machine snapshot capture.

import { StateCreator } from 'zustand'
import type { Node, Edge } from '@xyflow/react'
import type { QueryNodeData, APICQuery } from '@/types'
import type { PipelineExecution } from '@/types/query'
import { NodeType } from '@/types'
import { toast } from '@/lib/toast'
import { createStartNode } from './_helpers'
import type { QueryBuilderState } from '../index'

export interface ExecutionSlice {
  // State
  generatedQuery: APICQuery | null
  actualQueryPath: string | null
  queryResult: unknown | null
  cachedQueryResult: { data: any; timestamp: number; query: any } | null
  hasViewedCurrentResult: boolean
  isExecuting: boolean
  currentQueryName: string | null
  currentQueryId: number | null
  currentQueryMetadata: any | null
  executionAbortController: AbortController | null
  pipelineProgress: PipelineExecution | null
  paginationMetadata: {
    currentPage: number
    pageSize: number
    totalCount: number
    totalPages: number
    hasNextPage: boolean
    hasPreviousPage: boolean
  } | null

  // Actions
  setGeneratedQuery: (query: APICQuery | null) => void
  setQueryResult: (result: unknown | null) => void
  setHasViewedCurrentResult: (hasViewed: boolean) => void
  setIsExecuting: (isExecuting: boolean) => void
  setCurrentQueryName: (name: string | null) => void
  setCurrentQueryId: (id: number | null) => void
  setCurrentQueryMetadata: (metadata: any | null) => void
  setPaginationMetadata: (metadata: ExecutionSlice['paginationMetadata']) => void
  cancelExecution: () => void
  executeQueryPage: (page: number) => Promise<void>
  executeQuery: () => Promise<void>
  testPostProcessors: () => Promise<void>
  clearCanvas: () => void
  loadFromSaved: (
    nodes: Node<QueryNodeData>[],
    edges: Edge[],
    queryName?: string,
    queryId?: number,
    metadata?: any
  ) => void
}

type ExecutionSliceCreator = StateCreator<QueryBuilderState, [], [], ExecutionSlice>

export const createExecutionSlice: ExecutionSliceCreator = (set, get) => ({
  // State
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

  // Simple setters
  setGeneratedQuery: (query) => set({ generatedQuery: query, hasQueryChanged: false }),
  setQueryResult: (result) => set({ queryResult: result, hasViewedCurrentResult: false }),
  setHasViewedCurrentResult: (hasViewed) => set({ hasViewedCurrentResult: hasViewed }),
  setIsExecuting: (isExecuting) => set({ isExecuting }),
  setCurrentQueryName: (name) => set({ currentQueryName: name }),
  setCurrentQueryId: (id) => set({ currentQueryId: id }),
  setCurrentQueryMetadata: (metadata) => set({ currentQueryMetadata: metadata }),
  setPaginationMetadata: (metadata) => set({ paginationMetadata: metadata }),

  cancelExecution: () => {
    const { executionAbortController } = get()
    if (executionAbortController) {
      executionAbortController.abort()
    }
    set({ isExecuting: false, executionAbortController: null, pipelineProgress: null })
    toast.info('Query cancelled')
  },

  executeQueryPage: async (page: number) => {
    const { nodes, selectedConnectionId, actualQueryPath } = get()

    if (!selectedConnectionId) {
      throw new Error('No APIC connection selected')
    }

    const outputNode = nodes.find((n) => n.type === NodeType.OUTPUT)
    if (!outputNode?.data?.enablePagination) {
      return
    }

    const pageSize = (outputNode.data as any).pageSize || 50

    get().updateNode(outputNode.id, { currentPage: page })

    set({ isExecuting: true })

    try {
      const { apicService } = await import('@/services/apic')
      const { generateAPICQuery } = await import('@/lib/queryGenerator')
      const { PostProcessorEngine } = await import('@/lib/postProcessorEngine')

      let queryPath: string
      if (actualQueryPath) {
        queryPath = actualQueryPath.replace(/[?&](page|page-size)=[^&]*/g, '')
      } else {
        const { edges } = get()
        const query = generateAPICQuery(nodes, edges)
        if (!query) {
          throw new Error('Failed to generate query')
        }
        const params = new URLSearchParams(query.params).toString()
        queryPath = params
          ? `${query.url}${query.url.includes('?') ? '&' : '?'}${params}`
          : query.url
      }

      const separator = queryPath.includes('?') ? '&' : '?'
      queryPath = `${queryPath}${separator}page=${page}&page-size=${pageSize}`
      const { edges } = get()
      const query = generateAPICQuery(nodes, edges)

      const response = await apicService.executeQuery({
        connection_id: selectedConnectionId,
        query_path: queryPath,
        method: query?.method || 'GET',
      })

      const result = response.data

      const totalCount = parseInt(result?.totalCount || '0', 10)
      const totalPages = Math.ceil(totalCount / pageSize)

      const paginationMetadata = {
        currentPage: page,
        pageSize,
        totalCount,
        totalPages,
        hasNextPage: page < totalPages - 1,
        hasPreviousPage: page > 0,
      }

      let processedResult = result
      if (query?.postProcessors && query.postProcessors.length > 0) {
        processedResult = PostProcessorEngine.execute(result, query.postProcessors)
      }

      set({
        queryResult: processedResult,
        paginationMetadata,
        hasViewedCurrentResult: false,
        isExecuting: false,
      })
    } catch (error) {
      set({
        isExecuting: false,
        queryResult: null,
        cachedQueryResult: null,
        paginationMetadata: null,
      })
      throw error
    }
  },

  clearCanvas: () => {
    const { canvasMode } = get()
    set({
      nodes: canvasMode === 'query-builder' ? [createStartNode()] : [],
      edges: [],
      selectedNode: null,
      generatedQuery: null,
      actualQueryPath: null,
      queryResult: null,
      cachedQueryResult: null,
      hasViewedCurrentResult: false,
      currentQueryName: null,
      currentQueryId: null,
      currentQueryMetadata: null,
      pipelineProgress: null,
      hasUnsavedChanges: false,
    })
  },

  loadFromSaved: (nodes, edges, queryName, queryId, metadata) =>
    set({
      nodes,
      edges,
      selectedNode: null,
      generatedQuery: null,
      actualQueryPath: null,
      queryResult: null,
      hasViewedCurrentResult: false,
      currentQueryName: queryName || null,
      currentQueryId: queryId || null,
      currentQueryMetadata: metadata || null,
      hasUnsavedChanges: false,
    }),

  executeQuery: async () => {
    const { nodes, edges, selectedConnectionId } = get()

    if (!selectedConnectionId) {
      throw new Error('Please select an APIC connection first')
    }

    // Check if canvas contains pipeline edges — route to pipeline execution
    const hasPipelineEdges = edges.some((e) => e.data?.edgeType === 'pipeline')
    if (hasPipelineEdges) {
      set({
        isExecuting: true,
        isTestMode: false,
        pipelineProgress: null,
        queryResult: null,
      })

      // Switch to results view so the user sees live progress
      get().setCanvasMode('object-explorer')

      try {
        const { pipelineService } = await import('@/services/pipeline')
        const { currentQueryName, currentQueryId } = get()

        const pipeline = await pipelineService.executePipeline(
          { nodes, edges },
          selectedConnectionId,
          currentQueryName || 'Pipeline Query',
          currentQueryId || undefined,
        )

        // Seed the progress state so the UI has stage definitions immediately
        set({ pipelineProgress: pipeline })

        // Poll until terminal state or user cancels
        let status = pipeline
        const maxPolls = 120
        for (let i = 0; i < maxPolls; i++) {
          if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
            break
          }
          if (!get().isExecuting) break

          await new Promise((resolve) => setTimeout(resolve, 1000))
          status = await pipelineService.getPipelineStatus(pipeline.id)
          set({ pipelineProgress: status })
        }

        if (status.status === 'completed' && status.aggregated_results?.final_result) {
          // Fetch full stage details for the results view
          const stages = await pipelineService.getPipelineStages(pipeline.id)
          set({
            queryResult: status.aggregated_results.final_result,
            hasViewedCurrentResult: false,
            isExecuting: false,
            pipelineProgress: null,
            currentQueryMetadata: {
              pipeline: true,
              stages,
              total_stages: status.total_stages,
              execution_time_ms: status.execution_time_ms,
            },
          })
          toast.success(`Pipeline completed: ${status.completed_stages} stages`)
        } else if (status.status === 'failed') {
          const stages = await pipelineService.getPipelineStages(pipeline.id)
          const failedStage = stages.find((s) => s.status === 'failed')
          const lastSuccess = stages.filter((s) => s.status === 'success').pop()

          set({
            queryResult: lastSuccess?.result || null,
            hasViewedCurrentResult: false,
            isExecuting: false,
            pipelineProgress: null,
            currentQueryMetadata: {
              pipeline: true,
              stages,
              total_stages: status.total_stages,
              pipeline_error: failedStage?.error_message,
            },
          })
          toast.error(`Pipeline failed at stage ${(failedStage?.stage_index ?? 0) + 1}: ${failedStage?.error_message}`)
        } else {
          set({ isExecuting: false, pipelineProgress: null })
          toast.warning('Pipeline timed out — check execution history')
        }
        return
      } catch (error: any) {
        set({ isExecuting: false, pipelineProgress: null })
        toast.error(error, 'pipeline')
        throw error
      }
    }

    const outputNode = nodes.find((n) => n.type === NodeType.OUTPUT)
    const enablePagination = (outputNode?.data as any)?.enablePagination || false
    const pageSize = (outputNode?.data as any)?.pageSize || 50

    const abortController = new AbortController()
    set({ isExecuting: true, isTestMode: false, executionAbortController: abortController })

    try {
      const { generateAPICQuery } = await import('@/lib/queryGenerator')
      const { apicService } = await import('@/services/apic')
      const { PostProcessorEngine } = await import('@/lib/postProcessorEngine')
      const { queriesService } = await import('@/services/queries')

      const query = generateAPICQuery(nodes, edges)
      if (!query) {
        throw new Error('Failed to generate query')
      }

      set({ generatedQuery: query })

      let queryPath: string

      try {
        const backendQuery = await queriesService.generateQueryPath({ nodes, edges })

        if (backendQuery.success && backendQuery.preview_query) {
          queryPath = backendQuery.preview_query
          set({
            actualQueryPath: queryPath,
            currentQueryMetadata: backendQuery.metadata,
          })
        } else {
          const params = new URLSearchParams(query.params).toString()
          queryPath = params
            ? `${query.url}${query.url.includes('?') ? '&' : '?'}${params}`
            : query.url
          set({ actualQueryPath: queryPath })
        }
      } catch (backendError) {
        const params = new URLSearchParams(query.params).toString()
        queryPath = params
          ? `${query.url}${query.url.includes('?') ? '&' : '?'}${params}`
          : query.url
        set({ actualQueryPath: queryPath })
      }

      if (enablePagination) {
        const separator = queryPath.includes('?') ? '&' : '?'
        queryPath = `${queryPath}${separator}page=0&page-size=${pageSize}`
        set({ actualQueryPath: queryPath })
      }

      const response = await apicService.executeQuery(
        {
          connection_id: selectedConnectionId,
          query_path: queryPath,
          method: query.method,
        },
        abortController.signal
      )

      const result = response.data

      let processedResult = result
      if (query.postProcessors && query.postProcessors.length > 0) {
        processedResult = PostProcessorEngine.execute(result, query.postProcessors)
      }

      let paginationMetadata = null
      if (enablePagination) {
        const totalCount = parseInt(result?.totalCount || '0', 10)
        const totalPages = Math.ceil(totalCount / pageSize)

        paginationMetadata = {
          currentPage: 0,
          pageSize,
          totalCount,
          totalPages,
          hasNextPage: totalPages > 1,
          hasPreviousPage: false,
        }
      }

      set({
        cachedQueryResult: {
          data: result,
          timestamp: Date.now(),
          query,
        },
        queryResult: processedResult,
        hasViewedCurrentResult: false,
        isExecuting: false,
        executionAbortController: null,
        paginationMetadata,
      })

      // Capture Time Machine snapshot if enabled
      const { currentQueryId } = get()
      if (currentQueryId) {
        try {
          const { timeMachineService } = await import('@/services/timeMachine')
          const { queriesService: qs } = await import('@/services/queries')

          const savedQuery = await qs.getSavedQuery(currentQueryId)

          if (savedQuery.enable_time_machine) {
            const connections = await apicService.getConnections()
            const connection = connections.find((c) => c.id === selectedConnectionId)
            const connectionName = connection?.name || 'Unknown Connection'

            const classNode = nodes.find((n) => n.type === 'class')
            const className = (classNode?.data as any)?.className || null

            const tmResult = await timeMachineService.captureSnapshot({
              result_data: result,  // raw APIC JSON, not processedResult
              apic_connection_id: selectedConnectionId,
              apic_connection_name: connectionName,
              saved_query_id: currentQueryId,
              query_name: savedQuery.name,
              class_name: className,
              query_structure: { nodes, edges },
              execution_time_ms: (response as any).execution_time_ms || null,
            })

            if (tmResult.skipped) {
              toast.info('Snapshot skipped — identical to previous')
            } else if (!tmResult.success && tmResult.error === 'snapshot_too_large') {
              toast.warning('Snapshot not saved — result too large')
            } else if (tmResult.success) {
              toast.success('Time Machine snapshot saved')
            }

          }
        } catch {
          /* ignore */
        }
      }

      toast.success('Query executed successfully')
    } catch (error: any) {
      if (error.name === 'AbortError') {
        // User cancelled — already handled by cancelExecution
        return
      }
      toast.error(error, 'query')
      set({
        isExecuting: false,
        executionAbortController: null,
        queryResult: null,
      })
      throw error
    }
  },

  testPostProcessors: async () => {
    const { cachedQueryResult, nodes, edges } = get()

    if (!cachedQueryResult) {
      throw new Error('No cached data available. Please execute the query first.')
    }

    try {
      set({ isExecuting: true, isTestMode: true })

      const { PostProcessorEngine } = await import('@/lib/postProcessorEngine')
      const { generateAPICQuery } = await import('@/lib/queryGenerator')

      const query = generateAPICQuery(nodes, edges)
      if (!query) {
        throw new Error('Failed to generate query')
      }

      let result = cachedQueryResult.data
      if (query.postProcessors && query.postProcessors.length > 0) {
        result = PostProcessorEngine.execute(cachedQueryResult.data, query.postProcessors)
      }

      set({
        queryResult: result,
        isExecuting: false,
        generatedQuery: query,
      })
    } catch (error) {
      set({
        isExecuting: false,
        queryResult: null,
        isTestMode: false,
      })
      throw error
    }
  },
})
