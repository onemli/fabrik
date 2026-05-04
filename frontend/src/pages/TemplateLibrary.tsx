// TemplateLibrary.tsx
//
// Browsable catalog of all AWX automation templates available to the current user.
// Each template card shows its input schema, category, and whether it requires
// manual approval. Clicking a template starts the request creation wizard.

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
import { awxService, AutomationTemplate, TemplateCategory } from '../services/awx'
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
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '../components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../components/ui/tooltip'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import {
  Search,
  Plus,
  Play,
  Edit,
  Trash2,
  TrendingUp,
  CheckCircle2,
  Workflow,
  FileCode,
  Filter,
  SlidersHorizontal,
  X,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDistanceToNow } from 'date-fns'
import { ConfirmDialog } from '../components/ConfirmDialog'

export default function TemplateLibrary() {
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<AutomationTemplate[]>([])
  const [categories, setCategories] = useState<TemplateCategory[]>([])
  const [loading, setLoading] = useState(true)

  // TanStack Table state
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [globalFilter, setGlobalFilter] = useState('')

  // Confirmation dialog
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; template: AutomationTemplate | null }>({
    isOpen: false,
    template: null,
  })

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)

      // Load categories
      const categoriesData = await awxService.listCategories()
      setCategories(Array.isArray(categoriesData) ? categoriesData : [])

      // Load all templates (filtering handled by TanStack Table)
      const templatesData = await awxService.listTemplates({})
      setTemplates(Array.isArray(templatesData) ? templatesData : [])
    } catch (error: any) {
      toast.error('Failed to load templates')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateRequest = (template: AutomationTemplate) => {
    navigate(`/awx/templates/${template.id}/create-request`)
  }

  const handleEditTemplate = (template: AutomationTemplate) => {
    navigate(`/awx/templates/${template.id}/edit`)
  }

  const confirmDeleteTemplate = (template: AutomationTemplate) => {
    setDeleteConfirm({ isOpen: true, template })
  }

  const handleDeleteTemplate = async () => {
    if (!deleteConfirm.template) return

    try {
      await awxService.deleteTemplate(deleteConfirm.template.id)
      toast.success('Template Deleted', {
        description: `"${deleteConfirm.template.name}" has been permanently deleted.`,
      })
      loadData()
    } catch (error: any) {
      toast.error('Delete Failed', {
        description: error.response?.data?.error || 'Failed to delete template',
      })
    } finally {
      setDeleteConfirm({ isOpen: false, template: null })
    }
  }

  const getSuccessRateColor = (rate: number) => {
    if (rate >= 90) return 'text-green-600 dark:text-green-400'
    if (rate >= 70) return 'text-yellow-600 dark:text-yellow-400'
    return 'text-red-600 dark:text-red-400'
  }

  const getSuccessRateBgColor = (rate: number) => {
    if (rate >= 90) return 'bg-green-50 dark:bg-green-900/20'
    if (rate >= 70) return 'bg-yellow-50 dark:bg-yellow-900/20'
    return 'bg-red-50 dark:bg-red-900/20'
  }

  // Define columns
  const columns = useMemo<ColumnDef<AutomationTemplate>[]>(
    () => [
      {
        id: 'type_icon',
        header: '',
        size: 60,
        enableSorting: false,
        enableColumnFilter: false,
        cell: ({ row }) => {
          const template = row.original
          return (
            <div className="flex items-center justify-center">
              {template.awx_type === 'workflow_template' ? (
                <div className="w-8 h-8 rounded bg-purple-100 dark:bg-purple-900/20 flex items-center justify-center">
                  <Workflow className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                </div>
              ) : (
                <div className="w-8 h-8 rounded bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center">
                  <FileCode className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                </div>
              )}
            </div>
          )
        },
      },
      {
        accessorKey: 'name',
        header: ({ column }) => {
          return (
            <div className="flex flex-col gap-1">
              <button
                className="flex items-center gap-1 hover:text-foreground"
                onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
              >
                Name
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
          const template = row.original
          return template.description ? (
            <TooltipProvider>
              <Tooltip delayDuration={300}>
                <TooltipTrigger asChild>
                  <div className="font-medium text-sm cursor-help truncate max-w-md">
                    {template.name}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="start" className="max-w-md">
                  <p className="text-xs">{template.description}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <div className="font-medium text-sm truncate max-w-md">
              {template.name}
            </div>
          )
        },
      },
      {
        accessorKey: 'awx_type',
        header: ({ column }) => {
          return (
            <div className="flex flex-col gap-1 items-center">
              <button
                className="flex items-center gap-1 hover:text-foreground"
                onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
              >
                Type
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
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="job_template">Job Template</SelectItem>
                  <SelectItem value="workflow_template">Workflow</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )
        },
        cell: ({ row }) => {
          return (
            <div className="flex items-center justify-center">
              <Badge variant="outline" className="text-xs">
                {row.original.awx_type_display}
              </Badge>
            </div>
          )
        },
        filterFn: 'equals',
      },
      {
        accessorKey: 'category_name',
        header: ({ column }) => {
          return (
            <div className="flex flex-col gap-1 items-center">
              <button
                className="flex items-center gap-1 hover:text-foreground"
                onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
              >
                Category
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
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.name}>
                      {cat.name}
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
              {row.original.category_name ? (
                <Badge variant="secondary" className="text-xs">
                  {row.original.category_name}
                </Badge>
              ) : (
                <span className="text-xs text-muted-foreground">-</span>
              )}
            </div>
          )
        },
      },
      {
        id: 'tags',
        accessorFn: (row) => row.tags?.join(', ') || '',
        header: ({ column }) => {
          return (
            <div className="flex flex-col gap-1 items-center">
              <div className="flex items-center gap-1">
                Tags
              </div>
              <Input
                placeholder="Filter tags..."
                value={(column.getFilterValue() as string) ?? ''}
                onChange={(e) => column.setFilterValue(e.target.value)}
                className="h-7 text-xs border-muted text-center"
              />
            </div>
          )
        },
        cell: ({ row }) => {
          const template = row.original
          return (
            <div className="flex items-center justify-center">
              {template.tags && template.tags.length > 0 ? (
                <div className="flex flex-wrap gap-1 justify-center">
                  {template.tags.slice(0, 2).map((tag, idx) => (
                    <Badge key={idx} variant="outline" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                  {template.tags.length > 2 && (
                    <Badge variant="outline" className="text-xs">
                      +{template.tags.length - 2}
                    </Badge>
                  )}
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">-</span>
              )}
            </div>
          )
        },
      },
      {
        accessorKey: 'execution_count',
        header: ({ column }) => {
          return (
            <div className="flex flex-col gap-1 items-center">
              <button
                className="flex items-center gap-1 hover:text-foreground"
                onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
              >
                Executions
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
            <div className="flex items-center justify-center gap-1">
              <TrendingUp className="h-3 w-3 text-muted-foreground" />
              <span className="text-sm font-medium">{row.original.execution_count || 0}</span>
            </div>
          )
        },
      },
      {
        accessorKey: 'success_rate',
        header: ({ column }) => {
          return (
            <div className="flex flex-col gap-1 items-center">
              <button
                className="flex items-center gap-1 hover:text-foreground"
                onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
              >
                Success Rate
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
          const template = row.original
          return (
            <div className="flex items-center justify-center">
              {template.execution_count > 0 ? (
                <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded ${getSuccessRateBgColor(template.success_rate || 0)}`}>
                  <CheckCircle2 className={`h-3 w-3 ${getSuccessRateColor(template.success_rate || 0)}`} />
                  <span className={`font-medium text-xs ${getSuccessRateColor(template.success_rate || 0)}`}>
                    {template.success_rate != null ? template.success_rate.toFixed(0) : '0'}%
                  </span>
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">-</span>
              )}
            </div>
          )
        },
      },
      {
        accessorKey: 'last_executed_at',
        header: ({ column }) => {
          return (
            <div className="flex flex-col gap-1 items-center">
              <button
                className="flex items-center gap-1 hover:text-foreground"
                onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
              >
                Last Executed
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
                {row.original.last_executed_at
                  ? formatDistanceToNow(new Date(row.original.last_executed_at), { addSuffix: true })
                  : 'Never'}
              </span>
            </div>
          )
        },
      },
      {
        id: 'actions',
        header: () => (
          <div className="text-center">Actions</div>
        ),
        size: 130,
        enableSorting: false,
        enableColumnFilter: false,
        cell: ({ row }) => {
          const template = row.original
          return (
            <div className="flex items-center justify-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => handleCreateRequest(template)}
                title="Create Request"
              >
                <Play className="h-4 w-4" />
              </Button>
              {template.can_edit && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => handleEditTemplate(template)}
                  title="Edit Template"
                >
                  <Edit className="h-4 w-4" />
                </Button>
              )}
              {template.can_delete && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                  onClick={() => confirmDeleteTemplate(template)}
                  title="Delete Template"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          )
        },
      },
    ],
    [categories]
  )

  // Create table instance
  const table = useReactTable({
    data: templates,
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
              <h1 className="text-2xl font-semibold tracking-tight">Automation Templates</h1>
              <p className="text-muted-foreground mt-1.5">
                Browse and manage AWX automation templates
              </p>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => navigate('/awx/categories')}>
                <SlidersHorizontal className="mr-2 h-4 w-4" />
                Manage Categories
              </Button>
              <Button onClick={() => navigate('/awx/templates/create')}>
                <Plus className="mr-2 h-4 w-4" />
                Create Template
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
                <p className="text-sm text-muted-foreground">Loading templates...</p>
              </div>
            </div>
          ) : (
            <>
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
                        data-state={row.getIsSelected() && 'selected'}
                        className="hover:bg-muted/30 transition-colors"
                      >
                        {row.getVisibleCells().map((cell) => (
                          <TableCell
                            key={cell.id}
                            className="py-2.5 px-4"
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
                          <Filter className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
                          <h3 className="font-semibold text-lg mb-2">No templates found</h3>
                          <p className="text-sm text-muted-foreground mb-4">
                            Try adjusting your filters or create a new template
                          </p>
                          <Button onClick={() => navigate('/awx/templates/create')}>
                            <Plus className="mr-2 h-4 w-4" />
                            Create Template
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </>
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
                  of {table.getFilteredRowModel().rows.length} templates
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
        onClose={() => setDeleteConfirm({ isOpen: false, template: null })}
        onConfirm={handleDeleteTemplate}
        title="Delete Template"
        message={`Are you sure you want to delete "${deleteConfirm.template?.name}"? This action cannot be undone and may affect existing requests.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />
    </div>
  )
}
