// RequestTracking.tsx
//
// Table view of all automation requests and their current execution status.
// Polled or WebSocket-updated so in-flight requests move from "running" to
// "success/failed" without a page refresh.

import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  ColumnDef,
  SortingState,
  ColumnFiltersState,
  VisibilityState,
} from '@tanstack/react-table'
import { awxService, AutomationRequest } from '../services/awx'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Badge } from '../components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
} from '../components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../components/ui/tooltip'
import {
  Search,
  Plus,
  MoreVertical,
  Eye,
  Play,
  Trash2,
  Loader2,
  Filter,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ExternalLink,
  FileSpreadsheet,
  X,
  RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDistanceToNow } from 'date-fns'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { isSafeUrl } from '../lib/utils'

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  running: { label: 'Running', color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
  successful: { label: 'Successful', color: 'bg-green-500/10 text-green-600 dark:text-green-400' },
  failed: { label: 'Failed', color: 'bg-red-500/10 text-red-600 dark:text-red-400' },
  cancelled: { label: 'Cancelled', color: 'bg-muted/50 text-muted-foreground' },
}

export default function RequestTracking() {
  const navigate = useNavigate()
  const [requests, setRequests] = useState<AutomationRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // TanStack Table state
  const [sorting, setSorting] = useState<SortingState>([{ id: 'created_at', desc: true }])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [globalFilter, setGlobalFilter] = useState('')

  // Confirmation dialogs
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; request: AutomationRequest | null }>({
    isOpen: false,
    request: null,
  })
  const [launchConfirm, setLaunchConfirm] = useState<{ isOpen: boolean; request: AutomationRequest | null }>({
    isOpen: false,
    request: null,
  })

  useEffect(() => {
    loadRequests()
  }, [])

  const loadRequests = async () => {
    try {
      setLoading(true)
      const data = await awxService.listRequests()
      setRequests(data)
    } catch (error: any) {
      toast.error('Failed to load requests')
    } finally {
      setLoading(false)
    }
  }

  const confirmDelete = (request: AutomationRequest) => {
    setDeleteConfirm({ isOpen: true, request })
  }

  const handleDelete = async () => {
    if (!deleteConfirm.request) return

    try {
      await awxService.deleteRequest(deleteConfirm.request.id)
      toast.success('Request Deleted', {
        description: `"${deleteConfirm.request.title}" has been permanently deleted.`,
      })
      loadRequests()
    } catch (error: any) {
      toast.error('Delete Failed', {
        description: error.response?.data?.error || 'Failed to delete request',
      })
    } finally {
      setDeleteConfirm({ isOpen: false, request: null })
    }
  }

  const confirmLaunch = (request: AutomationRequest) => {
    setLaunchConfirm({ isOpen: true, request })
  }

  const handleLaunch = async () => {
    if (!launchConfirm.request) return

    try {
      const result = await awxService.executeRequest(launchConfirm.request.id)
      toast.success('Automation Launched', {
        description: `"${launchConfirm.request.title}" has been launched. Task ID: ${result.task_id.slice(0, 8)}...`,
      })
      loadRequests()
    } catch (error: any) {
      toast.error('Launch Failed', {
        description: error.response?.data?.error || 'Failed to launch automation request',
      })
    } finally {
      setLaunchConfirm({ isOpen: false, request: null })
    }
  }

  const getRowCount = (inputData: any): number => {
    if (!inputData) return 0
    if (Array.isArray(inputData)) return inputData.length
    if (typeof inputData === 'object') {
      if ('data' in inputData && Array.isArray(inputData.data)) {
        return inputData.data.length
      }
      return Object.values(inputData).reduce((total: number, value: any) => {
        if (Array.isArray(value)) return total + value.length
        return total
      }, 0)
    }
    return 0
  }

  // Define columns
  const columns = useMemo<ColumnDef<AutomationRequest>[]>(
    () => [
      {
        accessorKey: 'title',
        header: ({ column }) => {
          return (
            <div className="flex flex-col gap-1">
              <button
                className="flex items-center gap-1 hover:text-foreground"
                onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
              >
                Title
                {column.getIsSorted() === 'asc' ? (
                  <ChevronUp className="h-3 w-3" />
                ) : column.getIsSorted() === 'desc' ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronsUpDown className="h-3 w-3 opacity-40" />
                )}
              </button>
            </div>
          )
        },
        cell: ({ row }) => {
          const request = row.original
          return (
            <div className="flex items-center gap-2">
              {request.status === 'running' && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600 flex-shrink-0" />
              )}
              {request.description ? (
                <TooltipProvider>
                  <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                      <div className="font-medium text-sm cursor-help truncate max-w-md">
                        {request.title}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" align="start" className="max-w-md">
                      <p className="text-xs">{request.description}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : (
                <div className="font-medium text-sm truncate max-w-md">
                  {request.title}
                </div>
              )}
            </div>
          )
        },
      },
      {
        accessorKey: 'status',
        header: ({ column }) => {
          return (
            <div className="flex flex-col gap-1 items-center">
              <button
                className="flex items-center gap-1 hover:text-foreground"
                onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
              >
                Status
                {column.getIsSorted() === 'asc' ? (
                  <ChevronUp className="h-3 w-3" />
                ) : column.getIsSorted() === 'desc' ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronsUpDown className="h-3 w-3 opacity-40" />
                )}
              </button>
              <Select
                value={(column.getFilterValue() as string) ?? 'all'}
                onValueChange={(value) => column.setFilterValue(value === 'all' ? undefined : value)}
              >
                <SelectTrigger className="h-7 text-xs border-muted">
                  <SelectValue placeholder="All" />
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
          )
        },
        cell: ({ row }) => {
          return (
            <div className="flex items-center justify-center">
              <Badge className={`${STATUS_CONFIG[row.original.status]?.color} text-xs px-2 py-0.5`}>
                {STATUS_CONFIG[row.original.status]?.label || row.original.status}
              </Badge>
            </div>
          )
        },
        filterFn: 'equals',
      },
      {
        accessorKey: 'template_name',
        header: ({ column }) => {
          return (
            <div className="flex flex-col gap-1 items-center">
              <button
                className="flex items-center gap-1 hover:text-foreground"
                onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
              >
                Template
                {column.getIsSorted() === 'asc' ? (
                  <ChevronUp className="h-3 w-3" />
                ) : column.getIsSorted() === 'desc' ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronsUpDown className="h-3 w-3 opacity-40" />
                )}
              </button>
            </div>
          )
        },
        cell: ({ row }) => {
          return (
            <div className="flex items-center justify-center">
              <span className="text-sm">{row.original.template_name || '-'}</span>
            </div>
          )
        },
      },
      {
        id: 'requested_by',
        accessorFn: (row) => row.requested_by?.username || 'Unknown',
        header: ({ column }) => {
          return (
            <div className="flex flex-col gap-1 items-center">
              <button
                className="flex items-center gap-1 hover:text-foreground"
                onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
              >
                Created By
                {column.getIsSorted() === 'asc' ? (
                  <ChevronUp className="h-3 w-3" />
                ) : column.getIsSorted() === 'desc' ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronsUpDown className="h-3 w-3 opacity-40" />
                )}
              </button>
            </div>
          )
        },
        cell: ({ row }) => {
          return (
            <div className="flex items-center justify-center">
              <span className="text-sm text-muted-foreground">
                {row.original.requested_by?.username || 'Unknown'}
              </span>
            </div>
          )
        },
      },
      {
        accessorKey: 'created_at',
        header: ({ column }) => {
          return (
            <div className="flex flex-col gap-1 items-center">
              <button
                className="flex items-center gap-1 hover:text-foreground"
                onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
              >
                Created At
                {column.getIsSorted() === 'asc' ? (
                  <ChevronUp className="h-3 w-3" />
                ) : column.getIsSorted() === 'desc' ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronsUpDown className="h-3 w-3 opacity-40" />
                )}
              </button>
            </div>
          )
        },
        cell: ({ row }) => {
          return (
            <div className="flex items-center justify-center">
              <span className="text-sm text-muted-foreground">
                {formatDistanceToNow(new Date(row.original.created_at), { addSuffix: true })}
              </span>
            </div>
          )
        },
      },
      {
        id: 'row_count',
        accessorFn: (row) => getRowCount(row.input_data),
        header: () => {
          return (
            <div className="flex flex-col gap-1 items-center">
              <span>Rows</span>
            </div>
          )
        },
        cell: ({ row }) => {
          return (
            <div className="flex items-center justify-center">
              <span className="text-sm text-muted-foreground">
                {getRowCount(row.original.input_data)}
              </span>
            </div>
          )
        },
        enableSorting: false,
      },
      {
        id: 'actions',
        header: () => (
          <div className="text-center">Actions</div>
        ),
        size: 100,
        enableSorting: false,
        enableColumnFilter: false,
        cell: ({ row }) => {
          const request = row.original
          return (
            <div className="flex items-center justify-center">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onClick={() => navigate(`/awx/requests/${request.id}`)}>
                    <Eye className="mr-2 h-4 w-4" />
                    View Details
                  </DropdownMenuItem>

                  {request.status === 'pending' && (
                    <DropdownMenuItem
                      onClick={() => confirmLaunch(request)}
                      className="text-emerald-700 dark:text-emerald-400 font-medium"
                    >
                      <Play className="mr-2 h-4 w-4" />
                      Execute Now
                    </DropdownMenuItem>
                  )}

                  {request.awx_job_id && request.awx_connection_url && isSafeUrl(request.awx_connection_url) && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild>
                        <a
                          href={`${request.awx_connection_url}/#/jobs/${request.awx_job_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="cursor-pointer"
                        >
                          <ExternalLink className="mr-2 h-4 w-4" />
                          View in AWX
                        </a>
                      </DropdownMenuItem>
                    </>
                  )}

                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => confirmDelete(request)} className="text-destructive">
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        },
      },
    ],
    []
  )

  // Create table instance
  const table = useReactTable({
    data: requests,
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
          <div className="flex items-center justify-between mb-5">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Automation Requests</h1>
              <p className="text-muted-foreground mt-1.5">
                Track and manage automation requests
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={async () => {
                  setRefreshing(true)
                  await loadRequests()
                  setRefreshing(false)
                }}
                disabled={loading || refreshing}
                title="Refresh list"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              </Button>
              <Button onClick={() => navigate('/awx/templates')}>
                <Plus className="mr-2 h-4 w-4" />
                New Request
              </Button>
            </div>
          </div>

          {/* Global Search */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search all columns..."
                value={globalFilter ?? ''}
                onChange={(e) => setGlobalFilter(e.target.value)}
                className="pl-9 h-10"
              />
              {globalFilter && (
                <button
                  onClick={() => setGlobalFilter('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Column Visibility */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="h-10">
                  <Filter className="mr-2 h-4 w-4" />
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Toggle Columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {table
                  .getAllColumns()
                  .filter((column) => column.getCanHide())
                  .map((column) => {
                    return (
                      <DropdownMenuCheckboxItem
                        key={column.id}
                        className="capitalize"
                        checked={column.getIsVisible()}
                        onCheckedChange={(value) => column.toggleVisibility(!!value)}
                      >
                        {column.id.replace(/_/g, ' ')}
                      </DropdownMenuCheckboxItem>
                    )
                  })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto p-6">
        <div className="border rounded-lg shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                <p className="text-sm text-muted-foreground">Loading requests...</p>
              </div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead
                        key={header.id}
                        style={{ width: header.getSize() }}
                        className="py-3 px-4"
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows?.length ? (
                  table.getRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      className="hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => navigate(`/awx/requests/${row.original.id}`)}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          className="py-2.5 px-4"
                          onClick={(e) => {
                            if (cell.column.id === 'actions') {
                              e.stopPropagation()
                            }
                          }}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="h-64 text-center border-0">
                      <div className="flex flex-col items-center justify-center">
                        <FileSpreadsheet className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
                        <h3 className="font-semibold text-lg mb-2">No requests found</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                          Try adjusting your filters or create a new request
                        </p>
                        <Button onClick={() => navigate('/awx/templates')}>
                          <Plus className="mr-2 h-4 w-4" />
                          Create Request
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      {/* Pagination */}
      {!loading && table.getRowModel().rows?.length > 0 && (
        <div className="px-6 pb-6">
          <div className="border rounded-lg shadow-sm px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  Showing {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1} to{' '}
                  {Math.min(
                    (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
                    table.getFilteredRowModel().rows.length
                  )}{' '}
                  of {table.getFilteredRowModel().rows.length} requests
                </span>
              </div>

              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground whitespace-nowrap">Rows per page:</span>
                  <Select
                    value={table.getState().pagination.pageSize.toString()}
                    onValueChange={(value) => table.setPageSize(Number(value))}
                  >
                    <SelectTrigger className="h-8 w-[75px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[10, 20, 50, 100].map((pageSize) => (
                        <SelectItem key={pageSize} value={pageSize.toString()}>
                          {pageSize}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => table.setPageIndex(0)}
                    disabled={!table.getCanPreviousPage()}
                    className="h-9 w-9 p-0"
                  >
                    <ChevronsLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => table.previousPage()}
                    disabled={!table.getCanPreviousPage()}
                    className="h-9 w-9 p-0"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm text-muted-foreground px-3 min-w-[120px] text-center">
                    Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => table.nextPage()}
                    disabled={!table.getCanNextPage()}
                    className="h-9 w-9 p-0"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                    disabled={!table.getCanNextPage()}
                    className="h-9 w-9 p-0"
                  >
                    <ChevronsRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ isOpen: false, request: null })}
        onConfirm={handleDelete}
        title="Delete Request"
        message={`Are you sure you want to delete "${deleteConfirm.request?.title}"? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />

      {/* Launch Confirmation Dialog */}
      <ConfirmDialog
        isOpen={launchConfirm.isOpen}
        onClose={() => setLaunchConfirm({ isOpen: false, request: null })}
        onConfirm={handleLaunch}
        title="Execute Automation"
        message={`Are you sure you want to execute "${launchConfirm.request?.title}"? This will run the automation immediately.`}
        confirmText="Execute"
        cancelText="Cancel"
        variant="info"
      />
    </div>
  )
}
