// useQueryExecution.ts
//
// Handles inline and background query execution, including variable substitution,
// Time Machine snapshot capture, and audit logging.

import { useState, useMemo } from 'react'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import { useAuthStore } from '@/store/authStore'
import { NodeType } from '@/types'
import { queriesService } from '@/services/queries'

import { addQueryHistoryEntry } from '@/lib/queryHistory'

export function useQueryExecution() {
  const {
    nodes,
    edges,
    executeQuery,
    selectedConnectionId,
    currentQueryName,
    setNodes,
  } = useQueryBuilderStore()

  const { user } = useAuthStore()

  const [executeError, setExecuteError] = useState<string>('')
  const [showLoginPrompt, setShowLoginPrompt] = useState(false)
  const [showVariableDialog, setShowVariableDialog] = useState(false)

  const hasVariables = useMemo(() => {
    return nodes.some((node) => {
      if (node.type === 'filterNode') {
        const filterData = node.data as any
        return !!(filterData._variable || filterData._variables)
      }
      return false
    })
  }, [nodes])

  const handleExecute = async () => {
    if (!user) {
      setShowLoginPrompt(true)
      return
    }

    if (!selectedConnectionId) {
      setExecuteError('Please select an APIC connection first')
      return
    }

    const outputNode = nodes.find(n => n.type === NodeType.OUTPUT)
    if (!outputNode) {
      setExecuteError('Please add an Output node to execute the query')
      return
    }

    const startTime = Date.now()
    let success = false
    let resultCount = 0
    let errorMessage = ''

    try {
      setExecuteError('')
      await executeQuery()
      success = true

      const state = useQueryBuilderStore.getState()
      if (state.queryResult && typeof state.queryResult === 'object') {
        if (Array.isArray(state.queryResult)) {
          resultCount = state.queryResult.length
        } else if ('imdata' in state.queryResult && Array.isArray(state.queryResult.imdata)) {
          resultCount = state.queryResult.imdata.length
        }
      }

      // Time Machine snapshot capture is handled inside executeQuery() (executionSlice.ts)
      // which correctly resolves the connection name via apicService.getConnections().
      // A second capture here would produce "Unknown" connection names and duplicate attempts.
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to execute query'
      setExecuteError(errorMessage)
      success = false
    } finally {
      const executionTime = Date.now() - startTime

      const state = useQueryBuilderStore.getState()
      addQueryHistoryEntry({
        name: currentQueryName,
        nodes,
        edges,
        query: state.generatedQuery,
        resultCount,
        executionTime,
        success,
      })

      // Audit log for saved queries only
      if (state.currentQueryId) {
        try {
          await queriesService.executeQuery(state.currentQueryId, {
            success,
            execution_time_ms: executionTime,
            result_count: resultCount,
            error_message: errorMessage || undefined,
            response_content: success ? state.queryResult : undefined,
          })
        } catch {
          /* ignore */
        }
      }
    }
  }

  const handleConfigureAndRun = () => {
    if (hasVariables) {
      setShowVariableDialog(true)
    } else {
      handleExecute()
    }
  }

  const handleVariableExecute = (variableValues: Record<string, any>) => {
    const updatedNodes = nodes.map((node) => {
      if (node.type === 'filterNode') {
        const filterData = node.data as any
        const newData = { ...filterData }

        if (filterData._variables && Object.keys(filterData._variables).length > 0) {
          Object.entries(filterData._variables).forEach(([varId]: [string, any]) => {
            const runtimeVarId = `${node.id}_${varId}`
            const userValue = variableValues[runtimeVarId]

            if (userValue !== undefined) {
              const varSyntax = `\${${varId}}`

              if (newData.value === varSyntax) {
                newData.value = userValue
              }

              if (newData.wildcardPatterns && Array.isArray(newData.wildcardPatterns)) {
                newData.wildcardPatterns = newData.wildcardPatterns.map((pattern: any) => {
                  if (pattern.pattern === varSyntax) {
                    return { ...pattern, pattern: userValue }
                  }
                  return pattern
                })
              }

              if (newData.queryTargetFilter && typeof newData.queryTargetFilter === 'string') {
                newData.queryTargetFilter = newData.queryTargetFilter.replaceAll(varSyntax, userValue)
              }
            }
          })
        }
        // Legacy single variable format — only when _variables doesn't exist
        else if (filterData._variable) {
          const varId = filterData._variable.id || 'value'
          const runtimeVarId = `${node.id}_${varId}`
          const userValue = variableValues[runtimeVarId]

          if (userValue !== undefined) {
            newData.value = userValue
          }
        }

        return { ...node, data: newData }
      }
      return node
    })

    setNodes(updatedNodes)

    // Ensure nodes are updated in store before execution fires
    setTimeout(() => {
      handleExecute()
    }, 100)
  }

  return {
    executeError,
    showLoginPrompt,
    setShowLoginPrompt,
    showVariableDialog,
    setShowVariableDialog,
    hasVariables,
    handleExecute,
    handleConfigureAndRun,
    handleVariableExecute,
  }
}
