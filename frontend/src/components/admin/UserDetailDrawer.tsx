// admin/UserDetailDrawer.tsx — slide-in drawer with full user detail: login history,
// group memberships, last activity, and account status.

import { useState, useEffect } from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Shield,
  Users,
  Key,
  Edit,
  AlertTriangle,
  CheckCircle2,
  User,
  Clock,
  Activity,
  Save,
  X,
} from 'lucide-react'
import {
  userManagementService,
  UserManagementUser,
  Permission,
  EffectivePermission,
} from '@/services/userManagement'
import { PermissionSelector } from './PermissionSelector'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import { formatDistanceToNow } from 'date-fns'
import { useFormatters } from '@/contexts/TimezoneContext'

interface UserDetailDrawerProps {
  open: boolean
  onClose: () => void
  userId: number | null
  onEdit?: (user: UserManagementUser) => void
}

export function UserDetailDrawer({
  open,
  onClose,
  userId,
  onEdit,
}: UserDetailDrawerProps) {
  const { formatDate } = useFormatters()
  const { showLogoNotification } = useQueryBuilderStore()
  const [loading, setLoading] = useState(false)
  const [user, setUser] = useState<UserManagementUser | null>(null)

  // Direct permissions tab state
  const [directPermissions, setDirectPermissions] = useState<Permission[]>([])
  const [allPermissions, setAllPermissions] = useState<Permission[]>([])
  const [loadingDirectPerms, setLoadingDirectPerms] = useState(false)
  const [editingPerms, setEditingPerms] = useState(false)
  const [selectedPermIds, setSelectedPermIds] = useState<number[]>([])
  const [savingPerms, setSavingPerms] = useState(false)

  // Effective permissions tab state
  const [effectivePermissions, setEffectivePermissions] = useState<EffectivePermission[]>([])
  const [loadingEffective, setLoadingEffective] = useState(false)

  useEffect(() => {
    if (open && userId) {
      loadUser()
    }
  }, [open, userId])

  const loadUser = async () => {
    if (!userId) return
    try {
      setLoading(true)
      const data = await userManagementService.getUser(userId)
      setUser(data)
    } catch (error) {
      showLogoNotification({ message: 'LOAD USER FAILED', type: 'error', statusCode: 500, duration: 2000 })
      onClose()
    } finally {
      setLoading(false)
    }
  }

  const loadDirectPermissions = async () => {
    if (!userId) return
    try {
      setLoadingDirectPerms(true)
      const [dirPerms, allPerms] = await Promise.all([
        userManagementService.getUserDirectPermissions(userId),
        userManagementService.listPermissions({ page_size: 1000 }),
      ])
      setDirectPermissions(dirPerms)
      setAllPermissions(allPerms.results)
      setSelectedPermIds(dirPerms.map(p => p.id))
    } catch {
      /* ignore */
    } finally {
      setLoadingDirectPerms(false)
    }
  }

  const loadEffectivePermissions = async () => {
    if (!userId) return
    try {
      setLoadingEffective(true)
      const data = await userManagementService.getEffectivePermissions(userId)
      setEffectivePermissions(data)
    } catch {
      /* ignore */
    } finally {
      setLoadingEffective(false)
    }
  }

  const handleTabChange = (tab: string) => {
    if (tab === 'direct' && directPermissions.length === 0 && !loadingDirectPerms) {
      loadDirectPermissions()
    }
    if (tab === 'effective' && effectivePermissions.length === 0 && !loadingEffective) {
      loadEffectivePermissions()
    }
  }

  const handleEditPermissions = () => {
    setEditingPerms(true)
  }

  const handleCancelEditPermissions = () => {
    setEditingPerms(false)
    setSelectedPermIds(directPermissions.map(p => p.id))
  }

  const handleSavePermissions = async () => {
    if (!userId) return
    try {
      setSavingPerms(true)
      const currentIds = directPermissions.map(p => p.id)
      const toAdd = selectedPermIds.filter(id => !currentIds.includes(id))
      const toRemove = currentIds.filter(id => !selectedPermIds.includes(id))

      if (toAdd.length > 0) await userManagementService.addPermissionsToUser(userId, toAdd)
      if (toRemove.length > 0) await userManagementService.removePermissionsFromUser(userId, toRemove)

      await loadDirectPermissions()
      // Reset effective permissions cache so it reloads next time
      setEffectivePermissions([])
      setEditingPerms(false)

      showLogoNotification({ message: 'PERMISSIONS SAVED', type: 'success', statusCode: 200, duration: 1500 })
    } catch {
      showLogoNotification({ message: 'SAVE FAILED', type: 'error', statusCode: 500, duration: 2000 })
    } finally {
      setSavingPerms(false)
    }
  }

  // Group effective permissions by category for display
  const effectiveByCategory = effectivePermissions.reduce((acc, perm) => {
    const category = (perm as any).category || 'Other'
    if (!acc[category]) acc[category] = []
    acc[category].push(perm)
    return acc
  }, {} as Record<string, EffectivePermission[]>)

  if (loading || !user) {
    return (
      <Sheet open={open} onOpenChange={onClose}>
        <SheetContent className="w-full sm:max-w-[900px] lg:max-w-[1100px] xl:max-w-[1200px] p-0 flex items-center justify-center">
          <SheetHeader className="sr-only">
            <SheetTitle>Loading user details</SheetTitle>
            <SheetDescription>Fetching user information…</SheetDescription>
          </SheetHeader>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-[900px] lg:max-w-[1100px] xl:max-w-[1200px] p-0 flex flex-col">
        {/* Header */}
        <SheetHeader className="px-6 py-4 border-b">
          <div className="flex items-start gap-4">
            {/* Avatar */}
            <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground ring-1 ring-border flex items-center justify-center text-lg font-semibold flex-shrink-0">
              {user.first_name && user.last_name
                ? `${user.first_name[0]}${user.last_name[0]}`.toUpperCase()
                : user.username.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <SheetTitle className="text-xl">{user.username}</SheetTitle>
                {user.is_active ? (
                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Active</Badge>
                ) : (
                  <Badge variant="secondary">Inactive</Badge>
                )}
                {user.is_superuser && (
                  <Badge variant="destructive" className="gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Superuser
                  </Badge>
                )}
                {user.is_staff && !user.is_superuser && (
                  <Badge variant="outline">Staff</Badge>
                )}
                {(user.is_superuser || user.groups.some(g => g.name === 'Admin')) && (
                  <Badge className="gap-1 bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                    <Shield className="h-3 w-3" />
                    Admin
                  </Badge>
                )}
              </div>
              <SheetDescription className="mt-1">{user.email}</SheetDescription>
            </div>
            <Button size="sm" variant="outline" className="gap-2 flex-shrink-0" onClick={() => onEdit?.(user)}>
              <Edit className="h-4 w-4" />
              Edit
            </Button>
          </div>

          {/* Quick stats */}
          <div className="flex items-center gap-4 pt-2">
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Users className="h-4 w-4" />
              <span>{user.groups.length} group{user.groups.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Activity className="h-4 w-4" />
              <span>{user.query_count} queries</span>
            </div>
            {user.last_login && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span>Last login {formatDistanceToNow(new Date(user.last_login), { addSuffix: true })}</span>
              </div>
            )}
          </div>
        </SheetHeader>

        {/* Tabs */}
        <Tabs
          defaultValue="overview"
          className="flex-1 flex flex-col overflow-hidden"
          onValueChange={handleTabChange}
        >
          <div className="px-6 pt-4">
            <TabsList className="w-full justify-start gap-6 bg-transparent p-0 h-auto border-b border-border rounded-none">
              {[
                { value: 'overview', label: 'Overview' },
                { value: 'direct', label: 'Direct Permissions' },
                { value: 'effective', label: 'Effective Permissions' },
              ].map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="relative rounded-none border-0 bg-transparent px-0 pb-2.5 pt-1 -mb-px text-sm font-medium text-muted-foreground shadow-none data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none after:absolute after:left-0 after:right-0 after:-bottom-px after:h-0.5 after:bg-primary after:scale-x-0 data-[state=active]:after:scale-x-100 after:transition-transform"
                >
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <ScrollArea className="flex-1 px-6 pb-6">

            {/* Overview Tab */}
            <TabsContent value="overview" className="mt-4 space-y-4">
              <div className="space-y-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <User className="h-4 w-4" />
                  User Information
                </h3>
                <div className="border rounded-lg p-4 space-y-3">
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Username</p>
                      <p className="text-sm font-medium">{user.username}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Email</p>
                      <p className="text-sm font-medium">{user.email}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">First Name</p>
                      <p className="text-sm font-medium">{user.first_name || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Last Name</p>
                      <p className="text-sm font-medium">{user.last_name || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Joined</p>
                      <p className="text-sm font-medium">
                        {formatDate(user.date_joined)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Last Login</p>
                      <p className="text-sm font-medium">
                        {user.last_login
                          ? formatDate(user.last_login)
                          : '—'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div className="space-y-3">
                <h3 className="font-semibold">Statistics</h3>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="border rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground">Total Queries</p>
                        <p className="text-2xl font-bold mt-1">{user.query_count}</p>
                      </div>
                      <Activity className="h-8 w-8 text-muted-foreground/30" />
                    </div>
                  </div>
                  <div className="border rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground">Groups</p>
                        <p className="text-2xl font-bold mt-1">{user.groups.length}</p>
                      </div>
                      <Users className="h-8 w-8 text-muted-foreground/30" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Groups */}
              {user.groups.length > 0 && (
                <div className="space-y-3">
                  <h3 className="font-semibold">Groups</h3>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {user.groups.map(group => (
                      <div
                        key={group.id}
                        className="border rounded-lg p-3 flex items-center gap-3 bg-background hover:border-primary/40 transition-colors"
                      >
                        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <Shield className="h-4 w-4 text-primary" />
                        </div>
                        <span className="text-sm font-medium truncate">{group.name}</span>
                        {group.name === 'Admin' && (
                          <Badge variant="secondary" className="text-xs ml-auto">System</Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>

            {/* Direct Permissions Tab */}
            <TabsContent value="direct" className="mt-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold flex items-center gap-2">
                  <Key className="h-4 w-4" />
                  Direct Permissions
                  <Badge variant="secondary">{directPermissions.length}</Badge>
                </h3>
                {!editingPerms ? (
                  <Button size="sm" variant="outline" className="gap-2" onClick={handleEditPermissions}>
                    <Edit className="h-4 w-4" />
                    Edit
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="gap-2" onClick={handleCancelEditPermissions}>
                      <X className="h-4 w-4" />
                      Cancel
                    </Button>
                    <Button size="sm" className="gap-2" onClick={handleSavePermissions} disabled={savingPerms}>
                      <Save className="h-4 w-4" />
                      {savingPerms ? 'Saving...' : 'Save'}
                    </Button>
                  </div>
                )}
              </div>

              {loadingDirectPerms ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                </div>
              ) : editingPerms ? (
                <PermissionSelector
                  permissions={allPermissions}
                  selectedIds={selectedPermIds}
                  onSelectionChange={setSelectedPermIds}
                />
              ) : directPermissions.length === 0 ? (
                <div className="border rounded-lg p-8 text-center">
                  <Key className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No direct permissions assigned</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Permissions may still be inherited via groups
                  </p>
                  <Button size="sm" variant="outline" className="mt-3 gap-2" onClick={handleEditPermissions}>
                    <Edit className="h-4 w-4" />
                    Assign Permissions
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {directPermissions.map(perm => (
                    <div
                      key={perm.id}
                      className="border rounded-lg p-3 bg-background hover:border-primary/40 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium truncate">{perm.name}</p>
                            {perm.is_dangerous && (
                              <Badge variant="destructive" className="text-xs gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                Dangerous
                              </Badge>
                            )}
                          </div>
                          {perm.description && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{perm.description}</p>
                          )}
                          <p className="text-xs text-muted-foreground/70 font-mono mt-1 truncate">{perm.codename}</p>
                        </div>
                        <CheckCircle2 className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Effective Permissions Tab */}
            <TabsContent value="effective" className="mt-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Effective Permissions
                  <Badge variant="secondary">{effectivePermissions.length}</Badge>
                </h3>
              </div>

              {loadingEffective ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                </div>
              ) : effectivePermissions.length === 0 ? (
                <div className="border rounded-lg p-8 text-center">
                  <Shield className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No effective permissions</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {Object.entries(effectiveByCategory).map(([category, perms]) => (
                    <div key={category} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-sm">{category}</h4>
                        <Badge variant="outline" className="text-xs">{perms.length}</Badge>
                      </div>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        {perms.map(perm => (
                          <div
                            key={`${perm.id}-${perm.source}`}
                            className="border rounded-lg p-3 bg-background hover:border-primary/40 transition-colors"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm font-medium truncate">{perm.name}</p>
                                  {perm.is_dangerous && (
                                    <Badge variant="destructive" className="text-xs gap-1">
                                      <AlertTriangle className="h-3 w-3" />
                                      Dangerous
                                    </Badge>
                                  )}
                                  {perm.source === 'direct' ? (
                                    <Badge className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                                      Direct
                                    </Badge>
                                  ) : (
                                    <Badge variant="secondary" className="text-xs">
                                      via {perm.source}
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground/70 font-mono mt-1 truncate">{perm.codename}</p>
                              </div>
                              <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

          </ScrollArea>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}
