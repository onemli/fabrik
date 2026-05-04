/**
 * Pagination Controls Component
 * Professional pagination UI with page navigation
 */

import { Button } from './button'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PaginationControlsProps {
  currentPage: number // 0-indexed
  totalPages: number
  totalResults: number
  pageSize: number
  onPageChange: (page: number) => void
  className?: string
  disabled?: boolean
}

export function PaginationControls({
  currentPage,
  totalPages,
  totalResults,
  pageSize,
  onPageChange,
  className,
  disabled = false
}: PaginationControlsProps) {
  const hasNextPage = currentPage < totalPages - 1
  const hasPreviousPage = currentPage > 0

  const startResult = currentPage * pageSize + 1
  const endResult = Math.min((currentPage + 1) * pageSize, totalResults)

  const handleFirstPage = () => {
    if (!disabled && hasPreviousPage) {
      onPageChange(0)
    }
  }

  const handlePreviousPage = () => {
    if (!disabled && hasPreviousPage) {
      onPageChange(currentPage - 1)
    }
  }

  const handleNextPage = () => {
    if (!disabled && hasNextPage) {
      onPageChange(currentPage + 1)
    }
  }

  const handleLastPage = () => {
    if (!disabled && hasNextPage) {
      onPageChange(totalPages - 1)
    }
  }

  if (totalPages <= 1) {
    // Don't show pagination controls if only one page
    return null
  }

  return (
    <div className={cn('flex items-center justify-between', className)}>
      {/* Results info */}
      <div className="text-sm text-muted-foreground">
        Showing <span className="font-medium text-foreground">{startResult}</span> to{' '}
        <span className="font-medium text-foreground">{endResult}</span> of{' '}
        <span className="font-medium text-foreground">{totalResults.toLocaleString()}</span> results
      </div>

      {/* Navigation buttons */}
      <div className="flex items-center gap-2">
        {/* Page info */}
        <div className="text-sm text-muted-foreground mr-2">
          Page <span className="font-medium text-foreground">{currentPage + 1}</span> of{' '}
          <span className="font-medium text-foreground">{totalPages}</span>
        </div>

        {/* First page */}
        <Button
          variant="outline"
          size="sm"
          onClick={handleFirstPage}
          disabled={disabled || !hasPreviousPage}
          className="h-8 w-8 p-0"
        >
          <ChevronsLeft className="h-4 w-4" />
          <span className="sr-only">First page</span>
        </Button>

        {/* Previous page */}
        <Button
          variant="outline"
          size="sm"
          onClick={handlePreviousPage}
          disabled={disabled || !hasPreviousPage}
          className="h-8 w-8 p-0"
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="sr-only">Previous page</span>
        </Button>

        {/* Next page */}
        <Button
          variant="outline"
          size="sm"
          onClick={handleNextPage}
          disabled={disabled || !hasNextPage}
          className="h-8 w-8 p-0"
        >
          <ChevronRight className="h-4 w-4" />
          <span className="sr-only">Next page</span>
        </Button>

        {/* Last page */}
        <Button
          variant="outline"
          size="sm"
          onClick={handleLastPage}
          disabled={disabled || !hasNextPage}
          className="h-8 w-8 p-0"
        >
          <ChevronsRight className="h-4 w-4" />
          <span className="sr-only">Last page</span>
        </Button>
      </div>
    </div>
  )
}
