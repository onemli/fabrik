// admin/ResetPasswordDialog.tsx — admin password reset form. Sets a new
// temporary password for the user without needing the old one.

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { userManagementService, UserManagementUser } from '@/services/userManagement'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import { Key } from 'lucide-react'

interface ResetPasswordDialogProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  user: UserManagementUser
}

export function ResetPasswordDialog({ open, onClose, onSuccess, user }: ResetPasswordDialogProps) {
  const { showLogoNotification } = useQueryBuilderStore()
  const [loading, setLoading] = useState(false)
  const [passwords, setPasswords] = useState({
    new_password: '',
    new_password_confirm: ''
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (passwords.new_password !== passwords.new_password_confirm) {
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
      await userManagementService.resetPassword(
        user.id,
        passwords.new_password,
        passwords.new_password_confirm
      )

      showLogoNotification({
        message: 'PASSWORD RESET',
        type: 'success',
        statusCode: 200,
        duration: 1500,
      })

      setPasswords({ new_password: '', new_password_confirm: '' })
      onSuccess()
    } catch (error) {
      showLogoNotification({
        message: 'RESET FAILED',
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
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Reset Password for {user.username}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new_password">New Password</Label>
            <Input
              id="new_password"
              type="password"
              value={passwords.new_password}
              onChange={(e) => setPasswords({ ...passwords, new_password: e.target.value })}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="new_password_confirm">Confirm New Password</Label>
            <Input
              id="new_password_confirm"
              type="password"
              value={passwords.new_password_confirm}
              onChange={(e) => setPasswords({ ...passwords, new_password_confirm: e.target.value })}
              required
            />
          </div>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Resetting...' : 'Reset Password'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
