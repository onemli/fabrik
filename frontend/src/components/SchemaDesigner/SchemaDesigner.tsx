// SchemaDesigner/SchemaDesigner.tsx
//
// Main schema designer component for AWX table schemas. The user builds a column
// layout here — adding columns, setting their types, configuring validation rules,
// and previewing how the data grid will look with the current schema.
// Schema is saved to the backend and later used to validate uploaded input files.

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Download,
  Sparkles,
  AlertCircle,
} from 'lucide-react'
import { ColumnList } from './ColumnList'
import { ColumnEditor } from './ColumnEditor'
import { SchemaPreview } from './SchemaPreview'
import { TableColumn, TableSchema } from './types'
import { ConfirmDialog } from '@/components/ConfirmDialog'

interface SchemaDesignerProps {
  schema?: TableSchema
  onSchemaChange?: (schema: TableSchema) => void
  onImportFromAWX?: () => void
  sheetName?: string
  jobTemplateId?: number | null
  panelMode?: boolean
}

export function SchemaDesigner({
  schema,
  onSchemaChange,
  onImportFromAWX,
  sheetName: _sheetName = 'Sheet1',
  jobTemplateId: _jobTemplateId = null,
  panelMode = false,
}: SchemaDesignerProps) {
  const [columns, setColumns] = useState<TableColumn[]>(schema?.columns || [])
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingColumn, setEditingColumn] = useState<TableColumn | null>(null)
  const [deleteConfirmColumn, setDeleteConfirmColumn] = useState<string | null>(null)

  const handleColumnsChange = (newColumns: TableColumn[]) => {
    setColumns(newColumns)
    if (onSchemaChange && schema) {
      onSchemaChange({
        ...schema,
        columns: newColumns,
      })
    }
  }

  const handleReorder = (reorderedColumns: TableColumn[]) => {
    handleColumnsChange(reorderedColumns)
  }

  const handleAdd = () => {
    if (panelMode) {
      setEditingColumn({ name: '', display_name: '', type: 'text', required: false })
    } else {
      setEditingColumn(null)
      setEditorOpen(true)
    }
  }

  const handleEdit = (column: TableColumn) => {
    if (panelMode) {
      setEditingColumn(column)
    } else {
      setEditingColumn(column)
      setEditorOpen(true)
    }
  }

  const handleDelete = (columnName: string) => {
    setDeleteConfirmColumn(columnName)
  }

  const confirmDeleteColumn = () => {
    if (deleteConfirmColumn) {
      const newColumns = columns.filter(col => col.name !== deleteConfirmColumn)
      handleColumnsChange(newColumns)
      setDeleteConfirmColumn(null)
    }
  }

  const handleSave = (column: TableColumn) => {
    let newColumns: TableColumn[]

    const isNewColumn = !editingColumn?.name
    if (!isNewColumn) {
      // Edit existing column
      newColumns = columns.map(col =>
        col.name === editingColumn!.name ? column : col
      )
    } else {
      // Add new column
      newColumns = [...columns, column]
    }

    handleColumnsChange(newColumns)
    if (panelMode) {
      setEditingColumn(null)
    } else {
      setEditorOpen(false)
      setEditingColumn(null)
    }
  }


  if (panelMode) {
    return (
      <div className="w-full space-y-4">
        {/* Stats row */}
        {columns.length > 0 && (
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span><strong className="text-foreground">{columns.length}</strong> {columns.length === 1 ? 'column' : 'columns'}</span>
            <span><strong className="text-foreground">{columns.filter(c => c.required).length}</strong> required</span>
            <span><strong className="text-foreground">{columns.filter(c => c.validation).length}</strong> with validation</span>
          </div>
        )}

        {/* Panel layout: ColumnList (left) + ColumnEditor (right) */}
        <div className="flex border rounded-lg overflow-hidden" style={{ minHeight: 480 }}>
          {/* Left: column list */}
          <div className="w-80 border-r flex flex-col bg-muted/20">
            {columns.length === 0 && !editingColumn ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                <AlertCircle className="h-8 w-8 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground mb-3">No columns defined yet</p>
                <Button onClick={handleAdd} size="sm">
                  Add First Column
                </Button>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                <ColumnList
                  columns={columns}
                  onReorder={handleReorder}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onAdd={handleAdd}
                  selectedColumnName={editingColumn?.name}
                />
              </div>
            )}
          </div>

          {/* Right: inline column editor or empty state */}
          <div className="flex-1 bg-muted/30">
            {editingColumn !== null ? (
              <ColumnEditor
                open={true}
                asPanel
                column={editingColumn.name ? editingColumn : null}
                onSave={handleSave}
                onCancel={() => setEditingColumn(null)}
                existingColumns={columns}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <Sparkles className="h-10 w-10 text-muted-foreground mb-3" />
                <p className="text-sm font-medium mb-1">No column selected</p>
                <p className="text-xs text-muted-foreground mb-4">
                  Select a column to edit, or add a new one
                </p>
                <Button onClick={handleAdd} size="sm">
                  Add Column
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Delete Column Confirmation Dialog */}
        <ConfirmDialog
          isOpen={!!deleteConfirmColumn}
          onClose={() => setDeleteConfirmColumn(null)}
          onConfirm={confirmDeleteColumn}
          title="Delete Column"
          message={`Are you sure you want to delete the column "${deleteConfirmColumn}"? This action cannot be undone.`}
          confirmText="Delete"
          variant="danger"
        />
      </div>
    )
  }

  return (
    <div className="w-full space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Sparkles className="h-5 w-5 text-primary" />
          <div>
            <h3 className="text-lg font-semibold">Column Designer</h3>
            <p className="text-sm text-muted-foreground">
              Define the structure and validation rules for your table
            </p>
          </div>
        </div>

        {onImportFromAWX && (
          <Button variant="outline" size="sm" onClick={onImportFromAWX}>
            <Download className="h-4 w-4 mr-2" />
            Import from AWX Survey
          </Button>
        )}
      </div>

      {/* Stats Card */}
      {columns.length > 0 && (
        <Card className="p-4 bg-muted/50">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{columns.length}</Badge>
              <span className="text-sm text-muted-foreground">
                {columns.length === 1 ? 'Column' : 'Columns'}
              </span>
            </div>
            <Separator orientation="vertical" className="h-6" />
            <div className="flex items-center gap-2">
              <Badge variant="secondary">
                {columns.filter(c => c.required).length}
              </Badge>
              <span className="text-sm text-muted-foreground">Required</span>
            </div>
            <Separator orientation="vertical" className="h-6" />
            <div className="flex items-center gap-2">
              <Badge variant="secondary">
                {columns.filter(c => c.validation).length}
              </Badge>
              <span className="text-sm text-muted-foreground">With Validation</span>
            </div>
          </div>
        </Card>
      )}

      {/* Warning for no columns */}
      {columns.length === 0 && (
        <Card className="p-6 border-dashed bg-muted/20">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-medium mb-1">No columns defined</h4>
              <p className="text-sm text-muted-foreground mb-3">
                Your template needs at least one column. Click "Add Column" to get started,
                or import an existing schema from AWX Survey.
              </p>
              <div className="flex gap-2">
                <Button onClick={handleAdd} size="sm">
                  Add Your First Column
                </Button>
                {onImportFromAWX && (
                  <Button variant="outline" size="sm" onClick={onImportFromAWX}>
                    <Download className="h-4 w-4 mr-2" />
                    Import from AWX
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Main Layout: Column List + Preview */}
      {columns.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Column List - 50% */}
          <div className="w-full">
            <ColumnList
              columns={columns}
              onReorder={handleReorder}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onAdd={handleAdd}
            />
          </div>

          {/* Live Preview - 50% */}
          <div className="w-full">
            <SchemaPreview columns={columns} />
          </div>
        </div>
      )}

      {/* Column Editor Dialog */}
      <ColumnEditor
        open={editorOpen}
        column={editingColumn}
        onSave={handleSave}
        onCancel={() => {
          setEditorOpen(false)
          setEditingColumn(null)
        }}
        existingColumns={columns}
      />

      {/* Delete Column Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!deleteConfirmColumn}
        onClose={() => setDeleteConfirmColumn(null)}
        onConfirm={confirmDeleteColumn}
        title="Delete Column"
        message={`Are you sure you want to delete the column "${deleteConfirmColumn}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
      />
    </div>
  )
}
