// settings/Connections.tsx
//
// Quick-access APIC connection management embedded in the Settings area.
// Uses the same table pattern as AuditLogs / TaskManagement so that
// fleets with many connections (50+) stay scannable.

import { useState, useRef, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel,
  getPaginationRowModel, flexRender, ColumnDef, SortingState, PaginationState,
} from '@tanstack/react-table'
import {
  Network, Plus, Trash2, TestTube, Edit, CheckCircle, XCircle,
  Eye, EyeOff, Search, Loader2, MinusCircle, ChevronLeft, ChevronRight,
  ChevronsLeft, ChevronsRight, ChevronUp, ChevronDown, ChevronsUpDown,
} from 'lucide-react'
import { apicService, APICConnection, APICConnectionCreate } from '@/services/apic'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useDebounce } from '@/hooks/useDebounce'
import { useFormatters } from '@/contexts/TimezoneContext'
import { toast } from 'sonner'

const DEFAULT_TIMEOUT_SECONDS = 30
const MIN_TIMEOUT_SECONDS = 5
const MAX_TIMEOUT_SECONDS = 300

const EMPTY_FORM: APICConnectionCreate = {
  name: '',
  description: '',
  url: '',
  username: '',
  password: '',
  verify_ssl: false,
  is_public: false,
  timeout: DEFAULT_TIMEOUT_SECONDS,
}

