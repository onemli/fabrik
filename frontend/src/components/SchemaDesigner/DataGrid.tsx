// SchemaDesigner/DataGrid.tsx
//
// Tabulator-backed data entry grid for AWX input data. Columns and their
// validation rules come from the saved table schema. Cells with bad values are
// highlighted; the error summary feeds into the validation sidebar components.

import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { ReactTabulator } from 'react-tabulator'
import 'tabulator-tables/dist/css/tabulator_simple.min.css'
import './tabulator-fabrik.css'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Plus,
  Trash2,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
  RotateCcw,
} from 'lucide-react'
import { TableColumn } from './types'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'

interface DataGridProps {
  columns: TableColumn[]
  data?: any[]
  onDataChange?: (data: any[]) => void
  minRows?: number
  maxRows?: number
  readOnly?: boolean
  validationErrors?: Array<{
    row: number
    column: string
    value?: any
    message: string
    allowed_values?: any[]
  }>
}

// Map a TableColumn schema definition to a Tabulator column definition.
function buildTabulatorColumn(col: TableColumn, readOnly: boolean): any {
  const colDef: any = {
    title: col.display_name + (col.required ? ' *' : ''),
    field: col.name,
    headerSort: true,
    resizable: true,
    editor: readOnly ? false : undefined,
    validator: [] as any[],
  }

  // Editor + type-specific config
  if (!readOnly) {
    switch (col.type) {
      case 'number':
        colDef.editor = 'number'
        colDef.editorParams = {
          min: col.min,
          max: col.max,
          step: 1,
        }
        break

      case 'boolean':
        colDef.editor = 'tickCross'
        colDef.formatter = 'tickCross'
        break

      case 'select':
        colDef.editor = 'list'
        colDef.editorParams = {
          values: col.enum_values || [],
          autocomplete: true,
          clearable: true,
          listOnEmpty: true,
        }
        colDef.headerFilter = false
        colDef.cssClass = 'tabulator-cell-dropdown'
        break

      case 'multiselect':
        colDef.editor = 'list'
        colDef.editorParams = {
          values: col.enum_values || [],
          multiselect: true,
          autocomplete: true,
          clearable: true,
          listOnEmpty: true,
        }
        colDef.cssClass = 'tabulator-cell-dropdown'
        break

      case 'password':
        colDef.editor = 'input'
        colDef.formatter = (cell: any) => {
          const val = cell.getValue()
          return val ? '\u2022'.repeat(Math.min(String(val).length, 12)) : ''
        }
        break

      case 'textarea':
        colDef.editor = 'textarea'
        colDef.editorParams = {
          verticalNavigation: 'hybrid',
          shiftEnterSubmit: true,
        }
        break

      case 'text':
      default:
        colDef.editor = 'input'
        break
    }
  }

  // Built-in validators
  if (col.required) {
    colDef.validator.push('required')
  }

  if (col.type === 'number') {
    colDef.validator.push('numeric')
    if (col.min !== undefined) colDef.validator.push({ type: 'min', parameters: col.min })
    if (col.max !== undefined) colDef.validator.push({ type: 'max', parameters: col.max })
  }

  if ((col.type === 'select' || col.type === 'multiselect') && col.enum_values?.length) {
    colDef.validator.push({ type: 'in', parameters: col.enum_values })
  }

  if (col.type === 'text' || col.type === 'textarea') {
    if (col.min_length) colDef.validator.push({ type: 'minLength', parameters: col.min_length })
    if (col.max_length) colDef.validator.push({ type: 'maxLength', parameters: col.max_length })
  }

  if (col.validation) {
    colDef.validator.push({ type: 'regex', parameters: col.validation })
  }

  // Clean up empty validator array
  if (colDef.validator.length === 0) {
    delete colDef.validator
  }

  return colDef
}

