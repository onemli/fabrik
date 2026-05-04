// table/TableToolbar.tsx
//
// Toolbar row that sits above SmartTable. Hosts the live search input, export
// buttons (CSV/Excel), column customizer trigger, and saved-template open/save
// controls. All table-level actions live here so SmartTable stays focused on rendering.

import { useState } from 'react'
import { Table } from '@tanstack/react-table'
import { Search, Download, Settings2, Save, FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import type { TableStructure } from '@/services/tableDetection'
import { mkConfig, generateCsv, download } from 'export-to-csv'
import * as XLSX from 'xlsx'
import { TemplateManager } from './TemplateManager'

interface TableToolbarProps {
  table: Table<any>
  structure: TableStructure
  globalFilter: string
  onGlobalFilterChange: (value: string) => void
  onShowCustomizer: () => void
  onSaveTemplate: (name: string) => void
  onLoadTemplate?: (template: any) => void
  trackHistory: boolean
}

export function TableToolbar({
  table,
  structure,
  globalFilter,
  onGlobalFilterChange,
  onShowCustomizer,
  onSaveTemplate,
  onLoadTemplate,
  trackHistory
}: TableToolbarProps) {
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [showTemplateManager, setShowTemplateManager] = useState(false)
  const [templateName, setTemplateName] = useState('')

  // Build rows that mirror exactly what the user sees: only visible leaf columns,
  // in current order, with the header label as the key, sorted like the UI.
  // Using `row.original` + useKeysAsHeaders would leak hidden columns and
  // fall back to JS object-key order instead of the reordered column layout.
  const buildExportRows = (): Record<string, string | number | boolean>[] => {
    const visibleCols = table
      .getVisibleLeafColumns()
      .filter(col => col.id !== 'select' && col.id !== 'actions')

    const headerFor = (col: typeof visibleCols[number]): string => {
      const raw = col.columnDef.header
      if (typeof raw === 'string') return raw
      return col.id
    }

    const cellToScalar = (val: unknown): string | number | boolean => {
      if (val === null || val === undefined) return ''
      if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        return val
      }
      try {
        return JSON.stringify(val)
      } catch {
        return String(val)
      }
    }

    return table.getSortedRowModel().rows.map(row => {
      const out: Record<string, string | number | boolean> = {}
      visibleCols.forEach(col => {
        out[headerFor(col)] = cellToScalar(row.getValue(col.id))
      })
      return out
    })
  }

  // Excel sheet names are capped at 31 chars and can't contain []:*?/\
  const sanitizeSheetName = (name: string): string =>
    name.replace(/[[\]:*?/\\]/g, '_').slice(0, 31) || 'Data'

  const exportToCSV = () => {
    const rows = buildExportRows()
    const csvConfig = mkConfig({
      filename: `${structure.className || 'table'}_${new Date().toISOString().split('T')[0]}`,
      useKeysAsHeaders: true,
      fieldSeparator: ',',
    })

    const csv = generateCsv(csvConfig)(rows)
    download(csvConfig)(csv)
  }

  const exportToExcel = () => {
    const rows = buildExportRows()
    const worksheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, sanitizeSheetName(structure.className || 'Data'))

    const filename = `${structure.className || 'table'}_${new Date().toISOString().split('T')[0]}.xlsx`
    XLSX.writeFile(workbook, filename)
  }

  // Handle save template
  const handleSaveTemplate = () => {
    if (!templateName.trim()) return
    onSaveTemplate(templateName)
    setShowSaveDialog(false)
    setTemplateName('')
  }

  return (
    <div className="flex items-center justify-between gap-3">
      {/* Left side - Search */}
      <div className="flex-1 max-w-md">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search all columns..."
            value={globalFilter}
            onChange={(e) => onGlobalFilterChange(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Right side - Actions */}
      <div className="flex items-center gap-2">
        {/* Info */}
        <div className="text-sm text-muted-foreground px-3">
          {structure.className && (
            <span className="font-mono text-xs bg-muted px-2 py-1 rounded">
              {structure.className}
            </span>
          )}
        </div>

        {/* Export */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={exportToCSV}>
              Export as CSV
            </DropdownMenuItem>
            <DropdownMenuItem onClick={exportToExcel}>
              Export as Excel
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Template Actions (only if tracking history) */}
        {trackHistory && structure.className && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowTemplateManager(true)}
            >
              <FolderOpen className="h-4 w-4 mr-2" />
              Templates
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSaveDialog(true)}
            >
              <Save className="h-4 w-4 mr-2" />
              Save
            </Button>
          </>
        )}

        {/* Column Customizer */}
        <Button
          variant="outline"
          size="sm"
          onClick={onShowCustomizer}
        >
          <Settings2 className="h-4 w-4 mr-2" />
          Customize
        </Button>
      </div>

      {/* Save Template Dialog */}
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Table Template</DialogTitle>
            <DialogDescription>
              Save the current column configuration and preferences as a template for{' '}
              <span className="font-mono font-medium">{structure.className}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="template-name">Template Name</Label>
              <Input
                id="template-name"
                placeholder="e.g., Production View, Debugging Layout"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSaveTemplate()
                  }
                }}
              />
            </div>
            <div className="text-sm text-muted-foreground space-y-1">
              <p>This will save:</p>
              <ul className="list-disc list-inside pl-2 space-y-0.5">
                <li>Column visibility settings</li>
                <li>Column order and sizes</li>
                <li>Current sorting and filters</li>
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveTemplate} disabled={!templateName.trim()}>
              Save Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Template Manager */}
      {structure.className && (
        <TemplateManager
          className={structure.className}
          open={showTemplateManager}
          onClose={() => setShowTemplateManager(false)}
          onLoadTemplate={(template) => {
            if (onLoadTemplate) {
              onLoadTemplate(template)
            }
          }}
        />
      )}
    </div>
  )
}