export default function Connections() {
  const queryClient = useQueryClient()
  const { formatDateTime } = useFormatters()

  const [showDialog, setShowDialog] = useState(false)
  const [editing, setEditing] = useState<APICConnection | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<APICConnection | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [testingId, setTestingId] = useState<number | null>(null)
  const [form, setForm] = useState<APICConnectionCreate>(EMPTY_FORM)
  const testAbortRef = useRef<AbortController | null>(null)

  // Table state
  const [searchQuery, setSearchQuery] = useState('')
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }])
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 })
  const debouncedSearch = useDebounce(searchQuery, 300)

  useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }))
  }, [debouncedSearch])

  const { data: connections = [], isLoading } = useQuery({
    queryKey: ['apic-connections'],
    queryFn: () => apicService.getConnections(),
  })

  const createMutation = useMutation({
    mutationFn: (data: APICConnectionCreate) => apicService.createConnection(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apic-connections'] })
      closeDialog()
      toast.success('Connection created')
    },
    onError: (err: unknown) =>
      toast.error('Failed to create', {
        description: (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail,
      }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<APICConnectionCreate> }) =>
      apicService.updateConnection(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apic-connections'] })
      closeDialog()
      toast.success('Connection updated')
    },
    onError: (err: unknown) =>
      toast.error('Failed to update', {
        description: (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail,
      }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apicService.deleteConnection(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apic-connections'] })
      toast.success('Connection deleted')
    },
    onError: (err: unknown) =>
      toast.error('Failed to delete', {
        description: (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail,
      }),
  })

  const handleTest = async (id: number) => {
    // If already testing, cancel it
    if (testingId === id && testAbortRef.current) {
      testAbortRef.current.abort()
      testAbortRef.current = null
      setTestingId(null)
      return
    }

    const controller = new AbortController()
    testAbortRef.current = controller
    setTestingId(id)

    try {
      await apicService.testConnection(id, controller.signal)
    } catch {
      // Backend persists outcome to last_test_status / last_test_message,
      // so silent catch is fine — the table refetch below will surface it.
    } finally {
      // Always refetch so the row reflects the new last_tested_at / status,
      // including aborted tests where the backend may still have written
      // an outcome before the abort landed.
      queryClient.invalidateQueries({ queryKey: ['apic-connections'] })
      testAbortRef.current = null
      setTestingId(null)
    }
  }

  const closeDialog = () => {
    setShowDialog(false)
    setEditing(null)
    setForm(EMPTY_FORM)
    setShowPassword(false)
  }

  const openEdit = (conn: APICConnection) => {
    setForm({
      name: conn.name,
      description: conn.description || '',
      url: conn.url,
      username: conn.username,
      password: '',
      verify_ssl: conn.verify_ssl,
      is_public: conn.is_public,
      timeout: conn.timeout || DEFAULT_TIMEOUT_SECONDS,
    })
    setEditing(conn)
    setShowDialog(true)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: form })
    } else {
      createMutation.mutate(form)
    }
  }

  // Client-side filter: name, url, username, description match search query.
  const filteredConnections = useMemo(() => {
    if (!debouncedSearch.trim()) return connections
    const q = debouncedSearch.toLowerCase()
    return connections.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      c.url.toLowerCase().includes(q) ||
      c.username.toLowerCase().includes(q) ||
      (c.description || '').toLowerCase().includes(q)
    )
  }, [connections, debouncedSearch])

  const columns = useMemo<ColumnDef<APICConnection>[]>(() => [
    {
      id: 'name',
      header: 'Name',
      accessorFn: (row) => row.name,
      cell: ({ row }) => {
        const conn = row.original
        return (
          <div className="min-w-0">
            <div className="font-medium text-foreground truncate">{conn.name}</div>
            {conn.description && (
              <div className="text-xs text-muted-foreground truncate mt-0.5">
                {conn.description}
              </div>
            )}
          </div>
        )
      },
    },
    {
      id: 'url',
      header: 'URL',
      accessorFn: (row) => row.url,
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground" title={row.original.url}>
          {row.original.url}
        </span>
      ),
    },
    {
      id: 'username',
      header: 'Username',
      accessorFn: (row) => row.username,
      cell: ({ row }) => <span className="text-sm">{row.original.username}</span>,
    },
    {
      id: 'ssl',
      header: 'SSL',
      enableSorting: false,
      cell: ({ row }) => (
        row.original.verify_ssl
          ? <Badge variant="outline" className="text-xs">Verify</Badge>
          : <Badge variant="outline" className="text-xs text-muted-foreground">Skip</Badge>
      ),
    },
    {
      id: 'timeout',
      header: 'Timeout',
      accessorFn: (row) => row.timeout,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground tabular-nums">
          {row.original.timeout || DEFAULT_TIMEOUT_SECONDS}s
        </span>
      ),
    },
    {
      id: 'visibility',
      header: 'Visibility',
      enableSorting: false,
      cell: ({ row }) => (
        row.original.is_public
          ? <Badge variant="default" className="text-xs">Public</Badge>
          : <Badge variant="secondary" className="text-xs">Private</Badge>
      ),
    },
    {
      id: 'last_test',
      header: 'Last Test',
      accessorFn: (row) => row.last_tested_at || '',
      cell: ({ row }) => {
        const conn = row.original
        const isTesting = testingId === conn.id

        if (isTesting) {
          return (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Testing…
            </span>
          )
        }

        if (conn.last_test_status === undefined || conn.last_test_status === null) {
          return (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MinusCircle className="w-3.5 h-3.5" />
              Never
            </span>
          )
        }

        const tooltipBody = (
          <div className="max-w-xs space-y-1">
            <div className="font-medium">
              {conn.last_test_status ? 'Successful' : 'Failed'}
            </div>
            {conn.last_tested_at && (
              <div className="text-xs opacity-90">{formatDateTime(conn.last_tested_at)}</div>
            )}
            {conn.last_test_message && (
              <div className="text-xs opacity-80 break-words">{conn.last_test_message}</div>
            )}
          </div>
        )

        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={`flex items-center gap-1.5 text-xs cursor-default ${
                  conn.last_test_status
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {conn.last_test_status
                  ? <CheckCircle className="w-3.5 h-3.5" />
                  : <XCircle className="w-3.5 h-3.5" />}
                {conn.last_tested_at
                  ? formatDateTime(conn.last_tested_at)
                  : (conn.last_test_status ? 'Successful' : 'Failed')}
              </span>
            </TooltipTrigger>
            <TooltipContent>{tooltipBody}</TooltipContent>
          </Tooltip>
        )
      },
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      enableSorting: false,
      cell: ({ row }) => {
        const conn = row.original
        const isTesting = testingId === conn.id
        return (
          <div className="flex items-center justify-end gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleTest(conn.id)}
                  className="h-8 w-8"
                  aria-label={isTesting ? 'Cancel test' : 'Test connection'}
                >
                  {isTesting
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <TestTube className="w-4 h-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{isTesting ? 'Cancel test' : 'Test connection'}</TooltipContent>
            </Tooltip>

            {conn.can_edit && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openEdit(conn)}
                    className="h-8 w-8"
                    aria-label="Edit connection"
                  >
                    <Edit className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Edit</TooltipContent>
              </Tooltip>
            )}

            {conn.can_edit && conn.can_delete && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeleteConfirm(conn)}
                    className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-500/10"
                    aria-label="Delete connection"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Delete</TooltipContent>
              </Tooltip>
            )}
          </div>
        )
      },
    },
  ], [testingId, formatDateTime])

  const table = useReactTable({
    data: filteredConnections,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  return (
    <TooltipProvider delayDuration={200}>
      <ConfirmDialog
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => {
          if (deleteConfirm) deleteMutation.mutate(deleteConfirm.id)
          setDeleteConfirm(null)
        }}
        title="Delete Connection"
        message={`Are you sure you want to delete "${deleteConfirm?.name}"?`}
        confirmText="Delete"
        variant="danger"
      />

      <div className="space-y-6 w-full">
        {/* Page title */}
        <div>
          <h2 className="text-lg font-semibold">APIC Connections</h2>
          <p className="text-sm text-muted-foreground">Manage your Cisco APIC controller connections.</p>
        </div>

        {/* Section header with Add button */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Network className="w-5 h-5" />
            <div>
              <h3 className="text-base font-semibold leading-none">Connections</h3>
              <p className="text-xs text-muted-foreground mt-1">
                {connections.length} connection{connections.length !== 1 ? 's' : ''} configured
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => { setForm(EMPTY_FORM); setEditing(null); setShowDialog(true) }}
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Connection
          </Button>
        </div>

        {/* Search bar */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, URL, username, description…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            {filteredConnections.length} of {connections.length}
          </span>
        </div>

        {/* Table or empty / loading state */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2].map(i => (
              <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        ) : connections.length === 0 ? (
          <div className="text-center py-12 border-2 border-dashed border-border rounded-lg">
            <Network className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">No APIC connections configured</p>
            <Button
              variant="outline"
              onClick={() => { setForm(EMPTY_FORM); setEditing(null); setShowDialog(true) }}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Your First Connection
            </Button>
          </div>
        ) : (
          <>
            <div className="border rounded-lg shadow-sm overflow-hidden">
              <Table>
                  <TableHeader>
                    {table.getHeaderGroups().map((headerGroup) => (
                      <TableRow key={headerGroup.id}>
                        {headerGroup.headers.map((header) => {
                          const canSort = header.column.getCanSort()
                          const sortDir = header.column.getIsSorted()
                          return (
                            <TableHead
                              key={header.id}
                              onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                              className={canSort ? 'cursor-pointer select-none' : ''}
                            >
                              <div className="flex items-center gap-1">
                                {flexRender(header.column.columnDef.header, header.getContext())}
                                {canSort && (
                                  sortDir === 'asc' ? <ChevronUp className="w-3 h-3" />
                                  : sortDir === 'desc' ? <ChevronDown className="w-3 h-3" />
                                  : <ChevronsUpDown className="w-3 h-3 opacity-30" />
                                )}
                              </div>
                            </TableHead>
                          )
                        })}
                      </TableRow>
                    ))}
                  </TableHeader>
                  <TableBody>
                    {table.getRowModel().rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={columns.length} className="text-center text-muted-foreground py-8">
                          No connections match your search
                        </TableCell>
                      </TableRow>
                    ) : (
                      table.getRowModel().rows.map((row) => (
                        <TableRow key={row.id}>
                          {row.getVisibleCells().map((cell) => (
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

              {/* Pagination — separate bordered box, mirrors /saved ListView */}
              <div className="border rounded-lg shadow-sm px-6 py-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Rows per page:</span>
                    <Select
                      value={String(pagination.pageSize)}
                      onValueChange={(v) => setPagination({ pageIndex: 0, pageSize: Number(v) })}
                    >
                      <SelectTrigger className="h-7 w-[70px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[25, 50, 100, 200].map((s) => (
                          <SelectItem key={s} value={String(s)} className="text-xs">{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground tabular-nums">
                      Page {table.getState().pagination.pageIndex + 1} of {Math.max(1, table.getPageCount())}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => table.setPageIndex(0)}
                        disabled={!table.getCanPreviousPage()}
                      >
                        <ChevronsLeft className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => table.previousPage()}
                        disabled={!table.getCanPreviousPage()}
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => table.nextPage()}
                        disabled={!table.getCanNextPage()}
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                        disabled={!table.getCanNextPage()}
                      >
                        <ChevronsRight className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

      {/* Create / Edit Dialog */}
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-background/50"
            onClick={closeDialog}
          />
          <div className="relative bg-card border border-border rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-4">
                {editing ? 'Edit APIC Connection' : 'Add APIC Connection'}
              </h3>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <Label htmlFor="apic_name">Name *</Label>
                    <Input
                      id="apic_name"
                      type="text"
                      required
                      value={form.name}
                      onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                      placeholder="My APIC"
                      className="mt-2"
                    />
                  </div>

                  <div className="col-span-2">
                    <Label htmlFor="apic_description">Description</Label>
                    <textarea
                      id="apic_description"
                      value={form.description}
                      onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                      className="w-full px-3 py-2 mt-2 border border-border rounded-md bg-background resize-none"
                      rows={2}
                    />
                  </div>

                  <div className="col-span-2">
                    <Label htmlFor="apic_url">URL *</Label>
                    <Input
                      id="apic_url"
                      type="url"
                      required
                      value={form.url}
                      onChange={e => setForm(p => ({ ...p, url: e.target.value }))}
                      placeholder="https://apic.example.com"
                      className="mt-2"
                    />
                  </div>

                  <div>
                    <Label htmlFor="apic_username">Username *</Label>
                    <Input
                      id="apic_username"
                      type="text"
                      required
                      value={form.username}
                      onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
                      className="mt-2"
                    />
                  </div>

                  <div>
                    <Label htmlFor="apic_password">
                      Password {editing ? '' : '*'}
                    </Label>
                    <div className="relative mt-2">
                      <Input
                        id="apic_password"
                        type={showPassword ? 'text' : 'password'}
                        required={!editing}
                        value={form.password}
                        onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                        placeholder={editing ? 'Leave blank to keep current' : ''}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2"
                      >
                        {showPassword
                          ? <EyeOff className="w-4 h-4" />
                          : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="col-span-2">
                    <Label htmlFor="apic_timeout">Request Timeout (seconds)</Label>
                    <Input
                      id="apic_timeout"
                      type="number"
                      min={MIN_TIMEOUT_SECONDS}
                      max={MAX_TIMEOUT_SECONDS}
                      value={form.timeout ?? DEFAULT_TIMEOUT_SECONDS}
                      onChange={e => {
                        const raw = e.target.value
                        const parsed = raw === '' ? DEFAULT_TIMEOUT_SECONDS : Number(raw)
                        const clamped = Number.isNaN(parsed)
                          ? DEFAULT_TIMEOUT_SECONDS
                          : Math.min(MAX_TIMEOUT_SECONDS, Math.max(MIN_TIMEOUT_SECONDS, parsed))
                        setForm(p => ({ ...p, timeout: clamped }))
                      }}
                      className="mt-2"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      How long to wait for an APIC response before failing.
                      Range {MIN_TIMEOUT_SECONDS}–{MAX_TIMEOUT_SECONDS} seconds (default {DEFAULT_TIMEOUT_SECONDS}).
                    </p>
                  </div>

                  <div className="col-span-2 space-y-3">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={form.verify_ssl}
                        onChange={e => setForm(p => ({ ...p, verify_ssl: e.target.checked }))}
                        className="w-4 h-4"
                      />
                      <span className="text-sm">Verify SSL certificates</span>
                    </label>

                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={form.is_public}
                        onChange={e => setForm(p => ({ ...p, is_public: e.target.checked }))}
                        className="w-4 h-4"
                      />
                      <span className="text-sm">Make public (all users can use)</span>
                    </label>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-4">
                  <Button type="button" variant="outline" onClick={closeDialog}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={createMutation.isPending || updateMutation.isPending}
                  >
                    {createMutation.isPending || updateMutation.isPending
                      ? 'Saving…'
                      : editing
                      ? 'Update'
                      : 'Create'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </TooltipProvider>
  )
}
