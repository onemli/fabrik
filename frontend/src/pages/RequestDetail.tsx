// pages/RequestDetail.tsx
//
// Detail page for a single AWX automation request. Two-column layout: left sidebar
// shows request metadata, current status, and the full execution timeline (each
// execution and its workflow nodes). Main area shows the input data, a live terminal
// for the selected execution, and the output data below it.

import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAWXWebSocket } from '../hooks/useAWXWebSocket'
import { awxService, type AutomationExecution } from '../services/awx'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { JobOutputViewer } from '../components/awx/JobOutputViewer'
import { WorkflowNodeOutput } from '../components/awx/WorkflowNodeOutput'
import {
  ChevronDown,
  ChevronUp,
  RefreshCw,
  PlayCircle,
  CheckCircle,
  XCircle,
  Clock,
  Wifi,
  WifiOff,
  Download,
  Loader2,
  Activity,
  FileSpreadsheet,
  GitBranch,
  Package,
  User,
  Calendar,
  Info,
  FileText
} from 'lucide-react'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'
import { useFormatters } from '@/contexts/TimezoneContext'

interface TemplateSummary {
  id: string
  name: string
  table_schemas?: any[]
  [key: string]: any
}

interface AutomationRequest {
  id: string
  title: string
  description: string
  // Backend returns either a template ID string (stale cache) or a full nested
  // template object when requested via the detail endpoint. Narrow with
  // `getTemplateObject()` before accessing nested fields.
  template: string | TemplateSummary
  template_name?: string
  status: string
  requested_by?: {
    id: number
    username: string
    email: string
  }
  created_at: string
  updated_at: string
  input_data: any
}

// Narrow `request.template` to its object form, returning null when the
// serializer only gave us the ID string.
function getTemplateObject(
  template: string | TemplateSummary | undefined | null
): TemplateSummary | null {
  return template && typeof template === 'object' ? template : null
}

interface WorkflowNode {
  id: number
  job?: number
  workflow_job?: number
  unified_job_type: string
  identifier: string
  summary_fields?: {
    job?: {
      id: number
      name: string
      status: string
      elapsed: number
      finished?: string
    }
  }
}

