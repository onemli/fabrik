// admin/EditUserDialog.tsx — update user profile fields (name, email, is_active,
// group membership). Does not change password — use ResetPasswordDialog for that.

import { useState, useEffect, useMemo } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  AlertTriangle,
  Search,
  Shield,
  User as UserIcon,
  Users,
  Mail,
  Settings,
  CheckCircle2,
} from 'lucide-react'
import { userManagementService, UserManagementUser, GroupBasic } from '@/services/userManagement'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import { cn } from '@/lib/utils'

interface EditUserDialogProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  user: UserManagementUser
  groups: GroupBasic[]
}

export function EditUserDialog({ open, onClose, onSuccess, user, groups }: EditUserDialogProps) {
  const { showLogoNotification } = useQueryBuilderStore()
  const [loading, setLoading] = useState(false)
  const [groupSearch, setGroupSearch] = useState('')
  const [formData, setFormData] = useState({
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    is_active: user.is_active,
    is_staff: user.is_staff,
    is_superuser: user.is_superuser,
    group_ids: user.groups.map(g => g.id)
  })

  useEffect(() => {
    setFormData({
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      is_active: user.is_active,
      is_staff: user.is_staff,
      is_superuser: user.is_superuser,
      group_ids: user.groups.map(g => g.id)
    })
    setGroupSearch('')
  }, [user, open])

  const filteredGroups = useMemo(() => {
    const q = groupSearch.trim().toLowerCase()
    if (!q) return groups
    return groups.filter(g => g.name.toLowerCase().includes(q))
  }, [groups, groupSearch])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      setLoading(true)
      await userManagementService.updateUser(user.id, formData)
      showLogoNotification({ message: 'USER UPDATED', type: 'success', statusCode: 200, duration: 1500 })
      onSuccess()
    } catch {
      showLogoNotification({ message: 'UPDATE FAILED', type: 'error', statusCode: 500, duration: 2000 })
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

  const selectAllVisible = () => {
    const visibleIds = filteredGroups.map(g => g.id)
    setFormData(prev => ({
      ...prev,
      group_ids: Array.from(new Set([...prev.group_ids, ...visibleIds])),
    }))
  }

  const clearAllVisible = () => {
    const visibleIds = new Set(filteredGroups.map(g => g.id))
    setFormData(prev => ({
      ...prev,
      group_ids: prev.group_ids.filter(id => !visibleIds.has(id)),
    }))
  }

  const avatarInitials =
    user.first_name && user.last_name
      ? `${user.first_name[0]}${user.last_name[0]}`.toUpperCase()
      : user.username.slice(0, 2).toUpperCase()

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl p-0 gap-0 max-h-[92vh] overflow-hidden flex flex-col">
        <DialogHeader className="px-6 py-5 border-b bg-muted/20">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-full bg-primary text-primary-foreground ring-1 ring-border flex items-center justify-center text-base font-semibold flex-shrink-0">
              {avatarInitials}
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-xl truncate">Edit User — {user.username}</DialogTitle>
              <DialogDescription className="mt-0.5">
                Update profile, group memberships, and system access for this account.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="p-6 space-y-8">

              {/* Personal Info */}
              <section className="space-y-4">
                <div className="flex items-center gap-2">
                  <UserIcon className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
                    Personal Information
                  </h3>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="first_name">First Name</Label>
                    <Input
                      id="first_name"
                      value={formData.first_name}
                      onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                      placeholder="e.g. Kerem"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="last_name">Last Name</Label>
                    <Input
                      id="last_name"
                      value={formData.last_name}
                      onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                      placeholder="e.g. Önemli"
                    />
                  </div>
                  <div className="space-y-2 col-span-2">
                    <Label htmlFor="email" className="flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                      Email
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="user@example.com"
                    />
                  </div>
                </div>
              </section>

              {/* Account Status */}
              <section className="space-y-4">
                <div className="flex items-center gap-2">
                  <Settings className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
                    Account Status
                  </h3>
                </div>
                <div className="border rounded-lg divide-y">
                  <div className="flex items-center justify-between p-4">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="is_active" className="text-sm font-medium">Active Account</Label>
                        {formData.is_active && (
                          <Badge className="bg-green-100 text-green-800 dark:bg-green-900/60 dark:text-green-200 text-xs">
                            Can sign in
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        If disabled, the user cannot sign in but data is retained.
                      </p>
                    </div>
                    <Switch
                      id="is_active"
                      checked={formData.is_active}
                      onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                    />
                  </div>
                  <div className="flex items-center justify-between p-4">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="is_staff" className="text-sm font-medium">Staff Status</Label>
                        <Badge variant="outline" className="text-xs">Django Admin</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Grants access to the Django admin interface at <span className="font-mono">/admin</span>.
                      </p>
                    </div>
                    <Switch
                      id="is_staff"
                      checked={formData.is_staff}
                      onCheckedChange={(checked) => setFormData({ ...formData, is_staff: checked })}
                    />
                  </div>
                  <div
                    className={cn(
                      'flex items-center justify-between p-4 transition-colors',
                      formData.is_superuser && 'bg-amber-50/60 dark:bg-amber-950/20'
                    )}
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="is_superuser" className="text-sm font-medium">Superuser</Label>
                        <Badge variant="destructive" className="text-xs gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          Bypasses all checks
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Grants every permission unconditionally — including destructive operations. Assign sparingly.
                      </p>
                    </div>
                    <Switch
                      id="is_superuser"
                      checked={formData.is_superuser}
                      onCheckedChange={(checked) => setFormData({ ...formData, is_superuser: checked })}
                    />
                  </div>
                </div>
              </section>

              {/* Groups */}
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
                      Group Membership
                    </h3>
                    <Badge variant="secondary" className="ml-1">
                      {formData.group_ids.length} / {groups.length}
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-xs h-7"
                      onClick={selectAllVisible}
                      disabled={filteredGroups.length === 0}
                    >
                      Select all
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-xs h-7"
                      onClick={clearAllVisible}
                      disabled={filteredGroups.length === 0}
                    >
                      Clear
                    </Button>
                  </div>
                </div>

                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={groupSearch}
                    onChange={(e) => setGroupSearch(e.target.value)}
                    placeholder="Search groups..."
                    className="pl-9"
                  />
                </div>

                {filteredGroups.length === 0 ? (
                  <div className="border rounded-lg p-8 text-center text-sm text-muted-foreground">
                    {groupSearch ? 'No groups match your search.' : 'No groups available.'}
                  </div>
                ) : (
                  <div className="border rounded-lg bg-muted/10">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3">
                      {filteredGroups.map(group => {
                        const checked = formData.group_ids.includes(group.id)
                        return (
                          <label
                            key={group.id}
                            htmlFor={`group-${group.id}`}
                            className={cn(
                              'flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-all',
                              'hover:border-primary/40 hover:bg-primary/5',
                              checked ? 'border-primary bg-primary/10 shadow-sm' : 'border-border bg-background'
                            )}
                          >
                            <Checkbox
                              id={`group-${group.id}`}
                              checked={checked}
                              onCheckedChange={() => toggleGroup(group.id)}
                              className="mt-0.5"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <Shield className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                                <span className="text-sm font-medium truncate">{group.name}</span>
                                {group.name === 'Admin' && (
                                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                                    System
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                                {typeof group.permission_count === 'number' && (
                                  <span>{group.permission_count} perms</span>
                                )}
                                {typeof group.user_count === 'number' && (
                                  <span>{group.user_count} users</span>
                                )}
                              </div>
                            </div>
                            {checked && (
                              <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                            )}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )}
              </section>

            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t bg-muted/20 flex items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              {formData.group_ids.length > 0
                ? `Member of ${formData.group_ids.length} group${formData.group_ids.length === 1 ? '' : 's'}`
                : 'Not a member of any group'}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading} className="min-w-[120px]">
                {loading ? 'Updating...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
