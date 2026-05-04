// UsersTab.tsx
//
// Users tab content for the user management page. Renders stats cards, filters,
// user table with action dropdowns, and all user-related dialogs (create, edit,
// reset password, delete confirm, detail drawer).

import { UserManagementUser, CreateUserData, UpdateUserData, PasswordResetData } from '../../services/userManagement'
import { Plus, Trash2, Edit, UserX, UserCheck, Key, Search, Shield, Users, MoreVertical, Activity, ShieldOff, MailCheck, KeyRound } from 'lucide-react'
import { ConfirmDialog } from '../ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { UserDetailDrawer } from './UserDetailDrawer'
import { UserFormDialog } from './UserFormDialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useFormatters } from '@/contexts/TimezoneContext'

interface GroupOption { id: number; name: string }
interface PermissionOption { id: number; codename: string }
interface Stats { totalUsers: number; activeUsers: number; adminUsers: number; totalQueries: number }

export interface UsersTabProps {
  users: UserManagementUser[]
  filteredUsers: UserManagementUser[]
  groups: GroupOption[]
  allPermissions: PermissionOption[]
  stats: Stats
  currentUser: { id: number } | null | undefined

  searchQuery: string
  setSearchQuery: (value: string) => void
  filterGroup: string
  setFilterGroup: (value: string) => void
  filterActive: string
  setFilterActive: (value: string) => void
  filterPermission: string
  setFilterPermission: (value: string) => void

  showCreateDialog: boolean
  setShowCreateDialog: (value: boolean) => void
  createFormData: CreateUserData
  setCreateFormData: (value: CreateUserData) => void
  handleCreate: () => void
  resetCreateForm: () => void
  isCreatePending: boolean

  editingUser: UserManagementUser | null
  setEditingUser: (value: UserManagementUser | null) => void
  updateFormData: UpdateUserData
  setUpdateFormData: (value: UpdateUserData) => void
  handleUpdate: () => void
  resetUpdateForm: () => void
  handleEdit: (user: UserManagementUser) => void
  isUpdatePending: boolean

  resetPasswordUser: UserManagementUser | null
  setResetPasswordUser: (value: UserManagementUser | null) => void
  passwordFormData: PasswordResetData
  setPasswordFormData: (value: PasswordResetData) => void
  handleResetPassword: () => void
  isResetPasswordPending: boolean

  deleteConfirm: UserManagementUser | null
  setDeleteConfirm: (value: UserManagementUser | null) => void
  onDeleteConfirm: (id: number) => void

  detailDrawerOpen: boolean
  setDetailDrawerOpen: (value: boolean) => void
  detailUserId: number | null
  setDetailUserId: (value: number | null) => void

  handleToggleActive: (user: UserManagementUser) => void
  handleGenerateResetCode: (user: UserManagementUser) => void
  handleAdminVerifyEmail: (user: UserManagementUser) => void
  handleAdminDisableMfa: (user: UserManagementUser) => void
  getInitials: (firstName: string, lastName: string, username: string) => string
}

