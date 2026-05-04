// SchemaDesigner/StaticListEditor.tsx
//
// Inline editor for a column's static validation list — the allowed values when
// validation mode is set to "static". The user can type entries one-by-one or
// paste a newline-separated list. Each entry shows as a removable chip.

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Plus, X, Upload, Download } from 'lucide-react'

interface StaticListEditorProps {
  values: string[]
  onChange: (values: string[]) => void
  caseSensitive?: boolean
  onCaseSensitiveChange?: (value: boolean) => void
  errorMessage?: string
  onErrorMessageChange?: (message: string) => void
  errorTitle?: string
  onErrorTitleChange?: (title: string) => void
}

export function StaticListEditor({
  values,
  onChange,
  caseSensitive = false,
  onCaseSensitiveChange,
  errorMessage = 'Value not in allowed list',
  onErrorMessageChange,
  errorTitle = 'Invalid Value',
  onErrorTitleChange,
}: StaticListEditorProps) {
  const [newValue, setNewValue] = useState('')
  const [bulkInput, setBulkInput] = useState('')
  const [showBulkInput, setShowBulkInput] = useState(false)

  const handleAdd = () => {
    const trimmed = newValue.trim()
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed])
      setNewValue('')
    }
  }

  const handleRemove = (valueToRemove: string) => {
    onChange(values.filter(v => v !== valueToRemove))
  }

  const handleBulkAdd = () => {
    const newValues = bulkInput
      .split('\n')
      .map(v => v.trim())
      .filter(v => v.length > 0 && !values.includes(v))

    if (newValues.length > 0) {
      onChange([...values, ...newValues])
      setBulkInput('')
      setShowBulkInput(false)
    }
  }

  const handleExport = () => {
    const blob = new Blob([values.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'validation-list.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.txt,.csv'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) {
        const reader = new FileReader()
        reader.onload = (event) => {
          const text = event.target?.result as string
          const importedValues = text
            .split(/[\n,]/)
            .map(v => v.trim())
            .filter(v => v.length > 0 && !values.includes(v))

          if (importedValues.length > 0) {
            onChange([...values, ...importedValues])
          }
        }
        reader.readAsText(file)
      }
    }
    input.click()
  }

  return (
    <Card className="p-4 space-y-4">
      {/* Case Sensitivity */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="case-sensitive">Case Sensitive Matching</Label>
          <p className="text-xs text-muted-foreground">
            Require exact case match for values
          </p>
        </div>
        <Switch
          id="case-sensitive"
          checked={caseSensitive}
          onCheckedChange={onCaseSensitiveChange}
        />
      </div>

      <Separator />

      {/* Values List */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Allowed Values ({values.length})</Label>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowBulkInput(!showBulkInput)}
            >
              <Plus className="h-4 w-4 mr-1" />
              Bulk Add
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleImport}
            >
              <Upload className="h-4 w-4 mr-1" />
              Import
            </Button>
            {values.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleExport}
              >
                <Download className="h-4 w-4 mr-1" />
                Export
              </Button>
            )}
          </div>
        </div>

        {/* Bulk Input */}
        {showBulkInput && (
          <div className="space-y-2 p-3 border rounded-lg bg-muted/50">
            <Label>Paste values (one per line)</Label>
            <Textarea
              value={bulkInput}
              onChange={(e) => setBulkInput(e.target.value)}
              placeholder="ABC&#10;XYZ&#10;DEF"
              rows={5}
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setBulkInput('')
                  setShowBulkInput(false)
                }}
              >
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={handleBulkAdd}>
                Add {bulkInput.split('\n').filter(v => v.trim().length > 0).length} Values
              </Button>
            </div>
          </div>
        )}

        {/* Add Single Value */}
        <div className="flex gap-2">
          <Input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleAdd()
              }
            }}
            placeholder="Type value and press Enter"
          />
          <Button type="button" onClick={handleAdd} disabled={!newValue.trim()}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {/* Values Display */}
        {values.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground border rounded-lg border-dashed">
            No values added yet. Add values above to define the allowed list.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto p-2 border rounded-lg">
            {values.map((value, index) => (
              <Badge
                key={index}
                variant="secondary"
                className="pl-2 pr-1 gap-1"
              >
                {value}
                <button
                  type="button"
                  onClick={() => handleRemove(value)}
                  className="hover:bg-destructive/20 rounded-sm p-0.5 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Error Configuration - visually distinct red section */}
      {(onErrorTitleChange || onErrorMessageChange) && (
        <>
          <Separator />
          <div className="rounded-lg border border-red-200 bg-red-50/50 dark:border-red-900/50 dark:bg-red-950/20 p-3 space-y-3">
            <Label className="text-red-700 dark:text-red-400 text-xs font-semibold uppercase tracking-wide">
              Validation Failure Feedback
            </Label>
            {onErrorTitleChange && (
              <div className="space-y-1.5">
                <Label htmlFor="error-title" className="text-sm text-red-600 dark:text-red-400">Error Title</Label>
                <Input
                  id="error-title"
                  value={errorTitle}
                  onChange={(e) => onErrorTitleChange(e.target.value)}
                  placeholder="e.g., Invalid Tenant"
                  maxLength={100}
                  className="border-red-200 dark:border-red-900/50 focus-visible:ring-red-500/30"
                />
                <p className="text-xs text-muted-foreground">Short title shown when validation fails</p>
              </div>
            )}
            {onErrorMessageChange && (
              <div className="space-y-1.5">
                <Label htmlFor="error-message" className="text-sm text-red-600 dark:text-red-400">Error Message</Label>
                <Textarea
                  id="error-message"
                  value={errorMessage}
                  onChange={(e) => onErrorMessageChange(e.target.value)}
                  placeholder="e.g., Value is not in the allowed list. Please select one of: ..."
                  maxLength={500}
                  rows={2}
                  className="border-red-200 dark:border-red-900/50 focus-visible:ring-red-500/30"
                />
                <p className="text-xs text-muted-foreground">Detailed message explaining what went wrong</p>
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  )
}
