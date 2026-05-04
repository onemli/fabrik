// admin/CloneGroupDialog.tsx — copy an existing group with a new name and the same permissions.

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Copy, Shield } from 'lucide-react'
import { userManagementService, GroupDetail } from '@/services/userManagement'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'

interface CloneGroupDialogProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  group: GroupDetail
}

export function CloneGroupDialog({ open, onClose, onSuccess, group }: CloneGroupDialogProps) {
  const { showLogoNotification } = useQueryBuilderStore()
  const [loading, setLoading] = useState(false)
  const [newName, setNewName] = useState(`${group.name} (Copy)`)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!newName.trim()) {
      showLogoNotification({
        message: 'GROUP NAME REQUIRED',
        type: 'error',
        statusCode: 400,
        duration: 2000,
      })
      return
    }

    try {
      setLoading(true)
      await userManagementService.cloneGroup(group.id, newName.trim())

      showLogoNotification({
        message: 'GROUP CLONED',
        type: 'success',
        statusCode: 201,
        duration: 1500,
      })

      setNewName(`${group.name} (Copy)`)
      onClose()
      onSuccess()
    } catch (error: any) {
      showLogoNotification({
        message: error?.error || error?.message || 'CLONE FAILED',
        type: 'error',
        statusCode: error?.status || 500,
        duration: 2000,
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-5 w-5" />
            Clone Group
          </DialogTitle>
          <DialogDescription>
            Create a copy of "{group.name}" with all its permissions
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
              <Shield className="h-4 w-4 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">Source: {group.name}</p>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="secondary" className="text-xs">
                    {group.permissions.length} permissions
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {group.user_count} members
                  </Badge>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="newName">New Group Name *</Label>
              <Input
                id="newName"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Enter new group name"
                required
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                The new group will inherit all permissions from "{group.name}"
              </p>
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-4 border-t">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !newName.trim()} className="gap-2">
              <Copy className="h-4 w-4" />
              {loading ? 'Cloning...' : 'Clone Group'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
