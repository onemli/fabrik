// AuditLogs.tsx
//
// Read-only compliance log viewer. Admin-only page that shows every action
// recorded by AuditService — query runs, automation launches, login events, etc.
// Supports date range filtering and category-based filtering.

import { useState, useEffect, useMemo } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import {
  useReactTable, getCoreRowModel, getSortedRowModel, flexRender,
  ColumnDef, SortingState, VisibilityState, PaginationState,
} from '@tanstack/react-table'
import { auditLogService } from '@/services/auditLog'
import { usePermissions } from '@/hooks/usePermissions'
import { useDebounce } from '@/hooks/useDebounce'
import {
  Shield, Search, Download, RefreshCw, Activity, Users, Lock,
  Settings as SettingsIcon, FileText, AlertCircle, CheckCircle,
  TrendingUp, X, Calendar, Filter, ChevronLeft, ChevronRight,
  ChevronsLeft, ChevronsRight, ChevronUp, ChevronDown, ChevronsUpDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import type { AuditLog } from '@/types/audit'
import { cn } from '@/lib/utils'
import { useFormatters } from '@/contexts/TimezoneContext'

export default function AuditLogs() {
  const { isAdmin } = usePermissions()
  const { formatDate, formatTime, formatDateTime } = useFormatters()

  // Server-side filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [successFilter, setSuccessFilter] = useState<string>('all')
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null)

  // TanStack Table state
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 })

  const debouncedSearch = useDebounce(searchQuery, 300)

  useEffect(() => {
    setPagination(p => ({ ...p, pageIndex: 0 }))
  }, [debouncedSearch, categoryFilter, successFilter])

  const { data: logsResponse, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['audit-logs', debouncedSearch, categoryFilter, successFilter, pagination.pageIndex, pagination.pageSize],
    queryFn: async () => {
      return auditLogService.listLogs({
        search: debouncedSearch || undefined,
        category: categoryFilter !== 'all' ? categoryFilter : undefined,
        success: successFilter !== 'all' ? successFilter === 'true' : undefined,
        page: pagination.pageIndex + 1,
      })
    },
    enabled: isAdmin,
    retry: false,
    placeholderData: keepPreviousData,
  })

  const { data: stats } = useQuery({
    queryKey: ['audit-stats'],
    queryFn: async () => auditLogService.getStats(),
    enabled: isAdmin,
    retry: false,
  })

  const logs: AuditLog[] = useMemo(
    () => Array.isArray(logsResponse) ? logsResponse : (logsResponse?.results || []),
    [logsResponse]
  )
  const totalCount = Array.isArray(logsResponse) ? logsResponse.length : (logsResponse?.count || 0)

  const columns = useMemo<ColumnDef<AuditLog>[]>(() => [
    {
      id: 'user_action',
      header: 'User & Action',
      accessorFn: (row) => row.username,
      cell: ({ row }) => {
        const log = row.original
        return (
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold flex-shrink-0">
              {log.username.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="font-medium text-sm truncate">{log.username}</p>
              <p className="text-xs text-muted-foreground truncate">{log.action_display}</p>
            </div>
          </div>
        )
      },
    },
    {
      accessorKey: 'description',
      header: 'Description',
      cell: ({ getValue }) => (
        <p className="text-sm text-muted-foreground line-clamp-2">{getValue() as string}</p>
      ),
    },
    {
      accessorKey: 'category',
      header: 'Category',
      cell: ({ row }) => {
        const log = row.original
        const config = getCategoryConfig(log.category)
        const Icon = config.icon
        return (
          <Badge variant="outline" className="gap-1.5">
            <Icon className={cn('h-3 w-3', config.color)} />
            <span className="text-xs">{log.category_display}</span>
          </Badge>
        )
      },
    },
    {
      accessorKey: 'timestamp',
      header: 'Timestamp',
      cell: ({ getValue }) => (
        <div className="text-xs text-muted-foreground">
          <div className="font-medium">{formatDate(getValue() as string)}</div>
          <div>{formatTime(getValue() as string)}</div>
        </div>
      ),
    },
    {
      accessorKey: 'success',
      header: 'Status',
      enableSorting: false,
      cell: ({ getValue }) => getValue() ? (
        <div className="w-6 h-6 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
          <CheckCircle className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
        </div>
      ) : (
        <div className="w-6 h-6 rounded-full bg-red-500/10 flex items-center justify-center mx-auto">
          <AlertCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
        </div>
      ),
    },
  ], [formatDate, formatTime])

  const table = useReactTable({
    data: logs,
    columns,
    manualPagination: true,
    pageCount: Math.ceil(totalCount / pagination.pageSize),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    state: { sorting, columnVisibility, pagination },
  })

  const handleExport = async () => {
    try {
      await auditLogService.exportLogs({
        search: debouncedSearch || undefined,
        category: categoryFilter !== 'all' ? categoryFilter : undefined,
      })
      toast.success('Logs exported successfully')
    } catch (error) {
      toast.error('Failed to export logs')
    }
  }

  const getCategoryConfig = (category: string) => {
    const configs: Record<string, { icon: any; color: string; bgColor: string }> = {
      'user_management': {
        icon: Users,
        color: 'text-blue-600 dark:text-blue-400',
        bgColor: 'bg-blue-500/10',
      },
      'group_permission': {
        icon: Shield,
        color: 'text-purple-600 dark:text-purple-400',
        bgColor: 'bg-purple-500/10',
      },
      'query_execution': {
        icon: Activity,
        color: 'text-green-600 dark:text-green-400',
        bgColor: 'bg-green-500/10',
      },
      'login_logout': {
        icon: Lock,
        color: 'text-amber-600 dark:text-amber-400',
        bgColor: 'bg-amber-500/10',
      },
      'settings_change': {
        icon: SettingsIcon,
        color: 'text-orange-600 dark:text-orange-400',
        bgColor: 'bg-orange-500/10',
      },
      'api_access': {
        icon: FileText,
        color: 'text-slate-600 dark:text-slate-400',
        bgColor: 'bg-slate-500/10',
      },
    }
    return configs[category] || configs['api_access']
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-6 animate-in fade-in duration-500">
          <div className="relative">
            <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-red-500 to-pink-500 flex items-center justify-center shadow-lg">
              <Shield className="h-10 w-10 text-foreground" />
            </div>
            <div className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center">
              <X className="h-4 w-4 text-foreground" />
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
              Access Denied
            </h1>
            <p className="text-muted-foreground max-w-sm mx-auto">
              You need administrator privileges to access audit logs. Please contact your system administrator.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-background">

      <div className="flex-1 overflow-auto">
        <div className="p-6 space-y-6">
          {/* Professional Header */}
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Shield className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight">Audit Logs</h1>
                  <p className="text-sm text-muted-foreground">
                    System activity tracking and monitoring
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                onClick={() => refetch()}
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={isFetching}
              >
                <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
                {isFetching ? 'Refreshing...' : 'Refresh'}
              </Button>
              <Button
                onClick={handleExport}
                variant="default"
                size="sm"
                className="gap-2"
              >
                <Download className="h-4 w-4" />
                Export CSV
              </Button>
            </div>
          </div>

          {/* Stats Cards */}
          {stats && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-card border border-border rounded-lg p-4 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between mb-2">
                  <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
                    <FileText className="h-4 w-4 text-primary" />
                  </div>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Total Logs</p>
                  <p className="text-2xl font-bold mt-0.5">{stats.total_logs?.toLocaleString()}</p>
                </div>
              </div>

              {stats.by_category?.slice(0, 3).map((cat: { category: string; count: number }) => {
                const config = getCategoryConfig(cat.category)
                const Icon = config.icon
                return (
                  <div
                    key={cat.category}
                    className="bg-card border border-border rounded-lg p-4 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className={cn("w-8 h-8 rounded-md flex items-center justify-center", config.bgColor)}>
                        <Icon className={cn("h-4 w-4", config.color)} />
                      </div>
                      <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground capitalize">
                        {cat.category.replace('_', ' ')}
                      </p>
                      <p className="text-2xl font-bold mt-0.5">{cat.count?.toLocaleString()}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Professional Filter Panel */}
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-4">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Filters</h3>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Search */}
              <div className="lg:col-span-4">
                <label className="text-xs font-medium text-muted-foreground mb-2 block">Search</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="User, action, resource..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 h-9"
                  />
                </div>
              </div>

              {/* Category Filter */}
              <div className="lg:col-span-4">
                <label className="text-xs font-medium text-muted-foreground mb-2 block">Category</label>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="all">All Categories</option>
                  <option value="user_management">User Management</option>
                  <option value="query_execution">Query Execution</option>
                  <option value="login_logout">Login/Logout</option>
                  <option value="settings_change">Settings Change</option>
                  <option value="group_permission">Group & Permission</option>
                  <option value="api_access">API Access</option>
                </select>
              </div>

              {/* Status Filter */}
              <div className="lg:col-span-4">
                <label className="text-xs font-medium text-muted-foreground mb-2 block">Status</label>
                <select
                  value={successFilter}
                  onChange={(e) => setSuccessFilter(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="all">All Status</option>
                  <option value="true">Success Only</option>
                  <option value="false">Failed Only</option>
                </select>
              </div>
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-semibold text-red-600 text-sm mb-1">Failed to load audit logs</h3>
                  <p className="text-xs text-red-600/80">{error instanceof Error ? error.message : 'Unknown error'}</p>
                  <Button onClick={() => refetch()} className="mt-3" variant="outline" size="sm" disabled={isFetching}>
                    <RefreshCw className={cn("h-4 w-4 mr-2", isFetching && "animate-spin")} />
                    {isFetching ? 'Retrying...' : 'Try Again'}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Table toolbar */}
          <div className="flex items-center gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="h-10 ml-auto">
                  <Filter className="mr-2 h-4 w-4" />Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Toggle Columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {table.getAllColumns().filter(c => c.getCanHide()).map(column => (
                  <DropdownMenuCheckboxItem key={column.id} className="capitalize"
                    checked={column.getIsVisible()}
                    onCheckedChange={(v) => column.toggleVisibility(!!v)}>
                    {column.id.replace(/_/g, ' ')}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Table */}
          <div className="border rounded-lg shadow-sm overflow-hidden">
            {isLoading ? (
              <div className="p-6 space-y-3">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="flex items-center gap-3 animate-pulse">
                    <div className="w-8 h-8 rounded bg-muted" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 bg-muted rounded w-3/4" />
                      <div className="h-2 bg-muted rounded w-1/2" />
                    </div>
                    <div className="w-16 h-5 bg-muted rounded" />
                  </div>
                ))}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  {table.getHeaderGroups().map(headerGroup => (
                    <TableRow key={headerGroup.id}>
                      {headerGroup.headers.map(header => (
                        <TableHead key={header.id}
                          className={header.column.getCanSort() ? 'cursor-pointer select-none' : ''}
                          onClick={header.column.getToggleSortingHandler()}>
                          {header.isPlaceholder ? null : (
                            <div className="flex items-center gap-1">
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {header.column.getCanSort() && (
                                header.column.getIsSorted() === 'asc' ? <ChevronUp className="h-3.5 w-3.5" />
                                : header.column.getIsSorted() === 'desc' ? <ChevronDown className="h-3.5 w-3.5" />
                                : <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
                              )}
                            </div>
                          )}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {table.getRowModel().rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={columns.length} className="py-16 text-center">
                        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-muted mb-3">
                          <FileText className="h-6 w-6 text-muted-foreground" />
                        </div>
                        <p className="text-sm font-semibold">No activity found</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {searchQuery || categoryFilter !== 'all' || successFilter !== 'all'
                            ? 'Try adjusting your filters'
                            : 'Activity logs will appear here'}
                        </p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    table.getRowModel().rows.map(row => (
                      <TableRow key={row.id}
                        className="cursor-pointer hover:bg-accent/50"
                        onClick={() => setSelectedLog(row.original)}>
                        {row.getVisibleCells().map(cell => (
                          <TableCell key={cell.id}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </div>

          {/* Pagination bar — matches TemplateLibrary exactly */}
          {!isLoading && table.getRowModel().rows.length > 0 && (
            <div className="border rounded-lg shadow-sm px-6 py-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Showing{' '}
                  {pagination.pageIndex * pagination.pageSize + 1} to{' '}
                  {Math.min((pagination.pageIndex + 1) * pagination.pageSize, totalCount)} of{' '}
                  {totalCount.toLocaleString()} logs
                </span>
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground whitespace-nowrap">Rows per page:</span>
                    <Select
                      value={pagination.pageSize.toString()}
                      onValueChange={(v) => table.setPageSize(Number(v))}
                    >
                      <SelectTrigger className="h-8 w-[75px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[25, 50, 100].map(size => (
                          <SelectItem key={size} value={size.toString()}>{size}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" className="h-9 w-9 p-0"
                      onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage() || isFetching}>
                      <ChevronsLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="sm" className="h-9 w-9 p-0"
                      onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage() || isFetching}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm text-muted-foreground px-3 min-w-[120px] text-center">
                      Page {pagination.pageIndex + 1} of {table.getPageCount()}
                    </span>
                    <Button variant="outline" size="sm" className="h-9 w-9 p-0"
                      onClick={() => table.nextPage()} disabled={!table.getCanNextPage() || isFetching}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="sm" className="h-9 w-9 p-0"
                      onClick={() => table.setPageIndex(table.getPageCount() - 1)} disabled={!table.getCanNextPage() || isFetching}>
                      <ChevronsRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Detail Modal */}
      {selectedLog && (
        <div
          className="fixed inset-0 bg-background/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setSelectedLog(null)}
        >
          <div
            className="bg-card rounded-lg border border-border shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden animate-in zoom-in-95 duration-200"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="border-b border-border p-6">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    {(() => {
                      const config = getCategoryConfig(selectedLog.category)
                      const Icon = config.icon
                      return (
                        <div className={cn("w-8 h-8 rounded-md flex items-center justify-center", config.bgColor)}>
                          <Icon className={cn("h-4 w-4", config.color)} />
                        </div>
                      )
                    })()}
                    <div>
                      <h2 className="text-lg font-semibold">{selectedLog.action_display}</h2>
                      <p className="text-xs text-muted-foreground">{selectedLog.category_display}</p>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedLog(null)}
                  className="w-8 h-8 rounded-md hover:bg-accent flex items-center justify-center transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-4 overflow-y-auto max-h-[60vh]">
              {/* User Info */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase">User Information</h3>
                <div className="grid grid-cols-2 gap-3 p-3 rounded-md bg-muted/30">
                  <div>
                    <p className="text-xs text-muted-foreground">Username</p>
                    <p className="text-sm font-medium mt-0.5">{selectedLog.username}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">IP Address</p>
                    <p className="text-sm font-medium mt-0.5">{selectedLog.ip_address || 'N/A'}</p>
                  </div>
                </div>
              </div>

              {/* Resource Info */}
              {selectedLog.resource_type && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase">Resource</h3>
                  <div className="p-3 rounded-md bg-muted/30 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Type</span>
                      <span className="font-medium">{selectedLog.resource_type}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Name</span>
                      <span className="font-medium">{selectedLog.resource_name || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">ID</span>
                      <span className="font-mono text-xs">{selectedLog.resource_id}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Description */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase">Description</h3>
                <p className="text-sm p-3 rounded-md bg-muted/30">{selectedLog.description}</p>
              </div>

              {/* Timestamp */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase">Timestamp</h3>
                <div className="flex items-center gap-2 text-sm p-3 rounded-md bg-muted/30">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span>
                    {formatDateTime(selectedLog.timestamp)}
                  </span>
                </div>
              </div>

              {/* Status */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase">Status</h3>
                <div className={cn(
                  "flex items-center gap-2 p-3 rounded-md",
                  selectedLog.success ? "bg-green-500/10" : "bg-red-500/10"
                )}>
                  {selectedLog.success ? (
                    <>
                      <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                      <span className="font-medium text-sm text-green-600 dark:text-green-400">Success</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                      <span className="font-medium text-sm text-red-600 dark:text-red-400">Failed</span>
                      {selectedLog.error_message && (
                        <span className="text-xs text-red-600/80 dark:text-red-400/80"> - {selectedLog.error_message}</span>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Metadata */}
              {Object.keys(selectedLog.metadata || {}).length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase">Metadata</h3>
                  <pre className="text-xs p-3 rounded-md bg-muted/30 overflow-x-auto">
                    {JSON.stringify(selectedLog.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="border-t border-border px-6 py-4 flex justify-end">
              <Button onClick={() => setSelectedLog(null)} variant="outline" size="sm">
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