const STATUS_CONFIG = {
  pending: { icon: Clock, color: 'text-amber-600 dark:text-amber-400', bgColor: 'bg-amber-500/10', label: 'Pending' },
  running: { icon: PlayCircle, color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-500/10', label: 'Running' },
  successful: { icon: CheckCircle, color: 'text-green-600 dark:text-green-400', bgColor: 'bg-green-500/10', label: 'Successful' },
  failed: { icon: XCircle, color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-500/10', label: 'Failed' },
  cancelled: { icon: XCircle, color: 'text-muted-foreground', bgColor: 'bg-muted/50', label: 'Cancelled' }
}

const JOB_STATUS_CONFIG = {
  pending: { color: 'text-muted-foreground', bgColor: 'bg-muted/50', label: 'Pending' },
  waiting: { color: 'text-amber-600 dark:text-amber-400', bgColor: 'bg-amber-500/10', label: 'Waiting' },
  running: { color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-500/10', label: 'Running' },
  successful: { color: 'text-green-600 dark:text-green-400', bgColor: 'bg-green-500/10', label: 'Successful' },
  failed: { color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-500/10', label: 'Failed' },
  error: { color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-500/10', label: 'Error' },
  canceled: { color: 'text-muted-foreground', bgColor: 'bg-muted/50', label: 'Canceled' }
}

export default function RequestDetail() {
  const { requestId } = useParams<{ requestId: string }>()
  const navigate = useNavigate()
  const { formatDateTime } = useFormatters()

  const [request, setRequest] = useState<AutomationRequest | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [relaunchingId, setRelaunchingId] = useState<string | null>(null)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [selectedExecution, setSelectedExecution] = useState<AutomationExecution | null>(null)
  const [selectedAwxJobId, setSelectedAwxJobId] = useState<number | null>(null)
  const [workflowNodes, setWorkflowNodes] = useState<Record<string, WorkflowNode[]>>({})

  // Collapsible sections state
  const [requestInfoCollapsed, setRequestInfoCollapsed] = useState(false)
  const [_timelineCollapsed, _setTimelineCollapsed] = useState(false)
  const [inputDataCollapsed, setInputDataCollapsed] = useState(false)
  const [selectedInputSheet, setSelectedInputSheet] = useState<string>('') // Multi-sheet tab selection

  // WebSocket connection for live updates
  const { connected, executions, reconnect } = useAWXWebSocket({
    requestId,
    showNotifications: true,
    autoReconnect: true,
    onExecutionUpdate: (execution) => {
      const isTerminal = ['successful', 'failed', 'error', 'canceled'].includes(execution.status)
      if (isTerminal) {
        // Derive request status from the latest execution result.
        // This covers first-run, relaunch (request was "failed" but new execution succeeds),
        // and any other terminal transition regardless of the previous request status.
        const newRequestStatus = execution.status === 'successful' ? 'successful' : 'failed'
        setRequest(prev => {
          if (!prev || prev.status === newRequestStatus) return prev
          return { ...prev, status: newRequestStatus }
        })
      } else if (execution.status === 'running') {
        // Execution started or is in progress — mark request as running
        setRequest(prev => {
          if (!prev || prev.status === 'running') return prev
          return { ...prev, status: 'running' }
        })
      }

      // Fetch workflow nodes when execution updates
      if (execution.awx_job_id) {
        fetchWorkflowNodes(execution.id, execution.awx_job_id)
      }
    }
  })

  const loadRequestDetails = async () => {
    if (!requestId) {
      return
    }

    try {
      setLoading(true)
      const requestData = await awxService.getRequest(requestId)
      setRequest(requestData)

      // Load all executions for this request (including completed ones)
      try {
        // Use automation_request filter to get executions for this specific request
        const response = await fetch(`/api/awx/executions/?automation_request=${requestId}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('access_token')}`
          }
        })
        const data = await response.json()
        const allExecutions = data.results || data

        // Fetch workflow nodes for all executions
        const workflowNodesData: Record<string, any[]> = {}
        for (const exec of allExecutions) {
          if (exec.awx_job_id) {
            const nodes = await fetchWorkflowNodes(exec.id, exec.awx_job_id)
            if (nodes) {
              workflowNodesData[exec.id] = nodes
            }
          }
        }

        // Auto-select first execution if none selected
        if (allExecutions.length > 0 && !selectedJobId) {
          const firstExec = allExecutions[0]
          setSelectedExecution(firstExec)
          setSelectedJobId(firstExec.id)

          // If this execution has workflow nodes, select the first node
          // Otherwise select the main job
          const nodes = workflowNodesData[firstExec.id]
          if (nodes && nodes.length > 0) {
            const firstNode = nodes[0]
            const firstNodeJobId = firstNode.summary_fields?.job?.id
            if (firstNodeJobId) {
              setSelectedAwxJobId(firstNodeJobId)
            } else {
              setSelectedAwxJobId(firstExec.awx_job_id)
            }
          } else {
            setSelectedAwxJobId(firstExec.awx_job_id)
          }
        }
      } catch {
        /* ignore */
      }
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to load request details')
    } finally {
      setLoading(false)
    }
  }

  const fetchWorkflowNodes = async (executionId: string, _awxJobId: number) => {
    try {
      const token = localStorage.getItem('access_token')
      const response = await fetch(
        `/api/awx/executions/${executionId}/workflow-nodes/`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      )

      if (response.ok) {
        const data = await response.json()
        const nodes = data.nodes || []
        setWorkflowNodes(prev => ({
          ...prev,
          [executionId]: nodes
        }))
        return nodes
      }
    } catch {
      /* ignore */
    }
    return null
  }

  const handleExecute = async () => {
    if (!requestId) return

    try {
      await awxService.executeRequest(requestId)
      toast.success('Execution started')
      await loadRequestDetails()
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to start execution')
    }
  }

  const handleRelaunch = async (executionId: string) => {
    try {
      setRelaunchingId(executionId)
      const result = await awxService.relaunchExecution(executionId)
      toast.success(`Relaunched → AWX job #${result.new_awx_job_id}`)
      await loadRequestDetails()
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to relaunch execution')
    } finally {
      setRelaunchingId(null)
    }
  }

  // Helper: Get all sheets from input_data (multi-schema support)
  const getInputDataSheets = (): Record<string, any[]> => {
    if (!request?.input_data) return {}

    // Derive sheet name from first schema (for single-array cases)
    const templateObj = getTemplateObject(request.template)
    const firstSchema = templateObj?.table_schemas?.[0]
    const singleSheetName = firstSchema?.sheet_name
      || (firstSchema?.awx_variable_name
          ? firstSchema.awx_variable_name.charAt(0).toUpperCase() + firstSchema.awx_variable_name.slice(1)
          : 'Data')

    // Case 1: input_data.data exists (single-schema legacy)
    if (request.input_data.data && Array.isArray(request.input_data.data)) {
      return { [singleSheetName]: request.input_data.data }
    }
    // Case 2: input_data itself is an array (single-schema)
    else if (Array.isArray(request.input_data)) {
      return { [singleSheetName]: request.input_data }
    }
    // Case 3: Multi-schema - object with sheet names
    else if (typeof request.input_data === 'object') {
      const sheets: Record<string, any[]> = {}
      for (const [key, value] of Object.entries(request.input_data)) {
        if (Array.isArray(value)) {
          // Capitalize sheet name: "tenants" → "Tenants"
          const sheetName = key.charAt(0).toUpperCase() + key.slice(1)
          sheets[sheetName] = value
        }
      }
      return sheets
    }

    return {}
  }

  const getInputDataArray = () => {
    const sheets = getInputDataSheets()
    const firstSheet = Object.values(sheets)[0]
    return firstSheet || []
  }

  const handleDownloadExcel = () => {
    const sheets = getInputDataSheets()
    const sheetNames = Object.keys(sheets)

    if (sheetNames.length === 0) {
      toast.error('No data to download')
      return
    }

    try {
      const wb = XLSX.utils.book_new()

      // Add each sheet to workbook
      for (const [sheetName, data] of Object.entries(sheets)) {
        const ws = XLSX.utils.json_to_sheet(data)
        XLSX.utils.book_append_sheet(wb, ws, sheetName)
      }

      const filename = `request_${requestId}_input_data_${new Date().toISOString().split('T')[0]}.xlsx`
      XLSX.writeFile(wb, filename)
      toast.success(`Excel file downloaded with ${sheetNames.length} sheet(s)`)
    } catch {
      toast.error('Failed to export data')
    }
  }

  const handleDownloadJSON = () => {
    const sheets = getInputDataSheets()
    if (Object.keys(sheets).length === 0) {
      toast.error('No data to download')
      return
    }

    // Export all sheets as multi-schema JSON
    const blob = new Blob([JSON.stringify(sheets, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `request_${requestId}_input_data.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success('JSON downloaded')
  }

  useEffect(() => {
    loadRequestDetails()
  }, [requestId])

  // Fetch workflow nodes when executions are loaded
  useEffect(() => {
    if (executions.length > 0) {
      executions.forEach(exec => {
        if (exec.awx_job_id) {
          fetchWorkflowNodes(exec.id, exec.awx_job_id)
        }
      })
    }
  }, [executions])

  // Select first execution when executions are loaded
  useEffect(() => {
    if (executions.length > 0 && !selectedJobId) {
      const firstExecution = executions[0]
      setSelectedExecution(firstExecution as unknown as AutomationExecution)
      setSelectedJobId(firstExecution.id)
      setSelectedAwxJobId(firstExecution.awx_job_id ?? null)
    }
  }, [executions, selectedJobId])

  // Sync selectedExecution with executions array when it updates (for WebSocket status changes)
  useEffect(() => {
    if (selectedJobId && executions.length > 0) {
      const updatedExecution = executions.find(e => e.id === selectedJobId)
      if (updatedExecution) {
        setSelectedExecution(updatedExecution as unknown as AutomationExecution)
      }
    }
  }, [executions, selectedJobId])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!request) {
    return (
      <div className="flex flex-col items-center justify-center h-screen space-y-4">
        <XCircle className="w-16 h-16 text-red-500" />
        <p className="text-lg text-muted-foreground">Request not found</p>
        <Button onClick={() => navigate('/awx/requests')}>
          Back to Requests
        </Button>
      </div>
    )
  }

  const statusConfig = STATUS_CONFIG[request.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.pending
  const StatusIcon = statusConfig.icon
  const templateObject = getTemplateObject(request.template)

  // Extract input data - multi-sheet support
  const inputDataSheets = getInputDataSheets()

  // Get sheet names in the order defined by table_schemas
  const schemaSheetNames = (templateObject?.table_schemas ?? [])
    .map((schema: any) => {
      const varName = schema.awx_variable_name
      if (!varName) return null
      // Capitalize: "tenants" → "Tenants"
      const capitalizedName = varName.charAt(0).toUpperCase() + varName.slice(1)
      // Also check sheet_name directly
      const sheetKey = inputDataSheets[capitalizedName]
        ? capitalizedName
        : (schema.sheet_name && inputDataSheets[schema.sheet_name] ? schema.sheet_name : null)
      return sheetKey
    })
    .filter(Boolean) as string[]
  // Fallback to all available sheets if schema lookup yields nothing
  const sheetNames = schemaSheetNames.length > 0 ? schemaSheetNames : Object.keys(inputDataSheets)

  const inputDataArray = getInputDataArray() // For backward compatibility

  // Set default selected sheet if not set
  if (!selectedInputSheet && sheetNames.length > 0) {
    setSelectedInputSheet(sheetNames[0])
  }

  return (
    <div className="flex-1 flex overflow-hidden bg-background">
        {/* Left Sidebar - Fixed width, scrollable */}
        <aside className="w-80 border-r bg-card/30 flex-shrink-0 overflow-y-auto">
          <div className="p-4 space-y-4">
            {/* Request Info Section */}
            <Card className="border-l-4 border-l-blue-500">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Info className="w-4 h-4 text-blue-500" />
                    <CardTitle className="text-base">Request Info</CardTitle>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      title="Refresh request details"
                      disabled={refreshing}
                      onClick={async () => {
                        setRefreshing(true)
                        await loadRequestDetails()
                        setRefreshing(false)
                      }}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => setRequestInfoCollapsed(!requestInfoCollapsed)}
                    >
                      {requestInfoCollapsed ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronUp className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </CardHeader>

              {!requestInfoCollapsed && (
                <CardContent className="space-y-3">
                  {/* Status Badge */}
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-lg ${statusConfig.bgColor} flex items-center justify-center`}>
                      <StatusIcon className={`w-4 h-4 ${statusConfig.color}`} />
                    </div>
                    <Badge variant="outline" className={`${statusConfig.bgColor} ${statusConfig.color}`}>
                      {statusConfig.label}
                    </Badge>
                  </div>

                  {/* Template */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Package className="w-3.5 h-3.5" />
                      <span>Template</span>
                    </div>
                    <p className="text-sm font-medium pl-5">{request.template_name || templateObject?.name || 'Unknown'}</p>
                  </div>

                  {/* Title */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <FileText className="w-3.5 h-3.5" />
                      <span>Title</span>
                    </div>
                    <p className="text-sm font-medium pl-5">{request.title}</p>
                  </div>

                  {/* Description */}
                  {request.description && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Description</p>
                      <p className="text-sm text-muted-foreground">{request.description}</p>
                    </div>
                  )}

                  {/* Requested By */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <User className="w-3.5 h-3.5" />
                      <span>Requested By</span>
                    </div>
                    <p className="text-sm font-medium pl-5">
                      {request.requested_by?.username || 'Unknown'}
                    </p>
                  </div>

                  {/* Created At */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Calendar className="w-3.5 h-3.5" />
                      <span>Created</span>
                    </div>
                    <p className="text-sm pl-5">
                      {formatDateTime(request.created_at)}
                    </p>
                  </div>

                  {/* Execute Button */}
                  {request.status === 'pending' && (
                    <Button
                      onClick={handleExecute}
                      className="w-full mt-2"
                      size="sm"
                    >
                      <PlayCircle className="w-4 h-4 mr-2" />
                      Execute Now
                    </Button>
                  )}

                  {/* WebSocket Status */}
                  <div className="flex items-center gap-2 pt-2 border-t">
                    {connected ? (
                      <>
                        <Wifi className="w-3.5 h-3.5 text-green-500" />
                        <span className="text-xs text-green-600">Live Updates Active</span>
                      </>
                    ) : (
                      <>
                        <WifiOff className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">Disconnected</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={reconnect}
                          className="h-6 ml-auto"
                        >
                          <RefreshCw className="w-3 h-3" />
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              )}
            </Card>

            {/* Timeline moved to main content area */}
          </div>
        </aside>

        {/* Main Content Area - Flexible width, scrollable */}
        <main className="flex-1 overflow-y-auto bg-background">
          <div className="p-6 space-y-4">
            {/* Execution Timeline - Horizontal Pipeline */}
            {selectedExecution && (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <GitBranch className="w-4 h-4 text-purple-500" />
                    <CardTitle className="text-base">
                      {workflowNodes[selectedExecution.id] && workflowNodes[selectedExecution.id].length > 0
                        ? 'Workflow Pipeline'
                        : 'Execution Pipeline'}
                    </CardTitle>
                    <Badge variant="secondary" className="ml-1">
                      {workflowNodes[selectedExecution.id] && workflowNodes[selectedExecution.id].length > 0
                        ? `${workflowNodes[selectedExecution.id].length} nodes`
                        : '1 job'}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 ml-auto"
                      title="Refresh execution status"
                      disabled={refreshing}
                      onClick={async () => {
                        setRefreshing(true)
                        await loadRequestDetails()
                        setRefreshing(false)
                      }}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {/* Horizontal Node Pipeline */}
                  <div className="flex items-center gap-4 overflow-x-auto pb-2">
                    {(() => {
                      // Workflow template: Show all nodes
                      if (workflowNodes[selectedExecution.id] && workflowNodes[selectedExecution.id].length > 0) {
                        // Sort nodes by job ID (ascending)
                        const sortedNodes = [...workflowNodes[selectedExecution.id]].sort((a, b) => {
                          const jobIdA = a.summary_fields?.job?.id || 0
                          const jobIdB = b.summary_fields?.job?.id || 0
                          return jobIdA - jobIdB
                        })

                        return sortedNodes.map((node, nodeIdx) => {
                      const jobData = node.summary_fields?.job
                      if (!jobData) return null

                      const isNodeRunning = jobData.status === 'running' || jobData.status === 'pending' || jobData.status === 'waiting'
                      const isNodeCompleted = jobData.status === 'successful'
                      const isNodeFailed = jobData.status === 'failed' || jobData.status === 'error'
                      const isNodeSelected = selectedAwxJobId === jobData.id

                      // Circle colors
                      let circleColor = 'bg-gray-200 border-gray-300'
                      if (isNodeRunning) {
                        circleColor = 'bg-blue-500 border-blue-600 shadow-lg shadow-blue-500/50'
                      } else if (isNodeCompleted) {
                        circleColor = 'bg-green-500 border-green-600'
                      } else if (isNodeFailed) {
                        circleColor = 'bg-red-500 border-red-600'
                      }

                      return (
                        <div key={node.id} className="flex items-center gap-3">
                          {/* Node Circle + Label */}
                          <button
                            onClick={() => {
                              setSelectedExecution(selectedExecution)
                              setSelectedJobId(selectedExecution.id)
                              setSelectedAwxJobId(jobData.id)
                            }}
                            className="flex flex-col items-center gap-2 transition-all hover:brightness-125"
                          >
                            <div className={`w-10 h-10 rounded-full border-3 ${circleColor} flex items-center justify-center transition-all ${
                              isNodeRunning ? 'animate-pulse' : ''
                            }`}>
                              {isNodeCompleted && <CheckCircle className="w-5 h-5 text-foreground" />}
                              {isNodeFailed && <XCircle className="w-5 h-5 text-foreground" />}
                              {isNodeRunning && <Loader2 className="w-5 h-5 text-foreground animate-spin" />}
                              {!isNodeCompleted && !isNodeFailed && !isNodeRunning && (
                                <Clock className="w-5 h-5 text-muted-foreground" />
                              )}
                            </div>
                            <div className="text-center min-w-[120px]">
                              <div className={`text-xs font-medium ${
                                isNodeSelected ? 'text-foreground' : 'text-muted-foreground'
                              }`}>
                                {jobData.name}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {Math.round(jobData.elapsed || 0)}s
                              </div>
                            </div>
                          </button>

                          {/* Connector Line */}
                          {nodeIdx < sortedNodes.length - 1 && (
                            <div className={`h-0.5 w-12 ${
                              isNodeCompleted ? 'bg-green-300' : 'bg-gray-200'
                            }`} />
                          )}
                        </div>
                      )
                        })
                      }

                      // Normal job template: Show single job as one node
                      else {
                        const isJobRunning = selectedExecution.status === 'running' || selectedExecution.status === 'pending'
                        const isJobCompleted = selectedExecution.status === 'successful'
                        const isJobFailed = selectedExecution.status === 'failed' || selectedExecution.status === 'error'

                        let circleColor = 'bg-gray-200 border-gray-300'
                        if (isJobRunning) {
                          circleColor = 'bg-blue-500 border-blue-600 shadow-lg shadow-blue-500/50'
                        } else if (isJobCompleted) {
                          circleColor = 'bg-green-500 border-green-600'
                        } else if (isJobFailed) {
                          circleColor = 'bg-red-500 border-red-600'
                        }

                        return (
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => {
                                setSelectedExecution(selectedExecution)
                                setSelectedJobId(selectedExecution.id)
                                setSelectedAwxJobId(selectedExecution.awx_job_id)
                              }}
                              className="flex flex-col items-center gap-2 transition-all hover:brightness-125"
                            >
                              <div className={`w-10 h-10 rounded-full border-3 ${circleColor} flex items-center justify-center transition-all ${
                                isJobRunning ? 'animate-pulse' : ''
                              }`}>
                                {isJobCompleted && <CheckCircle className="w-5 h-5 text-foreground" />}
                                {isJobFailed && <XCircle className="w-5 h-5 text-foreground" />}
                                {isJobRunning && <Loader2 className="w-5 h-5 text-foreground animate-spin" />}
                                {!isJobCompleted && !isJobFailed && !isJobRunning && (
                                  <Clock className="w-5 h-5 text-muted-foreground" />
                                )}
                              </div>
                              <div className="text-center min-w-[120px]">
                                <div className="text-xs font-medium text-foreground">
                                  {templateObject?.name || 'Job'}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {Math.round(selectedExecution.elapsed_seconds || 0)}s
                                </div>
                              </div>
                            </button>
                          </div>
                        )
                      }
                    })()}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Input Data Section */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-blue-500" />
                    <CardTitle className="text-base">Input Data</CardTitle>
                    {sheetNames.length > 1 && (
                      <Badge variant="secondary" className="ml-1">
                        {sheetNames.length} sheets
                      </Badge>
                    )}
                    {inputDataArray.length > 0 && (
                      <Badge variant="outline" className="ml-1">
                        {inputDataArray.length} rows total
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {inputDataArray.length > 0 && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleDownloadExcel}
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />
                          Excel
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleDownloadJSON}
                        >
                          <Download className="w-3.5 h-3.5 mr-1.5" />
                          JSON
                        </Button>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => setInputDataCollapsed(!inputDataCollapsed)}
                    >
                      {inputDataCollapsed ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronUp className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </CardHeader>

              {!inputDataCollapsed && (
                <CardContent>
                  {sheetNames.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      No input data
                    </p>
                  ) : sheetNames.length === 1 ? (
                    // Single sheet - no tabs
                    (() => {
                      const sheetName = sheetNames[0]
                      const sheetData = inputDataSheets[sheetName]
                      const schemaIndex = 0
                      const columns = templateObject?.table_schemas?.[schemaIndex]?.columns || []

                      return (
                        <div className="border rounded-lg overflow-hidden">
                          <div className="overflow-x-auto max-h-80 overflow-y-auto">
                            <table className="w-full text-sm">
                              <thead className="bg-muted sticky top-0">
                                <tr>
                                  {columns.length > 0 ? (
                                    columns.map((col: any) => (
                                      <th key={col.name} className="px-4 py-2 text-left font-medium text-muted-foreground border-b">
                                        {col.display_name || col.name}
                                      </th>
                                    ))
                                  ) : (
                                    Object.keys(sheetData[0] || {}).map((key) => (
                                      <th key={key} className="px-4 py-2 text-left font-medium text-muted-foreground border-b">
                                        {key}
                                      </th>
                                    ))
                                  )}
                                </tr>
                              </thead>
                              <tbody>
                                {sheetData.slice(0, 10).map((row: any, idx: number) => {
                                  const orderedKeys = columns.length > 0 ? columns.map((col: any) => col.name) : Object.keys(row)
                                  return (
                                    <tr key={idx} className="border-b hover:bg-muted/50">
                                      {orderedKeys.map((key: string) => (
                                        <td key={key} className="px-4 py-2">{String(row[key] ?? '')}</td>
                                      ))}
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                          {sheetData.length > 10 && (
                            <div className="px-4 py-2 bg-muted/50 border-t text-xs text-muted-foreground text-center">
                              Showing 10 of {sheetData.length} rows
                            </div>
                          )}
                        </div>
                      )
                    })()
                  ) : (
                    // Multi-sheet - with tabs
                    <Tabs value={selectedInputSheet} onValueChange={setSelectedInputSheet}>
                      <TabsList className="mb-4">
                        {sheetNames.map((sheetName) => (
                          <TabsTrigger key={sheetName} value={sheetName}>
                            {sheetName}
                            <Badge variant="secondary" className="ml-2 text-xs">
                              {inputDataSheets[sheetName].length}
                            </Badge>
                          </TabsTrigger>
                        ))}
                      </TabsList>

                      {sheetNames.map((sheetName) => {
                        const sheetData = inputDataSheets[sheetName]

                        // Find matching schema by awx_variable_name
                        const schema = templateObject?.table_schemas?.find(
                          (s: any) => s.awx_variable_name === sheetName.toLowerCase()
                        )
                        const columns = schema?.columns || []

                        return (
                          <TabsContent key={sheetName} value={sheetName}>
                            <div className="border rounded-lg overflow-hidden">
                              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                                <table className="w-full text-sm">
                                  <thead className="bg-muted sticky top-0">
                                    <tr>
                                      {columns.length > 0 ? (
                                        columns.map((col: any) => (
                                          <th key={col.name} className="px-4 py-2 text-left font-medium text-muted-foreground border-b">
                                            {col.display_name || col.name}
                                          </th>
                                        ))
                                      ) : (
                                        Object.keys(sheetData[0] || {}).map((key) => (
                                          <th key={key} className="px-4 py-2 text-left font-medium text-muted-foreground border-b">
                                            {key}
                                          </th>
                                        ))
                                      )}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {sheetData.slice(0, 10).map((row: any, idx: number) => {
                                      const orderedKeys = columns.length > 0 ? columns.map((col: any) => col.name) : Object.keys(row)
                                      return (
                                        <tr key={idx} className="border-b hover:bg-muted/50">
                                          {orderedKeys.map((key: string) => (
                                            <td key={key} className="px-4 py-2">{String(row[key] ?? '')}</td>
                                          ))}
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              </div>
                              {sheetData.length > 10 && (
                                <div className="px-4 py-2 bg-muted/50 border-t text-xs text-muted-foreground text-center">
                                  Showing 10 of {sheetData.length} rows
                                </div>
                              )}
                            </div>
                          </TabsContent>
                        )
                      })}
                    </Tabs>
                  )}
                </CardContent>
              )}
            </Card>

            {/* Unified Sequential Terminal - Workflow Pipeline */}
            {selectedExecution && (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-green-500" />
                      <CardTitle className="text-base">Execution Pipeline</CardTitle>
                      {selectedExecution && (
                        <Badge variant="secondary" className="font-mono text-xs">
                          Execution #{selectedExecution.id.slice(0, 8)}
                        </Badge>
                      )}
                    </div>
                    {(() => {
                      const TERMINAL_STATUSES = ['successful', 'failed', 'error', 'canceled', 'cancelled']
                      const canRelaunch = selectedExecution.can_relaunch
                        ?? (TERMINAL_STATUSES.includes(selectedExecution.status)
                            && (selectedExecution.relaunch_count ?? 0) < 3
                            && selectedExecution.awx_job_id !== null)
                      if (!canRelaunch) return null
                      const isRelaunching = relaunchingId === selectedExecution.id
                      return (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isRelaunching}
                          onClick={() => handleRelaunch(selectedExecution.id)}
                          title="Relaunch this execution with the same parameters"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isRelaunching ? 'animate-spin' : ''}`} />
                          {isRelaunching ? 'Relaunching…' : 'Relaunch'}
                        </Button>
                      )
                    })()}
                  </div>
                </CardHeader>
                <CardContent>
                  {(() => {
                    const nodes = workflowNodes[selectedExecution.id] || []
                    const isRunning = selectedExecution.status === 'running' || selectedExecution.status === 'pending'

                    // If workflow has multiple nodes, show expandable view
                    if (nodes.length > 0) {
                      return (
                        <WorkflowNodeOutput
                          executionId={selectedExecution.id}
                          nodes={nodes}
                          isRunning={isRunning}
                        />
                      )
                    }

                    // Otherwise show single terminal for main job
                    const nodeStatusConfig = JOB_STATUS_CONFIG[selectedExecution.status as keyof typeof JOB_STATUS_CONFIG] || JOB_STATUS_CONFIG.pending

                    return (
                      <div className="border rounded-lg overflow-hidden">
                        {/* Job Header */}
                        <div className="bg-muted px-4 py-3 border-b">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <Activity className="w-4 h-4 text-blue-500" />
                              <span className="text-sm font-medium">Job Output</span>
                              <Badge className={`${nodeStatusConfig.bgColor} ${nodeStatusConfig.color} text-xs`}>
                                {nodeStatusConfig.label}
                              </Badge>
                              {isRunning && (
                                <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Terminal Output */}
                        <JobOutputViewer
                          executionId={selectedExecution.id}
                          isRunning={isRunning}
                          awxJobId={selectedExecution.awx_job_id}
                          isWorkflowNode={false}
                        />
                      </div>
                    )
                  })()}
                </CardContent>
              </Card>
            )}


            {!selectedExecution && executions.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Activity className="w-12 h-12 text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground">
                  No executions yet. Execute this request to see output.
                </p>
              </div>
            )}
          </div>
        </main>
      </div>
  )
}
