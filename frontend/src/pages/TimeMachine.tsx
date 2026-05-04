// TimeMachine.tsx
//
// Landing page for the Time Machine feature. Lists all saved queries that have
// Time Machine enabled, with a snapshot count and the last execution time.
// Clicking a query navigates to TimeMachineQueryDetail.

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getPaginationRowModel,
  flexRender, ColumnDef, SortingState, VisibilityState,
} from '@tanstack/react-table'
import { timeMachineService, TimeMachineQuery } from '@/services/timeMachine'
import { useAuthStore } from '@/store/authStore'
import { useNavigate } from 'react-router-dom'
import {
  Clock, Database, Settings, Search, Eye, Info, CheckCircle2, XCircle,
  Filter, ChevronUp, ChevronDown, ChevronsUpDown,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { formatDistanceToNow } from 'date-fns'
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
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible'

export default function TimeMachine() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [showInfo, setShowInfo] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})

  const { data: queriesData, isLoading } = useQuery({
    queryKey: ['time-machine-queries'],
    queryFn: () => timeMachineService.listQueries(),
    enabled: !!user,
  })

  const allQueries = useMemo(
    () => (queriesData?.queries || []).filter(q => q.id && typeof q.id === 'number' && q.id > 0),
    [queriesData]
  )

  const tableData = useMemo(() => {
    if (!searchQuery) return allQueries
    const q = searchQuery.toLowerCase()
    return allQueries.filter(query => query.name.toLowerCase().includes(q))
  }, [allQueries, searchQuery])

  const columns = useMemo<ColumnDef<TimeMachineQuery>[]>(() => [
    {
      accessorKey: 'name',
      header: 'Query Name',
      cell: ({ getValue }) => (
        <span className="font-medium text-foreground">{getValue() as string}</span>
      ),
    },
    {
      accessorKey: 'version',
      header: 'Version',
      cell: ({ getValue }) => (
        <span className="px-2 py-0.5 glass border border-border/20 rounded text-xs font-mono">
          {getValue() as string}
        </span>
      ),
    },
    {
      accessorKey: 'snapshot_count',
      header: 'Snapshots',
      cell: ({ getValue }) => (
        <div className="flex items-center gap-1.5">
          <Database className="w-3.5 h-3.5 text-primary" />
          <span>{getValue() as number}</span>
        </div>
      ),
    },
    {
      accessorKey: 'latest_execution',
      header: 'Last Execution',
      cell: ({ getValue }) => (
        <span className="text-muted-foreground">
          {formatDistanceToNow(new Date(getValue() as string), { addSuffix: true })}
        </span>
      ),
    },
    {
      accessorKey: 'enable_time_machine',
      header: 'Status',
      enableSorting: false,
      cell: () => (
        <Badge variant="outline" className="bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30">
          Active
        </Badge>
      ),
    },
    {
      id: 'actions',
      enableSorting: false,
      enableHiding: false,
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm"
            onClick={(e) => { e.stopPropagation(); navigate(`/time-machine/query/${row.original.id}`) }}
            className="hover:bg-accent/50 transition-all hover:scale-105">
            <Eye className="w-4 h-4 mr-2" />View
          </Button>
        </div>
      ),
    },
  ], [navigate])

  const table = useReactTable({
    data: tableData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    state: { sorting, columnVisibility },
    initialState: { pagination: { pageSize: 25 } },
  })

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center glass-strong border border-border/20 rounded-2xl p-12 max-w-md animate-scale-in">
          <h2 className="text-2xl font-bold text-foreground mb-4">Authentication Required</h2>
          <p className="text-muted-foreground mb-6">Please log in to view Time Machine</p>
          <Button onClick={() => navigate('/login')}
            className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all hover:scale-[1.02]">
            Go to Login
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border/20">
        <div className="px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 glass border border-primary/30 bg-primary/10 rounded-xl group hover:scale-110 transition-transform">
                <Clock className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-foreground">Time Machine</h1>
                <p className="text-sm text-muted-foreground">Track and compare query execution history</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate('/time-machine/settings')}
              className="glass border-border/20 text-foreground hover:border-white/20 hover:bg-accent/50 transition-all hover:scale-[1.02]">
              <Settings className="w-4 h-4 mr-2" />Settings
            </Button>
          </div>
        </div>
      </div>

      {/* Info Banner */}
      <div className="px-8 pt-6 pb-0">
        <Collapsible open={showInfo} onOpenChange={setShowInfo}>
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg">
            <CollapsibleTrigger className="w-full p-4 flex items-center justify-between hover:bg-blue-500/5 transition-colors">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-blue-400" />
                <span className="font-medium text-sm text-blue-400">How Time Machine Works & Duplicate Detection</span>
              </div>
              <span className="text-xs text-blue-400/70">{showInfo ? 'Hide' : 'Show'} details</span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-4 pb-4 pt-0 space-y-3 text-sm text-muted-foreground">
                <div className="space-y-2">
                  <h4 className="font-semibold text-foreground text-xs uppercase tracking-wide">What is Time Machine?</h4>
                  <p>Time Machine automatically captures and stores snapshots of your query results over time.</p>
                  <ul className="list-disc list-inside space-y-1 ml-2 text-xs">
                    <li>Track how your network infrastructure changes over time</li>
                    <li>Compare query results between different executions</li>
                    <li>Identify when and what changed in your APIC environment</li>
                    <li>Maintain a historical record of query executions</li>
                  </ul>
                </div>
                <div className="space-y-2 pt-2 border-t border-blue-500/20">
                  <h4 className="font-semibold text-foreground text-xs uppercase tracking-wide flex items-center gap-2">
                    <Database className="w-3.5 h-3.5" />Duplicate Detection
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                    <div className="bg-green-500/10 border border-green-500/20 rounded p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <CheckCircle2 className="w-4 h-4 text-green-400" />
                        <span className="font-semibold text-xs text-green-400">New Snapshot Created</span>
                      </div>
                      <p className="text-xs">When query results change from the previous execution.</p>
                    </div>
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <XCircle className="w-4 h-4 text-amber-400" />
                        <span className="font-semibold text-xs text-amber-400">Duplicate Skipped</span>
                      </div>
                      <p className="text-xs">When results are identical to the previous execution (same SHA256 hash).</p>
                    </div>
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
      </div>

      {/* Content */}
      <div className="px-8 py-8">
        {isLoading ? (
          <div className="text-center py-12">
            <div className="inline-block w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-sm text-muted-foreground">Loading queries...</p>
          </div>
        ) : allQueries.length === 0 ? (
          <div className="text-center py-20 glass border border-border/20 rounded-xl max-w-2xl mx-auto">
            <div className="relative mb-6">
              <div className="absolute inset-0 bg-primary/10 blur-3xl rounded-full" />
              <div className="relative w-20 h-20 glass border border-border/20 rounded-full flex items-center justify-center mx-auto">
                <Database className="w-10 h-10 text-muted-foreground" />
              </div>
            </div>
            <h3 className="text-xl font-bold mb-2 text-foreground">No Query History</h3>
            <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
              Execute queries with Time Machine enabled to start tracking history
            </p>
            <Button onClick={() => navigate('/')}
              className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all hover:scale-[1.02]">
              Go to Query Builder
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Search saved queries..."
                  value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-10 glass border-border/20" />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="h-10 ml-auto glass border-border/20">
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
            <div className="border rounded-lg shadow-sm overflow-hidden glass border-border/20">
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
                      <TableCell colSpan={columns.length} className="text-center py-8 text-muted-foreground">
                        No saved queries with snapshots found
                      </TableCell>
                    </TableRow>
                  ) : (
                    table.getRowModel().rows.map(row => (
                      <TableRow key={row.id}
                        className="cursor-pointer hover:bg-white/[0.02] transition-colors border-border/20"
                        onClick={() => navigate(`/time-machine/query/${row.original.id}`)}>
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
            </div>

            {/* Pagination bar */}
            {table.getPageCount() > 1 && (
              <div className="border rounded-lg shadow-sm px-6 py-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Showing {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1} to{' '}
                    {Math.min(
                      (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
                      table.getFilteredRowModel().rows.length
                    )} of {table.getFilteredRowModel().rows.length} queries
                  </span>
                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground whitespace-nowrap">Rows per page:</span>
                      <Select value={table.getState().pagination.pageSize.toString()}
                        onValueChange={(v) => table.setPageSize(Number(v))}>
                        <SelectTrigger className="h-8 w-[75px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {[10, 25, 50].map(size => (
                            <SelectItem key={size} value={size.toString()}>{size}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="sm" className="h-9 w-9 p-0"
                        onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()}>
                        <ChevronsLeft className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="sm" className="h-9 w-9 p-0"
                        onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-sm text-muted-foreground px-3 min-w-[120px] text-center">
                        Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
                      </span>
                      <Button variant="outline" size="sm" className="h-9 w-9 p-0"
                        onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="sm" className="h-9 w-9 p-0"
                        onClick={() => table.setPageIndex(table.getPageCount() - 1)} disabled={!table.getCanNextPage()}>
                        <ChevronsRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
