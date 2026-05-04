// ExecutionsMonitoring.tsx
//
// Real-time AWX execution monitor. Shows running and recently completed AWX jobs
// with live output streamed from the JobOutputViewer via WebSocket.
// Uses a polling fallback if the WebSocket connection drops.

import { useState, useEffect, useRef } from 'react'
import { awxService, AutomationExecution } from '../services/awx'
import { JobOutputViewer } from '../components/awx/JobOutputViewer'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Badge } from '../components/ui/badge'
import { Progress } from '../components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../components/ui/tabs'


import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table'
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import {
  Search,
  RefreshCw,
  MoreVertical,
  Eye,
  ExternalLink,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  PlayCircle,
  StopCircle,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Network,
  Terminal,
  Zap,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Columns3,
  Hash,
  Activity,
  Timer,
  Calendar,
  CalendarCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { isSafeUrl } from '../lib/utils'
import { useFormatters } from '@/contexts/TimezoneContext'

type AutoRefreshInterval = 0 | 5000 | 10000 | 30000 | 60000

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  pending: { label: 'Pending', color: 'bg-muted/50 text-muted-foreground', icon: Clock },
  waiting: { label: 'Waiting', color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400', icon: Clock },
  running: { label: 'Running', color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400', icon: PlayCircle },
  successful: { label: 'Successful', color: 'bg-green-500/10 text-green-600 dark:text-green-400', icon: CheckCircle2 },
  failed: { label: 'Failed', color: 'bg-red-500/10 text-red-600 dark:text-red-400', icon: XCircle },
  error: { label: 'Error', color: 'bg-red-500/10 text-red-600 dark:text-red-400', icon: AlertCircle },
  canceled: { label: 'Canceled', color: 'bg-muted/50 text-muted-foreground', icon: StopCircle },
}

const AUTO_REFRESH_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 5000, label: '5 seconds' },
  { value: 10000, label: '10 seconds' },
  { value: 30000, label: '30 seconds' },
  { value: 60000, label: '1 minute' },
]

