// table/NestedCell.tsx
//
// Table cell renderer for columns that contain nested objects or arrays. Shows
// a compact inline summary (e.g., "3 items") with a click-to-expand modal for
// the full detail. Avoids blowing up the row height while still making complex
// nested data accessible.

import { useState } from 'react'
import { ChevronRight, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { mkConfig, generateCsv, download } from 'export-to-csv'
import * as XLSX from 'xlsx'
import { cn } from '@/lib/utils'

interface NestedCellProps {
  value: any
  type: 'object' | 'array'
}

export function NestedCell({ value, type }: NestedCellProps) {
  const [showModal, setShowModal] = useState(false)

  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">-</span>
  }

  // Array handling
  if (type === 'array' && Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-muted-foreground">Empty</span>
    }

    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          className="h-auto py-1 px-2 font-normal hover:bg-primary/10"
          onClick={() => setShowModal(true)}
        >
          <ChevronRight className="h-3 w-3 mr-1" />
          <span className="text-xs">
            {value.length} {value.length === 1 ? 'item' : 'items'}
          </span>
        </Button>

        <Dialog open={showModal} onOpenChange={setShowModal}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader className="flex flex-row items-center justify-between pr-8">
              <DialogTitle>Array Items ({value.length})</DialogTitle>
              <NestedExportMenu data={value} filename="nested_array" />
            </DialogHeader>
            <div className="space-y-2">
              {value.map((item, index) => (
                <div
                  key={index}
                  className="p-3 border rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start gap-2">
                    <span className="text-xs font-medium text-muted-foreground min-w-[2rem]">
                      [{index}]
                    </span>
                    <div className="flex-1 overflow-auto">
                      {typeof item === 'object' ? (
                        <ObjectDisplay data={item} />
                      ) : (
                        <span className="text-sm">{String(item)}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </>
    )
  }

  // Object handling
  if (type === 'object' && typeof value === 'object') {
    const keys = Object.keys(value)

    if (keys.length === 0) {
      return <span className="text-muted-foreground">Empty</span>
    }

    // Show first key-value as summary
    const firstKey = keys[0]
    const summary = keys.length > 1
      ? `${firstKey}: ${truncate(String(value[firstKey]), 20)} (+${keys.length - 1} more)`
      : `${firstKey}: ${truncate(String(value[firstKey]), 30)}`

    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          className="h-auto py-1 px-2 font-normal hover:bg-primary/10 text-left"
          onClick={() => setShowModal(true)}
        >
          <ChevronRight className="h-3 w-3 mr-1 flex-shrink-0" />
          <span className="text-xs truncate">{summary}</span>
        </Button>

        <Dialog open={showModal} onOpenChange={setShowModal}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader className="flex flex-row items-center justify-between pr-8">
              <DialogTitle>Object Properties</DialogTitle>
              <NestedExportMenu data={value} filename="nested_object" />
            </DialogHeader>
            <ObjectDisplay data={value} />
          </DialogContent>
        </Dialog>
      </>
    )
  }

  return <span className="text-sm">{String(value)}</span>
}

/**
 * ObjectDisplay - Renders object as key-value table
 */
function ObjectDisplay({ data }: { data: any }) {
  const entries = Object.entries(data)

  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-4 py-2 text-left font-medium border-b w-1/3">Property</th>
            <th className="px-4 py-2 text-left font-medium border-b">Value</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, value], index) => (
            <tr
              key={key}
              className={cn(
                'border-b last:border-b-0',
                index % 2 === 0 ? 'bg-background' : 'bg-muted/20'
              )}
            >
              <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                {key}
              </td>
              <td className="px-4 py-2">
                {renderValue(value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Render value based on type
 */
function renderValue(value: any): React.ReactNode {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground italic">null</span>
  }

  if (typeof value === 'boolean') {
    return <span className="font-medium">{value ? 'true' : 'false'}</span>
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-muted-foreground italic">Empty array</span>
    }
    return (
      <div className="space-y-1">
        {value.slice(0, 3).map((item, i) => (
          <div key={i} className="text-sm">
            • {typeof item === 'object' ? JSON.stringify(item) : String(item)}
          </div>
        ))}
        {value.length > 3 && (
          <div className="text-xs text-muted-foreground">
            ... and {value.length - 3} more
          </div>
        )}
      </div>
    )
  }

  if (typeof value === 'object') {
    return (
      <details className="cursor-pointer">
        <summary className="text-sm text-muted-foreground hover:text-foreground flex items-center justify-between gap-2">
          <span>{Object.keys(value).length} properties</span>
          <span onClick={(e) => e.stopPropagation()}>
            <NestedExportMenu data={value} filename="nested" compact />
          </span>
        </summary>
        <div className="mt-2 pl-4 border-l-2 border-muted">
          <ObjectDisplay data={value} />
        </div>
      </details>
    )
  }

  // String or number
  return <span className="break-words">{String(value)}</span>
}

/**
 * Truncate string with ellipsis
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.substring(0, maxLength) + '...'
}

type Scalar = string | number | boolean

/**
 * Convert a nested value into flat rows suitable for CSV/Excel.
 * Deeply-nested objects/arrays inside a cell become JSON strings — that way
 * the user still gets every level, just in a single cell.
 */
function toTabularRows(data: unknown): Record<string, Scalar>[] {
  const encode = (v: unknown): Scalar => {
    if (v === null || v === undefined) return ''
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
    try {
      return JSON.stringify(v)
    } catch {
      return String(v)
    }
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return []
    const allObjects = data.every(item => item && typeof item === 'object' && !Array.isArray(item))
    if (allObjects) {
      return (data as Record<string, unknown>[]).map(item => {
        const row: Record<string, Scalar> = {}
        Object.entries(item).forEach(([k, v]) => { row[k] = encode(v) })
        return row
      })
    }
    return data.map((item, index) => ({ index, value: encode(item) }))
  }

  if (data && typeof data === 'object') {
    return Object.entries(data as Record<string, unknown>).map(([key, value]) => ({
      key,
      value: encode(value),
    }))
  }

  return [{ value: encode(data) }]
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

interface NestedExportMenuProps {
  data: unknown
  filename: string
  compact?: boolean
}

/**
 * Export menu rendered inside nested-cell dialogs so users can extract data
 * from arbitrarily deep structures (CSV/Excel flatten one level; JSON keeps all).
 */
function NestedExportMenu({ data, filename, compact = false }: NestedExportMenuProps) {
  const timestamp = new Date().toISOString().split('T')[0]

  const exportCSV = () => {
    const rows = toTabularRows(data)
    if (rows.length === 0) return
    const csvConfig = mkConfig({
      filename: `${filename}_${timestamp}`,
      useKeysAsHeaders: true,
      fieldSeparator: ',',
    })
    download(csvConfig)(generateCsv(csvConfig)(rows))
  }

  const exportExcel = () => {
    const rows = toTabularRows(data)
    if (rows.length === 0) return
    const worksheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Data')
    XLSX.writeFile(workbook, `${filename}_${timestamp}.xlsx`)
  }

  const exportJSON = () => {
    downloadBlob(JSON.stringify(data, null, 2), `${filename}_${timestamp}.json`, 'application/json')
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={compact ? 'sm' : 'sm'} className={compact ? 'h-7 px-2' : ''}>
          <Download className={compact ? 'h-3 w-3 mr-1' : 'h-4 w-4 mr-2'} />
          <span className={compact ? 'text-xs' : ''}>Export</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={exportCSV}>Export as CSV</DropdownMenuItem>
        <DropdownMenuItem onClick={exportExcel}>Export as Excel</DropdownMenuItem>
        <DropdownMenuItem onClick={exportJSON}>Export as JSON (full depth)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
