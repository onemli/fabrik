// validation/ValidationErrorGrid.tsx
//
// Tabulator grid that highlights cells with validation errors in red and shows
// a detail panel when you click one. The underlying data is the raw sheet rows
// from the uploaded file — the grid is read-only here, just for reviewing
// errors before the user fixes their source file.

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { ReactTabulator } from 'react-tabulator'
import 'tabulator-tables/dist/css/tabulator_simple.min.css'
import '@/components/SchemaDesigner/tabulator-fabrik.css'

// Minimal subset of the Tabulator column shape we actually use. The
// tabulator-tables package ships no .d.ts, so we keep this local instead of
// pulling in @types/tabulator-tables just for one import.
type TabulatorColumn = {
  title: string
  field: string
  headerSort?: boolean
  headerFilter?: string | boolean
  resizable?: boolean
}
import { ValidationError, SheetValidationResult } from '@/services/validation'
import { ValidationErrorDetailPanel } from './ValidationErrorDetailPanel'
import { applyErrorHighlights } from './createErrorCellRenderer'

interface ValidationErrorGridProps {
  sheet: {
    name: string
    rows: any[]
    columns: { name: string; display_name: string }[]
  }
  validationResult?: SheetValidationResult
  selectedError?: ValidationError | null
  onErrorSelect?: (error: ValidationError) => void
}

export const ValidationErrorGrid = React.forwardRef<any, ValidationErrorGridProps>(
  ({ sheet, validationResult, selectedError, onErrorSelect }, ref) => {
    const tableRef = useRef<any>(null)
    const [detailPanelError, setDetailPanelError] = useState<ValidationError | null>(null)
    const cleanupRef = useRef<(() => void) | null>(null)

    React.useImperativeHandle(ref, () => ({
      table: tableRef.current,
    }), [])

    const jumpToCell = useCallback((error: ValidationError) => {
      const table = tableRef.current
      if (!table) return

      const row = table.getRowFromPosition(error.row)
      if (!row) return
      row.scrollTo()

      const cell = row.getCell(error.column)
      if (cell) {
        const el = cell.getElement()
        el.scrollIntoView({ block: 'center', inline: 'center' })
      }
    }, [])

    useEffect(() => {
      if (selectedError) {
        setDetailPanelError(selectedError)
        jumpToCell(selectedError)
      }
    }, [selectedError, jumpToCell])

    const handleCellClick = useCallback((error: ValidationError) => {
      setDetailPanelError(error)
      onErrorSelect?.(error)
    }, [onErrorSelect])

    // Apply error highlights after table renders
    const applyHighlights = useCallback(() => {
      // Clean up previous highlights
      if (cleanupRef.current) {
        cleanupRef.current()
        cleanupRef.current = null
      }

      const table = tableRef.current
      if (!table || !validationResult || validationResult.errors.length === 0) return

      cleanupRef.current = applyErrorHighlights(table, validationResult.errors, handleCellClick)
    }, [validationResult, handleCellClick])

    // Clean up on unmount
    useEffect(() => {
      return () => {
        if (cleanupRef.current) cleanupRef.current()
      }
    }, [])

    const tabulatorColumns = useMemo<TabulatorColumn[]>(() => {
      return sheet.columns.map(col => ({
        title: col.display_name,
        field: col.name,
        headerSort: true,
        headerFilter: true,
        resizable: true,
      }))
    }, [sheet.columns])

    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-hidden">
          <ReactTabulator
            onRef={(r: any) => { tableRef.current = r?.current }}
            data={sheet.rows}
            columns={tabulatorColumns as any}
            options={{
              height: '100%',
              minHeight: 400,
              layout: 'fitColumns',
              headerSort: true,
              placeholder: 'No data',
              renderHorizontal: 'virtual',
            }}
            events={{
              tableBuilt: () => applyHighlights(),
              dataProcessed: () => applyHighlights(),
            }}
          />
        </div>

        {detailPanelError && (
          <ValidationErrorDetailPanel
            error={detailPanelError}
            onClose={() => setDetailPanelError(null)}
          />
        )}
      </div>
    )
  }
)

ValidationErrorGrid.displayName = 'ValidationErrorGrid'
