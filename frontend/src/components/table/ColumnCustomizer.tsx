// table/ColumnCustomizer.tsx
//
// Drag-and-drop panel for rearranging and toggling table columns. The user can
// reorder by dragging grip handles, toggle visibility per column, pin columns
// as always-visible, or turn on auto-hide for columns that have no data.
// State is managed locally and pushed back to SmartTable via a callback.

import { useState, useEffect } from 'react'
import { GripVertical, Eye, EyeOff, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import type { ColumnDefinition } from '@/services/tableDetection'
import type { VisibilityState, ColumnOrderState } from '@tanstack/react-table'

interface ColumnCustomizerProps {
  columns: ColumnDefinition[]
  visibility: VisibilityState
  order: ColumnOrderState
  onVisibilityChange: (visibility: VisibilityState) => void
  onOrderChange: (order: ColumnOrderState) => void
  onClose: () => void
  onSave: (config: {
    visibleColumns: string[]
    hiddenColumns: string[]
    columnOrder: string[]
    alwaysVisible: string[]
    autoHideEmpty: boolean
  }) => void
}

export function ColumnCustomizer({
  columns,
  visibility,
  order,
  onVisibilityChange,
  onOrderChange,
  onClose,
  onSave
}: ColumnCustomizerProps) {
  // Local state for customization
  const [localVisibility, setLocalVisibility] = useState<VisibilityState>(visibility)
  const [localOrder, setLocalOrder] = useState<string[]>(order)
  const [alwaysVisible, setAlwaysVisible] = useState<Set<string>>(new Set())
  const [autoHideEmpty, setAutoHideEmpty] = useState(true)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)

  // Initialize order from columns if not set
  useEffect(() => {
    if (localOrder.length === 0) {
      const initialOrder = columns
        .sort((a, b) => a.order - b.order)
        .map(col => col.field)
      setLocalOrder(initialOrder)
    }
  }, [columns, localOrder.length])

  // Get ordered columns
  const orderedColumns = localOrder
    .map(fieldName => columns.find(col => col.field === fieldName))
    .filter(Boolean) as ColumnDefinition[]

  // Handle drag start
  const handleDragStart = (index: number) => {
    setDraggedIndex(index)
  }

  // Handle drag over
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (draggedIndex === null || draggedIndex === index) return

    const newOrder = [...localOrder]
    const draggedItem = newOrder[draggedIndex]
    newOrder.splice(draggedIndex, 1)
    newOrder.splice(index, 0, draggedItem)

    setLocalOrder(newOrder)
    setDraggedIndex(index)
  }

  // Handle drag end
  const handleDragEnd = () => {
    setDraggedIndex(null)
  }

  // Toggle visibility
  const toggleVisibility = (field: string) => {
    const col = columns.find(c => c.field === field)
    if (col?.locked) return // Can't hide locked columns

    setLocalVisibility(prev => ({
      ...prev,
      [field]: !prev[field]
    }))
  }

  // Toggle always visible
  const toggleAlwaysVisible = (field: string) => {
    const newSet = new Set(alwaysVisible)
    if (newSet.has(field)) {
      newSet.delete(field)
    } else {
      newSet.add(field)
      // Also make it visible
      setLocalVisibility(prev => ({ ...prev, [field]: true }))
    }
    setAlwaysVisible(newSet)
  }

  // Apply changes
  const handleApply = () => {
    onVisibilityChange(localVisibility)
    onOrderChange(localOrder)
    onClose()
  }

  // Save configuration
  const handleSave = () => {
    // First apply the changes to the table
    onVisibilityChange(localVisibility)
    onOrderChange(localOrder)

    // Then save to backend
    const visibleColumns = localOrder.filter(field => localVisibility[field])
    const hiddenColumns = localOrder.filter(field => !localVisibility[field])

    onSave({
      visibleColumns,
      hiddenColumns,
      columnOrder: localOrder,
      alwaysVisible: Array.from(alwaysVisible),
      autoHideEmpty,
    })
  }

  // Reset to defaults
  const handleReset = () => {
    const defaultVisibility: VisibilityState = {}
    const defaultOrder = columns
      .sort((a, b) => a.order - b.order)
      .map(col => {
        defaultVisibility[col.field] = col.visible
        return col.field
      })

    setLocalVisibility(defaultVisibility)
    setLocalOrder(defaultOrder)
    setAlwaysVisible(new Set())
    setAutoHideEmpty(true)
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Customize Columns</DialogTitle>
          <DialogDescription>
            Drag to reorder columns, toggle visibility, and configure display preferences
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-4">
          {/* Auto-hide empty columns option */}
          <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/30">
            <div className="space-y-0.5">
              <Label htmlFor="auto-hide" className="text-sm font-medium">
                Auto-hide empty columns
              </Label>
              <p className="text-xs text-muted-foreground">
                Automatically hide columns with no data
              </p>
            </div>
            <Switch
              id="auto-hide"
              checked={autoHideEmpty}
              onCheckedChange={setAutoHideEmpty}
            />
          </div>

          {/* Column list */}
          <div className="space-y-1">
            <div className="text-sm font-medium mb-2 px-1">
              Columns ({orderedColumns.length})
            </div>
            {orderedColumns.map((col, index) => {
              const isVisible = localVisibility[col.field] ?? true
              const isLocked = col.locked || false
              const isAlwaysVisible = alwaysVisible.has(col.field)
              const isDragging = draggedIndex === index

              return (
                <div
                  key={col.field}
                  draggable={!isLocked}
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragEnd={handleDragEnd}
                  className={cn(
                    'flex items-center gap-3 p-3 border rounded-lg transition-all',
                    isDragging && 'opacity-50 scale-95',
                    isLocked ? 'bg-muted/50 cursor-not-allowed' : 'bg-background hover:bg-muted/30 cursor-move'
                  )}
                >
                  {/* Drag handle */}
                  <div className={cn(
                    'flex-shrink-0',
                    isLocked ? 'text-muted-foreground/50' : 'text-muted-foreground'
                  )}>
                    {isLocked ? (
                      <Lock className="h-4 w-4" />
                    ) : (
                      <GripVertical className="h-4 w-4" />
                    )}
                  </div>

                  {/* Visibility checkbox */}
                  <Checkbox
                    checked={isVisible}
                    onCheckedChange={() => toggleVisibility(col.field)}
                    disabled={isLocked || isAlwaysVisible}
                  />

                  {/* Column info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">
                        {col.label}
                      </span>
                      <span className="text-xs text-muted-foreground font-mono">
                        {col.field}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground">
                        {col.dataType}
                      </span>
                      {col.alwaysHide && (
                        <span className="text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 px-1.5 py-0.5 rounded">
                          Meta field
                        </span>
                      )}
                      {isLocked && (
                        <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded">
                          Required
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Always visible toggle */}
                  {!isLocked && (
                    <Button
                      variant={isAlwaysVisible ? 'secondary' : 'ghost'}
                      size="sm"
                      onClick={() => toggleAlwaysVisible(col.field)}
                      className="flex-shrink-0"
                      title="Always visible"
                    >
                      {isAlwaysVisible ? (
                        <Eye className="h-4 w-4" />
                      ) : (
                        <EyeOff className="h-4 w-4" />
                      )}
                    </Button>
                  )}
                </div>
              )
            })}
          </div>

          {/* Summary */}
          <div className="p-3 border rounded-lg bg-muted/30 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Visible columns:</span>
              <span className="font-medium">
                {Object.values(localVisibility).filter(Boolean).length} of {columns.length}
              </span>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={handleReset}>
            Reset to Defaults
          </Button>
          <div className="flex-1" />
          <Button variant="outline" onClick={handleApply}>
            Apply
          </Button>
          <Button onClick={handleSave}>
            Save Configuration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
