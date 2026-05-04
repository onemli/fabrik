// SchemaDesigner/SchemaPreview.tsx
//
// Read-only preview of the current schema shown on the right side of the designer.
// Renders the column list with their types and validation rules as a summary card
// so the designer can sanity-check the schema before saving.

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  RotateCcw,
  Sparkles,
} from 'lucide-react'
import { TableColumn } from './types'

interface SchemaPreviewProps {
  columns: TableColumn[]
}

interface ValidationError {
  field: string
  message: string
}

export function SchemaPreview({ columns }: SchemaPreviewProps) {
  const [formData, setFormData] = useState<Record<string, any>>({})
  const [errors, setErrors] = useState<ValidationError[]>([])
  const [showValidation, setShowValidation] = useState(false)

  const validateField = (column: TableColumn, value: any): string | null => {
    // Required validation
    if (column.required && (!value || value === '')) {
      return `${column.display_name} is required`
    }

    if (!value || value === '') return null

    // Type-specific validation
    if (column.type === 'number') {
      const num = Number(value)
      if (isNaN(num)) {
        return 'Must be a valid number'
      }
      if (column.min !== undefined && num < column.min) {
        return `Must be at least ${column.min}`
      }
      if (column.max !== undefined && num > column.max) {
        return `Must be at most ${column.max}`
      }
    }

    // Text length validation
    if (column.type === 'text' || column.type === 'textarea') {
      const strValue = String(value)
      if (column.min_length && strValue.length < column.min_length) {
        return `Must be at least ${column.min_length} characters`
      }
      if (column.max_length && strValue.length > column.max_length) {
        return `Must be at most ${column.max_length} characters`
      }
    }

    // Regex validation
    if (column.validation) {
      try {
        const regex = new RegExp(column.validation)
        if (!regex.test(String(value))) {
          return 'Invalid format'
        }
      } catch {
        return 'Validation error'
      }
    }

    return null
  }

  const handleChange = (columnName: string, value: any) => {
    setFormData(prev => ({ ...prev, [columnName]: value }))

    // Clear error for this field if validation is shown
    if (showValidation) {
      setErrors(prev => prev.filter(e => e.field !== columnName))
    }
  }

  const handleValidate = () => {
    const newErrors: ValidationError[] = []

    columns.forEach(column => {
      const value = formData[column.name]
      const error = validateField(column, value)
      if (error) {
        newErrors.push({
          field: column.name,
          message: error,
        })
      }
    })

    setErrors(newErrors)
    setShowValidation(true)
  }

  const handleClear = () => {
    setFormData({})
    setErrors([])
    setShowValidation(false)
  }

  const getFieldError = (columnName: string) => {
    return errors.find(e => e.field === columnName)?.message
  }

  const renderField = (column: TableColumn) => {
    const value = formData[column.name]
    const error = showValidation ? getFieldError(column.name) : null
    const hasError = !!error

    const commonInputProps = {
      id: column.name,
      value: value || '',
      onChange: (e: any) => handleChange(column.name, e.target.value),
      placeholder: column.placeholder,
      className: hasError ? 'border-destructive' : '',
    }

    switch (column.type) {
      case 'text':
      case 'password':
        return (
          <Input
            {...commonInputProps}
            type={column.type}
          />
        )

      case 'textarea':
        return (
          <Textarea
            {...commonInputProps}
            rows={4}
          />
        )

      case 'number':
        return (
          <Input
            {...commonInputProps}
            type="number"
            min={column.min}
            max={column.max}
          />
        )

      case 'boolean':
        return (
          <div className="flex items-center space-x-2">
            <Switch
              id={column.name}
              checked={value || false}
              onCheckedChange={(checked) => handleChange(column.name, checked)}
            />
            <Label htmlFor={column.name} className="text-sm text-muted-foreground">
              {value ? 'Enabled' : 'Disabled'}
            </Label>
          </div>
        )

      case 'select':
        return (
          <Select
            value={value || ''}
            onValueChange={(val) => handleChange(column.name, val)}
          >
            <SelectTrigger className={hasError ? 'border-destructive' : ''}>
              <SelectValue placeholder="Select an option..." />
            </SelectTrigger>
            <SelectContent>
              {column.enum_values?.map((option, idx) => (
                <SelectItem key={idx} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )

      case 'multiselect': {
        const selectedValues = value ? (Array.isArray(value) ? value : [value]) : []
        return (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2 min-h-[40px] p-2 border rounded-md">
              {selectedValues.length > 0 ? (
                selectedValues.map((val: string, idx: number) => (
                  <Badge key={idx} variant="secondary">
                    {val}
                    <button
                      className="ml-2 hover:text-destructive"
                      onClick={() => {
                        const newValues = selectedValues.filter((v: string) => v !== val)
                        handleChange(column.name, newValues)
                      }}
                    >
                      ×
                    </button>
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">No selections</span>
              )}
            </div>
            <Select
              value=""
              onValueChange={(val) => {
                if (!selectedValues.includes(val)) {
                  handleChange(column.name, [...selectedValues, val])
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Add option..." />
              </SelectTrigger>
              <SelectContent>
                {column.enum_values
                  ?.filter(opt => !selectedValues.includes(opt))
                  .map((option, idx) => (
                    <SelectItem key={idx} value={option}>
                      {option}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        )
      }

      default:
        return <Input {...commonInputProps} />
    }
  }

  if (columns.length === 0) {
    return (
      <Card className="p-12 text-center border-dashed">
        <Eye className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <p className="text-muted-foreground mb-2">No columns to preview</p>
        <p className="text-sm text-muted-foreground">
          Add columns to see how your form will look
        </p>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-lg">Live Preview</h3>
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        {showValidation && (
          <Badge variant={errors.length === 0 ? 'default' : 'destructive'}>
            {errors.length === 0 ? (
              <>
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Valid
              </>
            ) : (
              <>
                <AlertCircle className="h-3 w-3 mr-1" />
                {errors.length} error{errors.length !== 1 ? 's' : ''}
              </>
            )}
          </Badge>
        )}
      </div>

      <Card className="p-6">
        <div className="space-y-6">
          <div className="text-sm text-muted-foreground mb-4">
            This preview shows how operators will see and interact with your form
          </div>

          {columns.map((column, idx) => {
            const error = showValidation ? getFieldError(column.name) : null
            return (
              <div key={idx} className="space-y-2">
                <Label htmlFor={column.name} className="flex items-center gap-2">
                  {column.display_name}
                  {column.required && (
                    <Badge variant="outline" className="text-xs">
                      Required
                    </Badge>
                  )}
                </Label>

                {renderField(column)}

                {column.help_text && !error && (
                  <p className="text-xs text-muted-foreground">
                    {column.help_text}
                  </p>
                )}

                {error && (
                  <div className="flex items-center gap-2 text-destructive text-xs">
                    <AlertCircle className="h-3 w-3" />
                    {error}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Card>

      <div className="flex gap-2">
        <Button onClick={handleValidate} variant="default">
          <CheckCircle2 className="h-4 w-4 mr-2" />
          Validate Form
        </Button>
        <Button onClick={handleClear} variant="outline">
          <RotateCcw className="h-4 w-4 mr-2" />
          Clear
        </Button>
      </div>
    </div>
  )
}
