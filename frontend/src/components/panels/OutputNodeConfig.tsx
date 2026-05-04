// panels/OutputNodeConfig.tsx
//
// Side-panel configuration for the OutputNode — the terminal node in every
// query graph. Controls Time Machine enable/disable, pagination limits, and
// the display format (table / JSON / chart) for the results panel.

import { useState } from 'react'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import { OutputNodeData } from '@/types'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Clock, Table2, AlertCircle, Save, CheckCircle, FileStack, Info, ShieldCheck } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { queriesService } from '@/services/queries'
import { useMutation, useQueryClient } from '@tanstack/react-query'

interface OutputNodeConfigProps {
  nodeId: string
  data: OutputNodeData
}

export function OutputNodeConfig({ nodeId, data }: OutputNodeConfigProps) {
  const { updateNode, currentQueryId, queryResult, nodes, edges, showLogoNotification } = useQueryBuilderStore()
  const queryClient = useQueryClient()

  const isQuerySaved = !!currentQueryId
  const canEnableTimeMachine = isQuerySaved

  // Check if query has post-processor nodes
  const hasPostProcessors = nodes.some(n => n.type === 'postProcessorNode')

  // Mutation to update query in backend
  const updateQueryMutation = useMutation({
    mutationFn: async () => {
      if (!currentQueryId) throw new Error('No query to update')

      // enable_time_machine is saved immediately by the toggle (handleTimeMachineToggle).
      // Do not re-send it here — the node closure may hold a stale value and would overwrite
      // the already-committed toggle state with the wrong boolean.
      return queriesService.updateSavedQuery(currentQueryId, {
        flow_data: { nodes, edges },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-queries'] })
      showLogoNotification({
        message: 'UPDATED',
        type: 'success',
        statusCode: 200,
        duration: 2000,
      })
    },
    onError: (error: any) => {
      showLogoNotification({
        message: 'ERROR',
        type: 'error',
        statusCode: error?.response?.status || 500,
        duration: 3000,
      })
    },
  })

  // Mutation to update only Time Machine status
  const updateTimeMachineMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!currentQueryId) return
      return queriesService.updateSavedQuery(currentQueryId, {
        enable_time_machine: enabled,
      })
    },
  })

  const handleTimeMachineToggle = async (checked: boolean) => {
    if (!canEnableTimeMachine) return

    // Mutual exclusion: disable pagination when enabling Time Machine
    updateNode(nodeId, {
      enableTimeMachine: checked,
      enablePagination: checked ? false : data.enablePagination
    })

    if (currentQueryId) {
      await updateTimeMachineMutation.mutateAsync(checked)
    }
  }

  const handleSaveQuery = () => {
    if (!currentQueryId) return
    updateQueryMutation.mutate()
  }

  const handleTrackHistoryToggle = (checked: boolean) => {
    updateNode(nodeId, { track_execution_history: checked })
  }

  const handlePaginationToggle = (checked: boolean) => {
    // Mutual exclusion: disable Time Machine when enabling Pagination
    updateNode(nodeId, {
      enablePagination: checked,
      enableTimeMachine: checked ? false : data.enableTimeMachine,
      // Reset current page when enabling pagination
      currentPage: checked ? 0 : undefined
    })
  }

  const handlePageSizeChange = (value: string) => {
    updateNode(nodeId, { pageSize: parseInt(value, 10) })
  }

  // ── Validation Query ──────────────────────────────────────────
  const [validationSaving, setValidationSaving] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  // Check if current queryResult is a flat list (array of primitives or flat objects)
  const resultIsList = Array.isArray(queryResult)

  const handleValidationToggle = async (checked: boolean) => {
    if (!currentQueryId) return
    if (checked && !resultIsList) {
      setValidationError(
        'Query result is not a list. Run the query first and make sure a PostProcessor converts it to a flat list.'
      )
      return
    }
    setValidationError(null)
    setValidationSaving(true)
    try {
      await queriesService.markAsValidationQuery(currentQueryId, { is_validation_query: checked })
      updateNode(nodeId, { isValidationQuery: checked })
      showLogoNotification({ message: checked ? 'MARKED' : 'UNMARKED', type: 'success', statusCode: 200, duration: 2000 })
    } catch (err: any) {
      setValidationError(err?.message || 'Failed to update validation status')
    } finally {
      setValidationSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Time Machine Section */}
      <div className="border-b border-border">
        <div className="px-6 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Time Machine
            </h3>
          </div>
          {isQuerySaved && (
            <Button
              onClick={handleSaveQuery}
              disabled={updateQueryMutation.isPending}
              size="sm"
              variant="outline"
              className="h-8 text-xs"
            >
              <Save className="w-3 h-3 mr-2" />
              {updateQueryMutation.isPending ? 'Saving...' : 'Update'}
            </Button>
          )}
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between space-x-3 rounded border border-border p-3 bg-muted/50">
            <div className="space-y-0.5 flex-1">
              <Label htmlFor="enable-time-machine" className="text-sm font-medium cursor-pointer">
                Track execution history
              </Label>
              <p className="text-xs text-muted-foreground">
                Save query results over time for comparison and analysis
              </p>
            </div>
            <Switch
              id="enable-time-machine"
              checked={data.enableTimeMachine || false}
              onCheckedChange={handleTimeMachineToggle}
              disabled={!canEnableTimeMachine}
            />
          </div>

          {!canEnableTimeMachine && (
            <div className="text-xs bg-muted/50 border border-border rounded p-3">
              <p className="font-medium text-foreground mb-1.5 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-muted-foreground" />
                Query Must Be Saved First
              </p>
              <p className="text-muted-foreground">
                Save this query to enable Time Machine tracking. Time Machine only works with saved queries.
              </p>
            </div>
          )}

          {data.enableTimeMachine && canEnableTimeMachine && (
            <div className="text-xs bg-muted/50 border border-border rounded p-3">
              <p className="font-medium text-foreground mb-1.5 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-primary" />
                Time Machine Enabled
              </p>
              <p className="text-muted-foreground">
                Query results will be captured automatically after each execution.
                View and compare historical snapshots in the Time Machine page.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Pagination Section */}
      <div className="border-b border-border">
        <div className="px-6 py-3 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <FileStack className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Pagination
            </h3>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between space-x-3 rounded border border-border p-3 bg-muted/50">
            <div className="space-y-0.5 flex-1">
              <Label htmlFor="enable-pagination" className="text-sm font-medium cursor-pointer">
                Enable pagination
              </Label>
              <p className="text-xs text-muted-foreground">
                Paginate query results for better performance with large datasets
              </p>
            </div>
            <Switch
              id="enable-pagination"
              checked={data.enablePagination || false}
              onCheckedChange={handlePaginationToggle}
              disabled={data.enableTimeMachine || hasPostProcessors}
            />
          </div>

          {/* Page Size Selector - Only show when pagination is enabled */}
          {data.enablePagination && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Results per page</Label>
              <Select
                value={String(data.pageSize || 50)}
                onValueChange={handlePageSizeChange}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50 (Recommended)</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                  <SelectItem value="500">500</SelectItem>
                  <SelectItem value="1000">1000 (Maximum)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Warning: Mutual Exclusion with Time Machine */}
          {data.enableTimeMachine && (
            <div className="text-xs bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded p-3">
              <p className="font-medium text-amber-900 dark:text-amber-200 mb-1.5 flex items-center gap-2">
                <Info className="w-4 h-4" />
                Time Machine Enabled
              </p>
              <p className="text-amber-700 dark:text-amber-300">
                Pagination is disabled because Time Machine is active. Time Machine requires full data for drift detection.
              </p>
            </div>
          )}

          {/* Warning: Post-Processors Require Full Data */}
          {hasPostProcessors && !data.enableTimeMachine && (
            <div className="text-xs bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded p-3">
              <p className="font-medium text-amber-900 dark:text-amber-200 mb-1.5 flex items-center gap-2">
                <Info className="w-4 h-4" />
                Post-Processors Detected
              </p>
              <p className="text-amber-700 dark:text-amber-300">
                Pagination is disabled because post-processor nodes are present in the query. Post-processors require full data to function correctly.
              </p>
            </div>
          )}

          {/* Info when pagination is enabled */}
          {data.enablePagination && (
            <div className="text-xs bg-muted/50 border border-border rounded p-3">
              <p className="font-medium text-foreground mb-1.5 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-primary" />
                Pagination Enabled
              </p>
              <p className="text-muted-foreground">
                Query will return {data.pageSize || 50} results per page. Use pagination controls in the results view to navigate pages.
              </p>
            </div>
          )}
        </div>
      </div>


      {/* Validation Query Section */}
      <div className="border-b border-border">
        <div className="px-6 py-3 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Validation Query
            </h3>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between space-x-3 rounded border border-border p-3 bg-muted/50">
            <div className="space-y-0.5 flex-1">
              <Label htmlFor="is-validation-query" className="text-sm font-medium cursor-pointer">
                Mark as validation query
              </Label>
              <p className="text-xs text-muted-foreground">
                Makes this query available for column validation in AWX templates
              </p>
            </div>
            <Switch
              id="is-validation-query"
              checked={data.isValidationQuery || false}
              onCheckedChange={handleValidationToggle}
              disabled={!isQuerySaved || validationSaving}
            />
          </div>

          {!isQuerySaved && (
            <div className="text-xs bg-muted/50 border border-border rounded p-3">
              <p className="font-medium text-foreground mb-1 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-muted-foreground" />
                Query Must Be Saved First
              </p>
              <p className="text-muted-foreground">
                Save this query to mark it as a validation query.
              </p>
            </div>
          )}

          {isQuerySaved && !data.isValidationQuery && (
            <div className="text-xs bg-muted/50 border border-border rounded p-3 space-y-1">
              <p className="font-medium text-foreground flex items-center gap-2">
                <Info className="w-4 h-4 text-muted-foreground" />
                How it works
              </p>
              <p className="text-muted-foreground">
                Run the query first. If the result is a flat list (e.g. via a PostProcessor), toggle the switch to mark it.
              </p>
              {!resultIsList && queryResult !== null && (
                <p className="text-amber-600 dark:text-amber-400 mt-1">
                  Current result is not a list. Add a PostProcessor to extract a flat list before marking.
                </p>
              )}
            </div>
          )}

          {validationError && (
            <div className="text-xs bg-destructive/10 border border-destructive/30 rounded p-3 flex items-start gap-2 text-destructive">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              {validationError}
            </div>
          )}

          {data.isValidationQuery && isQuerySaved && (
            <div className="text-xs bg-muted/50 border border-border rounded p-3">
              <p className="font-medium text-foreground mb-1 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-primary" />
                Validation Query Active
              </p>
              <p className="text-muted-foreground">
                This query appears in AWX template column validation under
                Ansible → Validation Queries.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Table Template Persistence Section */}
      <div className="border-b border-border">
        <div className="px-6 py-3 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <Table2 className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Table Templates
            </h3>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between space-x-3 rounded border border-border p-3 bg-muted/50">
            <div className="space-y-0.5 flex-1">
              <Label htmlFor="track-execution-history" className="text-sm font-medium cursor-pointer">
                Save table templates
              </Label>
              <p className="text-xs text-muted-foreground">
                Persist table column configurations and preferences
              </p>
            </div>
            <Switch
              id="track-execution-history"
              checked={data.track_execution_history || false}
              onCheckedChange={handleTrackHistoryToggle}
            />
          </div>

          {data.track_execution_history && (
            <div className="text-xs bg-muted/50 border border-border rounded p-3">
              <p className="font-medium text-foreground mb-1.5 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-primary" />
                Table Templates Enabled
              </p>
              <p className="text-muted-foreground">
                Column configurations, visibility settings, and sorting preferences will be saved.
                Access saved templates via the Table tab's template manager.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
