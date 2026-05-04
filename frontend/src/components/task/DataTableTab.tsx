// Generic data table tab layout shared by schedules and executions tabs.
// Handles search bar, column visibility toggle, loading/empty states,
// table rendering, and pagination.

import { Search, Columns3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { flexRender } from '@tanstack/react-table'
import type { Table as TanstackTable } from '@tanstack/react-table'
import { cn } from '@/lib/utils'

interface DataTableTabProps {
  table: TanstackTable<any>
  isLoading: boolean
  globalFilter: string
  onGlobalFilterChange: (value: string) => void
  searchPlaceholder: string
  emptyIcon: React.ReactNode
  emptyTitle: string
  emptyDescription: string
  emptyAction?: React.ReactNode
  emptyBgClass: string
  entityName: string
}

export function DataTableTab({
  table,
  isLoading,
  globalFilter,
  onGlobalFilterChange,
  searchPlaceholder,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  emptyAction,
  emptyBgClass,
  entityName,
}: DataTableTabProps) {
  return (
    <div className="flex-1 flex flex-col">
      <div className="py-4 border-b border-border/20 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex-1 max-w-md relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder={searchPlaceholder}
              value={globalFilter ?? ''}
              onChange={(e) => onGlobalFilterChange(e.target.value)}
              className="pl-9"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Columns3 className="mr-2 h-4 w-4" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {table
                .getAllColumns()
                .filter((column) => column.getCanHide())
                .map((column) => (
                  <DropdownMenuItem
                    key={column.id}
                    className="capitalize"
                    onClick={() => column.toggleVisibility(!column.getIsVisible())}
                  >
                    <input
                      type="checkbox"
                      checked={column.getIsVisible()}
                      onChange={() => column.toggleVisibility(!column.getIsVisible())}
                      className="mr-2"
                    />
                    {column.id.replace(/_/g, ' ')}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-sm text-muted-foreground">Loading {entityName}...</p>
            </div>
          </div>
        ) : table.getRowModel().rows.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center max-w-md">
              <div className="relative mb-6">
                <div className={cn('absolute inset-0 blur-3xl rounded-full', emptyBgClass)} />
                <div className="relative w-20 h-20 glass border border-border/20 rounded-full flex items-center justify-center mx-auto">
                  {emptyIcon}
                </div>
              </div>
              <h3 className="text-xl font-bold mb-2 text-foreground">{emptyTitle}</h3>
              <p className="text-sm text-muted-foreground mb-6 leading-relaxed">{emptyDescription}</p>
              {emptyAction}
            </div>
          </div>
        ) : (
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
                  <TableRow key={row.id} className="hover:bg-muted/30">
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
        )}
      </div>

      {/* Pagination */}
      {!isLoading && table.getRowModel().rows.length > 0 && (
        <div className="flex-shrink-0 border-t border-border/20 mt-4">
          <div className="pt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Showing {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1} to{' '}
                {Math.min(
                  (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
                  table.getFilteredRowModel().rows.length
                )}{' '}
                of {table.getFilteredRowModel().rows.length} {entityName}
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
                    onClick={() => table.previousPage()}
                    disabled={!table.getCanPreviousPage()}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => table.nextPage()}
                    disabled={!table.getCanNextPage()}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
