// useQuerySave.ts
//
// Handles save/update flow for queries, including backend query path generation
// with frontend fallback, and the TanStack Query mutation lifecycle.

import { useState } from 'react'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import { useAuthStore } from '@/store/authStore'
import { NodeType } from '@/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queriesService } from '@/services/queries'
import { generateAPICQuery } from '@/lib/queryGenerator'

export function useQuerySave() {
  const { nodes, edges } = useQueryBuilderStore()
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  const [showSaveQueryDialog, setShowSaveQueryDialog] = useState(false)
  const [generatedQueryForSave, setGeneratedQueryForSave] = useState<string>('')
  // Shared with useQueryExecution — caller can wire setShowLoginPrompt from there
  const [showLoginPromptForSave, setShowLoginPromptForSave] = useState(false)

  const handleSaveClick = async () => {
    if (!user) {
      setShowLoginPromptForSave(true)
      return
    }

    // Prefer backend generation for multi-class chain accuracy
    try {
      const response = await queriesService.generateQueryPath({
        nodes,
        edges
      })

      if (response?.success && response?.preview_query) {
        setGeneratedQueryForSave(response.preview_query)
        setShowSaveQueryDialog(true)
      } else {
        const query = generateAPICQuery(nodes, edges)
        if (query) {
          const params = new URLSearchParams(query.params).toString()
          const queryPath = params ? `${query.url}${query.url.includes('?') ? '&' : '?'}${params}` : query.url
          setGeneratedQueryForSave(queryPath)
          setShowSaveQueryDialog(true)
        }
      }
    } catch {
      try {
        const query = generateAPICQuery(nodes, edges)
        if (query) {
          const params = new URLSearchParams(query.params).toString()
          const queryPath = params ? `${query.url}${query.url.includes('?') ? '&' : '?'}${params}` : query.url
          setGeneratedQueryForSave(queryPath)
          setShowSaveQueryDialog(true)
        }
      } catch {
        /* ignore */
      }
    }
  }

  const saveMutation = useMutation({
    mutationFn: (data: any) => {
      // Read current state at call time to avoid stale closure values.
      const { currentQueryId, nodes: currentNodes, edges: currentEdges } = useQueryBuilderStore.getState()

      const outputNode = currentNodes.find(n => n.type === NodeType.OUTPUT)
      const enableTimeMachine = (outputNode && 'enableTimeMachine' in outputNode.data) ? outputNode.data.enableTimeMachine || false : false

      const payload = {
        ...data,
        flow_data: { nodes: currentNodes, edges: currentEdges },
        generated_query: generatedQueryForSave,
        enable_time_machine: enableTimeMachine,
      }

      if (currentQueryId) {
        return queriesService.updateSavedQuery(currentQueryId, payload)
      } else {
        return queriesService.createSavedQuery(payload)
      }
    },
    onSuccess: (result: any) => {
      const { currentQueryId, showLogoNotification, setCurrentQueryId, setCurrentQueryMetadata } = useQueryBuilderStore.getState()
      const isUpdate = !!currentQueryId

      queryClient.invalidateQueries({ queryKey: ['saved-queries'] })
      setShowSaveQueryDialog(false)

      if (result?.id) {
        if (!isUpdate) setCurrentQueryId(result.id)
        setCurrentQueryMetadata({
          name: result.name,
          description: result.description,
          category: result.category,
          tags: result.tags_list?.join(','),
          is_public: result.is_public,
          is_template: result.is_template,
        })
      }

      showLogoNotification({
        message: isUpdate ? 'Query updated successfully' : 'Query saved successfully',
        type: 'success',
        duration: 2500,
      })
    },
    onError: (error: any) => {
      const { showLogoNotification } = useQueryBuilderStore.getState()
      const message = error?.response?.data?.detail || error?.response?.data?.error || 'Failed to save query'
      showLogoNotification({
        message,
        type: 'error',
        duration: 3000,
      })
    },
  })

  return {
    showSaveQueryDialog,
    setShowSaveQueryDialog,
    showLoginPromptForSave,
    setShowLoginPromptForSave,
    generatedQueryForSave,
    handleSaveClick,
    saveMutation,
  }
}
