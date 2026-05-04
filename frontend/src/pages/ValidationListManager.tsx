// pages/ValidationListManager.tsx
//
// CRUD page for managing validation lists used in AWX table schema columns.
// Lists can be static (manually entered values) or query-backed (values from
// a saved APIC query). Each list is reusable across multiple schema columns.

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
import { Switch } from '@/components/ui/switch'
import {
  Plus,
  Search,
  Edit,
  Trash2,
  Eye,
  ListChecks,
  Users,
  RefreshCw,
  MoreVertical,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  User,
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
import { validationService, ValidationList, ValidationListCreate } from '@/services/validation'
import { StaticListEditor } from '@/components/SchemaDesigner/StaticListEditor'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useFormatters } from '@/contexts/TimezoneContext'

export function ValidationListManager() {
  const { formatDate } = useFormatters()
  const [lists, setLists] = useState<ValidationList[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sorting, setSorting] = useState<SortingState>([])

  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [viewDialogOpen, setViewDialogOpen] = useState(false)
  const [usagesDialogOpen, setUsagesDialogOpen] = useState(false)
  const [selectedList, setSelectedList] = useState<ValidationList | null>(null)
  const [usages, setUsages] = useState<any[]>([])

  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; list: ValidationList | null }>({
    isOpen: false,
    list: null,
  })

  const [formData, setFormData] = useState<ValidationListCreate>({
    name: '',
    description: '',
    values: [],
    case_sensitive: false,
    error_message: 'Value not in allowed list',
    error_message_title: 'Invalid Value',
    is_public: false,
  })

  useEffect(() => { fetchLists() }, [])

  const fetchLists = async () => {
    try {
      setLoading(true)
      const data = await validationService.getValidationLists()
      setLists(data)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load validation lists')
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = () => {
    setFormData({
      name: '',
      description: '',
      values: [],
      case_sensitive: false,
      error_message: 'Value not in allowed list',
      error_message_title: 'Invalid Value',
      is_public: false,
    })
    setCreateDialogOpen(true)
  }

  const handleEdit = (list: ValidationList) => {
    setSelectedList(list)
    setFormData({
      name: list.name,
      description: list.description,
      values: list.values,
      case_sensitive: list.case_sensitive,
      error_message: list.error_message,
      error_message_title: list.error_message_title,
      is_public: list.is_public,
    })
    setEditDialogOpen(true)
  }

  const handleView = (list: ValidationList) => {
    setSelectedList(list)
    setViewDialogOpen(true)
  }

  const handleViewUsages = async (list: ValidationList) => {
    try {
      setSelectedList(list)
      const data = await validationService.getValidationListUsages(list.id)
      setUsages(data.usages)
      setUsagesDialogOpen(true)
    } catch {
      toast.error('Failed to load usages')
    }
  }

  const confirmDelete = (list: ValidationList) => {
    if (list.usage_count > 0) {
      toast.error('Cannot Delete', {
        description: `This validation list is used in ${list.usage_count} place(s). Remove usages first.`,
      })
      return
    }
    setDeleteConfirm({ isOpen: true, list })
  }

  const handleDelete = async () => {
    if (!deleteConfirm.list) return
    try {
      await validationService.deleteValidationList(deleteConfirm.list.id)
      toast.success('Validation List Deleted', {
        description: `"${deleteConfirm.list.name}" has been permanently deleted.`,
      })
      fetchLists()
    } catch (error) {
      toast.error('Delete Failed', {
        description: error instanceof Error ? error.message : 'Failed to delete validation list',
      })
    } finally {
      setDeleteConfirm({ isOpen: false, list: null })
    }
  }

  const handleSaveCreate = async () => {
    if (!formData.name || formData.values.length === 0) {
      toast.error('Name and at least one value are required')
      return
    }
    try {
      await validationService.createValidationList(formData)
      toast.success('Validation list created successfully')
      setCreateDialogOpen(false)
      fetchLists()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create validation list')
    }
  }

  const handleSaveEdit = async () => {
    if (!selectedList || !formData.name || formData.values.length === 0) {
      toast.error('Name and at least one value are required')
      return
    }
    try {
      await validationService.updateValidationList(selectedList.id, formData)
      toast.success('Validation list updated successfully')
      setEditDialogOpen(false)
      fetchLists()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update validation list')
    }
  }

  const filtered = search
    ? lists.filter(l =>
        l.name.toLowerCase().includes(search.toLowerCase()) ||
        l.description.toLowerCase().includes(search.toLowerCase())
      )
    : lists

  // Column definitions
  const columns: ColumnDef<ValidationList>[] = [
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
              <ListChecks className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="font-medium text-sm truncate max-w-[220px]">{item.name}</div>
              {item.description && (
                <div className="text-xs text-muted-foreground truncate max-w-[220px]">{item.description}</div>
              )}
            </div>
          </div>
        )
      },
    },
    {
      accessorKey: 'values',
      header: ({ column }) => (
        <div className="flex items-center justify-center">
          <button
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            Values
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
      sortingFn: (a, b) => a.original.values.length - b.original.values.length,
      cell: ({ row }) => (
        <div className="flex items-center justify-center">
          <Badge variant="secondary" className="text-xs">{row.original.values.length}</Badge>
        </div>
      ),
    },
    {
      accessorKey: 'case_sensitive',
      header: ({ column }) => (
        <div className="flex items-center justify-center">
          <button
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            Case Sensitive
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
          {row.original.case_sensitive
            ? <Badge variant="outline" className="text-xs">Yes</Badge>
            : <span className="text-sm text-muted-foreground">No</span>
          }
        </div>
      ),
    },
    {
      accessorKey: 'usage_count',
      header: ({ column }) => (
        <div className="flex items-center justify-center">
          <button
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            Usage
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
        const count = row.original.usage_count
        return (
          <div className="flex items-center justify-center">
            {count > 0 ? (
              <button onClick={e => { e.stopPropagation(); handleViewUsages(row.original) }}>
                <Badge variant="outline" className="text-xs cursor-pointer hover:bg-muted/50 transition-colors">
                  {count} {count === 1 ? 'use' : 'uses'}
                </Badge>
              </button>
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: 'is_public',
      header: ({ column }) => (
        <div className="flex items-center justify-center">
          <button
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            Visibility
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
          {row.original.is_public ? (
            <Badge variant="outline" className="text-xs gap-1">
              <Users className="h-3 w-3" />
              Public
            </Badge>
          ) : (
            <span className="text-sm text-muted-foreground">Private</span>
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
                <DropdownMenuItem onClick={e => { e.stopPropagation(); handleView(item) }}>
                  <Eye className="h-4 w-4 mr-2" />
                  View details
                </DropdownMenuItem>
                {item.can_edit && (
                  <DropdownMenuItem onClick={e => { e.stopPropagation(); handleEdit(item) }}>
                    <Edit className="h-4 w-4 mr-2" />
                    Edit
                  </DropdownMenuItem>
                )}
                {item.usage_count > 0 && (
                  <DropdownMenuItem onClick={e => { e.stopPropagation(); handleViewUsages(item) }}>
                    <Users className="h-4 w-4 mr-2" />
                    View usages
                  </DropdownMenuItem>
                )}
                {item.can_delete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={e => { e.stopPropagation(); confirmDelete(item) }}
                      disabled={item.usage_count > 0}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      },
    },
  ]

  const table = useReactTable({
    data: filtered,
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
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Validation Lists</h1>
              <p className="text-muted-foreground mt-1">
                Reusable lists of valid values for column validation
              </p>
            </div>
            <Button
              onClick={handleCreate}
              size="sm"
              className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all hover:scale-[1.02]"
            >
              <Plus className="w-4 h-4" />
              New Validation List
            </Button>
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
              placeholder="Search validation lists…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 h-10 glass border-border/20 text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all"
            />
          </div>
          <Button variant="ghost" size="icon" className="h-10 w-10" onClick={fetchLists} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Table / states */}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <RefreshCw className="h-5 w-5 animate-spin mr-2" />
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
            <ListChecks className="h-12 w-12 text-muted-foreground/30" />
            <div>
              <p className="font-medium">No validation lists found</p>
              <p className="text-sm text-muted-foreground mt-1">
                {search ? 'No results for your search.' : 'Create a reusable list of valid values to get started.'}
              </p>
            </div>
            {!search && (
              <Button variant="outline" onClick={handleCreate}>
                <Plus className="h-4 w-4 mr-2" />
                Create Your First Validation List
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
                    <TableRow key={row.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => handleView(row.original)}>
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
                        filtered.length
                      )}
                    </span>{' '}
                    of{' '}
                    <span className="font-medium text-foreground">{filtered.length}</span>{' '}
                    lists
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

      {/* ── Dialogs ──────────────────────────────────────────────────── */}

      {/* Create */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Validation List</DialogTitle>
            <DialogDescription>
              Create a reusable list of valid values for column validation
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="create-name">Name *</Label>
              <Input
                id="create-name"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., ACI Tenant Names"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-description">Description</Label>
              <Textarea
                id="create-description"
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                placeholder="Describe what this list is used for"
                rows={2}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="create-public">Public Visibility</Label>
                <p className="text-xs text-muted-foreground">Allow all users to use this validation list</p>
              </div>
              <Switch
                id="create-public"
                checked={formData.is_public}
                onCheckedChange={checked => setFormData({ ...formData, is_public: checked })}
              />
            </div>
            <StaticListEditor
              values={formData.values}
              onChange={values => setFormData({ ...formData, values })}
              caseSensitive={formData.case_sensitive}
              onCaseSensitiveChange={value => setFormData({ ...formData, case_sensitive: value })}
              errorMessage={formData.error_message}
              onErrorMessageChange={message => setFormData({ ...formData, error_message: message })}
              errorTitle={formData.error_message_title}
              onErrorTitleChange={title => setFormData({ ...formData, error_message_title: title })}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveCreate}>Create List</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Validation List</DialogTitle>
            <DialogDescription>Update validation list settings and values</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name *</Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., ACI Tenant Names"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                placeholder="Describe what this list is used for"
                rows={2}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="edit-public">Public Visibility</Label>
                <p className="text-xs text-muted-foreground">Allow all users to use this validation list</p>
              </div>
              <Switch
                id="edit-public"
                checked={formData.is_public}
                onCheckedChange={checked => setFormData({ ...formData, is_public: checked })}
              />
            </div>
            <StaticListEditor
              values={formData.values}
              onChange={values => setFormData({ ...formData, values })}
              caseSensitive={formData.case_sensitive}
              onCaseSensitiveChange={value => setFormData({ ...formData, case_sensitive: value })}
              errorMessage={formData.error_message}
              onErrorMessageChange={message => setFormData({ ...formData, error_message: message })}
              errorTitle={formData.error_message_title}
              onErrorTitleChange={title => setFormData({ ...formData, error_message_title: title })}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveEdit}>Update List</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedList?.name}</DialogTitle>
            <DialogDescription>{selectedList?.description || 'No description'}</DialogDescription>
          </DialogHeader>
          {selectedList && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <Label className="text-muted-foreground">Values Count</Label>
                  <div className="font-medium">{selectedList.values.length}</div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Case Sensitive</Label>
                  <div className="font-medium">{selectedList.case_sensitive ? 'Yes' : 'No'}</div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Usage Count</Label>
                  <div className="font-medium">{selectedList.usage_count}</div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Visibility</Label>
                  <div className="font-medium">{selectedList.is_public ? 'Public' : 'Private'}</div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Created By</Label>
                  <div className="font-medium">{selectedList.created_by?.username || 'Unknown'}</div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Last Used</Label>
                  <div className="font-medium">
                    {selectedList.last_used_at
                      ? formatDate(selectedList.last_used_at)
                      : 'Never'}
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-red-200 bg-red-50/50 dark:border-red-900/50 dark:bg-red-950/20 p-3 space-y-2">
                <Label className="text-red-700 dark:text-red-400 text-xs font-semibold uppercase tracking-wide">
                  Validation Failure Feedback
                </Label>
                <div className="space-y-1">
                  <Label className="text-xs text-red-600 dark:text-red-400">Error Title</Label>
                  <div className="p-2 bg-red-100/50 dark:bg-red-950/30 rounded text-sm border border-red-200/50 dark:border-red-900/30">
                    {selectedList.error_message_title}
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-red-600 dark:text-red-400">Error Message</Label>
                  <div className="p-2 bg-red-100/50 dark:bg-red-950/30 rounded text-sm border border-red-200/50 dark:border-red-900/30">
                    {selectedList.error_message}
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Allowed Values</Label>
                <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto p-2 border rounded-lg">
                  {selectedList.values.map((value, index) => (
                    <Badge key={index} variant="secondary">{value}</Badge>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewDialogOpen(false)}>Close</Button>
            {selectedList?.can_edit && (
              <Button onClick={() => { setViewDialogOpen(false); handleEdit(selectedList) }}>
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Usages */}
      <Dialog open={usagesDialogOpen} onOpenChange={setUsagesDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Where is "{selectedList?.name}" used?</DialogTitle>
            <DialogDescription>Templates and columns using this validation list</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {usages.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                This validation list is not used in any templates yet
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Template</TableHead>
                    <TableHead>Sheet</TableHead>
                    <TableHead>Column</TableHead>
                    <TableHead>Created By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usages.map((usage) => (
                    <TableRow key={usage.id}>
                      <TableCell className="font-medium">{usage.template_name}</TableCell>
                      <TableCell>{usage.sheet_name}</TableCell>
                      <TableCell>{usage.column_name}</TableCell>
                      <TableCell className="text-muted-foreground">{usage.created_by_username || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUsagesDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ isOpen: false, list: null })}
        onConfirm={handleDelete}
        title="Delete Validation List"
        message={`Are you sure you want to delete "${deleteConfirm.list?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />
    </div>
  )
}