export function UsersTab(props: UsersTabProps) {
  const {
    users, filteredUsers, groups, allPermissions, stats, currentUser,
    searchQuery, setSearchQuery, filterGroup, setFilterGroup,
    filterActive, setFilterActive, filterPermission, setFilterPermission,
    showCreateDialog, setShowCreateDialog, createFormData, setCreateFormData,
    handleCreate, resetCreateForm, isCreatePending,
    editingUser, setEditingUser, updateFormData, setUpdateFormData,
    handleUpdate, resetUpdateForm, handleEdit, isUpdatePending,
    resetPasswordUser, setResetPasswordUser, passwordFormData, setPasswordFormData,
    handleResetPassword, isResetPasswordPending,
    deleteConfirm, setDeleteConfirm, onDeleteConfirm,
    detailDrawerOpen, setDetailDrawerOpen, detailUserId, setDetailUserId,
    handleToggleActive, handleGenerateResetCode, handleAdminVerifyEmail,
    handleAdminDisableMfa, getInitials,
  } = props

  return (
    <div className="space-y-6">
      <StatsCards stats={stats} />
      <FiltersBar
        searchQuery={searchQuery} setSearchQuery={setSearchQuery}
        filterGroup={filterGroup} setFilterGroup={setFilterGroup}
        filterActive={filterActive} setFilterActive={setFilterActive}
        filterPermission={filterPermission} setFilterPermission={setFilterPermission}
        groups={groups} allPermissions={allPermissions}
        onAddUser={() => setShowCreateDialog(true)}
      />

      {/* Users Table */}
      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left py-1.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">User</th>
                <th className="text-left py-1.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">Groups</th>
                <th className="text-left py-1.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="text-left py-1.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">Queries</th>
                <th className="text-left py-1.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">Last Login</th>
                <th className="text-right py-1.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredUsers.length === 0 ? (
                <EmptyUsersRow hasFilters={!!(searchQuery || filterGroup !== 'all' || filterActive !== 'all')} />
              ) : (
                filteredUsers.map((user) => (
                  <UserRow
                    key={user.id} user={user} currentUserId={currentUser?.id}
                    onViewPermissions={() => { setDetailUserId(user.id); setDetailDrawerOpen(true) }}
                    onEdit={() => handleEdit(user)}
                    onResetPassword={() => setResetPasswordUser(user)}
                    onGenerateResetCode={() => handleGenerateResetCode(user)}
                    onVerifyEmail={() => handleAdminVerifyEmail(user)}
                    onDisableMfa={() => handleAdminDisableMfa(user)}
                    onToggleActive={() => handleToggleActive(user)}
                    onDelete={() => setDeleteConfirm(user)}
                    getInitials={getInitials}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
        {filteredUsers.length > 0 && (
          <div className="px-4 py-1.5 border-t bg-muted/20">
            <p className="text-sm text-muted-foreground">
              Showing <span className="font-medium text-foreground">{filteredUsers.length}</span> of{' '}
              <span className="font-medium text-foreground">{users.length}</span> users
            </p>
          </div>
        )}
      </div>

      {showCreateDialog && (
        <UserFormDialog
          title="Create New User" groups={groups}
          formData={createFormData}
          setFormData={(patch) => setCreateFormData({ ...createFormData, ...patch })}
          onSubmit={handleCreate}
          onCancel={() => { setShowCreateDialog(false); resetCreateForm() }}
          isPending={isCreatePending} submitLabel="Create User" pendingLabel="Creating..." isCreate
        />
      )}

      {editingUser && (
        <UserFormDialog
          title={`Edit User: ${editingUser.username}`} groups={groups}
          formData={updateFormData}
          setFormData={(patch) => setUpdateFormData({ ...updateFormData, ...patch })}
          onSubmit={handleUpdate}
          onCancel={() => { setEditingUser(null); resetUpdateForm() }}
          isPending={isUpdatePending} submitLabel="Save Changes" pendingLabel="Saving..."
        />
      )}

      {resetPasswordUser && (
        <ResetPasswordDialog
          username={resetPasswordUser.username}
          passwordFormData={passwordFormData}
          setPasswordFormData={setPasswordFormData}
          onSubmit={handleResetPassword}
          onCancel={() => { setResetPasswordUser(null); setPasswordFormData({ new_password: '', new_password_confirm: '' }) }}
          isPending={isResetPasswordPending}
        />
      )}

      {deleteConfirm && (
        <ConfirmDialog
          isOpen={true}
          onClose={() => setDeleteConfirm(null)}
          onConfirm={() => onDeleteConfirm(deleteConfirm.id)}
          title="Delete User"
          message={`Are you sure you want to delete ${deleteConfirm.username}? This action cannot be undone.`}
          confirmText="Delete" variant="danger"
        />
      )}

      <UserDetailDrawer
        open={detailDrawerOpen}
        onClose={() => { setDetailDrawerOpen(false); setDetailUserId(null) }}
        userId={detailUserId}
        onEdit={(u) => { setDetailDrawerOpen(false); handleEdit(u) }}
      />
    </div>
  )
}

function StatsCards({ stats }: { stats: Stats }) {
  const cards = [
    { label: 'Total Users', value: stats.totalUsers, icon: <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />, bg: 'bg-blue-50 dark:bg-blue-950' },
    { label: 'Active', value: stats.activeUsers, icon: <Activity className="h-5 w-5 text-green-600 dark:text-green-400" />, bg: 'bg-green-50 dark:bg-green-950' },
    { label: 'Admins', value: stats.adminUsers, icon: <Shield className="h-5 w-5 text-purple-600 dark:text-purple-400" />, bg: 'bg-purple-50 dark:bg-purple-950' },
    { label: 'Total Queries', value: stats.totalQueries, icon: <Activity className="h-5 w-5 text-orange-600 dark:text-orange-400" />, bg: 'bg-orange-50 dark:bg-orange-950' },
  ]
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(({ label, value, icon, bg }) => (
        <div key={label} className="bg-card border rounded-lg p-5 hover:shadow-sm transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">{label}</p>
              <p className="text-2xl font-semibold mt-1">{value}</p>
            </div>
            <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center`}>{icon}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
function FiltersBar({ searchQuery, setSearchQuery, filterGroup, setFilterGroup, filterActive, setFilterActive, filterPermission, setFilterPermission, groups, allPermissions, onAddUser }: {
  searchQuery: string; setSearchQuery: (v: string) => void
  filterGroup: string; setFilterGroup: (v: string) => void
  filterActive: string; setFilterActive: (v: string) => void
  filterPermission: string; setFilterPermission: (v: string) => void
  groups: GroupOption[]; allPermissions: PermissionOption[]
  onAddUser: () => void
}) {
  return (
    <div className="flex flex-col sm:flex-row gap-3">
      <div className="flex-1 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input type="text" placeholder="Search users..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9 h-10" />
      </div>
      <Select value={filterGroup} onValueChange={setFilterGroup}>
        <SelectTrigger className="w-full sm:w-[160px] h-10"><SelectValue placeholder="All Groups" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Groups</SelectItem>
          {groups.map(g => <SelectItem key={g.id} value={g.id.toString()}>{g.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={filterActive} onValueChange={setFilterActive}>
        <SelectTrigger className="w-full sm:w-[140px] h-10"><SelectValue placeholder="All Status" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="inactive">Inactive</SelectItem>
        </SelectContent>
      </Select>
      <Select value={filterPermission} onValueChange={setFilterPermission}>
        <SelectTrigger className="w-full sm:w-[180px] h-10"><SelectValue placeholder="Filter by Permission" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Permissions</SelectItem>
          {allPermissions.map(p => <SelectItem key={p.id} value={p.id.toString()}>{p.codename}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button onClick={onAddUser} className="h-10"><Plus className="h-4 w-4 mr-2" />Add User</Button>
    </div>
  )
}
function EmptyUsersRow({ hasFilters }: { hasFilters: boolean }) {
  return (
    <tr>
      <td colSpan={6} className="py-12 text-center">
        <div className="flex flex-col items-center justify-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
            <Users className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium">No users found</p>
            <p className="text-sm text-muted-foreground mt-1">
              {hasFilters ? 'Try adjusting your filters' : 'Get started by creating your first user'}
            </p>
          </div>
        </div>
      </td>
    </tr>
  )
}
function UserRow({ user, currentUserId, onViewPermissions, onEdit, onResetPassword, onGenerateResetCode, onVerifyEmail, onDisableMfa, onToggleActive, onDelete, getInitials }: {
  user: UserManagementUser; currentUserId: number | undefined
  onViewPermissions: () => void; onEdit: () => void; onResetPassword: () => void
  onGenerateResetCode: () => void; onVerifyEmail: () => void; onDisableMfa: () => void
  onToggleActive: () => void; onDelete: () => void
  getInitials: (f: string, l: string, u: string) => string
}) {
  const { formatDate } = useFormatters()
  const isCurrentUser = user.id === currentUserId
  const isAdminUser = user.is_superuser || user.groups.some(g => g.name === 'Admin')

  return (
    <tr className="hover:bg-muted/30 transition-colors">
      <td className="py-1.5 px-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-primary text-primary-foreground ring-1 ring-border flex items-center justify-center text-sm font-medium flex-shrink-0">
            {getInitials(user.first_name, user.last_name, user.username)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-medium truncate">{user.username}</p>
              {isAdminUser && <Shield className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />}
            </div>
            <p className="text-sm text-muted-foreground truncate">{user.email}</p>
          </div>
        </div>
      </td>
      <td className="py-1.5 px-4">
        <div className="flex flex-wrap gap-1">
          {user.groups.length === 0
            ? <span className="text-sm text-muted-foreground">&mdash;</span>
            : user.groups.slice(0, 2).map(g => (
              <Badge key={g.id} variant={g.name === 'Admin' ? 'default' : 'secondary'} className="text-xs font-normal">{g.name}</Badge>
            ))
          }
          {user.groups.length > 2 && <Badge variant="outline" className="text-xs font-normal">+{user.groups.length - 2}</Badge>}
        </div>
      </td>
      <td className="py-1.5 px-4">
        <Badge variant={user.is_active ? 'default' : 'secondary'} className={`text-xs font-normal ${user.is_active ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : ''}`}>
          {user.is_active ? 'Active' : 'Inactive'}
        </Badge>
      </td>
      <td className="py-1.5 px-4"><span className="text-sm">{user.query_count}</span></td>
      <td className="py-1.5 px-4">
        <span className="text-sm text-muted-foreground">
          {user.last_login ? formatDate(user.last_login) : '\u2014'}
        </span>
      </td>
      <td className="py-1.5 px-4">
        <div className="flex items-center justify-end gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0"><MoreVertical className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={onViewPermissions}><Shield className="h-4 w-4 mr-2" />View Permissions</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onEdit}><Edit className="h-4 w-4 mr-2" />Edit User</DropdownMenuItem>
              <DropdownMenuItem onClick={onResetPassword}><Key className="h-4 w-4 mr-2" />Reset Password</DropdownMenuItem>
              <DropdownMenuItem onClick={onGenerateResetCode}><KeyRound className="h-4 w-4 mr-2" />Generate Reset Code</DropdownMenuItem>
              <DropdownMenuItem onClick={onVerifyEmail}><MailCheck className="h-4 w-4 mr-2" />Verify Email</DropdownMenuItem>
              <DropdownMenuItem onClick={onDisableMfa}><ShieldOff className="h-4 w-4 mr-2" />Disable MFA</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onToggleActive} disabled={isCurrentUser}>
                {user.is_active ? <><UserX className="h-4 w-4 mr-2" />Deactivate</> : <><UserCheck className="h-4 w-4 mr-2" />Activate</>}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onDelete} disabled={isCurrentUser} className="text-red-600 focus:text-red-600">
                <Trash2 className="h-4 w-4 mr-2" />Delete User
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </td>
    </tr>
  )
}
function ResetPasswordDialog({ username, passwordFormData, setPasswordFormData, onSubmit, onCancel, isPending }: {
  username: string
  passwordFormData: PasswordResetData
  setPasswordFormData: (data: PasswordResetData) => void
  onSubmit: () => void; onCancel: () => void; isPending: boolean
}) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-xl border shadow-2xl max-w-md w-full p-6">
        <h2 className="text-xl font-semibold mb-6">Reset Password: {username}</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">New Password</label>
            <Input type="password" value={passwordFormData.new_password} onChange={(e) => setPasswordFormData({ ...passwordFormData, new_password: e.target.value })} placeholder="••••••••" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Confirm New Password</label>
            <Input type="password" value={passwordFormData.new_password_confirm} onChange={(e) => setPasswordFormData({ ...passwordFormData, new_password_confirm: e.target.value })} placeholder="••••••••" />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-6 border-t">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={onSubmit} disabled={isPending}>{isPending ? 'Resetting...' : 'Reset Password'}</Button>
        </div>
      </div>
    </div>
  )
}