export function DataGrid({
  columns,
  data = [],
  onDataChange,
  minRows = 1,
  maxRows = 1000,
  readOnly = false,
  validationErrors = [],
}: DataGridProps) {
  const tableRef = useRef<any>(null)
  const [rowCount, setRowCount] = useState(0)
  const [errorCount, setErrorCount] = useState(0)
  const [deleteRowsConfirm, setDeleteRowsConfirm] = useState(false)
  const [clearAllConfirm, setClearAllConfirm] = useState(false)

  // Build initial data — use provided data or fill with empty rows
  const initialData = useMemo(() => {
    if (data.length > 0) {
      return data.map((row: any) => {
        const obj: any = {}
        columns.forEach(col => { obj[col.name] = row[col.name] ?? '' })
        return obj
      })
    }
    return Array.from({ length: minRows }, () => {
      const obj: any = {}
      columns.forEach(col => { obj[col.name] = '' })
      return obj
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Build Tabulator column definitions
  const tabulatorColumns = useMemo(
    () => columns.map(col => buildTabulatorColumn(col, readOnly)),
    [columns, readOnly]
  )

  // Custom paste action — receives parsed row objects from Tabulator's default
  // 'table' parser. Auto-extends rows when pasted data exceeds current row count.
  // `this` is the Clipboard module, `this.table` gives the Tabulator instance.
  const pasteAction = useCallback(function(this: any, rowData: any[]) {
    const table = this.table
    if (!rowData || rowData.length === 0) return

    // Drop trailing empty rows — Excel/Sheets copy adds a \n at the end
    // which Tabulator parses as an extra blank row object.
    const cleanRowData = rowData.filter((row: any) =>
      Object.values(row).some((v: any) => v !== null && v !== undefined && v !== '')
    )
    if (cleanRowData.length === 0) return

    const currentRowCount = table.getDataCount()
    const rowsToAdd = cleanRowData.length - currentRowCount

    if (rowsToAdd > 0) {
      if (currentRowCount + rowsToAdd > maxRows) {
        toast.warning('Row Limit Reached', {
          description: `Paste would exceed maximum row limit of ${maxRows}`,
        })
        return
      }
      for (let i = 0; i < rowsToAdd; i++) {
        const emptyRow: any = {}
        columns.forEach(col => { emptyRow[col.name] = '' })
        table.addRow(emptyRow)
      }
    }

    // Update existing rows with pasted data, then validate each one.
    // Trim each string cell — Excel/Sheets often carry trailing \r from CRLF
    // line endings, which breaks exact-match validators like select enums.
    const allRows = table.getRows()
    cleanRowData.forEach((data: any, idx: number) => {
      const row = allRows[idx]
      if (!row) return
      const trimmed: any = {}
      for (const key of Object.keys(data)) {
        const v = data[key]
        trimmed[key] = typeof v === 'string' ? v.trim() : v
      }
      row.update(trimmed)
      row.validate()
    })
  }, [columns, maxRows])

  // Sync row count and notify parent when data changes
  const syncToParent = useCallback(() => {
    const table = tableRef.current
    if (!table) return

    const allData = table.getData()
    const nonEmpty = allData.filter((row: any) =>
      Object.values(row).some((v: any) => v !== null && v !== undefined && v !== '')
    ).length
    setRowCount(nonEmpty)
    onDataChange?.(allData)
  }, [onDataChange])

  // Apply backend validation error highlighting
  useEffect(() => {
    setErrorCount(validationErrors.length)

    const table = tableRef.current
    if (!table) return

    // Clear previous highlights
    table.getRows().forEach((row: any) => {
      row.getCells().forEach((cell: any) => {
        cell.getElement().classList.remove('tabulator-cell-error')
        cell.getElement().removeAttribute('title')
      })
    })

    // Apply new error highlights
    validationErrors.forEach(err => {
      const row = table.getRowFromPosition(err.row)
      if (!row) return
      const cell = row.getCell(err.column)
      if (!cell) return
      cell.getElement().classList.add('tabulator-cell-error')
      cell.getElement().setAttribute('title', err.message)
    })
  }, [validationErrors])

  const handleAddRow = () => {
    const table = tableRef.current
    if (!table) return

    if (table.getDataCount() >= maxRows) {
      toast.warning('Row Limit Reached', { description: `Maximum row limit is ${maxRows}` })
      return
    }

    const emptyRow: any = {}
    columns.forEach(col => { emptyRow[col.name] = '' })
    table.addRow(emptyRow)
    syncToParent()
  }

  const handleDeleteSelected = () => {
    const table = tableRef.current
    if (!table) return
    const selected = table.getSelectedRows()
    if (selected.length === 0) {
      toast.warning('No Selection', { description: 'Click rows to select them before deleting' })
      return
    }
    setDeleteRowsConfirm(true)
  }

  const confirmDeleteRows = () => {
    const table = tableRef.current
    if (!table) return
    table.getSelectedRows().forEach((row: any) => row.delete())
    syncToParent()
    setDeleteRowsConfirm(false)
  }

  const handleClearAll = () => {
    setClearAllConfirm(true)
  }

  const confirmClearAll = () => {
    const table = tableRef.current
    if (!table) return

    table.clearData()

    // Add back minRows empty rows
    const emptyRows = Array.from({ length: minRows }, () => {
      const obj: any = {}
      columns.forEach(col => { obj[col.name] = '' })
      return obj
    })
    table.setData(emptyRows)

    setRowCount(0)
    setErrorCount(0)
    syncToParent()
    setClearAllConfirm(false)
  }

  const handleImportCSV = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.csv'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      const table = tableRef.current
      if (!file || !table) return

      const reader = new FileReader()
      reader.onload = (event) => {
        const csv = event.target?.result as string
        const rows = csv.split('\n').filter(line => line.trim())
        const parsed = rows.map(row => row.split(','))

        const firstRow = parsed[0]
        const hasHeader = firstRow?.every((cell, idx) =>
          cell.trim().toLowerCase() === columns[idx]?.display_name.toLowerCase()
        )
        if (hasHeader) parsed.shift()

        const newRows = parsed.map(row => {
          const obj: any = {}
          columns.forEach((col, idx) => { obj[col.name] = row[idx]?.trim() ?? '' })
          return obj
        })

        table.setData(newRows)
        syncToParent()
      }
      reader.readAsText(file)
    }
    input.click()
  }

  if (columns.length === 0) {
    return (
      <Card className="p-12 text-center border-dashed">
        <FileSpreadsheet className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <p className="text-muted-foreground mb-2">No schema defined</p>
        <p className="text-sm text-muted-foreground">
          Define columns in the template schema first
        </p>
      </Card>
    )
  }

  return (
    <div className="space-y-4 w-full">
      {/* Stats Bar */}
      <Card className="p-4 bg-muted/50 w-full">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{rowCount}</Badge>
              <span className="text-sm text-muted-foreground">
                {rowCount === 1 ? 'Row' : 'Rows'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {errorCount === 0 ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span className="text-sm text-green-600">No errors</span>
                </>
              ) : (
                <>
                  <AlertCircle className="h-4 w-4 text-destructive" />
                  <Badge variant="destructive">{errorCount}</Badge>
                  <span className="text-sm text-destructive">
                    {errorCount === 1 ? 'Error' : 'Errors'}
                  </span>
                </>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              Copy/Paste enabled &bull; Undo/Redo (Ctrl+Z/Y)
            </div>
          </div>
        </div>
      </Card>

      {/* Tabulator Grid */}
      <Card className="w-full">
        <div className="p-4">
          <ReactTabulator
            onRef={(r: any) => { tableRef.current = r?.current }}
            data={initialData}
            columns={tabulatorColumns}
            options={{
              height: 600,
              layout: 'fitColumns',
              clipboard: !readOnly,
              clipboardPasteAction: readOnly ? 'replace' : pasteAction,
              clipboardCopyStyled: false,
              validationMode: 'highlight',
              editTriggerEvent: 'dblclick',
              selectableRows: !readOnly,
              history: !readOnly,
              rowHeight: 36,
              headerHeight: 44,
              placeholder: 'No data',
              renderHorizontal: 'virtual',
            }}
            events={{
              cellEdited: () => syncToParent(),
              dataLoaded: () => syncToParent(),
              clipboardPasted: () => syncToParent(),
            }}
          />
        </div>
      </Card>

      {/* Action Buttons */}
      {!readOnly && (
        <div className="flex gap-2">
          <Button onClick={handleAddRow} variant="default" size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Add Row
          </Button>
          <Button onClick={handleDeleteSelected} variant="outline" size="sm">
            <Trash2 className="h-4 w-4 mr-2" />
            Delete Selected
          </Button>
          <Button onClick={handleImportCSV} variant="outline" size="sm">
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            Import CSV
          </Button>
          <Button onClick={handleClearAll} variant="outline" size="sm">
            <RotateCcw className="h-4 w-4 mr-2" />
            Clear All
          </Button>
        </div>
      )}

      <ConfirmDialog
        isOpen={deleteRowsConfirm}
        onClose={() => setDeleteRowsConfirm(false)}
        onConfirm={confirmDeleteRows}
        title="Delete Selected Rows"
        message="Are you sure you want to delete the selected rows? This action cannot be undone."
        confirmText="Delete"
        variant="danger"
      />

      <ConfirmDialog
        isOpen={clearAllConfirm}
        onClose={() => setClearAllConfirm(false)}
        onConfirm={confirmClearAll}
        title="Clear All Data"
        message="Are you sure you want to clear all data? This action cannot be undone."
        confirmText="Clear All"
        variant="danger"
      />
    </div>
  )
}
