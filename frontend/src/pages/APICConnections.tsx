// APICConnections.tsx
//
// CRUD page for APIC controller credentials. Test Connection fires a login
// against the live APIC to verify the credentials work before saving.
// Passwords are Fernet-encrypted and not included in GET responses.

import { useState, useRef, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel,
  getPaginationRowModel, flexRender, ColumnDef, SortingState, PaginationState,
} from '@tanstack/react-table'
import { apicService, APICConnection, APICConnectionCreate } from '../services/apic'
import { useAuthStore } from '../store/authStore'
import { useQueryBuilderStore } from '../store/queryBuilderStore'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Trash2, TestTube, Edit, CheckCircle, XCircle, Eye, EyeOff,
  Sparkles, Search, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  ChevronUp, ChevronDown, ChevronsUpDown, Loader2, MinusCircle,
} from 'lucide-react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Switch } from '../components/ui/switch'
import { Label } from '../components/ui/label'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Badge } from '../components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../components/ui/table'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '../components/ui/tooltip'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../components/ui/select'
import { useDebounce } from '../hooks/useDebounce'
import { useFormatters } from '../contexts/TimezoneContext'

const DEFAULT_TIMEOUT_SECONDS = 30
const MIN_TIMEOUT_SECONDS = 5
const MAX_TIMEOUT_SECONDS = 300

