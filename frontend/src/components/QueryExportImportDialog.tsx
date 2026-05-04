// QueryExportImportDialog.tsx
//
// Shared dialog used by both ExportDialog and ImportDialog in the library.
// In export mode it serializes selected queries to JSON and triggers a download.
// In import mode it reads an uploaded JSON file and POSTs it to the backend.

import { useState, useRef } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Download, Upload, CheckCircle2, XCircle, AlertCircle, FileJson } from 'lucide-react'
import { queriesService } from '@/services/queries'
import { useQueryClient } from '@tanstack/react-query'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface QueryExportImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'export' | 'import'
  selectedQueryIds?: number[]
}

export function QueryExportImportDialog({ open, onOpenChange, mode, selectedQueryIds = [] }: QueryExportImportDialogProps) {
  const queryClient = useQueryClient()
  const { showLogoNotification } = useQueryBuilderStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [importResult, setImportResult] = useState<any>(null)

  const handleExport = async () => {
    if (selectedQueryIds.length === 0) {
      showLogoNotification({
        message: 'NO SELECTION',
        type: 'error',
        statusCode: 400,
        duration: 2000,
      })
      return
    }
    setIsProcessing(true)
    try {
      const exportData = await queriesService.exportQueries(selectedQueryIds)
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `fabrik_queries_${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      showLogoNotification({
        message: 'EXPORTED',
        type: 'success',
        statusCode: 200,
        duration: 2000,
      })
      onOpenChange(false)
    } catch (error: any) {
      showLogoNotification({
        message: 'EXPORT FAILED',
        type: 'error',
        statusCode: 500,
        duration: 2500,
      })
    } finally {
      setIsProcessing(false)
    }
  }

  const handleImport = async (file: File) => {
    setIsProcessing(true)
    setImportResult(null)
    try {
      const text = await file.text()
      const importData = JSON.parse(text)
      if (!importData.version || !Array.isArray(importData.queries)) {
        throw new Error('Invalid export file format')
      }
      const result = await queriesService.importQueries(importData)
      setImportResult(result)
      queryClient.invalidateQueries({ queryKey: ['saved-queries'] })
      queryClient.invalidateQueries({ queryKey: ['saved-queries-paginated'] })
      if (result.success_count > 0) {
        showLogoNotification({
          message: 'IMPORTED',
          type: 'success',
          statusCode: 200,
          duration: 2000,
        })
      }
    } catch (error: any) {
      showLogoNotification({
        message: 'IMPORT FAILED',
        type: 'error',
        statusCode: 500,
        duration: 2500,
      })
    } finally {
      setIsProcessing(false)
    }
  }

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      if (!file.name.endsWith('.json')) {
        showLogoNotification({
          message: 'INVALID FILE',
          type: 'error',
          statusCode: 400,
          duration: 2000,
        })
        return
      }
      if (file.size > 10 * 1024 * 1024) {
        showLogoNotification({
          message: 'FILE TOO LARGE',
          type: 'error',
          statusCode: 413,
          duration: 2000,
        })
        return
      }
      handleImport(file)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === 'export' ? <><Download className="w-5 h-5" />Export Queries</> : <><Upload className="w-5 h-5" />Import Queries</>}
          </DialogTitle>
          <DialogDescription>
            {mode === 'export' ? 'Export selected queries to JSON' : 'Import queries from JSON file'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {mode === 'export' ? (
            <>
              <Alert>
                <FileJson className="w-4 h-4" />
                <AlertDescription>
                  Exporting {selectedQueryIds.length} {selectedQueryIds.length === 1 ? 'query' : 'queries'}.
                  Export includes structure and settings but excludes execution history.
                </AlertDescription>
              </Alert>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isProcessing}>Cancel</Button>
                <Button onClick={handleExport} disabled={isProcessing || selectedQueryIds.length === 0}>
                  <Download className="w-4 h-4 mr-2" />
                  {isProcessing ? 'Exporting...' : 'Export to JSON'}
                </Button>
              </div>
            </>
          ) : (
            <>
              <Alert>
                <AlertCircle className="w-4 h-4" />
                <AlertDescription>
                  <strong>Import Guidelines:</strong> JSON files from Fabrik exports only. Max 10MB, 100 queries.
                </AlertDescription>
              </Alert>
              <input ref={fileInputRef} type="file" accept=".json" onChange={handleFileSelect} className="hidden" />
              {!importResult ? (
                <div className="border-2 border-dashed rounded-lg p-8 text-center">
                  <FileJson className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground mb-4">Select a JSON export file</p>
                  <Button onClick={() => fileInputRef.current?.click()} disabled={isProcessing}>
                    <Upload className="w-4 h-4 mr-2" />
                    {isProcessing ? 'Importing...' : 'Select File'}
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircle2 className="w-5 h-5 text-green-500" />
                        <span className="font-semibold">Successful</span>
                      </div>
                      <div className="text-2xl font-bold">{importResult.success_count}</div>
                    </div>
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <XCircle className="w-5 h-5 text-red-500" />
                        <span className="font-semibold">Failed</span>
                      </div>
                      <div className="text-2xl font-bold">{importResult.error_count}</div>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => { setImportResult(null); if(fileInputRef.current) fileInputRef.current.value = '' }}>
                      Import Another
                    </Button>
                    <Button onClick={() => onOpenChange(false)}>Done</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
