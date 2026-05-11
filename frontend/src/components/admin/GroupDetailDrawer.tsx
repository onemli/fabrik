// admin/GroupDetailDrawer.tsx — slide-in drawer showing group details:
// members (with search), permissions by category, quotas, and overview.

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
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
  Copy,
  Trash,
  AlertTriangle,
  CheckCircle2,
  User,
  Mail,
  Clock,
  ToggleLeft,
  Gauge,
  Search,
  CalendarClock,
  Server,
  Database,
  Download,
  Share2,
  Sparkles,
  Infinity,
  Save,
  Info,
  Minus,
  Plus,
  X,
  Pencil,
} from 'lucide-react'
import { userManagementService, GroupDetail, GroupQuotaData, SYSTEM_ADMIN_GROUP_NAME } from '@/services/userManagement'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import { formatDistanceToNow } from 'date-fns'
import { PermissionSelector, Permission } from './PermissionSelector'

interface GroupDetailDrawerProps {
  open: boolean
  onClose: () => void
  groupId: number | null
  onSaved?: () => void
  onClone?: (group: GroupDetail) => void
  onDelete?: (group: GroupDetail) => void
}

export function GroupDetailDrawer({
  open,
  onClose,
  groupId,
  onSaved,
  onClone,
  onDelete,
}: GroupDetailDrawerProps) {
  const { showLogoNotification } = useQueryBuilderStore()
  const [loading, setLoading] = useState(false)
  const [group, setGroup] = useState<GroupDetail | null>(null)
  const [quota, setQuota] = useState<GroupQuotaData | null>(null)
  const [quotaLoading, setQuotaLoading] = useState(false)
  const [quotaDirty, setQuotaDirty] = useState(false)
  const [memberSearch, setMemberSearch] = useState('')

  // ── Edit mode ────────────────────────────────────────────────────────────
  const [editMode, setEditMode] = useState(false)
  const [editName, setEditName] = useState('')
  const [editPermissionIds, setEditPermissionIds] = useState<number[]>([])
  const [allPermissions, setAllPermissions] = useState<Permission[]>([])
  const [permissionsLoading, setPermissionsLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Tracks the most recent groupId requested. Async loaders capture the id
  // they were started for and discard their own response if the active
  // groupId changed mid-flight (e.g. user opens group A, then B before A's
  // fetch settles — without this guard, A's response would overwrite B).
  const activeGroupIdRef = useRef<number | null>(null)

  useEffect(() => {
    if (open && groupId) {
      activeGroupIdRef.current = groupId
      loadGroupDetails(groupId)
      loadQuota(groupId)
      setMemberSearch('')
      setEditMode(false)
      // Reset stale state from previous group so the drawer never flashes
      // the previous group's content during the load.
      setGroup(null)
      setQuota(null)
      setQuotaDirty(false)
    } else if (!open) {
      activeGroupIdRef.current = null
    }
  }, [open, groupId])

  // Once group loads, seed the edit-form fields and (lazily) the permissions list
  useEffect(() => {
    if (group) {
      setEditName(group.name)
      setEditPermissionIds(group.permissions.map(p => p.id))
    }
  }, [group])

  useEffect(() => {
    if (editMode && allPermissions.length === 0) {
      void loadAllPermissions()
    }
  }, [editMode])

  // The Admin group bypasses RBAC via a name match in
  // IsAdminOrSuperuser / FabrikModelPermissions, so its Group.permissions
  // table is empty. Load the full permission catalogue so the drawer can
  // show the effective access set instead of "0 permissions".
  useEffect(() => {
    if (group?.name === SYSTEM_ADMIN_GROUP_NAME && allPermissions.length === 0) {
      void loadAllPermissions()
    }
  }, [group?.name, allPermissions.length])

  const loadAllPermissions = async () => {
    try {
      setPermissionsLoading(true)
      const result = await userManagementService.listPermissions({ page_size: 1000 })
      setAllPermissions((result.results || []) as unknown as Permission[])
    } catch {
      showLogoNotification({
        message: 'LOAD PERMISSIONS FAILED',
        type: 'error', statusCode: 500, duration: 2000,
      })
    } finally {
      setPermissionsLoading(false)
    }
  }

  const loadGroupDetails = async (requestedId: number) => {
    if (!requestedId) return
    try {
      setLoading(true)
      const data = await userManagementService.getGroup(requestedId)
      // Drop the response if the user has since opened a different group.
      if (activeGroupIdRef.current !== requestedId) return
      setGroup(data)
    } catch {
      if (activeGroupIdRef.current !== requestedId) return
      showLogoNotification({
        message: 'LOAD GROUP FAILED',
        type: 'error',
        statusCode: 500,
        duration: 2000,
      })
      onClose()
    } finally {
      if (activeGroupIdRef.current === requestedId) {
        setLoading(false)
      }
    }
  }

  const loadQuota = async (requestedId: number) => {
    if (!requestedId) return
    try {
      setQuotaLoading(true)
      const data = await userManagementService.getGroupQuota(requestedId)
      if (activeGroupIdRef.current !== requestedId) return
      setQuota(data)
      setQuotaDirty(false)
    } catch {
      if (activeGroupIdRef.current !== requestedId) return
      setQuota(null)
    } finally {
      if (activeGroupIdRef.current === requestedId) {
        setQuotaLoading(false)
      }
    }
  }

  const DEFAULT_QUOTA: Omit<GroupQuotaData, 'group_name'> = {
    max_saved_queries: 0,
    max_scheduled_tasks: 0,
    max_apic_connections: 0,
    max_awx_requests_daily: 0,
    max_awx_concurrent: 5,
    max_query_results: 0,
    max_export_rows: 50000,
    query_execution_daily: 0,
    can_create_queries: true,
    can_execute_queries: true,
    can_create_scheduled: true,
    can_use_awx: true,
    can_use_time_machine: true,
    can_export_data: true,
    can_share_resources: true,
    can_use_ai_builder: true,
    ai_analysis_daily: 0,
  }

  const effectiveQuota = quota || { group_name: group?.name || '', ...DEFAULT_QUOTA }

  const updateQuotaField = useCallback((field: string, value: boolean | number) => {
    setQuota(prev => {
      const base = prev || { group_name: group?.name || '', ...DEFAULT_QUOTA }
      return { ...base, [field]: value }
    })
    setQuotaDirty(true)
  }, [group])

  const isSystemGroup = group?.name === SYSTEM_ADMIN_GROUP_NAME

  // ── Edit-mode dirty tracking + save / discard ───────────────────────────
  const nameDirty = !!group && editName.trim() !== group.name
  const permsDirty = !!group && (
    editPermissionIds.length !== group.permissions.length ||
    editPermissionIds.some(id => !group.permissions.find(p => p.id === id))
  )
  const isDirty = nameDirty || permsDirty || quotaDirty

  const handleEnterEditMode = () => setEditMode(true)

  const handleDiscard = () => {
    if (!group || !groupId) return
    if (isDirty && !window.confirm('Discard unsaved changes?')) return
    setEditName(group.name)
    setEditPermissionIds(group.permissions.map(p => p.id))
    setQuotaDirty(false)
    void loadQuota(groupId)
    setEditMode(false)
  }

  const handleSave = async () => {
    if (!group || !groupId) return
    if (nameDirty && !editName.trim()) {
      showLogoNotification({
        message: 'GROUP NAME REQUIRED',
        type: 'error', statusCode: 400, duration: 2000,
      })
      return
    }

    let saveError: unknown = null
    try {
      setSaving(true)

      if (nameDirty || permsDirty) {
        await userManagementService.updateGroup(groupId, {
          name: nameDirty ? editName.trim() : group.name,
          permission_ids: editPermissionIds,
        })
      }

      if (quotaDirty && quota) {
        const { group_name: _gn, ...data } = quota
        await userManagementService.updateGroupQuota(groupId, data)
      }

      showLogoNotification({
        message: 'GROUP UPDATED',
        type: 'success', statusCode: 200, duration: 1500,
      })
      setEditMode(false)
      onSaved?.()
    } catch (error: any) {
      saveError = error
      showLogoNotification({
        message: error?.message || 'SAVE FAILED',
        type: 'error', statusCode: 500, duration: 2500,
      })
    } finally {
      setSaving(false)
      // Refresh from server in BOTH the success and failure paths so the
      // drawer always reflects what was actually persisted. If the second
      // sequential call (quota) fails after the first (group) succeeded,
      // the prior implementation would leave the form claiming dirty quota
      // changes that had not been saved on top of group changes that had.
      try {
        await Promise.all([loadGroupDetails(groupId), loadQuota(groupId)])
        setQuotaDirty(false)
      } catch {
        // loaders surface their own errors; swallow here to avoid masking saveError
      }
      // If the save partially succeeded, surface that explicitly so the user
      // knows the persisted state may differ from what they last typed.
      if (saveError) {
        // already toasted above
      }
    }
  }

  const handleRequestClose = () => {
    if (editMode && isDirty && !window.confirm('Discard unsaved changes?')) return
    setEditMode(false)
    onClose()
  }

  // For the Admin group the explicit Group.permissions list is empty by design
  // (the role bypasses the permission system entirely). Substitute the full
  // catalogue when we have it loaded so the drawer reflects effective access.
  const effectivePermissions =
    group?.name === SYSTEM_ADMIN_GROUP_NAME ? allPermissions : group?.permissions ?? []

  const permissionsByCategory = effectivePermissions.reduce((acc, perm) => {
    const category = (perm as any).category || 'Other'
    if (!acc[category]) acc[category] = []
    acc[category].push(perm)
    return acc
  }, {} as Record<string, any[]>)

  // Filtered members list
  const filteredMembers = useMemo(() => {
    if (!group) return []
    if (!memberSearch.trim()) return group.users
    const q = memberSearch.toLowerCase()
    return group.users.filter(u =>
      u.username.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q)
    )
  }, [group, memberSearch])

  if (loading || !group) {
    return (
      <Sheet open={open} onOpenChange={(v) => { if (!v) handleRequestClose() }}>
        <SheetContent className="w-[900px] sm:max-w-[900px] p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Loading group details</SheetTitle>
            <SheetDescription>Fetching group information…</SheetDescription>
          </SheetHeader>
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) handleRequestClose() }}>
      <SheetContent className="w-[900px] sm:max-w-[900px] p-0 flex flex-col">
        {/* Header */}
        <SheetHeader className="px-6 py-5 border-b">
          <div className="flex items-start justify-between">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2.5">
                <SheetTitle className="text-2xl">{group.name}</SheetTitle>
                {isSystemGroup && (
                  <Badge variant="secondary">System</Badge>
                )}
              </div>
              <SheetDescription>
                Group management and permissions
              </SheetDescription>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="flex items-center gap-5 pt-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{group.user_count} members</span>
            </div>
            <div className="flex items-center gap-2">
              <Key className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">
                {isSystemGroup ? 'All permissions' : `${group.permissions.length} permissions`}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-3">
            {!editMode ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2"
                  onClick={handleEnterEditMode}
                  disabled={isSystemGroup}
                  title={isSystemGroup ? 'System groups cannot be edited' : undefined}
                >
                  <Pencil className="h-4 w-4" /> Edit
                </Button>
                <Button size="sm" variant="outline" className="gap-2" onClick={() => onClone?.(group)}>
                  <Copy className="h-4 w-4" /> Clone
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2 text-destructive hover:text-destructive"
                  onClick={() => onDelete?.(group)}
                  disabled={isSystemGroup}
                >
                  <Trash className="h-4 w-4" /> Delete
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  className="gap-2"
                  onClick={handleSave}
                  disabled={!isDirty || saving}
                >
                  <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save changes'}
                </Button>
                <Button size="sm" variant="outline" className="gap-2" onClick={handleDiscard} disabled={saving}>
                  <X className="h-4 w-4" /> Discard
                </Button>
                {isDirty && (
                  <Badge variant="secondary" className="ml-1 text-xs">Unsaved changes</Badge>
                )}
              </>
            )}
          </div>
        </SheetHeader>

        {/* Content */}
        <Tabs defaultValue="overview" className="flex-1 flex flex-col overflow-hidden">
          <div className="px-6 pt-4">
            <TabsList className="w-full justify-start gap-6 bg-transparent p-0 h-auto border-b border-border rounded-none">
              {[
                { value: 'overview', label: 'Overview' },
                { value: 'quotas', label: 'Quotas' },
                { value: 'permissions', label: 'Permissions' },
              ].map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="relative rounded-none border-0 bg-transparent px-0 pb-2.5 pt-1 -mb-px text-sm font-medium text-muted-foreground shadow-none data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none after:absolute after:left-0 after:right-0 after:-bottom-px after:h-0.5 after:bg-primary after:scale-x-0 data-[state=active]:after:scale-x-100 after:transition-transform"
                >
                  {tab.label}
                </TabsTrigger>
              ))}
              <TabsTrigger
                value="members"
                className="relative rounded-none border-0 bg-transparent px-0 pb-2.5 pt-1 -mb-px text-sm font-medium text-muted-foreground shadow-none data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none after:absolute after:left-0 after:right-0 after:-bottom-px after:h-0.5 after:bg-primary after:scale-x-0 data-[state=active]:after:scale-x-100 after:transition-transform"
              >
                Members
                {group.user_count > 0 && (
                  <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{group.user_count}</Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          <ScrollArea className="flex-1 px-6 pb-6">
            {/* ── Overview ── */}
            <TabsContent value="overview" className="mt-4 space-y-5">
              <div className="space-y-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Group Information
                </h3>
                <div className="border rounded-lg p-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="group-name" className="text-xs text-muted-foreground">Group Name</Label>
                      {editMode && !isSystemGroup ? (
                        <Input
                          id="group-name"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="mt-1 h-8 text-sm"
                        />
                      ) : (
                        <p className="text-sm font-medium mt-0.5">{group.name}</p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Type</p>
                      <p className="text-sm font-medium mt-0.5">
                        {isSystemGroup ? 'System Group' : 'Custom Group'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold">Statistics</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="border rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground">Total Members</p>
                        <p className="text-2xl font-bold mt-1">{group.user_count}</p>
                      </div>
                      <Users className="h-8 w-8 text-muted-foreground/30" />
                    </div>
                  </div>
                  <div className="border rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground">Permissions</p>
                        {isSystemGroup ? (
                          <>
                            <p className="text-2xl font-bold mt-1">All</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Full system access
                            </p>
                          </>
                        ) : (
                          <p className="text-2xl font-bold mt-1">{group.permissions.length}</p>
                        )}
                      </div>
                      <Key className="h-8 w-8 text-muted-foreground/30" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold">Permission Summary</h3>
                {isSystemGroup && (
                  <div className="flex items-start gap-3 rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
                    <Info className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-blue-500">System role</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Admin members bypass the permission system and have access to every
                        feature. Per-category counts below reflect the effective permission
                        catalogue, not explicit grants on this group.
                      </p>
                    </div>
                  </div>
                )}
                <div className="border rounded-lg divide-y">
                  {Object.entries(permissionsByCategory).map(([category, perms]) => (
                    <div key={category} className="px-4 py-3 flex items-center justify-between">
                      <span className="text-sm font-medium">{category}</span>
                      <Badge variant="secondary">{perms.length}</Badge>
                    </div>
                  ))}
                  {Object.keys(permissionsByCategory).length === 0 && (
                    <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                      {isSystemGroup ? 'Loading permission catalogue…' : 'No permissions assigned'}
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* ── Quotas ── */}
            <TabsContent value="quotas" className="mt-4 space-y-6">
              {quotaLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
              ) : (
                <>
                  {!quota && (
                    <div className="flex items-start gap-3 rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
                      <Info className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-blue-500">No quota configured</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          This group uses system defaults. All features enabled, no limits.
                          Configure below to set restrictions.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Feature Access — two-column grid */}
                  <div className="space-y-3">
                    <h3 className="font-semibold flex items-center gap-2">
                      <ToggleLeft className="h-4 w-4" />
                      Feature Access
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Control which platform features are available to members of this group.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {([
                        ['can_create_queries', 'Create Queries', 'Create and save new queries', Search],
                        ['can_execute_queries', 'Execute Queries', 'Run queries against APIC', Database],
                        ['can_create_scheduled', 'Scheduled Tasks', 'Create scheduled query tasks', CalendarClock],
                        ['can_use_awx', 'AWX Automation', 'Access Ansible AWX automation', Server],
                        ['can_use_time_machine', 'Time Machine', 'Access config snapshots', Clock],
                        ['can_export_data', 'Export Data', 'Export results to CSV/JSON', Download],
                        ['can_share_resources', 'Share Resources', 'Share queries with others', Share2],
                        ['can_use_ai_builder', 'AI Builder', 'AI-assisted class suggestions', Sparkles],
                      ] as const).map(([field, label, description, Icon]) => {
                        const enabled = (effectiveQuota as any)[field] ?? true
                        return (
                          <div
                            key={field}
                            className={`flex items-center justify-between p-3 rounded-lg border gap-3 ${
                              enabled ? 'border-border' : 'border-border/50 opacity-60'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className={`h-8 w-8 rounded-md flex items-center justify-center shrink-0 ${
                                enabled ? 'bg-primary/10' : 'bg-muted'
                              }`}>
                                <Icon className={`h-4 w-4 ${enabled ? 'text-primary' : 'text-muted-foreground/50'}`} />
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium leading-tight">{label}</p>
                                <p className="text-[11px] text-muted-foreground truncate">{description}</p>
                              </div>
                            </div>
                            <Switch
                              checked={enabled}
                              onCheckedChange={(v) => updateQuotaField(field, v)}
                              disabled={!editMode}
                            />
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Resource Limits — two-column grid per section */}
                  <div className="space-y-4">
                    <h3 className="font-semibold flex items-center gap-2">
                      <Gauge className="h-4 w-4" />
                      Resource Limits
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Set maximum resource counts per user. Most permissive group wins for users in multiple groups.
                    </p>

                    {/* Storage */}
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium text-muted-foreground">Storage</h4>
                      <div className="grid grid-cols-2 gap-3">
                        {([
                          ['max_saved_queries', 'Max Saved Queries'],
                          ['max_scheduled_tasks', 'Max Scheduled Tasks'],
                          ['max_apic_connections', 'Max APIC Connections'],
                        ] as const).map(([field, label]) => {
                          const val = (effectiveQuota as any)[field] ?? 0
                          return (
                            <div key={field} className="border rounded-lg p-3">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-medium">{label}</p>
                                <div className="flex items-center gap-1.5">
                                  {val === 0 && <Infinity className="h-3.5 w-3.5 text-muted-foreground" />}
                                  <QuotaNumberInput
                                    value={val}
                                    onChange={(next) => updateQuotaField(field, next)}
                                    disabled={!editMode}
                                  />
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {/* Daily Execution */}
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium text-muted-foreground">Daily Execution</h4>
                      <div className="grid grid-cols-2 gap-3">
                        {([
                          ['query_execution_daily', 'Daily Query Runs'],
                          ['max_awx_requests_daily', 'Daily AWX Requests'],
                          ['max_awx_concurrent', 'AWX Concurrent Jobs'],
                          ['ai_analysis_daily', 'Daily AI Suggestions'],
                        ] as const).map(([field, label]) => {
                          const val = (effectiveQuota as any)[field] ?? 0
                          return (
                            <div key={field} className="border rounded-lg p-3">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-medium">{label}</p>
                                <div className="flex items-center gap-1.5">
                                  {val === 0 && <Infinity className="h-3.5 w-3.5 text-muted-foreground" />}
                                  <QuotaNumberInput
                                    value={val}
                                    onChange={(next) => updateQuotaField(field, next)}
                                    disabled={!editMode}
                                  />
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {/* Output */}
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium text-muted-foreground">Output</h4>
                      <div className="grid grid-cols-2 gap-3">
                        {([
                          ['max_query_results', 'Max Query Results'],
                          ['max_export_rows', 'Max Export Rows'],
                        ] as const).map(([field, label]) => {
                          const val = (effectiveQuota as any)[field] ?? 0
                          return (
                            <div key={field} className="border rounded-lg p-3">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-medium">{label}</p>
                                <div className="flex items-center gap-1.5">
                                  {val === 0 && <Infinity className="h-3.5 w-3.5 text-muted-foreground" />}
                                  <QuotaNumberInput
                                    value={val}
                                    onChange={(next) => updateQuotaField(field, next)}
                                    disabled={!editMode}
                                  />
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                      <Infinity className="h-3.5 w-3.5 shrink-0" />
                      <span><span className="font-mono font-medium">0</span> = unlimited, no restriction applied.</span>
                    </div>
                    {!editMode && (
                      <p className="text-xs text-muted-foreground italic">
                        Click <span className="font-medium not-italic">Edit</span> in the header to change these values.
                      </p>
                    )}
                  </div>
                </>
              )}
            </TabsContent>

            {/* ── Permissions ── */}
            <TabsContent value="permissions" className="mt-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">
                  {editMode
                    ? 'Manage Permissions'
                    : isSystemGroup
                      ? 'Effective Permissions (All)'
                      : `All Permissions (${group.permissions.length})`}
                </h3>
                {editMode && permsDirty && (
                  <Badge variant="secondary" className="text-xs">{editPermissionIds.length} selected</Badge>
                )}
              </div>

              {!editMode && isSystemGroup && (
                <div className="flex items-start gap-3 rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
                  <Info className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-blue-500">Implicit full access</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Admin is a system role — its members bypass the permission system and
                      can use every feature regardless of explicit grants. The list below
                      shows the catalogue of permissions that effectively apply to Admin
                      members; it can't be edited here.
                    </p>
                  </div>
                </div>
              )}

              {editMode ? (
                <PermissionSelector
                  permissions={allPermissions}
                  selectedIds={editPermissionIds}
                  onSelectionChange={setEditPermissionIds}
                  isLoading={permissionsLoading}
                />
              ) : (
              <div className="space-y-4">
                {Object.entries(permissionsByCategory).map(([category, perms]) => (
                  <div key={category} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium text-sm">{category}</h4>
                      <Badge variant="outline" className="text-xs">{perms.length}</Badge>
                    </div>
                    <div className="border rounded-lg divide-y">
                      {perms.map((perm: any) => (
                        <div key={perm.id} className="p-3 space-y-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium">{perm.name}</p>
                                {perm.is_dangerous && (
                                  <Badge variant="destructive" className="text-xs gap-1">
                                    <AlertTriangle className="h-3 w-3" />
                                    Dangerous
                                  </Badge>
                                )}
                              </div>
                              {perm.description && (
                                <p className="text-xs text-muted-foreground mt-1">{perm.description}</p>
                              )}
                              <p className="text-xs text-muted-foreground/70 font-mono mt-1">{perm.codename}</p>
                            </div>
                            <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {Object.keys(permissionsByCategory).length === 0 && (
                  <div className="border rounded-lg p-8 text-center">
                    <Key className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">
                      {isSystemGroup ? 'Loading permission catalogue…' : 'No permissions assigned'}
                    </p>
                  </div>
                )}
              </div>
              )}
            </TabsContent>

            {/* ── Members ── */}
            <TabsContent value="members" className="mt-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold shrink-0">Members ({group.user_count})</h3>
                {group.users.length > 3 && (
                  <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by name or email..."
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      className="pl-9 h-9"
                    />
                  </div>
                )}
              </div>

              {group.users.length === 0 ? (
                <div className="border rounded-lg p-8 text-center">
                  <Users className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No members in this group</p>
                </div>
              ) : filteredMembers.length === 0 ? (
                <div className="border rounded-lg p-8 text-center">
                  <Search className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">
                    No members matching "{memberSearch}"
                  </p>
                </div>
              ) : (
                <div className="border rounded-lg divide-y">
                  {filteredMembers.map((user) => (
                    <div key={user.id} className="p-4 flex items-start gap-3">
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <User className="h-5 w-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm">{user.username}</p>
                          {!user.is_active && (
                            <Badge variant="secondary" className="text-xs">Inactive</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <Mail className="h-3 w-3 text-muted-foreground" />
                          <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                        </div>
                        {(user as any).last_login && (
                          <div className="flex items-center gap-2 mt-1">
                            <Clock className="h-3 w-3 text-muted-foreground" />
                            <p className="text-xs text-muted-foreground">
                              Last login {formatDistanceToNow(new Date((user as any).last_login), { addSuffix: true })}
                            </p>
                          </div>
                        )}
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

interface QuotaNumberInputProps {
  value: number
  onChange: (next: number) => void
  min?: number
  disabled?: boolean
}

function QuotaNumberInput({ value, onChange, min = 0, disabled = false }: QuotaNumberInputProps) {
  const dec = () => onChange(Math.max(min, value - 1))
  const inc = () => onChange(value + 1)
  return (
    <div className={`inline-flex items-center rounded-md border border-input bg-background overflow-hidden h-8 ${disabled ? 'opacity-60' : ''}`}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={dec}
        disabled={disabled || value <= min}
        className="h-full w-7 rounded-none border-r border-input hover:bg-muted"
      >
        <Minus className="h-3.5 w-3.5" />
      </Button>
      <Input
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value) || 0)}
        disabled={disabled}
        className="w-14 h-full border-0 rounded-none text-center text-sm font-mono px-1 focus-visible:ring-0 focus-visible:ring-offset-0"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={inc}
        disabled={disabled}
        className="h-full w-7 rounded-none border-l border-input hover:bg-muted"
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
