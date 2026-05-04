// ValidationQueries.tsx
//
// Management page for saved queries that are flagged as validation sources.
// These queries power dropdown fields in AWX automation templates — when a user
// fills out a request form, the dropdown options come from APIC live data via
// these validation queries.

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Search,
  Upload,
  Download,
  MoreVertical,
  AlertCircle,
  RefreshCw,
  Trash2,
  Edit,
  Plus,
  ExternalLink,
  ShieldCheck,
  User,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react'
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  useReactTable,
  SortingState,
} from '@tanstack/react-table'
import { formatDistanceToNow } from 'date-fns'
import { queriesService, SavedQueryListItem } from '@/services/queries'

// ── Edit Metadata Dialog ──────────────────────────────────────────────────────

function EditMetadataDialog({
  query,
  open,
  onClose,
  onSaved,
}: {
  query: SavedQueryListItem
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [description, setDescription] = useState(query.validation_description || '')
  const [errorTitle, setErrorTitle] = useState(query.validation_error_title || '')
  const [errorMessage, setErrorMessage] = useState(query.validation_error_message || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await queriesService.updateSavedQuery(query.id, {
        description: description || undefined,
      })
      await queriesService.markAsValidationQuery(query.id, { is_validation_query: true })
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit className="h-5 w-5 text-primary" />
            Edit — <span className="text-muted-foreground font-normal truncate max-w-xs">{query.name}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What does this validation query check?"
              rows={2}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Error Title</Label>
              <Input
                value={errorTitle}
                onChange={e => setErrorTitle(e.target.value)}
                placeholder="e.g. Invalid Tenant"
                maxLength={100}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Error Message</Label>
              <Input
                value={errorMessage}
                onChange={e => setErrorMessage(e.target.value)}
                placeholder="e.g. Tenant not found in APIC"
                maxLength={500}
              />
            </div>
          </div>
          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <RefreshCw className="h-4 w-4 mr-2 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Import Dialog ─────────────────────────────────────────────────────────────

function ImportDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean
  onClose: () => void
  onImported: () => void
}) {
  const [onDuplicate, setOnDuplicate] = useState<'skip' | 'overwrite' | 'rename'>('skip')
  const [result, setResult] = useState<{
    imported: number; skipped: number; overwritten: number
    errors: Array<{ index: number; name: string; error: string }>
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      if (!parsed.queries) throw new Error('Invalid file format — "queries" array not found.')
      const res = await queriesService.importValidationQueries(parsed, onDuplicate)
      setResult(res)
      if (res.imported > 0 || res.overwritten > 0) onImported()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setLoading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Import Validation Queries
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>On duplicate name</Label>
            <Select value={onDuplicate} onValueChange={v => setOnDuplicate(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="skip">Skip (keep existing)</SelectItem>
                <SelectItem value="overwrite">Overwrite existing</SelectItem>
                <SelectItem value="rename">Import with "(imported)" suffix</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div
            className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              Click to select a <span className="font-mono">.json</span> export file
            </p>
            <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleFile} />
          </div>

          {loading && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-2">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Importing…
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {result && (
            <Card className="p-3 space-y-1 text-sm">
              <div className="font-medium">Import complete</div>
              <div className="text-muted-foreground space-y-0.5">
                <div><span className="text-green-600 font-medium">{result.imported}</span> imported</div>
                {result.overwritten > 0 && <div><span className="text-blue-600 font-medium">{result.overwritten}</span> overwritten</div>}
                {result.skipped > 0 && <div><span className="text-muted-foreground">{result.skipped}</span> skipped</div>}
                {result.errors.length > 0 && (
                  <div className="text-destructive mt-1">
                    {result.errors.length} error{result.errors.length > 1 ? 's' : ''}:
                    <ul className="mt-1 space-y-0.5 pl-3">
                      {result.errors.map((e, i) => (
                        <li key={i}>{e.name}: {e.error}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Unmark Confirm Dialog ─────────────────────────────────────────────────────

function UnmarkConfirmDialog({
  query,
  open,
  onClose,
  onConfirm,
}: {
  query: SavedQueryListItem | null
  open: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Remove Validation Query Mark</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground py-2">
          Remove the validation query mark from <strong>{query?.name}</strong>?
          The query will remain saved but will no longer appear here or be available for column validation.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm}>Remove</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ValidationQueries() {
  const [queries, setQueries] = useState<SavedQueryListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [exporting, setExporting] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([])

  const [editDialog, setEditDialog] = useState<{ open: boolean; query: SavedQueryListItem | null }>({ open: false, query: null })
  const [unmarkDialog, setUnmarkDialog] = useState<{ open: boolean; query: SavedQueryListItem | null }>({ open: false, query: null })
  const [importDialog, setImportDialog] = useState(false)

  const load = async (q?: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await queriesService.getValidationQueries({ search: q || undefined, page_size: 100 })
      setQueries(res.results)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    const t = setTimeout(() => load(search), 350)
    return () => clearTimeout(t)
  }, [search])

  const handleUnmark = async () => {
    const q = unmarkDialog.query
    if (!q) return
    try {
      await queriesService.markAsValidationQuery(q.id, { is_validation_query: false })
      setUnmarkDialog({ open: false, query: null })
      load(search)
    } catch {
      /* ignore */
    }
  }

  const handleExportOne = async (q: SavedQueryListItem) => {
    setExporting(true)
    try { await queriesService.exportValidationQueries([q.id]) }
    finally { setExporting(false) }
  }

  const handleExportSelected = async () => {
    setExporting(true)
    try {
      const ids = selectedIds.length > 0 ? selectedIds : undefined
      await queriesService.exportValidationQueries(ids)
    } finally { setExporting(false) }
  }

  // Column definitions
  const columns: ColumnDef<SavedQueryListItem>[] = [
    {
      id: 'select',
      header: () => <div className="text-center">Select</div>,
      cell: ({ row }) => (
        <div className="flex items-center justify-center">
          <Checkbox
            checked={selectedIds.includes(row.original.id)}
            onCheckedChange={() => {
              setSelectedIds(prev =>
                prev.includes(row.original.id)
                  ? prev.filter(id => id !== row.original.id)
                  : [...prev, row.original.id]
              )
            }}
            onClick={e => e.stopPropagation()}
          />
        </div>
      ),
      enableSorting: false,
    },
    {
      accessorKey: 'name',
      header: ({ column }) => (
        <button
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="flex items-center gap-1.5 hover:text-foreground transition-colors"
        >
          Name
          {column.getIsSorted() === 'asc' ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : column.getIsSorted() === 'desc' ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
          )}
        </button>
      ),
      cell: ({ row }) => {
        const item = row.original
        return (
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <ShieldCheck className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="font-medium text-sm truncate max-w-[260px]">{item.name}</div>
              {(item.validation_description || item.description) && (
                <div className="text-xs text-muted-foreground truncate max-w-[260px]">
                  {item.validation_description || item.description}
                </div>
              )}
            </div>
          </div>
        )
      },
    },
    {
      accessorKey: 'category_name',
      header: ({ column }) => (
        <div className="flex items-center justify-center">
          <button
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            Category
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
          {row.original.category_name ? (
            <Badge variant="outline" className="text-xs">{row.original.category_name}</Badge>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'created_by.username',
      header: ({ column }) => (
        <div className="flex items-center justify-center">
          <button
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            Created By
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
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <User className="w-3 h-3" />
            {row.original.created_by?.username || 'Unknown'}
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'validation_usage_count',
      header: ({ column }) => (
        <div className="flex items-center justify-center">
          <button
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            Used In
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
        const count = row.original.validation_usage_count ?? 0
        return (
          <div className="flex items-center justify-center text-sm">
            {count > 0
              ? <Badge variant="secondary" className="text-xs">{count} template{count !== 1 ? 's' : ''}</Badge>
              : <span className="text-muted-foreground">—</span>
            }
          </div>
        )
      },
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
          {formatDistanceToNow(new Date(row.original.created_at), { addSuffix: true })}
        </div>
      ),
    },
    {
      id: 'actions',
      header: () => <div className="text-center">Actions</div>,
      enableSorting: false,
      cell: ({ row }) => {
        const item = row.original
        return (
          <div className="flex items-center justify-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={e => { e.stopPropagation(); setEditDialog({ open: true, query: item }) }}>
                  <Edit className="h-4 w-4 mr-2" />
                  Edit metadata
                </DropdownMenuItem>
                <DropdownMenuItem onClick={e => { e.stopPropagation(); window.open(`/builder/${item.id}`, '_blank') }}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open in Query Builder
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={e => { e.stopPropagation(); handleExportOne(item) }}>
                  <Download className="h-4 w-4 mr-2" />
                  Export
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={e => { e.stopPropagation(); setUnmarkDialog({ open: true, query: item }) }}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Remove validation mark
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      },
    },
  ]

  const table = useReactTable({
    data: queries,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
    initialState: { pagination: { pageSize: 20 } },
  })

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="border-b border-border/20 flex-shrink-0">
        <div className="px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Validation Queries</h1>
              <p className="text-muted-foreground mt-1">
                Queries marked as validation sources in Query Builder → Output node
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setImportDialog(true)}
                className="glass border-border/20 text-foreground hover:border-primary/30 hover:bg-accent/50 transition-all"
              >
                <Upload className="w-4 h-4 mr-2" />
                Import
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportSelected}
                disabled={exporting}
                className="glass border-border/20 text-foreground hover:border-primary/30 hover:bg-accent/50 transition-all disabled:opacity-40"
              >
                {exporting
                  ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  : <Download className="w-4 h-4 mr-2" />}
                {selectedIds.length > 0 ? `Export (${selectedIds.length})` : 'Export All'}
              </Button>
              <Button
                size="sm"
                onClick={() => window.open('/builder', '_blank')}
                className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all hover:scale-[1.02]"
              >
                <Plus className="w-4 h-4" />
                New Query
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-8 py-6 flex-1 flex flex-col">
        {/* Toolbar */}
        <div className="mb-6 flex items-center gap-3">
          <div className="flex-1 max-w-md relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search validation queries…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 h-10 glass border-border/20 text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all"
            />
          </div>
          <Button variant="ghost" size="icon" className="h-10 w-10" onClick={() => load(search)} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Selection bar */}
        {selectedIds.length > 0 && (
          <div className="mb-4 flex items-center justify-between p-4 glass border border-primary/30 rounded-xl bg-primary/5">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="text-sm font-medium">{selectedIds.length} item{selectedIds.length > 1 ? 's' : ''} selected</span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>
              Clear Selection
            </Button>
          </div>
        )}

        {/* Table / states */}
        {loading && !queries.length ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <RefreshCw className="h-5 w-5 animate-spin mr-2" />
            Loading…
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={() => load(search)}>Retry</Button>
          </div>
        ) : queries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
            <ShieldCheck className="h-12 w-12 text-muted-foreground/30" />
            <div>
              <p className="font-medium">No validation queries yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                {search
                  ? 'No results for your search.'
                  : 'Open a query in Query Builder, run it to verify the output is a list, then enable "Mark as validation query" in the Output node settings.'}
              </p>
            </div>
            {!search && (
              <Button variant="outline" onClick={() => window.open('/builder', '_blank')}>
                <Plus className="h-4 w-4 mr-2" />
                Open Query Builder
              </Button>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col justify-between">
            <div className="border rounded-lg shadow-sm overflow-hidden">
              <Table>
                <TableHeader>
                  {table.getHeaderGroups().map(hg => (
                    <TableRow key={hg.id}>
                      {hg.headers.map(header => (
                        <TableHead key={header.id} className="py-3 px-4">
                          {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {table.getRowModel().rows.map(row => (
                    <TableRow key={row.id} className="hover:bg-muted/30">
                      {row.getVisibleCells().map(cell => (
                        <TableCell key={cell.id} className="py-2.5 px-4">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            <div className="mt-4">
              <div className="border rounded-lg shadow-sm px-6 py-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Showing{' '}
                    <span className="font-medium text-foreground">
                      {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1}
                    </span>{' '}
                    to{' '}
                    <span className="font-medium text-foreground">
                      {Math.min(
                        (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
                        queries.length
                      )}
                    </span>{' '}
                    of{' '}
                    <span className="font-medium text-foreground">{queries.length}</span>{' '}
                    queries
                  </span>
                  <div className="flex items-center gap-4">
                    <Select
                      value={table.getState().pagination.pageSize.toString()}
                      onValueChange={v => table.setPageSize(Number(v))}
                    >
                      <SelectTrigger className="h-9 w-[120px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {[10, 20, 50, 100].map(size => (
                          <SelectItem key={size} value={size.toString()}>{size} per page</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()}>
                        <ChevronsLeft className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-sm font-medium">
                        Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
                      </span>
                      <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => table.setPageIndex(table.getPageCount() - 1)} disabled={!table.getCanNextPage()}>
                        <ChevronsRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Dialogs */}
      {editDialog.query && (
        <EditMetadataDialog
          query={editDialog.query}
          open={editDialog.open}
          onClose={() => setEditDialog({ open: false, query: null })}
          onSaved={() => { setEditDialog({ open: false, query: null }); load(search) }}
        />
      )}

      <UnmarkConfirmDialog
        query={unmarkDialog.query}
        open={unmarkDialog.open}
        onClose={() => setUnmarkDialog({ open: false, query: null })}
        onConfirm={handleUnmark}
      />

      <ImportDialog
        open={importDialog}
        onClose={() => setImportDialog(false)}
        onImported={() => load(search)}
      />
    </div>
  )
}
