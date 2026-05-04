// admin/CreateUserDialog.tsx — admin form for creating a new user account.
// Sets a temporary password that the user must change on first login.

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { userManagementService, GroupBasic } from '@/services/userManagement'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'

interface CreateUserDialogProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  groups: GroupBasic[]
}

export function CreateUserDialog({ open, onClose, onSuccess, groups }: CreateUserDialogProps) {
  const { showLogoNotification } = useQueryBuilderStore()
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    password_confirm: '',
    first_name: '',
    last_name: '',
    is_active: true,
    group_ids: [] as number[]
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (formData.password !== formData.password_confirm) {
      showLogoNotification({
        message: 'PASSWORDS DO NOT MATCH',
        type: 'error',
        statusCode: 400,
        duration: 2000,
      })
      return
    }

    try {
      setLoading(true)
      await userManagementService.createUser(formData)

      showLogoNotification({
        message: 'USER CREATED',
        type: 'success',
        statusCode: 201,
        duration: 1500,
      })

      onSuccess()
    } catch (error) {
      showLogoNotification({
        message: 'CREATE FAILED',
        type: 'error',
        statusCode: 500,
        duration: 2000,
      })
    } finally {
      setLoading(false)
    }
  }

  const toggleGroup = (groupId: number) => {
    setFormData(prev => ({
      ...prev,
      group_ids: prev.group_ids.includes(groupId)
        ? prev.group_ids.filter(id => id !== groupId)
        : [...prev.group_ids, groupId]
    }))
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New User</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username *</Label>
              <Input
                id="username"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="first_name">First Name *</Label>
              <Input
                id="first_name"
                value={formData.first_name}
                onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="last_name">Last Name *</Label>
              <Input
                id="last_name"
                value={formData.last_name}
                onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="password">Password *</Label>
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password_confirm">Confirm Password *</Label>
              <Input
                id="password_confirm"
                type="password"
                value={formData.password_confirm}
                onChange={(e) => setFormData({ ...formData, password_confirm: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Groups</Label>
            <div className="border rounded-lg p-4 space-y-2 max-h-48 overflow-y-auto">
              {groups.map(group => (
                <div key={group.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={`group-${group.id}`}
                    checked={formData.group_ids.includes(group.id)}
                    onCheckedChange={() => toggleGroup(group.id)}
                  />
                  <label
                    htmlFor={`group-${group.id}`}
                    className="text-sm font-medium cursor-pointer"
                  >
                    {group.name}
                  </label>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="is_active"
              checked={formData.is_active}
              onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked as boolean })}
            />
            <label htmlFor="is_active" className="text-sm font-medium cursor-pointer">
              Active
            </label>
          </div>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create User'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
