// library/ListView.tsx
//
// Table row layout for the query library — the alternative to GridView. Columns
// include checkbox (for bulk export), name, category, scheduled status, last run,
// and an action menu. Shares the same mutation logic as GridView.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queriesService } from '@/services/queries'
import { useAuthStore } from '@/store/authStore'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import {
  Heart,
  Trash2,
  Copy,
  Play,
  Sparkles,
  User,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  MoreVertical,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/ConfirmDialog'
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

interface ListViewProps {
  items: any[]
  type: 'query' | 'template'
  selectedIds: number[]
  onToggleSelect: (id: number) => void
}

export function ListView({ items, type, selectedIds, onToggleSelect }: ListViewProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const { loadFromSaved } = useQueryBuilderStore()
  const [sorting, setSorting] = useState<SortingState>([])
  const [deleteConfirmItem, setDeleteConfirmItem] = useState<any>(null)

  const favoriteMutation = useMutation({
    mutationFn: (id: number) => queriesService.favoriteQuery(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-queries-paginated'] })
      queryClient.invalidateQueries({ queryKey: ['saved-queries-count', 'queries'] })
      queryClient.invalidateQueries({ queryKey: ['saved-queries-count', 'templates'] })
    },
  })

  const duplicateMutation = useMutation({
    mutationFn: (id: number) => queriesService.duplicateQuery(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-queries-paginated'] })
      queryClient.invalidateQueries({ queryKey: ['saved-queries-count', 'queries'] })
      queryClient.invalidateQueries({ queryKey: ['saved-queries-count', 'templates'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => queriesService.deleteSavedQuery(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-queries-paginated'] })
      queryClient.invalidateQueries({ queryKey: ['saved-queries-count', 'queries'] })
      queryClient.invalidateQueries({ queryKey: ['saved-queries-count', 'templates'] })
    },
  })

  const handleDelete = (item: any) => {
    setDeleteConfirmItem(item)
  }

  const handleLoadQuery = async (query: any) => {
    const fullQuery = await queriesService.getSavedQuery(query.id)

    // Update Output node with enable_time_machine value
    const updatedNodes = fullQuery.flow_data.nodes.map((node: any) => {
      if (node.type === 'output') {
        return {
          ...node,
          data: {
            ...node.data,
            enableTimeMachine: fullQuery.enable_time_machine || false,
            isValidationQuery: fullQuery.is_validation_query || false,
          }
        }
      }
      return node
    })

    // Pass query ID and metadata to loadFromSaved
    loadFromSaved(
      updatedNodes,
      fullQuery.flow_data.edges,
      fullQuery.name,
      fullQuery.id,
      {
        name: fullQuery.name,
        description: fullQuery.description,
        category: fullQuery.category,
        tags: fullQuery.tags,
        is_public: fullQuery.is_public,
        is_template: fullQuery.is_template,
      }
    )
    navigate(`/builder/${fullQuery.id}`)
  }

  // Column definitions
  const columns: ColumnDef<any>[] = [
    {
      id: 'select',
      header: () => <div className="text-center">Select</div>,
      cell: ({ row }) => (
        <div className="flex items-center justify-center">
          <Checkbox
            checked={selectedIds.includes(row.original.id)}
            onCheckedChange={() => onToggleSelect(row.original.id)}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ),
      enableSorting: false,
    },
    {
      accessorKey: 'name',
      header: ({ column }) => (
        <div className="flex flex-col gap-1">
          <button
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors w-full"
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
        </div>
      ),
      cell: ({ row }) => {
        const item = row.original
        return (
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-lg ${
                item.is_template ? 'bg-purple-500/10' : 'bg-primary/10'
              }`}
            >
              {item.is_template ? (
                <Sparkles className="w-4 h-4 text-purple-400" />
              ) : (
                <Play className="w-4 h-4 text-primary" />
              )}
            </div>
            <div className="font-medium text-sm truncate max-w-[300px]">
              {item.name}
            </div>
          </div>
        )
      },
    },
    {
      accessorKey: 'category_name',
      header: ({ column }) => (
        <div className="flex flex-col gap-1 items-center">
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
            <Badge variant="outline" className="text-xs">
              {row.original.category_name}
            </Badge>
          ) : (
            <span className="text-sm text-muted-foreground">-</span>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'created_by.username',
      header: ({ column }) => (
        <div className="flex flex-col gap-1 items-center">
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
      accessorKey: 'execution_count',
      header: ({ column }) => (
        <div className="flex items-center justify-center">
          <button
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            Runs
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
        <div className="flex items-center justify-center text-sm">
          {row.original.execution_count || 0}
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
      cell: ({ row }) => {
        const item = row.original
        return (
          <div className="flex items-center justify-center gap-1">
            <Button
              onClick={(e) => {
                e.stopPropagation()
                handleLoadQuery(item)
              }}
              size="sm"
              variant="outline"
              className="h-8 text-xs"
            >
              Load
            </Button>
            <Button
              onClick={(e) => {
                e.stopPropagation()
                favoriteMutation.mutate(item.id)
              }}
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
            >
              <Heart
                className={`w-4 h-4 ${item.is_favorite ? 'fill-red-500 text-red-500' : ''}`}
              />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    duplicateMutation.mutate(item.id)
                  }}
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Duplicate
                </DropdownMenuItem>
                {item.created_by?.id === user?.id && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(item)
                      }}
                      className="text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      },
      enableSorting: false,
    },
  ]

  // TanStack Table setup
  const table = useReactTable({
    data: items,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    state: {
      sorting,
    },
    initialState: {
      pagination: {
        pageSize: 20,
      },
    },
  })

  return (
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
                onClick={() => handleLoadQuery(row.original)}
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
      {items.length > 0 && (
        <div className="mt-4 flex-shrink-0">
          <div className="border rounded-lg shadow-sm px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <span className="text-sm text-muted-foreground">
                  Showing{' '}
                  <span className="font-medium text-foreground">
                    {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1}
                  </span>{' '}
                  to{' '}
                  <span className="font-medium text-foreground">
                    {Math.min(
                      (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
                      items.length
                    )}
                  </span>{' '}
                  of{' '}
                  <span className="font-medium text-foreground">
                    {items.length}
                  </span>{' '}
                  {type === 'query' ? 'queries' : 'templates'}
                </span>
              </div>
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
                  >
                    <ChevronsLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => table.previousPage()}
                    disabled={!table.getCanPreviousPage()}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm font-medium">
                    Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => table.nextPage()}
                    disabled={!table.getCanNextPage()}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                    disabled={!table.getCanNextPage()}
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
        isOpen={!!deleteConfirmItem}
        onClose={() => setDeleteConfirmItem(null)}
        onConfirm={() => {
          if (deleteConfirmItem) {
            deleteMutation.mutate(deleteConfirmItem.id)
            setDeleteConfirmItem(null)
          }
        }}
        title={`Delete ${deleteConfirmItem?.is_template ? 'Template' : 'Query'}`}
        message={`Are you sure you want to delete this ${deleteConfirmItem?.is_template ? 'template' : 'query'}? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
      />
    </div>
  )
}
