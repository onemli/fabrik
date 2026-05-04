// admin/DeleteConfirmDialog.tsx — generic "are you sure?" confirmation dialog
// used by multiple admin actions before irreversible deletions.

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { userManagementService, UserManagementUser } from '@/services/userManagement'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import { AlertTriangle } from 'lucide-react'

interface DeleteConfirmDialogProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  user: UserManagementUser
}

export function DeleteConfirmDialog({ open, onClose, onSuccess, user }: DeleteConfirmDialogProps) {
  const { showLogoNotification } = useQueryBuilderStore()
  const [loading, setLoading] = useState(false)

  const handleDelete = async () => {
    try {
      setLoading(true)
      await userManagementService.deleteUser(user.id)

      showLogoNotification({
        message: 'USER DELETED',
        type: 'success',
        statusCode: 200,
        duration: 1500,
      })

      onSuccess()
    } catch {
      showLogoNotification({
        message: 'DELETE FAILED',
        type: 'error',
        statusCode: 500,
        duration: 2000,
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="h-5 w-5" />
            Delete User
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p>
            Are you sure you want to delete user <strong>{user.username}</strong> ({user.email})?
          </p>

          {user.query_count > 0 && (
            <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3 text-sm">
              <p className="font-medium text-orange-600">Warning:</p>
              <p className="text-orange-600/90">
                This user has {user.query_count} queries. Deleting this user may affect those queries.
              </p>
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            This action cannot be undone.
          </p>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={loading}
            >
              {loading ? 'Deleting...' : 'Delete User'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
