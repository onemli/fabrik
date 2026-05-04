// table/SmartTable.tsx
//
// Main result table for APIC query output. Automatically detects column structure
// from the first row, supports saved column templates (show/hide, reorder, resize),
// and lets the user drill into nested child objects without leaving the page.
// Export to CSV/Excel is handled here too so users can take results offline.

import { useState, useMemo, useEffect, useCallback } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  ColumnDef,
  SortingState,
  ColumnFiltersState,
  VisibilityState,
  ColumnOrderState,
  ColumnSizingState,
} from '@tanstack/react-table'
import {
  detectTableStructure,
  extractTableData,
  filterEmptyColumns,
  type ColumnDefinition,
  type TableStructure
} from '@/services/tableDetection'
import { mimApi } from '@/lib/api'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import { Button } from '@/components/ui/button'
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  AlertTriangle,
  Info,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { NestedCell } from './NestedCell'
import { TableToolbar } from './TableToolbar'
import { ColumnCustomizer } from './ColumnCustomizer'
import { DrillDownBar } from './DrillDownBar'
import { ParentDetailCard } from './ParentDetailCard'
import { useDrillDown } from '@/hooks/useDrillDown'
import { useFormatters } from '@/contexts/TimezoneContext'

interface SmartTableProps {
  data: any
  className?: string
  trackHistory?: boolean // From Output node setting
  queryId?: string // For associating templates with queries
  onTemplateChange?: (templateId: number) => void
  backendPaginationEnabled?: boolean // If true, backend handles pagination (no frontend pagination)
  rawData?: any // Raw APIC data for drill-down (cachedQueryResult.data)
}

