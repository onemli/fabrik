// validation/ValidationErrorDetailPanel.tsx
//
// Slide-in detail panel for a single validation error. Appears when the user
// clicks an error-highlighted cell in ValidationErrorGrid. Shows the error
// message, cell coordinates, and a copy button for the bad value.

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AlertCircle, X, Copy } from 'lucide-react'
import { ValidationError } from '@/services/validation'
import { toast } from 'sonner'

interface ValidationErrorDetailPanelProps {
  error: ValidationError
  onClose: () => void
}

export function ValidationErrorDetailPanel({
  error,
  onClose,
}: ValidationErrorDetailPanelProps) {
  const handleCopyValue = () => {
    navigator.clipboard.writeText(error.value?.toString() || '')
    toast.success('Value copied to clipboard')
  }

  const handleCopyAllowedValue = (value: string) => {
    navigator.clipboard.writeText(value)
    toast.success('Value copied to clipboard')
  }

  return (
    <div className="border-t bg-red-50/50 dark:bg-red-950/20">
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
              <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <h4 className="font-semibold text-red-900 dark:text-red-100">
                {error.error_title}
              </h4>
              <p className="text-xs text-red-700 dark:text-red-300 mt-0.5">
                Cell: {error.cell_ref} • Type: {error.validation_type}
              </p>
            </div>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Error Message */}
        <div className="pl-13">
          <p className="text-sm text-foreground">
            {error.error_message}
          </p>

          {/* Current Value */}
          <div className="mt-3 p-3 bg-background rounded-lg border border-red-200 dark:border-red-800">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs text-muted-foreground">Current value:</span>
                <div className="font-mono text-sm mt-1 text-red-600 dark:text-red-400">
                  "{error.value}"
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyValue}
              >
                <Copy className="h-3 w-3 mr-1" />
                Copy
              </Button>
            </div>
          </div>

          {/* Allowed Values */}
          {error.allowed_values && error.allowed_values.length > 0 && (
            <div className="mt-3">
              <div className="text-xs text-muted-foreground mb-2">
                Allowed values ({error.allowed_values.length} shown):
              </div>
              <div className="flex flex-wrap gap-1">
                {error.allowed_values.map((value, idx) => (
                  <Badge
                    key={idx}
                    variant="outline"
                    className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
                    onClick={() => handleCopyAllowedValue(value)}
                  >
                    {value}
                  </Badge>
                ))}
                {error.validation_type === 'query_list' && (
                  <Badge variant="secondary" className="text-xs">
                    ... and more
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                💡 Click a value to copy to clipboard, then paste into the cell
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
