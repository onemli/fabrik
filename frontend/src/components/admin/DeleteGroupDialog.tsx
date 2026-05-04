// admin/DeleteGroupDialog.tsx — delete confirmation that also warns if the group
// has members who will lose their permissions.

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { userManagementService, GroupDetail, SYSTEM_ADMIN_GROUP_NAME } from '@/services/userManagement'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import { AlertTriangle } from 'lucide-react'

interface DeleteGroupDialogProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  group: GroupDetail
}

export function DeleteGroupDialog({ open, onClose, onSuccess, group }: DeleteGroupDialogProps) {
  const { showLogoNotification } = useQueryBuilderStore()
  const [loading, setLoading] = useState(false)

  const handleDelete = async () => {
    try {
      setLoading(true)
      await userManagementService.deleteGroup(group.id)

      showLogoNotification({
        message: 'GROUP DELETED',
        type: 'success',
        statusCode: 200,
        duration: 1500,
      })

      onSuccess()
    } catch (error) {
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

  if (group.name === SYSTEM_ADMIN_GROUP_NAME) {
    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              Cannot Delete Admin Group
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <p>
              The Admin group is a system group and cannot be deleted.
            </p>

            <div className="flex gap-2 justify-end">
              <Button type="button" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="h-5 w-5" />
            Delete Group
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p>
            Are you sure you want to delete group <strong>{group.name}</strong>?
          </p>

          {group.user_count > 0 && (
            <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3 text-sm">
              <p className="font-medium text-orange-600">Warning:</p>
              <p className="text-orange-600/90">
                This group has {group.user_count} users. Those users will lose the permissions granted by this group.
              </p>
            </div>
          )}

          {group.permissions.length > 0 && (
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-sm">
              <p className="font-medium text-blue-600">Info:</p>
              <p className="text-blue-600/90">
                This group has {group.permissions.length} permissions assigned.
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
              {loading ? 'Deleting...' : 'Delete Group'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
