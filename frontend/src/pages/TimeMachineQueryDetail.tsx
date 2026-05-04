// TimeMachineQueryDetail.tsx
//
// Detail page for a single saved query's snapshot history.
// Shows the CalendarHeatmap at the top so you can instantly see when the
// data changed, a filterable snapshot list below, and an AnnotationDialog
// for tagging interesting snapshots. Selecting two rows and clicking Compare
// navigates to TimeMachineComparison.

import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  ColumnDef,
  SortingState,
  VisibilityState,
  PaginationState,
} from '@tanstack/react-table'
import { timeMachineService, TimeMachineSnapshot } from '@/services/timeMachine'
import { queriesService } from '@/services/queries'
import { useAuthStore } from '@/store/authStore'
import { useTimezone } from '@/contexts/TimezoneContext'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Calendar, Database, Clock, GitCompare, Eye, Search,
  PlayCircle, CalendarClock, MessageSquare, TrendingUp, Filter,
  ChevronUp, ChevronDown, ChevronsUpDown,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { format } from 'date-fns'
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
import { toast } from '@/lib/toast'
import { CalendarHeatmap, AnnotationDialog, AttributeTimeline, DnAutocomplete } from '@/components/time-machine'

// ── Main Component ────────────────────────────────────────────────────────────
export default function TimeMachineQueryDetail() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { queryId } = useParams<{ queryId: string }>()
  const { user } = useAuthStore()
  const { preferences } = useTimezone()

  // Table state
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 })

  // Feature state
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedSnapshots, setSelectedSnapshots] = useState<string[]>([])
  const [selectedYear] = useState(new Date().getFullYear())
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [annotatingSnapshot, setAnnotatingSnapshot] = useState<string | null>(null)
  const [annotationText, setAnnotationText] = useState('')
  const [annotationLabel, setAnnotationLabel] = useState('')
  const [timelineDn, setTimelineDn] = useState<string | null>(null)
  const [timelineInput, setTimelineInput] = useState('')
  const [showTimelineInput, setShowTimelineInput] = useState(false)

  const queryIdNum = queryId ? parseInt(queryId, 10) : NaN
  const isValidQueryId = !isNaN(queryIdNum) && queryIdNum > 0

  // Reset to page 0 when filters change
  useEffect(() => {
    setPagination(p => ({ ...p, pageIndex: 0 }))
  }, [selectedDate, searchQuery])

  const { data: snapshotsData, isLoading } = useQuery({
    queryKey: ['time-machine-snapshots', queryId, pagination.pageIndex, pagination.pageSize, selectedDate],
    queryFn: () => timeMachineService.getQuerySnapshots({
      saved_query_id: queryIdNum,
      limit: pagination.pageSize,
      offset: pagination.pageIndex * pagination.pageSize,
      date: selectedDate,
      timezone: preferences?.display_timezone,
    }),
    enabled: !!user && isValidQueryId,
    retry: false,
    placeholderData: (prev) => prev,
  })

  const { data: heatmapData } = useQuery({
    queryKey: ['time-machine-heatmap', queryId, selectedYear, preferences?.display_timezone],
    queryFn: () => timeMachineService.getHeatmapData({
      saved_query_id: queryIdNum,
      year: selectedYear,
      timezone: preferences?.display_timezone,
    }),
    enabled: !!user && isValidQueryId,
  })

  const { data: savedQueryData } = useQuery({
    queryKey: ['saved-query', queryIdNum],
    queryFn: () => queriesService.getSavedQuery(queryIdNum),
    enabled: isValidQueryId,
  })

  const annotateMutation = useMutation({
    mutationFn: ({ id, annotation, label }: { id: string; annotation: string; label: string }) =>
      timeMachineService.annotateSnapshot(id, { annotation, label }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time-machine-snapshots', queryId] })
      setAnnotatingSnapshot(null)
      toast.success('Annotation saved')
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to save annotation')
    },
  })

  const rawSnapshots = useMemo(() => snapshotsData?.snapshots || [], [snapshotsData])
  const totalCount = snapshotsData?.total_count ?? 0

  // Client-side text search on the current page (≤ pageSize rows — fast enough)
  const snapshots = useMemo(() => {
    if (!searchQuery) return rawSnapshots
    const q = searchQuery.toLowerCase()
    return rawSnapshots.filter(s =>
      s.query_name.toLowerCase().includes(q) ||
      s.apic_connection_name.toLowerCase().includes(q) ||
      (s.executed_by?.toLowerCase().includes(q) ?? false)
    )
  }, [rawSnapshots, searchQuery])

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
  }

  const handleSelectSnapshot = (snapshotId: string) => {
    setSelectedSnapshots(prev => {
      if (prev.includes(snapshotId)) return prev.filter(id => id !== snapshotId)
      if (prev.length < 2) return [...prev, snapshotId]
      return [prev[1], snapshotId]
    })
  }

  const handleCompare = () => {
    if (selectedSnapshots.length === 2) {
      navigate(`/time-machine/compare/${selectedSnapshots[0]}/${selectedSnapshots[1]}`)
    }
  }

  const openAnnotationDialog = (snapshot: TimeMachineSnapshot) => {
    setAnnotatingSnapshot(snapshot.id)
    setAnnotationText(snapshot.annotation || '')
    setAnnotationLabel(snapshot.label || '')
  }

  // ── Column definitions ────────────────────────────────────────────────────
  const columns = useMemo<ColumnDef<TimeMachineSnapshot>[]>(() => [
    {
      id: 'select',
      enableSorting: false,
      enableHiding: false,
      header: () => null,
      cell: ({ row }) => (
        <Checkbox
          checked={selectedSnapshots.includes(row.original.id)}
          onCheckedChange={() => handleSelectSnapshot(row.original.id)}
        />
      ),
    },
    {
      accessorKey: 'executed_at',
      header: 'Executed At',
      cell: ({ row }) => {
        const s = row.original
        return (
          <div className="flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <div>
              <div className="font-medium flex items-center gap-1.5">
                {format(new Date(s.executed_at), 'MMM dd, yyyy')}
                {s.has_changes && (
                  <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" title="Data changed" />
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {format(new Date(s.executed_at), 'HH:mm:ss')}
              </div>
              {s.label && (
                <Badge variant="outline" className="mt-1 text-xs bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30">
                  {s.label}
                </Badge>
              )}
              {s.annotation && (
                <p className="text-xs text-muted-foreground mt-0.5 max-w-xs truncate" title={s.annotation}>
                  {s.annotation}
                </p>
              )}
            </div>
          </div>
        )
      },
    },
    {
      accessorKey: 'query_version',
      header: 'Version',
      cell: ({ getValue }) => (
        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 font-mono">
          v{getValue() as string}
        </Badge>
      ),
    },
    {
      accessorKey: 'execution_type',
      header: 'Type',
      cell: ({ getValue }) => {
        const type = getValue() as string
        return (
          <Badge variant="outline" className={
            type === 'scheduled'
              ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30'
              : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30'
          }>
            {type === 'scheduled'
              ? <><CalendarClock className="w-3 h-3 mr-1" />Scheduled</>
              : <><PlayCircle className="w-3 h-3 mr-1" />Manual</>
            }
          </Badge>
        )
      },
    },
    {
      accessorKey: 'executed_by',
      header: 'Executed By',
      cell: ({ getValue }) => (
        <span className="text-muted-foreground">{(getValue() as string | null) || 'Unknown'}</span>
      ),
    },
    {
      accessorKey: 'apic_connection_name',
      header: 'Connection',
      cell: ({ getValue }) => (
        <span className="text-muted-foreground">{getValue() as string}</span>
      ),
    },
    {
      accessorKey: 'result_count',
      header: 'Results',
      cell: ({ getValue }) => (
        <div className="flex items-center gap-1.5">
          <Database className="w-3.5 h-3.5 text-muted-foreground" />
          <span>{getValue() as number}</span>
        </div>
      ),
    },
    {
      accessorKey: 'result_size_bytes',
      header: 'Size',
      cell: ({ getValue }) => (
        <span className="text-muted-foreground">{formatBytes(getValue() as number)}</span>
      ),
    },
    {
      accessorKey: 'execution_time_ms',
      header: 'Time (ms)',
      cell: ({ getValue }) => {
        const ms = getValue() as number | null
        return ms ? (
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            <span>{ms}</span>
          </div>
        ) : <span className="text-muted-foreground">—</span>
      },
    },
    {
      id: 'actions',
      enableSorting: false,
      enableHiding: false,
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => {
        const s = row.original
        const rowIndex = row.index
        const isNotLast = rowIndex < snapshots.length - 1
        return (
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={() => openAnnotationDialog(s)} title="Add note">
              <MessageSquare className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate(`/time-machine/snapshot/${s.id}`)}>
              <Eye className="w-4 h-4 mr-1" />
              View
            </Button>
            {isNotLast && (
              <Button variant="ghost" size="sm" onClick={() => {
                const prevId = snapshots[rowIndex + 1].id
                navigate(`/time-machine/compare/${prevId}/${s.id}`)
              }}>
                <GitCompare className="w-4 h-4 mr-1" />
                vs Prev
              </Button>
            )}
          </div>
        )
      },
    },
  ], [snapshots, selectedSnapshots, navigate])

  const table = useReactTable({
    data: snapshots,
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

  // ── Guards ────────────────────────────────────────────────────────────────
  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-4">Authentication Required</h2>
          <p className="text-muted-foreground mb-6">Please log in to view snapshots</p>
          <button onClick={() => navigate('/login')} className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90">
            Go to Login
          </button>
        </div>
      </div>
    )
  }

  if (!isValidQueryId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-4">Invalid Query ID</h2>
          <p className="text-muted-foreground mb-6">The query ID in the URL is not valid</p>
          <Button onClick={() => navigate('/time-machine')}>Back to Time Machine</Button>
        </div>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      {/* Page Header */}
      <div className="border-b border-border bg-card">
        <div className="px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-primary/10 rounded-lg">
                <Database className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground">
                  {savedQueryData?.name || rawSnapshots[0]?.query_name || 'Query Snapshots'}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {totalCount.toLocaleString()} snapshot{totalCount !== 1 ? 's' : ''}
                  {selectedDate && ` · filtered to ${selectedDate}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {selectedSnapshots.length === 2 && (
                <Button onClick={handleCompare}>
                  <GitCompare className="w-4 h-4 mr-2" />
                  Compare Selected
                </Button>
              )}
              <Button variant="outline" onClick={() => setShowTimelineInput(!showTimelineInput)}>
                <TrendingUp className="w-4 h-4 mr-2" />
                Track DN
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-8 py-8 space-y-4">
        {/* Track DN Input */}
        {showTimelineInput && (
          <div className="bg-violet-500/8 border border-violet-500/30 rounded-lg">
            <div className="px-4 py-3 bg-violet-500/10 border-b border-violet-500/20 rounded-t-lg flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                <span className="text-sm font-semibold text-violet-700 dark:text-violet-300">Track DN over time</span>
              </div>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground hover:text-foreground"
                onClick={() => { setShowTimelineInput(false); setTimelineDn(null); setTimelineInput('') }}>
                Close
              </Button>
            </div>
            <div className="px-4 py-4">
              <p className="text-xs text-muted-foreground mb-3">
                Pick a DN from the latest snapshot — or paste any DN to track it across history.
              </p>
              {isValidQueryId && (
                <DnAutocomplete
                  savedQueryId={queryIdNum}
                  defaultValue={timelineInput}
                  onSubmit={(dn) => { setTimelineInput(dn); setTimelineDn(dn) }}
                  onCancel={() => { setShowTimelineInput(false); setTimelineDn(null); setTimelineInput('') }}
                />
              )}
            </div>
          </div>
        )}

        {/* Attribute Timeline */}
        {timelineDn && isValidQueryId && (
          <AttributeTimeline savedQueryId={queryIdNum} dn={timelineDn}
            onClose={() => { setTimelineDn(null); setTimelineInput('') }} />
        )}

        {/* Calendar Heatmap */}
        {heatmapData && (
          <CalendarHeatmap data={heatmapData.data} year={selectedYear}
            selectedDate={selectedDate} onSelectDate={setSelectedDate} />
        )}

        {/* Selection info banner */}
        {selectedSnapshots.length > 0 && (
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-sm text-blue-600 dark:text-blue-400">
            {selectedSnapshots.length === 1
              ? '1 snapshot selected. Select one more to compare.'
              : '2 snapshots selected. Click "Compare Selected" to view differences.'}
          </div>
        )}

        {/* Table toolbar */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search snapshots..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-10"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {selectedSnapshots.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setSelectedSnapshots([])}>
              Clear Selection
            </Button>
          )}
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
                  onCheckedChange={(value) => column.toggleVisibility(!!value)}>
                  {column.id.replace(/_/g, ' ')}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Table */}
        <div className="border rounded-lg shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Loading snapshots...</p>
              </div>
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
                    <TableCell colSpan={columns.length} className="text-center py-12 text-muted-foreground">
                      {searchQuery ? 'No snapshots match your search.' : 'No snapshots found.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  table.getRowModel().rows.map(row => (
                    <TableRow key={row.id}
                      className={selectedSnapshots.includes(row.original.id) ? 'bg-accent/30' : ''}>
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
                {totalCount.toLocaleString()} snapshots
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
                      {[10, 25, 50, 100].map(size => (
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
                    Page {pagination.pageIndex + 1} of {table.getPageCount()}
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

      {/* Annotation Dialog */}
      <AnnotationDialog
        open={!!annotatingSnapshot}
        onOpenChange={() => setAnnotatingSnapshot(null)}
        label={annotationLabel}
        annotation={annotationText}
        onLabelChange={setAnnotationLabel}
        onAnnotationChange={setAnnotationText}
        onSave={() => {
          if (annotatingSnapshot) {
            annotateMutation.mutate({ id: annotatingSnapshot, annotation: annotationText, label: annotationLabel })
          }
        }}
        isSaving={annotateMutation.isPending}
      />
    </div>
  )
}
