// UserFormDialog.tsx
//
// Shared modal dialog for both creating and editing users. When `isCreate` is
// true, username and password fields are shown. Otherwise only the editable
// profile fields appear.

import { useState, useMemo, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import {
  User as UserIcon,
  Mail,
  Lock,
  Users,
  Shield,
  Settings,
  Search,
  CheckCircle2,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface GroupOption {
  id: number
  name: string
  permission_count?: number
  user_count?: number
}

interface UserFormDialogProps {
  title: string
  groups: GroupOption[]
  formData: Record<string, unknown>
  setFormData: (patch: Record<string, unknown>) => void
  onSubmit: () => void
  onCancel: () => void
  isPending: boolean
  submitLabel: string
  pendingLabel: string
  isCreate?: boolean
}

export function UserFormDialog({
  title, groups, formData, setFormData, onSubmit, onCancel,
  isPending, submitLabel, pendingLabel, isCreate,
}: UserFormDialogProps) {
  const groupIds = (formData.group_ids as number[]) || []
  const [groupSearch, setGroupSearch] = useState('')

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  const filteredGroups = useMemo(() => {
    const q = groupSearch.trim().toLowerCase()
    if (!q) return groups
    return groups.filter(g => g.name.toLowerCase().includes(q))
  }, [groups, groupSearch])

  const toggleGroup = (groupId: number, checked: boolean) => {
    if (checked) {
      setFormData({ group_ids: [...groupIds, groupId] })
    } else {
      setFormData({ group_ids: groupIds.filter(id => id !== groupId) })
    }
  }

  const selectAllVisible = () => {
    const visibleIds = filteredGroups.map(g => g.id)
    setFormData({ group_ids: Array.from(new Set([...groupIds, ...visibleIds])) })
  }

  const clearAllVisible = () => {
    const visibleIds = new Set(filteredGroups.map(g => g.id))
    setFormData({ group_ids: groupIds.filter(id => !visibleIds.has(id)) })
  }

  const firstName = (formData.first_name as string) || ''
  const lastName = (formData.last_name as string) || ''
  const username = (formData.username as string) || ''

  const avatarInitials =
    firstName && lastName
      ? `${firstName[0]}${lastName[0]}`.toUpperCase()
      : username
        ? username.slice(0, 2).toUpperCase()
        : '??'

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel()
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={handleBackdropClick}
    >
      <div className="bg-card rounded-xl border shadow-2xl max-w-4xl w-full max-h-[92vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-5 border-b bg-muted/20 flex items-center gap-4">
          <div className="h-12 w-12 rounded-full bg-primary text-primary-foreground ring-1 ring-border flex items-center justify-center text-base font-semibold flex-shrink-0">
            {avatarInitials}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-semibold truncate">{title}</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {isCreate
                ? 'Create a new user account and configure their initial access.'
                : 'Update profile, group memberships, and access for this account.'}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel} className="flex-shrink-0">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="p-6 space-y-8">

            {/* Personal Info */}
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <UserIcon className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
                  {isCreate ? 'Identity' : 'Personal Information'}
                </h3>
              </div>

              {isCreate && (
                <div className="space-y-2">
                  <Label htmlFor="username">
                    Username <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="username"
                    value={username}
                    onChange={(e) => setFormData({ username: e.target.value })}
                    placeholder="Enter username"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="first_name">First Name</Label>
                  <Input
                    id="first_name"
                    value={firstName}
                    onChange={(e) => setFormData({ first_name: e.target.value })}
                    placeholder="e.g. Kerem"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="last_name">Last Name</Label>
                  <Input
                    id="last_name"
                    value={lastName}
                    onChange={(e) => setFormData({ last_name: e.target.value })}
                    placeholder="e.g. Önemli"
                  />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label htmlFor="email" className="flex items-center gap-2">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                    Email {isCreate && <span className="text-destructive">*</span>}
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={(formData.email as string) || ''}
                    onChange={(e) => setFormData({ email: e.target.value })}
                    placeholder="user@example.com"
                  />
                </div>
              </div>
            </section>

            {/* Password (create only) */}
            {isCreate && (
              <section className="space-y-4">
                <div className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
                    Password
                  </h3>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="password">
                      Password <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="password"
                      type="password"
                      value={(formData.password as string) || ''}
                      onChange={(e) => setFormData({ password: e.target.value })}
                      placeholder="••••••••"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password_confirm">
                      Confirm Password <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="password_confirm"
                      type="password"
                      value={(formData.password_confirm as string) || ''}
                      onChange={(e) => setFormData({ password_confirm: e.target.value })}
                      placeholder="••••••••"
                    />
                  </div>
                </div>
              </section>
            )}

            {/* Account Status */}
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <Settings className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
                  Account Status
                </h3>
              </div>
              <div className="border rounded-lg p-4 flex items-center justify-between bg-background">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="is_active" className="text-sm font-medium">Active Account</Label>
                    {((formData.is_active as boolean) ?? true) && (
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
                  checked={(formData.is_active as boolean) ?? true}
                  onCheckedChange={(checked) => setFormData({ is_active: checked })}
                />
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
                    {groupIds.length} / {groups.length}
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
                      const checked = groupIds.includes(group.id)
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
                            onCheckedChange={(v) => toggleGroup(group.id, Boolean(v))}
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
            {groupIds.length > 0
              ? `Member of ${groupIds.length} group${groupIds.length === 1 ? '' : 's'}`
              : 'Not a member of any group'}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel} disabled={isPending}>
              Cancel
            </Button>
            <Button onClick={onSubmit} disabled={isPending} className="min-w-[140px]">
              {isPending ? pendingLabel : submitLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
