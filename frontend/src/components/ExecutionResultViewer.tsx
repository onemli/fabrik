// ExecutionResultViewer.tsx
//
// Displays the result of a background or inline query execution in a modal.
// Supports toggling between raw JSON and tabular view, and downloading the result.

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Download, FileJson, Info, CheckCircle, XCircle } from 'lucide-react'
import { JsonViewer } from './JsonViewer'
import { useFormatters } from '@/contexts/TimezoneContext'

interface ExecutionResultViewerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  execution: {
    id: string
    apic_connection_name: string
    status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled'
    result?: any
    result_count?: number
    error_message?: string
    created_at: string
    execution_time_ms?: number
  }
  task: {
    id: string
    name: string
    saved_query?: {
      name: string
      description?: string
      flow_data?: any
    }
  }
}

export function ExecutionResultViewer({ open, onOpenChange, execution, task }: ExecutionResultViewerProps) {
  const { formatDateTime } = useFormatters()
  // Extract post-processor info from flow_data
  const postProcessors = task.saved_query?.flow_data?.nodes?.filter(
    (node: any) => node.type === 'post-processor'
  ) || []

  const handleDownloadJSON = () => {
    const blob = new Blob([JSON.stringify(execution.result, null, 2)], {
      type: 'application/json'
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${task.name}-${execution.apic_connection_name}-${new Date(execution.created_at).toISOString()}.json`
    a.click()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {execution.status === 'success' ? (
              <CheckCircle className="w-5 h-5 text-green-500" />
            ) : (
              <XCircle className="w-5 h-5 text-red-500" />
            )}
            Execution Result: {task.name}
          </DialogTitle>
          <DialogDescription>
            {execution.apic_connection_name} • {formatDateTime(execution.created_at)}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="summary" className="flex-1">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="summary" className="gap-2">
              <Info className="w-4 h-4" />
              Summary
            </TabsTrigger>
            <TabsTrigger value="json" className="gap-2">
              <FileJson className="w-4 h-4" />
              JSON
            </TabsTrigger>
          </TabsList>

          {/* Summary View */}
          <TabsContent value="summary" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="border rounded-lg p-4 space-y-2">
                <h3 className="font-semibold text-sm">Query Information</h3>
                <div className="text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Query:</span>
                    <span className="font-medium">{task.saved_query?.name || 'N/A'}</span>
                  </div>
                  {task.saved_query?.description && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Description:</span>
                      <span className="font-medium">{task.saved_query.description}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">APIC:</span>
                    <span className="font-medium">{execution.apic_connection_name}</span>
                  </div>
                </div>
              </div>

              <div className="border rounded-lg p-4 space-y-2">
                <h3 className="font-semibold text-sm">Execution Details</h3>
                <div className="text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status:</span>
                    <Badge variant={execution.status === 'success' ? 'default' : 'destructive'}>
                      {execution.status}
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Results:</span>
                    <span className="font-medium">
                      {execution.result_count !== undefined ? `${execution.result_count} items` : 'N/A'}
                    </span>
                  </div>
                  {execution.execution_time_ms && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Duration:</span>
                      <span className="font-medium">{(execution.execution_time_ms / 1000).toFixed(2)}s</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Post-Processors */}
            {postProcessors.length > 0 && (
              <div className="border rounded-lg p-4 space-y-2">
                <h3 className="font-semibold text-sm">Post-Processing Pipeline</h3>
                <div className="flex flex-wrap gap-2">
                  {postProcessors.map((processor: any, index: number) => (
                    <Badge key={index} variant="outline" className="gap-1">
                      {index + 1}. {processor.data?.processorType || 'Unknown'}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Result Data Type Info */}
            {execution.result && (
              <div className="border rounded-lg p-4 space-y-2">
                <h3 className="font-semibold text-sm">Result Data Structure</h3>
                <div className="text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Type:</span>
                    <span className="font-medium">{Array.isArray(execution.result) ? 'Array' : typeof execution.result}</span>
                  </div>
                  {Array.isArray(execution.result) && execution.result.length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Item Count:</span>
                      <span className="font-medium">{execution.result.length}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Error Message */}
            {execution.error_message && (
              <div className="border border-destructive rounded-lg p-4 space-y-2">
                <h3 className="font-semibold text-sm text-destructive">Error</h3>
                <pre className="text-xs text-destructive whitespace-pre-wrap">{execution.error_message}</pre>
              </div>
            )}
          </TabsContent>

          {/* JSON View */}
          <TabsContent value="json" className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground">
                {execution.result ? 'Raw result data in JSON format' : 'No result data available'}
              </p>
              {execution.result && (
                <Button variant="outline" size="sm" onClick={handleDownloadJSON}>
                  <Download className="w-4 h-4 mr-2" />
                  Download JSON
                </Button>
              )}
            </div>
            <div className="border rounded-lg p-4 max-h-[60vh] overflow-auto bg-muted/30">
              {execution.result ? (
                <JsonViewer data={execution.result} />
              ) : (
                <pre className="text-xs font-mono text-muted-foreground">null</pre>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