export default function APICConnections() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const { isLogoAnimationsEnabled, setIsLogoAnimationsEnabled } = useQueryBuilderStore()
  const { formatDateTime } = useFormatters()

  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [editingConnection, setEditingConnection] = useState<APICConnection | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<APICConnection | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [testingConnectionId, setTestingConnectionId] = useState<number | null>(null)
  const testAbortRef = useRef<AbortController | null>(null)

  // Table state
  const [searchQuery, setSearchQuery] = useState('')
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }])
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 })
  const debouncedSearch = useDebounce(searchQuery, 300)

  useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }))
  }, [debouncedSearch])

  const [formData, setFormData] = useState<APICConnectionCreate>({
    name: '',
    description: '',
    url: '',
    username: '',
    password: '',
    verify_ssl: false,
    is_public: false,
    timeout: DEFAULT_TIMEOUT_SECONDS,
  })

  const { data: connections = [], isLoading } = useQuery({
    queryKey: ['apic-connections'],
    queryFn: () => apicService.getConnections(),
    enabled: !!user,
  })

  const createMutation = useMutation({
    mutationFn: (data: APICConnectionCreate) => apicService.createConnection(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apic-connections'] })
      setShowCreateDialog(false)
      resetForm()
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<APICConnectionCreate> }) =>
      apicService.updateConnection(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apic-connections'] })
      setEditingConnection(null)
      resetForm()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apicService.deleteConnection(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apic-connections'] })
    },
  })

  const handleTestConnection = async (id: number) => {
    // If already testing this connection, cancel it
    if (testingConnectionId === id && testAbortRef.current) {
      testAbortRef.current.abort()
      testAbortRef.current = null
      setTestingConnectionId(null)
      return
    }

    const controller = new AbortController()
    testAbortRef.current = controller
    setTestingConnectionId(id)

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
      setTestingConnectionId(null)
    }
  }

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      url: '',
      username: '',
      password: '',
      verify_ssl: false,
      is_public: false,
      timeout: DEFAULT_TIMEOUT_SECONDS,
    })
    setShowPassword(false)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (editingConnection) {
      updateMutation.mutate({ id: editingConnection.id, data: formData })
    } else {
      createMutation.mutate(formData)
    }
  }

  const handleEdit = (conn: APICConnection) => {
    setFormData({
      name: conn.name,
      description: conn.description || '',
      url: conn.url,
      username: conn.username,
      password: '', // Don't pre-fill password
      verify_ssl: conn.verify_ssl,
      is_public: conn.is_public,
      timeout: conn.timeout || DEFAULT_TIMEOUT_SECONDS,
    })
    setEditingConnection(conn)
    setShowCreateDialog(true)
  }

  // Client-side filter: name, url, username, description match search query.
  // 90 connections fits comfortably in memory; no server-side pagination needed.
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
      cell: ({ row }) => (
        <span className="text-sm">{row.original.username}</span>
      ),
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
        const isTesting = testingConnectionId === conn.id

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
        const isTesting = testingConnectionId === conn.id
        return (
          <div className="flex items-center justify-end gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleTestConnection(conn.id)}
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
                    onClick={() => handleEdit(conn)}
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
  ], [testingConnectionId, formatDateTime])

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

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-4">Authentication Required</h2>
          <p className="text-muted-foreground mb-6">Please log in to manage APIC connections</p>
          <button
            onClick={() => navigate('/login')}
            className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            Go to Login
          </button>
        </div>
      </div>
    )
  }

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

      <div className="min-h-screen bg-background">
        <div className="p-6">
          <div className="max-w-7xl mx-auto">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h1 className="text-2xl font-semibold text-foreground mb-2">Settings</h1>
                <p className="text-muted-foreground">Manage connections and preferences</p>
              </div>
            </div>

            {/* Preferences Section */}
            <div className="mb-8 bg-card border border-border rounded-lg p-6">
              <h2 className="text-xl font-semibold text-foreground mb-4 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                Preferences
              </h2>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="logo-animations" className="text-base font-medium">
                      Animated Logo Notifications
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Show status codes and messages in the logo with retro terminal animations
                    </p>
                  </div>
                  <Switch
                    id="logo-animations"
                    checked={isLogoAnimationsEnabled}
                    onCheckedChange={setIsLogoAnimationsEnabled}
                  />
                </div>
              </div>
            </div>

            {/* APIC Connections Section */}
            <div className="flex items-center justify-between mb-4 gap-4">
              <div>
                <h2 className="text-xl font-semibold text-foreground mb-1">APIC Connections</h2>
                <p className="text-sm text-muted-foreground">Manage your Cisco APIC connections</p>
              </div>
              <Button
                onClick={() => {
                  resetForm()
                  setEditingConnection(null)
                  setShowCreateDialog(true)
                }}
                className="gap-2"
              >
                <Plus className="w-4 h-4" />
                Add Connection
              </Button>
            </div>

            {/* Search bar */}
            <div className="mb-4 flex items-center gap-2">
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

            {isLoading ? (
              <div className="text-center py-12 bg-card border border-border rounded-lg">
                <p className="text-muted-foreground">Loading connections…</p>
              </div>
            ) : connections.length === 0 ? (
              <div className="text-center py-12 bg-card border border-border rounded-lg">
                <p className="text-muted-foreground mb-4">No connections yet</p>
                <Button
                  onClick={() => {
                    resetForm()
                    setShowCreateDialog(true)
                  }}
                >
                  Add Your First Connection
                </Button>
              </div>
            ) : (
              <div className="bg-card border border-border rounded-lg overflow-hidden">
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

                {/* Pagination footer */}
                <div className="flex items-center justify-between p-3 border-t border-border bg-background/50">
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
            )}
          </div>
        </div>
      </div>

      {/* Create/Edit Dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-background/50" onClick={() => setShowCreateDialog(false)} />
          <div className="relative bg-card border border-border rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-4">
                {editingConnection ? 'Edit Connection' : 'Add APIC Connection'}
              </h3>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium mb-2">Name *</label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-3 py-2 border border-border rounded-md bg-background"
                      placeholder="My APIC"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-medium mb-2">Description</label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      className="w-full px-3 py-2 border border-border rounded-md bg-background resize-none"
                      rows={2}
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-medium mb-2">URL *</label>
                    <input
                      type="url"
                      required
                      value={formData.url}
                      onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                      className="w-full px-3 py-2 border border-border rounded-md bg-background"
                      placeholder="https://apic.example.com"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">Username *</label>
                    <input
                      type="text"
                      required
                      value={formData.username}
                      onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                      className="w-full px-3 py-2 border border-border rounded-md bg-background"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Password {editingConnection ? '' : '*'}
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required={!editingConnection}
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        className="w-full px-3 py-2 pr-10 border border-border rounded-md bg-background"
                        placeholder={editingConnection ? 'Leave blank to keep current' : ''}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-medium mb-2">
                      Request Timeout (seconds)
                    </label>
                    <input
                      type="number"
                      min={MIN_TIMEOUT_SECONDS}
                      max={MAX_TIMEOUT_SECONDS}
                      value={formData.timeout ?? DEFAULT_TIMEOUT_SECONDS}
                      onChange={(e) => {
                        const raw = e.target.value
                        const parsed = raw === '' ? DEFAULT_TIMEOUT_SECONDS : Number(raw)
                        const clamped = Number.isNaN(parsed)
                          ? DEFAULT_TIMEOUT_SECONDS
                          : Math.min(MAX_TIMEOUT_SECONDS, Math.max(MIN_TIMEOUT_SECONDS, parsed))
                        setFormData({ ...formData, timeout: clamped })
                      }}
                      className="w-full px-3 py-2 border border-border rounded-md bg-background"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      How long to wait for an APIC response before failing.
                      Range {MIN_TIMEOUT_SECONDS}–{MAX_TIMEOUT_SECONDS} seconds (default {DEFAULT_TIMEOUT_SECONDS}).
                    </p>
                  </div>

                  <div className="col-span-2 space-y-2">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={formData.verify_ssl}
                        onChange={(e) => setFormData({ ...formData, verify_ssl: e.target.checked })}
                        className="w-4 h-4"
                      />
                      <span className="text-sm">Verify SSL certificates</span>
                    </label>

                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={formData.is_public}
                        onChange={(e) => setFormData({ ...formData, is_public: e.target.checked })}
                        className="w-4 h-4"
                      />
                      <span className="text-sm">Make public (all users can use)</span>
                    </label>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateDialog(false)
                      setEditingConnection(null)
                      resetForm()
                    }}
                    className="px-4 py-2 border border-border rounded-md hover:bg-accent"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createMutation.isPending || updateMutation.isPending}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
                  >
                    {createMutation.isPending || updateMutation.isPending
                      ? 'Saving...'
                      : editingConnection
                      ? 'Update'
                      : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </TooltipProvider>
  )
}
