// library/ImportDialog.tsx
//
// Thin wrapper around QueryExportImportDialog configured for import mode.
// After a successful import the Library page will refresh automatically
// via React Query's cache invalidation.

import { QueryExportImportDialog } from '@/components/QueryExportImportDialog'

interface ImportDialogProps {
  open: boolean
  onClose: () => void
}

export function ImportDialog({ open, onClose }: ImportDialogProps) {
  return (
    <QueryExportImportDialog
      open={open}
      onOpenChange={onClose}
      mode="import"
    />
  )
}