export default function ExecutionsMonitoring() {
  const { formatDateTime } = useFormatters()
  const [executions, setExecutions] = useState<AutomationExecution[]>([])
  const [loading, setLoading] = useState(true)
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<AutoRefreshInterval>(10000)
  const [selectedExecution, setSelectedExecution] = useState<AutomationExecution | null>(null)
  const [detailDialogOpen, setDetailDialogOpen] = useState(false)
  const [cancelConfirm, setCancelConfirm] = useState<AutomationExecution | null>(null)
  const executionsRef = useRef<AutomationExecution[]>([])

  // TanStack Table state
  const [sorting, setSorting] = useState<SortingState>([{ id: 'created_at', desc: true }])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [globalFilter, setGlobalFilter] = useState('')

  // Keep ref in sync with state
  useEffect(() => {
    executionsRef.current = executions
  }, [executions])

  // Load executions on mount
  useEffect(() => {
    loadExecutions()
  }, [])

  // Auto-refresh based on selected interval
  useEffect(() => {
    if (autoRefreshInterval === 0) return

    const interval = setInterval(() => {
      // Only refresh if there are active executions
      const hasActive = executionsRef.current.some((e) =>
        e.status === 'running' || e.status === 'pending' || e.status === 'waiting'
      )
      if (hasActive) {
        loadExecutions()
      }
    }, autoRefreshInterval)

    return () => clearInterval(interval)
  }, [autoRefreshInterval])

  const loadExecutions = async () => {
    try {
      setLoading(true)
      const data = await awxService.listExecutions()
      setExecutions(data)
    } catch (error: any) {
      toast.error('Failed to load executions')
    } finally {
      setLoading(false)
    }
  }

  const handleViewDetails = (execution: AutomationExecution) => {
    setSelectedExecution(execution)
    setDetailDialogOpen(true)
  }

  const confirmCancelExecution = (execution: AutomationExecution) => {
    setCancelConfirm(execution)
  }

  const handleCancelExecution = async () => {
    if (!cancelConfirm) return

    try {
      await awxService.cancelExecution(cancelConfirm.id)
      toast.success('Execution cancellation requested', {
        description: 'The running job in AWX will be stopped'
      })
      setCancelConfirm(null)
      loadExecutions()
    } catch (error: any) {
      toast.error('Failed to cancel execution', {
        description: error.response?.data?.error || 'An error occurred while canceling'
      })
    }
  }

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '-'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}m ${secs}s`
  }

  // Duration falls back to now - started_at while the job is still running
  // or while the backend hasn't stamped elapsed_seconds yet.
  const resolveDuration = (ex: AutomationExecution): string => {
    if (ex.elapsed_seconds) return formatDuration(ex.elapsed_seconds)
    const start = ex.started_at || ex.created_at
    if (!start) return '-'
    const end = ex.finished_at ? new Date(ex.finished_at).getTime() : Date.now()
    const elapsed = Math.max(0, (end - new Date(start).getTime()) / 1000)
    return formatDuration(elapsed)
  }

  const resolveStartedAt = (ex: AutomationExecution): string => {
    const start = ex.started_at || ex.created_at
    return start ? formatDateTime(start) : '—'
  }

  const getStatusBadge = (status: string) => {
    const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending
    const StatusIcon = config.icon
    return (
      <Badge className={config.color}>
        <StatusIcon className="mr-1 h-3 w-3" />
        {config.label}
      </Badge>
    )
  }

  // Column definitions
  const columns: ColumnDef<AutomationExecution>[] = [
    {
      accessorKey: 'template_name',
      header: ({ column }) => (
        <div className="flex flex-col gap-1">
          <button
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors w-full"
          >
            Template
            {column.getIsSorted() === 'asc' ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : column.getIsSorted() === 'desc' ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
            )}
          </button>
        </div>
      ),
      cell: ({ row }) => {
        const execution = row.original
        return (
          <div className="font-medium text-sm truncate max-w-[200px]">
            {execution.template_name || 'Unknown Template'}
          </div>
        )
      },
    },
    {
      accessorKey: 'automation_request_title',
      header: ({ column }) => (
        <div className="flex flex-col gap-1 items-center">
          <button
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            Request
            {column.getIsSorted() === 'asc' ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : column.getIsSorted() === 'desc' ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
            )}
          </button>
        </div>
      ),
      cell: ({ row }) => (
        <div className="flex items-center justify-center">
          <div className="text-sm truncate max-w-[250px]">
            {row.original.automation_request_title || 'Unknown Request'}
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'status',
      header: ({ column }) => (
        <div className="flex flex-col gap-1 items-center">
          <button
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            Status
            {column.getIsSorted() === 'asc' ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : column.getIsSorted() === 'desc' ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
            )}
          </button>
          <Select
            value={(column.getFilterValue() as string) ?? 'all'}
            onValueChange={(value) => column.setFilterValue(value === 'all' ? undefined : value)}
          >
            <SelectTrigger className="h-7 w-[130px] text-xs">
              <SelectValue placeholder="Filter..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {Object.entries(STATUS_CONFIG).map(([status, config]) => (
                <SelectItem key={status} value={status}>
                  {config.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ),
      cell: ({ row }) => (
        <div className="flex items-center justify-center">
          {getStatusBadge(row.original.status)}
        </div>
      ),
      filterFn: 'equals',
    },
    {
      accessorKey: 'progress_percentage',
      header: () => <div className="text-center">Progress</div>,
      cell: ({ row }) => {
        const execution = row.original
        return (
          <div className="flex items-center justify-center">
            {execution.status === 'running' || execution.status === 'pending' ? (
              <div className="w-24">
                <Progress value={execution.progress_percentage || 0} className="h-2" />
                <span className="text-xs text-muted-foreground mt-0.5 block text-center">
                  {execution.progress_percentage || 0}%
                </span>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">-</span>
            )}
          </div>
        )
      },
      enableSorting: false,
    },
    {
      accessorKey: 'awx_job_id',
      header: () => <div className="text-center">AWX Job</div>,
      cell: ({ row }) => {
        const execution = row.original
        return (
          <div className="flex items-center justify-center">
            {execution.awx_job_id ? (
              <div className="flex items-center gap-1">
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                  #{execution.awx_job_id}
                </code>
                {execution.awx_job_url && isSafeUrl(execution.awx_job_url) && (
                  <a
                    href={execution.awx_job_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-primary hover:text-primary/80"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">-</span>
            )}
          </div>
        )
      },
      enableSorting: false,
    },
    {
      accessorKey: 'elapsed_seconds',
      header: ({ column }) => (
        <div className="flex items-center justify-center">
          <button
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            Duration
            {column.getIsSorted() === 'asc' ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : column.getIsSorted() === 'desc' ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
            )}
          </button>
        </div>
      ),
      cell: ({ row }) => (
        <div className="flex items-center justify-center text-sm text-muted-foreground">
          {formatDuration(row.original.elapsed_seconds)}
        </div>
      ),
    },
    {
      accessorKey: 'created_at',
      header: ({ column }) => (
        <div className="flex items-center justify-center">
          <button
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            Created
            {column.getIsSorted() === 'asc' ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : column.getIsSorted() === 'desc' ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
            )}
          </button>
        </div>
      ),
      cell: ({ row }) => (
        <div className="flex items-center justify-center text-sm text-muted-foreground">
          {formatDateTime(row.original.created_at)}
        </div>
      ),
    },
    {
      id: 'actions',
      header: () => <div className="text-center">Actions</div>,
      cell: ({ row }) => {
        const execution = row.original
        return (
          <div className="flex items-center justify-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="sm">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    handleViewDetails(execution)
                  }}
                >
                  <Eye className="mr-2 h-4 w-4" />
                  View Details
                </DropdownMenuItem>
                {execution.awx_job_url && isSafeUrl(execution.awx_job_url) && (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation()
                      window.open(execution.awx_job_url, '_blank')
                    }}
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open in AWX
                  </DropdownMenuItem>
                )}
                {(execution.status === 'running' || execution.status === 'pending') && (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation()
                      confirmCancelExecution(execution)
                    }}
                    className="text-destructive"
                  >
                    <StopCircle className="mr-2 h-4 w-4" />
                    Cancel
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      },
      enableSorting: false,
    },
  ]

  // TanStack Table setup
  const table = useReactTable({
    data: executions,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      globalFilter,
    },
    initialState: {
      pagination: {
        pageSize: 20,
      },
    },
  })

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="border-b">
        <div className="px-6 py-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Automation Executions</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Monitor {executions.length} job execution{executions.length !== 1 ? 's' : ''} in real-time
              </p>
            </div>
            <div className="flex gap-2">
              <Select
                value={autoRefreshInterval.toString()}
                onValueChange={(v) => setAutoRefreshInterval(Number(v) as AutoRefreshInterval)}
              >
                <SelectTrigger className="w-36">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUTO_REFRESH_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value.toString()}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={loadExecutions} variant="outline" disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>

          {/* Search and column visibility */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search all columns..."
                value={globalFilter ?? ''}
                onChange={(e) => table.setGlobalFilter(e.target.value)}
                className="pl-10"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="default">
                  <Columns3 className="mr-2 h-4 w-4" />
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {table
                  .getAllColumns()
                  .filter((column) => column.getCanHide())
                  .map((column) => {
                    return (
                      <DropdownMenuItem
                        key={column.id}
                        className="capitalize"
                        onClick={() => column.toggleVisibility(!column.getIsVisible())}
                      >
                        <input
                          type="checkbox"
                          checked={column.getIsVisible()}
                          onChange={() => column.toggleVisibility(!column.getIsVisible())}
                          className="mr-2"
                        />
                        {column.id.replace(/_/g, ' ')}
                      </DropdownMenuItem>
                    )
                  })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-96">
            <div className="text-center">
              <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Loading executions...</p>
            </div>
          </div>
        ) : table.getRowModel().rows.length === 0 ? (
          <div className="flex items-center justify-center h-96">
            <div className="text-center max-w-md">
              <Zap className="h-16 w-16 text-muted-foreground mx-auto mb-4 opacity-50" />
              <h3 className="text-lg font-semibold mb-2">No executions found</h3>
              <p className="text-sm text-muted-foreground">
                {globalFilter || columnFilters.length > 0
                  ? 'Try adjusting your search or filters'
                  : 'Launch automation requests to see executions here'}
              </p>
            </div>
          </div>
        ) : (
          <div className="border rounded-lg shadow-sm overflow-hidden">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id} className="py-3 px-4">
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="hover:bg-muted/30 cursor-pointer"
                    onClick={() => handleViewDetails(row.original)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="py-2.5 px-4">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {!loading && table.getRowModel().rows.length > 0 && (
        <div className="px-6 pb-6">
          <div className="border rounded-lg shadow-sm px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <span className="text-sm text-muted-foreground">
                  Showing{' '}
                  <span className="font-medium text-foreground">
                    {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1}
                  </span>{' '}
                  to{' '}
                  <span className="font-medium text-foreground">
                    {Math.min(
                      (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
                      table.getFilteredRowModel().rows.length
                    )}
                  </span>{' '}
                  of{' '}
                  <span className="font-medium text-foreground">
                    {table.getFilteredRowModel().rows.length}
                  </span>{' '}
                  execution{table.getFilteredRowModel().rows.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <Select
                  value={table.getState().pagination.pageSize.toString()}
                  onValueChange={(value) => table.setPageSize(Number(value))}
                >
                  <SelectTrigger className="h-9 w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 20, 50, 100].map((pageSize) => (
                      <SelectItem key={pageSize} value={pageSize.toString()}>
                        {pageSize} per page
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => table.setPageIndex(0)}
                    disabled={!table.getCanPreviousPage()}
                  >
                    <ChevronsLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => table.previousPage()}
                    disabled={!table.getCanPreviousPage()}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm font-medium">
                    Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => table.nextPage()}
                    disabled={!table.getCanNextPage()}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                    disabled={!table.getCanNextPage()}
                  >
                    <ChevronsRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-hidden">
          {selectedExecution && (
            <>
              <DialogHeader>
                <div className="flex items-start justify-between gap-3 pr-10">
                  <div className="flex-1 min-w-0">
                    <DialogTitle className="text-2xl truncate">
                      {selectedExecution.automation_request_title}
                    </DialogTitle>
                    <DialogDescription className="mt-2 truncate">
                      Template: {selectedExecution.template_name}
                    </DialogDescription>
                  </div>
                  <div className="flex-shrink-0">
                    {getStatusBadge(selectedExecution.status)}
                  </div>
                </div>
              </DialogHeader>

              <Tabs defaultValue="overview" className="mt-4 min-w-0 overflow-hidden">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="workflow">
                    <Network className="mr-2 h-4 w-4" />
                    Workflow Jobs
                  </TabsTrigger>
                  <TabsTrigger value="output">
                    <Terminal className="mr-2 h-4 w-4" />
                    Output
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-4 min-w-0 max-h-[65vh] overflow-y-auto pr-1">
                  <div className="rounded-lg border bg-card divide-y">
                    <div className="grid grid-cols-2 divide-x">
                      <div className="flex items-start gap-3 p-4">
                        <Hash className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">AWX Job ID</p>
                          <p className="text-sm font-medium font-mono truncate">
                            {selectedExecution.awx_job_id ? `#${selectedExecution.awx_job_id}` : 'N/A'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 p-4">
                        <Activity className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">Status</p>
                          <p className="text-sm font-medium capitalize truncate">{selectedExecution.status}</p>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 divide-x">
                      <div className="flex items-start gap-3 p-4">
                        <Zap className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-muted-foreground">Progress</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Progress
                              value={selectedExecution.progress_percentage || 0}
                              className="h-1.5 flex-1"
                            />
                            <span className="text-xs font-medium tabular-nums">
                              {selectedExecution.progress_percentage || 0}%
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 p-4">
                        <Timer className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">Duration</p>
                          <p className="text-sm font-medium tabular-nums truncate">
                            {resolveDuration(selectedExecution)}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 divide-x">
                      <div className="flex items-start gap-3 p-4">
                        <Calendar className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">Started At</p>
                          <p className="text-sm font-medium truncate">
                            {resolveStartedAt(selectedExecution)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 p-4">
                        <CalendarCheck className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">Finished At</p>
                          <p className="text-sm font-medium truncate">
                            {selectedExecution.finished_at
                              ? formatDateTime(selectedExecution.finished_at)
                              : '—'}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {selectedExecution.current_task && (
                    <div className="rounded-lg border bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground mb-1.5">Current Task</p>
                      <p className="text-sm font-mono break-all">
                        {selectedExecution.current_task}
                      </p>
                    </div>
                  )}

                  {selectedExecution.awx_job_url && isSafeUrl(selectedExecution.awx_job_url) && (
                    <Button
                      variant="outline"
                      onClick={() => window.open(selectedExecution.awx_job_url, '_blank')}
                      className="w-full"
                    >
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Open in AWX
                    </Button>
                  )}
                </TabsContent>

                <TabsContent value="workflow" className="space-y-4 min-w-0 max-h-[65vh] overflow-y-auto pr-1">
                  {selectedExecution.execution_metadata?.workflow_nodes &&
                  selectedExecution.execution_metadata.workflow_nodes.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground mb-3">
                        This workflow contains {selectedExecution.execution_metadata.workflow_nodes.length}{' '}
                        job(s)
                      </p>
                      <div className="space-y-2">
                        {selectedExecution.execution_metadata.workflow_nodes.map((node, index) => {
                          const jobName = node.summary_fields?.job?.name || `Job ${node.id}`
                          const jobStatus = node.status || 'unknown'
                          const jobId = node.summary_fields?.job?.id

                          return (
                            <div
                              key={node.id}
                              className="border rounded-lg p-3 hover:bg-muted/50 transition-colors"
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-mono text-muted-foreground">
                                      #{index + 1}
                                    </span>
                                  </div>
                                  <div className="flex-1">
                                    <p className="font-medium text-sm">{jobName}</p>
                                    {jobId && (
                                      <p className="text-xs text-muted-foreground">Job ID: {jobId}</p>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {jobStatus === 'successful' && (
                                    <Badge variant="default" className="bg-green-500">
                                      <CheckCircle2 className="mr-1 h-3 w-3" />
                                      Success
                                    </Badge>
                                  )}
                                  {jobStatus === 'failed' && (
                                    <Badge variant="destructive">
                                      <XCircle className="mr-1 h-3 w-3" />
                                      Failed
                                    </Badge>
                                  )}
                                  {jobStatus === 'running' && (
                                    <Badge variant="default" className="bg-blue-500">
                                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                      Running
                                    </Badge>
                                  )}
                                  {jobStatus === 'pending' && (
                                    <Badge variant="secondary">
                                      <Clock className="mr-1 h-3 w-3" />
                                      Pending
                                    </Badge>
                                  )}
                                  {jobStatus === 'canceled' && (
                                    <Badge variant="outline">
                                      <StopCircle className="mr-1 h-3 w-3" />
                                      Canceled
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-12 text-muted-foreground">
                      <Network className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>This is not a workflow job or workflow data is not available</p>
                      <p className="text-sm mt-1">Single job templates don't have workflow nodes</p>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="output" className="mt-0 min-w-0 overflow-hidden">
                  <JobOutputViewer
                    executionId={selectedExecution.id}
                    isRunning={
                      selectedExecution.status === 'running' || selectedExecution.status === 'pending'
                    }
                    className="h-[600px] w-full"
                  />
                </TabsContent>
              </Tabs>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Cancel Execution Confirmation */}
      <ConfirmDialog
        isOpen={!!cancelConfirm}
        onClose={() => setCancelConfirm(null)}
        onConfirm={handleCancelExecution}
        title="Cancel Execution"
        message={`Are you sure you want to cancel this execution? This will attempt to stop the running job in AWX and cannot be undone.`}
        confirmText="Cancel Execution"
        variant="danger"
      />
    </div>
  )
}
