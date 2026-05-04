// validation/MultiSheetValidationView.tsx
//
// Top-level validation UI for AWX input data that spans multiple sheets. Each
// sheet gets its own tab with an error count badge. The user uploads a file,
// the backend validates it against the table schema, and results appear here.

import { useState, useRef } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ShieldCheck, AlertCircle, CheckCircle2, RefreshCw, FileSpreadsheet } from 'lucide-react'
import { ValidationError, MultiSheetValidationResult } from '@/services/validation'
import { ValidationErrorList } from './ValidationErrorList'
import { ValidationErrorGrid } from './ValidationErrorGrid'

interface SheetData {
  name: string
  rows: any[]
  columns: { name: string; display_name: string }[]
}

interface MultiSheetValidationViewProps {
  sheets: SheetData[]
  validationResult?: MultiSheetValidationResult
  onRevalidate?: () => void
  loading?: boolean
}

export function MultiSheetValidationView({
  sheets,
  validationResult,
  onRevalidate,
  loading = false,
}: MultiSheetValidationViewProps) {
  const [activeSheet, setActiveSheet] = useState(sheets[0]?.name || '')
  const [selectedError, setSelectedError] = useState<ValidationError | null>(null)
  const gridRefs = useRef<Record<string, any>>({})

  const handleJumpToCell = (error: ValidationError) => {
    // Switch to the sheet containing the error if needed
    const sheetName = activeSheet
    const gridRef = gridRefs.current[sheetName]

    if (gridRef?.hotInstance) {
      const hot = gridRef.hotInstance
      const sheet = sheets.find(s => s.name === sheetName)
      if (!sheet) return

      const colIndex = sheet.columns.findIndex(col => col.name === error.column)
      if (colIndex === -1) return

      hot.selectCell(error.row, colIndex)
      hot.scrollViewportTo(error.row, colIndex)
    }

    setSelectedError(error)
  }

  const getSheetErrors = (sheetName: string): ValidationError[] => {
    if (!validationResult || !validationResult.sheets[sheetName]) {
      return []
    }
    return validationResult.sheets[sheetName].errors || []
  }

  const getSheetErrorCount = (sheetName: string): number => {
    return getSheetErrors(sheetName).length
  }

  const currentSheetErrors = getSheetErrors(activeSheet)

  return (
    <div className="h-full flex flex-col space-y-4">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-6 w-6 text-primary" />
              <div>
                <CardTitle>Data Validation</CardTitle>
                <CardDescription>
                  Review and fix validation errors before submitting
                </CardDescription>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {validationResult && (
                <>
                  {validationResult.is_valid ? (
                    <Badge variant="outline" className="gap-1 bg-green-50 text-green-700 border-green-200">
                      <CheckCircle2 className="h-3 w-3" />
                      All Valid
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1 bg-red-50 text-red-700 border-red-200">
                      <AlertCircle className="h-3 w-3" />
                      {validationResult.total_errors} Error{validationResult.total_errors !== 1 ? 's' : ''}
                    </Badge>
                  )}
                  {validationResult.validation_time_ms && (
                    <Badge variant="secondary" className="text-xs">
                      {validationResult.validation_time_ms}ms
                    </Badge>
                  )}
                </>
              )}
              <Button
                onClick={onRevalidate}
                disabled={loading}
                variant="outline"
                size="sm"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                Re-Validate
              </Button>
            </div>
          </div>
        </CardHeader>

        {validationResult && validationResult.bypassed && (
          <CardContent>
            <Alert>
              <ShieldCheck className="h-4 w-4" />
              <AlertDescription>
                {validationResult.message || 'Validation bypassed'}
              </AlertDescription>
            </Alert>
          </CardContent>
        )}
      </Card>

      {/* Multi-Sheet Tabs */}
      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* Left Panel: Error List */}
        {currentSheetErrors.length > 0 && (
          <Card className="w-80 flex-shrink-0">
            <ValidationErrorList
              errors={currentSheetErrors}
              selectedError={selectedError}
              onSelect={setSelectedError}
              onJumpToCell={handleJumpToCell}
            />
          </Card>
        )}

        {/* Right Panel: Grid with Tabs */}
        <Card className="flex-1 flex flex-col overflow-hidden">
          <Tabs
            value={activeSheet}
            onValueChange={setActiveSheet}
            className="flex-1 flex flex-col"
          >
            <div className="border-b px-4">
              <TabsList className="w-full justify-start h-auto p-0 bg-transparent">
                {sheets.map(sheet => {
                  const errorCount = getSheetErrorCount(sheet.name)
                  const hasErrors = errorCount > 0

                  return (
                    <TabsTrigger
                      key={sheet.name}
                      value={sheet.name}
                      className="gap-2 data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
                    >
                      <FileSpreadsheet className="h-4 w-4" />
                      {sheet.name}
                      {hasErrors && (
                        <Badge
                          variant="outline"
                          className="ml-1 bg-red-50 text-red-700 border-red-200"
                        >
                          {errorCount}
                        </Badge>
                      )}
                    </TabsTrigger>
                  )
                })}
              </TabsList>
            </div>

            <div className="flex-1 overflow-hidden">
              {sheets.map(sheet => (
                <TabsContent
                  key={sheet.name}
                  value={sheet.name}
                  className="h-full mt-0 data-[state=active]:flex data-[state=active]:flex-col"
                >
                  <ValidationErrorGrid
                    ref={(el) => {
                      if (el) {
                        gridRefs.current[sheet.name] = el
                      }
                    }}
                    sheet={sheet}
                    validationResult={
                      validationResult?.sheets[sheet.name]
                    }
                    selectedError={selectedError}
                    onErrorSelect={setSelectedError}
                  />
                </TabsContent>
              ))}
            </div>
          </Tabs>
        </Card>
      </div>

      {/* Instructions */}
      {validationResult && !validationResult.is_valid && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <strong>How to fix errors:</strong> Click on a red cell or select an error from the left panel.
            Copy the suggested value and paste it into the cell. Then click "Re-Validate" to check again.
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
