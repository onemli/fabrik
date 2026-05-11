// library/CategoryManager.tsx
//
// Table-style category list for the Library "categories" tab. Mirrors the
// queries-tab layout (TanStack Table, sortable headers, paginated, bulk-
// select) so the two tabs feel like one app. Clicking a category name
// fires onSelectCategory; the parent (Library) flips into a drill-down
// that reuses the queries ListView filtered to that category.

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queriesService, type Category } from '@/services/queries'
import {
  Plus,
  Edit,
  Trash2,
  Tag,
  Search,
  X,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from './EmptyState'
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  SortingState,
} from '@tanstack/react-table'
import { formatDistanceToNow } from 'date-fns'

const DEFAULT_COLOR = '#10b981'

const PRESET_COLORS = [
  '#10b981', // emerald
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#f59e0b', // amber
  '#ef4444', // red
  '#06b6d4', // cyan
  '#84cc16', // lime
]

interface CategoryManagerProps {
  onSelectCategory: (id: number) => void
}

export function CategoryManager({ onSelectCategory }: CategoryManagerProps) {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [deleteConfirmCategory, setDeleteConfirmCategory] = useState<Category | null>(null)
  const [search, setSearch] = useState('')
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }])
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    color: DEFAULT_COLOR,
  })

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories'],
    queryFn: () => queriesService.getCategories(),
  })

  const createMutation = useMutation({
    mutationFn: (data: typeof formData) => queriesService.createCategory(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] })
      closeDialog()
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: typeof formData }) =>
      queriesService.updateCategory(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] })
      closeDialog()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => queriesService.deleteCategory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] })
      queryClient.invalidateQueries({ queryKey: ['saved-queries-paginated'] })
    },
  })

  const resetForm = () => {
    setFormData({ name: '', description: '', color: DEFAULT_COLOR })
    setEditingCategory(null)
  }

  const closeDialog = () => {
    setDialogOpen(false)
    resetForm()
  }

  const handleSubmit = () => {
    if (!formData.name.trim()) return
    if (editingCategory) {
      updateMutation.mutate({ id: editingCategory.id, data: formData })
    } else {
      createMutation.mutate(formData)
    }
  }

  const openCreate = () => {
    resetForm()
    setDialogOpen(true)
  }

  const openEdit = (category: Category) => {
    setEditingCategory(category)
    setFormData({
      name: category.name,
      description: category.description || '',
      color: category.color || DEFAULT_COLOR,
    })
    setDialogOpen(true)
  }

  const columns = useMemo<ColumnDef<Category>[]>(
    () => [
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
          const cat = row.original
          const color = cat.color || DEFAULT_COLOR
          return (
            <button
              onClick={() => onSelectCategory(cat.id)}
              className="flex items-center gap-3 group"
            >
              <span
                className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: `${color}22` }}
              >
                <Tag className="w-4 h-4" style={{ color }} />
              </span>
              <span className="font-medium text-sm group-hover:text-primary transition-colors">
                {cat.name}
              </span>
            </button>
          )
        },
      },
      {
        accessorKey: 'description',
        header: 'Description',
        cell: ({ row }) =>
          row.original.description ? (
            <span className="text-sm text-muted-foreground line-clamp-1 max-w-md">
              {row.original.description}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground/50">—</span>
          ),
        enableSorting: false,
      },
      {
        accessorKey: 'query_count',
        header: ({ column }) => (
          <div className="flex items-center justify-center">
            <button
              onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
              className="flex items-center gap-1.5 hover:text-foreground transition-colors"
            >
              Queries
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
            <Badge variant="outline" className="text-xs">
              {row.original.query_count || 0}
            </Badge>
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
        cell: ({ row }) => (
          <div className="flex items-center justify-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={(e) => {
                e.stopPropagation()
                openEdit(row.original)
              }}
              aria-label="Edit category"
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 hover:bg-destructive/10 hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation()
                setDeleteConfirmCategory(row.original)
              }}
              aria-label="Delete category"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ),
        enableSorting: false,
      },
    ],
    [onSelectCategory]
  )

  const filteredCategories = useMemo(() => {
    if (!search) return categories
    const q = search.toLowerCase()
    return categories.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.description || '').toLowerCase().includes(q)
    )
  }, [categories, search])

  const table = useReactTable({
    data: filteredCategories,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 20 } },
  })

  return (
    <div className="flex-1 flex flex-col">
      {/* Toolbar */}
      <div className="mb-6 flex items-center gap-3">
        <div className="flex-1 max-w-md relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search categories..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-10 glass border-border/20"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-accent/50"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex-1" />

        <Button onClick={openCreate} className="gap-2">
          <Plus className="w-4 h-4" />
          New Category
        </Button>
      </div>

      {/* Content */}
      {categories.length === 0 ? (
        <EmptyState
          title="No categories yet"
          description="Create your first category to organize your queries."
          action={
            <Button onClick={openCreate} size="lg" className="gap-2">
              <Plus className="w-4 h-4" />
              Create Category
            </Button>
          }
        />
      ) : filteredCategories.length === 0 ? (
        <EmptyState
          title="No categories match"
          description="Try a different search term."
        />
      ) : (
        <div className="flex-1 flex flex-col justify-between">
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
                    onClick={() => onSelectCategory(row.original.id)}
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

          {/* Pagination */}
          {filteredCategories.length > 0 && (
            <div className="mt-4 flex-shrink-0">
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
                        filteredCategories.length
                      )}
                    </span>{' '}
                    of{' '}
                    <span className="font-medium text-foreground">{filteredCategories.length}</span>{' '}
                    categories
                  </span>
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
                        aria-label="First page"
                      >
                        <ChevronsLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => table.previousPage()}
                        disabled={!table.getCanPreviousPage()}
                        aria-label="Previous page"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-sm font-medium">
                        Page {table.getState().pagination.pageIndex + 1} of{' '}
                        {Math.max(table.getPageCount(), 1)}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => table.nextPage()}
                        disabled={!table.getCanNextPage()}
                        aria-label="Next page"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                        disabled={!table.getCanNextPage()}
                        aria-label="Last page"
                      >
                        <ChevronsRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCategory ? 'Edit Category' : 'Create Category'}</DialogTitle>
            <DialogDescription>
              {editingCategory
                ? 'Update the category details.'
                : 'Add a new category to organize your queries.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="cat-name">Name</Label>
              <Input
                id="cat-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Category name"
                autoFocus
              />
            </div>

            <div>
              <Label htmlFor="cat-description">Description (optional)</Label>
              <Input
                id="cat-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="What goes in this category?"
              />
            </div>

            <div>
              <Label>Color</Label>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setFormData({ ...formData, color: c })}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${
                      formData.color.toLowerCase() === c.toLowerCase()
                        ? 'border-foreground scale-110'
                        : 'border-transparent hover:scale-105'
                    }`}
                    style={{ backgroundColor: c }}
                    aria-label={`Pick color ${c}`}
                  />
                ))}
                <div className="flex items-center gap-2 ml-2">
                  <Input
                    type="color"
                    value={formData.color}
                    onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                    className="w-10 h-8 p-1"
                    aria-label="Custom color"
                  />
                  <Input
                    value={formData.color}
                    onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                    className="w-28 h-8 font-mono text-xs"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!formData.name.trim() || createMutation.isPending || updateMutation.isPending}
            >
              {editingCategory ? 'Update' : 'Create'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={!!deleteConfirmCategory}
        onClose={() => setDeleteConfirmCategory(null)}
        onConfirm={() => {
          if (deleteConfirmCategory) {
            deleteMutation.mutate(deleteConfirmCategory.id)
            setDeleteConfirmCategory(null)
          }
        }}
        title="Delete Category"
        message={
          deleteConfirmCategory && (deleteConfirmCategory.query_count ?? 0) > 0
            ? `Are you sure you want to delete "${deleteConfirmCategory.name}"? It contains ${deleteConfirmCategory.query_count} ${deleteConfirmCategory.query_count === 1 ? 'query' : 'queries'} — they won't be deleted, just uncategorised.`
            : `Are you sure you want to delete "${deleteConfirmCategory?.name}"?`
        }
        confirmText="Delete"
        variant="danger"
      />
    </div>
  )
}
