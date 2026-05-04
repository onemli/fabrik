// ExecutionResults.tsx
//
// Results panel below the Query Builder canvas. Shows query output in table
// or JSON view depending on the selected tab. Also surfaces the
// post-processor pipeline controls and Time Machine snapshot capture button.

import { Button } from './ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { Badge } from './ui/badge'
import {
  Copy,
  CheckCircle2,
  Download,
  FileQuestion,
  Play,
  Workflow,
  Database,
  FileJson,
  ArrowLeft,
  Activity,
  HardDrive,
  Table2,
  Zap,
} from 'lucide-react'
import { useState, useMemo } from 'react'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import { NodeType } from '@/types'
import { MonacoJsonViewer } from './MonacoJsonViewer'
import { SmartTable } from './table/SmartTable'
import { PaginationControls } from './ui/PaginationControls'
import { PipelineProgress, PipelineStageResults } from './pipeline'
import { cn } from '@/lib/utils'

export function ExecutionResults() {
  const [copied, setCopied] = useState(false)
  const [activeTab, setActiveTab] = useState('response')

  const {
    actualQueryPath,
    nodes,
    queryResult: result,
    cachedQueryResult,
    isTestMode,
    showLogoNotification,
    currentQueryName,
    currentQueryMetadata,
    setCanvasMode,
    paginationMetadata,
    executeQueryPage,
    isExecuting,
    pipelineProgress,
    cancelExecution,
  } = useQueryBuilderStore()

  // Get post-processor nodes
  const postProcessorNodes = nodes.filter((node) => node.type === NodeType.POST_PROCESSOR)

  const isPipeline = currentQueryMetadata?.pipeline === true
  const pipelineStages = currentQueryMetadata?.stages || []


  // Find Output node to check track_execution_history setting
  const outputNode = useMemo(() => {
    return nodes.find((node) => node.type === NodeType.OUTPUT)
  }, [nodes])

  const trackHistory = useMemo(() => {
    return (outputNode?.data as any)?.track_execution_history || false
  }, [outputNode])

  const isPaginationEnabled = useMemo(() => {
    return (outputNode?.data as any)?.enablePagination || false
  }, [outputNode])

  const handlePageChange = async (page: number) => {
    try {
      await executeQueryPage(page)
      // Scroll to top of results
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (error) {
      showLogoNotification({
        message: 'ERROR',
        type: 'error',
        statusCode: 500,
        duration: 3000,
      })
    }
  }

  const handleCopy = async () => {
    if (!result) return

    const text = JSON.stringify(result, null, 2)

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }

      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      showLogoNotification({
        message: 'COPIED',
        type: 'success',
        statusCode: 200,
        duration: 1500,
      })
    } catch (error) {
      showLogoNotification({
        message: 'COPY FAILED',
        type: 'error',
        statusCode: 500,
        duration: 2000,
      })
    }
  }

  const handleDownload = () => {
    if (!result) return

    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `query-results-${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showLogoNotification({
      message: 'DOWNLOADED',
      type: 'success',
      statusCode: 200,
      duration: 1500,
    })
  }

  const getResultCount = () => {
    if (!result) return 0
    if (typeof result === 'object' && result !== null) {
      if ('totalCount' in result) return (result as any).totalCount
      if ('imdata' in result && Array.isArray((result as any).imdata)) {
        return (result as any).imdata.length
      }
      if (Array.isArray(result)) return result.length
    }
    return 0
  }

  const getResponseSize = () => {
    if (!result) return '0 KB'
    const sizeInBytes = new Blob([JSON.stringify(result)]).size
    if (sizeInBytes < 1024) return `${sizeInBytes} B`
    if (sizeInBytes < 1024 * 1024) return `${(sizeInBytes / 1024).toFixed(1)} KB`
    return `${(sizeInBytes / (1024 * 1024)).toFixed(2)} MB`
  }

  // Pipeline in progress — show live stage tracker
  if (!result && pipelineProgress && isExecuting) {
    return (
      <div className="flex-1 flex flex-col bg-background">
        <PipelineProgress progress={pipelineProgress} onCancel={cancelExecution} />
      </div>
    )
  }

  // Empty state
  if (!result) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <FileQuestion className="w-16 h-16 text-muted-foreground/25 mb-6" />
        <h2 className="text-xl font-semibold text-foreground mb-2">No results yet</h2>
        <p className="text-sm text-muted-foreground text-center max-w-sm mb-6">
          Run a query from the Query Builder to see results here.
        </p>
        <Button onClick={() => setCanvasMode('query-builder')} size="default">
          <Play />
          Go to Query Builder
        </Button>
      </div>
    )
  }

  const resultCount = getResultCount()
  const responseSize = getResponseSize()

  return (
    <div className="execution-results-fullscreen flex flex-col flex-1 min-h-0 min-w-0 bg-background">

      {/* ── Header bar ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 h-11 border-b border-border bg-card/50 flex-shrink-0">
        {/* Back */}
        <button
          onClick={() => setCanvasMode('query-builder')}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Query Builder</span>
        </button>

        <span className="text-muted-foreground/30 select-none">/</span>

        {/* Title */}
        <span className="text-sm font-semibold text-foreground truncate min-w-0">
          {currentQueryName || 'Query Results'}
        </span>

        {isTestMode && (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20 flex-shrink-0">
            <Activity />
            Test Mode
          </Badge>
        )}

        {isPipeline && (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20 flex-shrink-0">
            <Zap className="w-3 h-3" />
            Pipeline · {pipelineStages.length} stages
          </Badge>
        )}

        <div className="flex-1" />

        {/* Stats pill — right side */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-shrink-0 bg-muted/40 px-3 py-1 rounded-full">
          <span className="flex items-center gap-1">
            <Database className="w-3 h-3 text-primary/60" />
            <span className="font-medium text-foreground tabular-nums">{resultCount.toLocaleString()}</span>
            <span>{resultCount === 1 ? 'object' : 'objects'}</span>
          </span>
          <span className="text-border/60">·</span>
          <span className="flex items-center gap-1">
            <HardDrive className="w-3 h-3 text-blue-500/60" />
            <span className="font-medium text-foreground">{responseSize}</span>
          </span>
          {postProcessorNodes.length > 0 && (
            <>
              <span className="text-border/60">·</span>
              <span className="flex items-center gap-1">
                <Workflow className="w-3 h-3 text-purple-500/60" />
                <span className="font-medium text-foreground">{postProcessorNodes.length} pp</span>
              </span>
            </>
          )}
          <span className="text-border/60">·</span>
          <span className="flex items-center gap-1 text-green-600 dark:text-green-400 font-medium">
            <CheckCircle2 className="w-3 h-3" />
            OK
          </span>
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-h-0 min-w-0">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0 min-w-0">

          {/* Query path bar — right-aligned */}
          {actualQueryPath && (
            <div className="flex items-center justify-end gap-2 px-4 py-1.5 border-b border-border bg-muted/20 flex-shrink-0">
              <Badge variant="outline" className="font-mono text-xs py-0 flex-shrink-0">
                GET
              </Badge>
              <code className="text-xs font-mono text-emerald-600 dark:text-emerald-400 truncate">
                {(() => {
                  try { return decodeURIComponent(actualQueryPath) } catch { return actualQueryPath }
                })()}
              </code>
            </div>
          )}

          {/* Tab list + action buttons */}
          <div className="flex items-center justify-between px-4 border-b border-border bg-card/30 flex-shrink-0">
            <TabsList className="bg-transparent h-10 [&_svg]:w-3.5 [&_svg]:h-3.5 flex-shrink-0">
              <TabsTrigger value="response" className="gap-1.5 text-sm data-[state=active]:text-blue-500">
                <FileJson />
                Response
              </TabsTrigger>
              <TabsTrigger value="table" className="gap-1.5 text-sm data-[state=active]:text-emerald-500">
                <Table2 />
                Table
              </TabsTrigger>
              {isPipeline && pipelineStages.length > 0 && (
                <TabsTrigger value="stages" className="gap-1.5 text-sm data-[state=active]:text-amber-500">
                  <Zap className="w-3.5 h-3.5" />
                  Stages
                </TabsTrigger>
              )}
              {postProcessorNodes.length > 0 && (
                <TabsTrigger value="processing" className="gap-1.5 text-sm data-[state=active]:text-amber-500">
                  <Workflow />
                  Post-Processing
                </TabsTrigger>
              )}
            </TabsList>

            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopy}
                className={cn(copied && 'border-green-500/40 text-green-600 bg-green-500/5')}
              >
                {copied ? <CheckCircle2 /> : <Copy />}
                {copied ? 'Copied' : 'Copy JSON'}
              </Button>
              <Button variant="outline" size="sm" onClick={handleDownload}>
                <Download />
                Download
              </Button>
            </div>
          </div>

          {/* ── Response tab ──────────────────────────────────────── */}
          <TabsContent value="response" className="m-0 flex flex-col flex-1 min-h-0 data-[state=inactive]:hidden">

            {/* Pagination top */}
            {isPaginationEnabled && paginationMetadata && (
              <div className="px-4 py-2 border-b border-border flex-shrink-0">
                <PaginationControls
                  currentPage={paginationMetadata.currentPage}
                  totalPages={paginationMetadata.totalPages}
                  totalResults={paginationMetadata.totalCount}
                  pageSize={paginationMetadata.pageSize}
                  onPageChange={handlePageChange}
                  disabled={isExecuting}
                />
              </div>
            )}

            {/* JSON viewer */}
            <div className="flex flex-col flex-1 min-h-0">
              <div className="flex-1 min-h-0">
                <MonacoJsonViewer data={result} height="100%" className="h-full" />
              </div>
            </div>

            {/* Pagination bottom */}
            {isPaginationEnabled && paginationMetadata && (
              <div className="px-4 py-2 border-t border-border flex-shrink-0">
                <PaginationControls
                  currentPage={paginationMetadata.currentPage}
                  totalPages={paginationMetadata.totalPages}
                  totalResults={paginationMetadata.totalCount}
                  pageSize={paginationMetadata.pageSize}
                  onPageChange={handlePageChange}
                  disabled={isExecuting}
                />
              </div>
            )}
          </TabsContent>

          {/* ── Table tab ─────────────────────────────────────────── */}
          <TabsContent value="table" className="m-0 p-4 data-[state=inactive]:hidden overflow-auto min-w-0">
            {result ? (
              <div className="space-y-3 min-w-0">
                {isPaginationEnabled && paginationMetadata && (
                  <PaginationControls
                    currentPage={paginationMetadata.currentPage}
                    totalPages={paginationMetadata.totalPages}
                    totalResults={paginationMetadata.totalCount}
                    pageSize={paginationMetadata.pageSize}
                    onPageChange={handlePageChange}
                    disabled={isExecuting}
                  />
                )}
                <SmartTable
                  data={result}
                  trackHistory={trackHistory}
                  backendPaginationEnabled={isPaginationEnabled}
                  rawData={cachedQueryResult?.data}
                />
                {isPaginationEnabled && paginationMetadata && (
                  <PaginationControls
                    currentPage={paginationMetadata.currentPage}
                    totalPages={paginationMetadata.totalPages}
                    totalResults={paginationMetadata.totalCount}
                    pageSize={paginationMetadata.pageSize}
                    onPageChange={handlePageChange}
                    disabled={isExecuting}
                  />
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center h-64">
                <div className="text-center">
                  <Table2 className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm font-medium text-foreground mb-1">No data</p>
                  <p className="text-xs text-muted-foreground">Execute a query first</p>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ── Pipeline Stages tab ──────────────────────────────── */}
          {isPipeline && pipelineStages.length > 0 && (
            <TabsContent value="stages" className="m-0 data-[state=inactive]:hidden overflow-auto">
              <PipelineStageResults
                stages={pipelineStages}
                totalExecutionMs={currentQueryMetadata?.execution_time_ms}
                pipelineError={currentQueryMetadata?.pipeline_error}
              />
            </TabsContent>
          )}

          {/* ── Post-Processing tab ───────────────────────────────── */}
          {postProcessorNodes.length > 0 && (
            <TabsContent value="processing" className="m-0 p-4 data-[state=inactive]:hidden overflow-auto">
              <div className="max-w-2xl space-y-2">
                <div className="flex items-center gap-2 mb-3">
                  <Workflow className="w-4 h-4 text-purple-500" />
                  <h3 className="text-sm font-semibold text-foreground">Post-Processing Pipeline</h3>
                  <Badge variant="outline" className="text-xs">{postProcessorNodes.length} steps</Badge>
                </div>
                {postProcessorNodes.map((node, index) => {
                  const nodeData = node.data as any
                  return (
                    <div
                      key={node.id}
                      className="flex items-start gap-3 p-3 rounded-lg border border-border bg-card hover:border-purple-500/40 transition-colors"
                    >
                      <div className="w-6 h-6 rounded-full bg-purple-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-xs font-bold text-purple-600">{index + 1}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground capitalize">
                          {nodeData.processorType || 'Unknown Processor'}
                        </p>
                        <p className="text-xs text-muted-foreground">Step {index + 1} of {postProcessorNodes.length}</p>
                        {nodeData.config && Object.keys(nodeData.config).length > 0 && (
                          <div className="mt-2 pt-2 border-t border-border space-y-1">
                            {Object.entries(nodeData.config).map(([key, value]) => (
                              <div key={key} className="flex items-center gap-2 text-xs font-mono">
                                <span className="text-purple-500 font-semibold">{key}:</span>
                                <span className="text-foreground">{String(value)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </TabsContent>
          )}

        </Tabs>
      </div>
    </div>
  )
}