export function SmartTable({
  data,
  className,
  trackHistory = false,
  queryId: _queryId,
  onTemplateChange,
  backendPaginationEnabled = false,
  rawData,
}: SmartTableProps) {
  const { formatDateTime } = useFormatters()
  const { showLogoNotification } = useQueryBuilderStore()

  // ── Drill-down hook ──
  const drillDown = useDrillDown(rawData)
  const isDrilled = !drillDown.isAtRoot
  const hasDrillDown = rawData?.imdata && Array.isArray(rawData.imdata)

  // Detection state
  const [structure, setStructure] = useState<TableStructure | null>(null)
  const [tableData, setTableData] = useState<any[]>([])
  const [detectedColumns, setDetectedColumns] = useState<ColumnDefinition[]>([])

  // Table state
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>([])
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({})
  const [globalFilter, setGlobalFilter] = useState('')

  // UI state
  const [showCustomizer, setShowCustomizer] = useState(false)
  const [showMismatchWarning, setShowMismatchWarning] = useState(false)
  const [savedTemplate, setSavedTemplate] = useState<any>(null)

  // Reset drill-down when source data changes (new query executed)
  useEffect(() => {
    drillDown.reset()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  // ── Determine effective data source ──
  // When drilled: use drill-down hook's rows/structure/columns
  // When at root: use standard detection
  const effectiveData = isDrilled ? drillDown.rows : tableData
  const effectiveStructure = isDrilled ? drillDown.structure : structure
  const effectiveDetectedColumns = isDrilled ? drillDown.columns : detectedColumns

  // Detect table structure on data change (root level)
  useEffect(() => {
    if (!data) return

    const detected = detectTableStructure(data)
    if (!detected) return

    setStructure(detected)

    // Extract data based on detected structure
    const extracted = extractTableData(data, detected)
    setTableData(extracted)

    // Filter out empty columns
    const filteredCols = filterEmptyColumns(detected.columns, extracted)
    setDetectedColumns(filteredCols)

    // Set initial visibility based on column definitions
    const visibility: VisibilityState = {}
    filteredCols.forEach(col => {
      visibility[col.field] = col.visible
    })
    setColumnVisibility(visibility)

    // Set initial column order
    const order = filteredCols
      .sort((a, b) => a.order - b.order)
      .map(col => col.field)
    setColumnOrder(order)

    // Check for saved template/preference if we have a className
    if (detected.className && trackHistory) {
      loadTemplateOrPreference(detected.className, extracted, filteredCols)
    }
  }, [data, trackHistory])

  // When drill level changes, reset table state for clean display
  useEffect(() => {
    if (!isDrilled) return

    const cols = drillDown.columns
    if (cols.length === 0) return

    const visibility: VisibilityState = {}
    cols.forEach(col => {
      visibility[col.field] = col.visible
    })
    setColumnVisibility(visibility)

    const order = [...cols]
      .sort((a, b) => a.order - b.order)
      .map(col => col.field)
    setColumnOrder(order)

    // Reset sort/filter when navigating
    setSorting([])
    setColumnFilters([])
    setGlobalFilter('')

    // Load template for drilled class
    if (drillDown.structure?.className && trackHistory) {
      loadTemplateOrPreference(drillDown.structure.className, drillDown.rows, cols)
    }
  }, [drillDown.breadcrumb, drillDown.activeChildClass])

  // Load saved template or preference
  const loadTemplateOrPreference = async (
    className: string,
    _extracted: any[],
    detected: ColumnDefinition[]
  ) => {
    try {
      // Try to load user preference first
      const preferences = await mimApi.getTablePreferences(className)
      if (preferences && preferences.length > 0) {
        const pref = preferences[0]

        // Check for column mismatch
        const detectedFields = new Set(detected.map(c => c.field))
        const savedFields = new Set(pref.visible_columns.concat(pref.hidden_columns))

        const hasNewFields = detected.some(c => !savedFields.has(c.field))
        const hasMissingFields = Array.from(savedFields).some(f => !detectedFields.has(f as string))

        if (hasNewFields || hasMissingFields) {
          setShowMismatchWarning(true)
          setSavedTemplate(pref)
        } else {
          // Apply saved preference
          applyPreference(pref, detected)
        }
      }
    } catch {
      /* ignore */
    }
  }

  // Apply saved preference
  const applyPreference = (pref: any, detected: ColumnDefinition[]) => {
    // Set visibility
    const visibility: VisibilityState = {}
    detected.forEach(col => {
      if (pref.always_visible.includes(col.field)) {
        visibility[col.field] = true
      } else if (pref.hidden_columns.includes(col.field)) {
        visibility[col.field] = false
      } else {
        visibility[col.field] = pref.visible_columns.includes(col.field)
      }
    })
    setColumnVisibility(visibility)

    // Set order
    if (pref.column_order && pref.column_order.length > 0) {
      setColumnOrder(pref.column_order)
    }
  }

  // Handle mismatch resolution
  const handleMismatchResolution = (action: 'use-saved' | 'auto-detect' | 'manual') => {
    setShowMismatchWarning(false)

    if (action === 'use-saved' && savedTemplate) {
      applyPreference(savedTemplate, effectiveDetectedColumns)
    } else if (action === 'auto-detect') {
      setSavedTemplate(null)
    } else if (action === 'manual') {
      setShowCustomizer(true)
      setSavedTemplate(null)
    }
  }

  // ── Row click handler for drill-down ──
  const handleRowDrillDown = useCallback((dn: string) => {
    drillDown.drillInto(dn)
  }, [drillDown.drillInto])

  // Determine which columns act as drill-down triggers (clickable links)
  const drillTriggerFields = useMemo(() => {
    if (!hasDrillDown || drillDown.expandableRows.size === 0) return new Set<string>()
    const triggers = new Set<string>()
    const candidateFields = ['name', 'dn', '_className']
    for (const field of candidateFields) {
      if (effectiveDetectedColumns.some(c => c.field === field)) {
        triggers.add(field)
      }
    }
    // Fallback: if none of the candidates exist, use first visible column
    if (triggers.size === 0 && effectiveDetectedColumns.length > 0) {
      triggers.add(effectiveDetectedColumns[0].field)
    }
    return triggers
  }, [hasDrillDown, drillDown.expandableRows, effectiveDetectedColumns])

  // Convert column definitions to TanStack Table format
  const columns = useMemo<ColumnDef<any>[]>(() => {
    const cols: ColumnDef<any>[] = []

    // Data columns
    effectiveDetectedColumns.forEach(col => {
      const isDrillTrigger = drillTriggerFields.has(col.field)

      cols.push({
        id: col.field,
        accessorKey: col.field,
        header: col.label,
        cell: ({ getValue, row }) => {
          const value = getValue()

          // Handle nested data
          if (col.dataType === 'object' || col.dataType === 'array') {
            return <NestedCell value={value} type={col.dataType} />
          }

          // Drill-down trigger cell: render as clickable link
          if (isDrillTrigger) {
            const dn = row.original.dn
            const isExpandable = dn && drillDown.expandableRows.has(dn)
            if (isExpandable) {
              const display = value === null || value === undefined ? '-' : String(value)
              return (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRowDrillDown(dn)
                  }}
                  className="text-left text-amber-500 dark:text-amber-400 hover:text-amber-600 dark:hover:text-amber-300 underline underline-offset-2 decoration-amber-500/30 hover:decoration-amber-500/60 transition-colors font-medium"
                  title={`${display} — click to view children`}
                >
                  {display}
                </button>
              )
            }
          }

          // Handle different data types
          if (col.dataType === 'boolean') {
            return value ? 'Yes' : 'No'
          }

          if (col.dataType === 'date' && value) {
            return formatDateTime(value as string | number)
          }

          if (value === null || value === undefined) {
            return <span className="text-muted-foreground">-</span>
          }

          return String(value)
        },
        enableSorting: col.dataType !== 'object' && col.dataType !== 'array',
        enableResizing: true,
        size: col.width || 150,
        minSize: 50,
        maxSize: 500,
      })
    })

    return cols
  }, [effectiveDetectedColumns, drillTriggerFields, drillDown.expandableRows, handleRowDrillDown])

  // Initialize table
  const table = useReactTable({
    data: effectiveData,
    columns,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      columnOrder,
      columnSizing,
      globalFilter,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    onColumnSizingChange: setColumnSizing,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    // Always use frontend pagination (disabled during backend pagination at root, always on when drilled)
    ...((backendPaginationEnabled && !isDrilled) ? {} : { getPaginationRowModel: getPaginationRowModel() }),
    columnResizeMode: 'onChange',
    enableColumnResizing: true,
  })

  // Save current state as template
  const saveAsTemplate = async (templateName: string) => {
    if (!effectiveStructure?.className) return

    try {
      const templateData = {
        class_name: effectiveStructure.className,
        template_name: templateName,
        columns: effectiveDetectedColumns,
        preferences: {
          columnVisibility,
          columnOrder,
          columnSizing,
        },
        default_sorting: sorting,
        default_filters: columnFilters,
      }

      if (trackHistory) {
        await mimApi.createTableTemplate(templateData)
        showLogoNotification({
          message: 'TEMPLATE SAVED',
          type: 'success',
          statusCode: 200,
          duration: 2000,
        })
      }
    } catch (error) {
      showLogoNotification({
        message: 'SAVE FAILED',
        type: 'error',
        statusCode: 500,
        duration: 2500,
      })
    }
  }

  // Load template configuration
  const handleLoadTemplate = async (template: any) => {
    try {
      // Apply preferences
      if (template.preferences) {
        if (template.preferences.columnVisibility) {
          setColumnVisibility(template.preferences.columnVisibility)
        }
        if (template.preferences.columnOrder) {
          setColumnOrder(template.preferences.columnOrder)
        }
        if (template.preferences.columnSizing) {
          setColumnSizing(template.preferences.columnSizing)
        }
      }

      // Apply sorting
      if (template.default_sorting) {
        setSorting(template.default_sorting)
      }

      // Apply filters
      if (template.default_filters) {
        setColumnFilters(template.default_filters)
      }

      // Update last_used timestamp
      if (trackHistory) {
        await mimApi.updateTableTemplate(template.id, {})
      }

      // Notify parent
      if (onTemplateChange) {
        onTemplateChange(template.id)
      }

      showLogoNotification({
        message: 'TEMPLATE LOADED',
        type: 'success',
        statusCode: 200,
        duration: 2000,
      })
    } catch (error) {
      showLogoNotification({
        message: 'LOAD FAILED',
        type: 'error',
        statusCode: 500,
        duration: 2500,
      })
    }
  }

  // ── Pagination helpers (frontend) ──
  const showFrontendPagination = isDrilled || !backendPaginationEnabled
  const paginationState = table.getState().pagination
  const filteredRowCount = table.getFilteredRowModel().rows.length

  if (!effectiveStructure || effectiveData.length === 0) {
    // If drilled but no children, show a message with back button
    if (isDrilled) {
      return (
        <div className={cn('space-y-4', className)}>
          <DrillDownBar
            breadcrumb={drillDown.breadcrumb}
            childGroups={drillDown.childGroups}
            activeChildClass={drillDown.activeChildClass}
            onNavigate={drillDown.navigateTo}
            onFilterByClass={drillDown.filterByClass}
            onGoBack={drillDown.goBack}
            totalChildCount={0}
            isLeafLevel={true}
            detectedScope={drillDown.detectedScope}
          />
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            No child data at this level
          </div>
        </div>
      )
    }

    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No table data detected
      </div>
    )
  }

  return (
    <div className={cn('space-y-3', className)}>
      {/* Drill-Down Navigation Bar */}
      {isDrilled && (
        <DrillDownBar
          breadcrumb={drillDown.breadcrumb}
          childGroups={drillDown.childGroups}
          activeChildClass={drillDown.activeChildClass}
          onNavigate={drillDown.navigateTo}
          onFilterByClass={drillDown.filterByClass}
          onGoBack={drillDown.goBack}
          totalChildCount={drillDown.rows.length}
          isLeafLevel={drillDown.isLeafLevel}
          detectedScope={drillDown.detectedScope}
        />
      )}

      {/* Mismatch Warning */}
      {showMismatchWarning && (
        <div className="bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-900 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-500 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-medium text-sm text-yellow-900 dark:text-yellow-200">
                Column Mismatch Detected
              </h4>
              <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                The saved template doesn't match the current data structure. Choose how to proceed:
              </p>
              <div className="flex gap-2 mt-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleMismatchResolution('use-saved')}
                >
                  Use Saved Anyway
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleMismatchResolution('auto-detect')}
                >
                  Auto-Detect New
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleMismatchResolution('manual')}
                >
                  Configure Manually
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <TableToolbar
        table={table}
        structure={effectiveStructure}
        globalFilter={globalFilter}
        onGlobalFilterChange={setGlobalFilter}
        onShowCustomizer={() => setShowCustomizer(true)}
        onSaveTemplate={saveAsTemplate}
        onLoadTemplate={handleLoadTemplate}
        trackHistory={trackHistory}
      />

      {/* Column Customizer */}
      {showCustomizer && (
        <ColumnCustomizer
          columns={effectiveDetectedColumns}
          visibility={columnVisibility}
          order={columnOrder}
          onVisibilityChange={setColumnVisibility}
          onOrderChange={setColumnOrder}
          onClose={() => setShowCustomizer(false)}
          onSave={async (config) => {
            if (effectiveStructure?.className && trackHistory) {
              await mimApi.createTablePreference({
                class_name: effectiveStructure.className,
                visible_columns: config.visibleColumns,
                column_order: config.columnOrder,
                hidden_columns: config.hiddenColumns,
                always_visible: config.alwaysVisible,
                auto_hide_empty: config.autoHideEmpty,
              })
            }
            setShowCustomizer(false)
          }}
        />
      )}

      {/* Parent Detail Card — shows parent MO attributes when drilled */}
      {isDrilled && drillDown.parentAttributes && drillDown.parentClassName && (
        <ParentDetailCard
          className={drillDown.parentClassName}
          attributes={drillDown.parentAttributes}
        />
      )}

      {/* Table */}
      <div className="border border-border/50 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              {table.getHeaderGroups().map(headerGroup => (
                <tr key={headerGroup.id} className="bg-muted/70 dark:bg-muted/40">
                  {headerGroup.headers.map(header => (
                    <th
                      key={header.id}
                      className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border/50 relative"
                      style={{ width: header.getSize() }}
                    >
                      {header.isPlaceholder ? null : (
                        <div
                          className={cn(
                            'flex items-center gap-2',
                            header.column.getCanSort() && 'cursor-pointer select-none hover:text-foreground transition-colors'
                          )}
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                          {header.column.getCanSort() && (
                            <span className="ml-auto opacity-60">
                              {{
                                asc: <ChevronUp className="h-3.5 w-3.5" />,
                                desc: <ChevronDown className="h-3.5 w-3.5" />,
                              }[header.column.getIsSorted() as string] ?? (
                                <ChevronsUpDown className="h-3.5 w-3.5" />
                              )}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Resize handle */}
                      {header.column.getCanResize() && (
                        <div
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          className={cn(
                            'absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none',
                            'hover:bg-primary/50',
                            header.column.getIsResizing() && 'bg-primary'
                          )}
                        />
                      )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-border/30">
              {table.getRowModel().rows.map((row, rowIndex) => {
                const dn = row.original?.dn
                const isExpandable = dn && drillDown.expandableRows.has(dn)

                return (
                  <tr
                    key={row.id}
                    className={cn(
                      'transition-colors',
                      // Subtle zebra striping
                      rowIndex % 2 === 0
                        ? 'bg-transparent'
                        : 'bg-muted/15 dark:bg-muted/10',
                      // Hover
                      'hover:bg-primary/5 dark:hover:bg-primary/10',
                      // Expandable row indicator
                      isExpandable && 'cursor-pointer'
                    )}
                    onDoubleClick={isExpandable ? () => handleRowDrillDown(dn) : undefined}
                  >
                    {row.getVisibleCells().map(cell => (
                      <td
                        key={cell.id}
                        className="px-4 py-1.5 whitespace-nowrap overflow-hidden text-ellipsis max-w-md text-foreground/85"
                        title={String(cell.getValue() ?? '')}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Frontend Pagination */}
        {showFrontendPagination && filteredRowCount > 0 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-border/40 bg-muted/20 dark:bg-muted/10">
            <div className="text-xs text-muted-foreground tabular-nums">
              {paginationState.pageIndex * paginationState.pageSize + 1}–{Math.min(
                (paginationState.pageIndex + 1) * paginationState.pageSize,
                filteredRowCount
              )}{' '}
              of {filteredRowCount}
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                Prev
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums px-1">
                {paginationState.pageIndex + 1}/{table.getPageCount()}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Scope hint — shown at root when drill-down data is shallow or absent */}
      {hasDrillDown && !isDrilled && drillDown.detectedScope === 'self' && (
        <div className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground/70">
          <Info className="h-3 w-3 shrink-0" />
          <span>Scope is <strong>Self</strong> — no child data available. Change scope to <strong>Children</strong> or <strong>Subtree</strong> to explore nested objects.</span>
        </div>
      )}
      {hasDrillDown && !isDrilled && drillDown.detectedScope === 'children' && drillDown.expandableRows.size > 0 && (
        <div className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground/70">
          <Info className="h-3 w-3 shrink-0" />
          <span>Scope is <strong>Children</strong> (1 level). Use <strong>Subtree</strong> for deeper drill-down.</span>
        </div>
      )}
    </div>
  )
}
