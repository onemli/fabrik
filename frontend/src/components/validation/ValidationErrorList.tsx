// validation/ValidationErrorList.tsx
//
// Scrollable list of all validation errors for the current sheet, shown in the
// left sidebar of the validation view. Clicking an error row jumps the grid to
// that cell. Each item shows the row/column location and a short error summary.

import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { AlertCircle } from 'lucide-react'
import { ValidationError } from '@/services/validation'

interface ValidationErrorListProps {
  errors: ValidationError[]
  selectedError: ValidationError | null
  onSelect: (error: ValidationError) => void
  onJumpToCell: (error: ValidationError) => void
}

export function ValidationErrorList({
  errors,
  selectedError,
  onSelect,
  onJumpToCell,
}: ValidationErrorListProps) {
  const handleErrorClick = (error: ValidationError) => {
    onSelect(error)
    onJumpToCell(error)
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b">
        <div className="text-sm font-semibold text-muted-foreground">
          {errors.length} Error{errors.length !== 1 ? 's' : ''}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2">
          {errors.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              No validation errors
            </div>
          ) : (
            errors.map((error, idx) => (
              <button
                key={idx}
                onClick={() => handleErrorClick(error)}
                className={`w-full text-left p-3 rounded-lg border transition-all ${
                  selectedError === error
                    ? 'border-red-500 bg-red-50 dark:bg-red-950/30'
                    : 'border-border hover:bg-accent'
                }`}
              >
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-red-900 dark:text-red-100">
                      {error.error_title}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Cell {error.cell_ref} • {error.column}
                    </div>
                    <div className="text-xs text-foreground/80 mt-1 line-clamp-2">
                      {error.error_message}
                    </div>
                    <div className="mt-2 font-mono text-xs text-red-600 dark:text-red-400">
                      "{error.value}"
                    </div>
                    <div className="mt-2">
                      <Badge variant="outline" className="text-xs">
                        {error.validation_type}
                      </Badge>
                    </div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
