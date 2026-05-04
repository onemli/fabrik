// library/ExportDialog.tsx
//
// Thin wrapper around QueryExportImportDialog configured for export mode.
// The Library page passes the selected query IDs here so users can bundle
// a subset of their queries into a portable JSON file.

import { QueryExportImportDialog } from '@/components/QueryExportImportDialog'

interface ExportDialogProps {
  open: boolean
  onClose: () => void
  selectedQueryIds: number[]
}

export function ExportDialog({ open, onClose, selectedQueryIds }: ExportDialogProps) {
  return (
    <QueryExportImportDialog
      open={open}
      onOpenChange={onClose}
      mode="export"
      selectedQueryIds={selectedQueryIds}
    />
  )
}
