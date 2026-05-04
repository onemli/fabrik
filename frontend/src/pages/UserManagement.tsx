// UserManagement.tsx
//
// Admin-only user and group management page. Supports creating users, assigning
// groups/roles, resetting passwords, and enabling/disabling accounts. RBAC-gated —
// regular users can't reach this page.

import { Shield, Users, RefreshCw } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { useUserManagement } from '@/hooks/useUserManagement'
import { UsersTab } from '@/components/admin/UsersTab'
import { GroupsTab } from '@/components/admin/GroupsTab'

export default function UserManagement() {
  const mgmt = useUserManagement()

  if (!mgmt.isAdmin) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-full bg-red-50 dark:bg-red-950 flex items-center justify-center">
            <Shield className="h-8 w-8 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold mb-2">Access Denied</h1>
            <p className="text-muted-foreground">You don't have permission to access this page.</p>
          </div>
        </div>
      </div>
    )
  }

  if (mgmt.isLoadingUsers) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-sm text-muted-foreground">Loading users...</p>
        </div>
      </div>
    )
  }

  if (mgmt.usersError) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-full bg-red-50 dark:bg-red-950 flex items-center justify-center">
            <div className="text-2xl">&#9888;&#65039;</div>
          </div>
          <div>
            <h2 className="text-xl font-semibold mb-2">Error Loading Users</h2>
            <p className="text-muted-foreground mb-4">{(mgmt.usersError as Error).message}</p>
            <Button onClick={() => mgmt.refetchUsers()} variant="outline">
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex-1 overflow-auto">
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Team Management</h1>
              <p className="text-sm text-muted-foreground mt-1">Manage users, permissions, and access control</p>
            </div>
            <Button onClick={() => mgmt.refetchUsers()} variant="ghost" size="sm">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>

          <Tabs defaultValue="users" className="space-y-6">
            <TabsList className="bg-muted/50">
              <TabsTrigger value="users" className="gap-2 data-[state=active]:bg-background">
                <Users className="h-4 w-4" />
                Users
              </TabsTrigger>
              <TabsTrigger value="groups" className="gap-2 data-[state=active]:bg-background">
                <Shield className="h-4 w-4" />
                Groups
              </TabsTrigger>
            </TabsList>

            <TabsContent value="users" className="space-y-6 mt-0">
              <UsersTab
                users={mgmt.users}
                filteredUsers={mgmt.filteredUsers}
                groups={mgmt.groups}
                allPermissions={mgmt.allPermissions}
                stats={mgmt.stats}
                currentUser={mgmt.currentUser}
                searchQuery={mgmt.searchQuery}
                setSearchQuery={mgmt.setSearchQuery}
                filterGroup={mgmt.filterGroup}
                setFilterGroup={mgmt.setFilterGroup}
                filterActive={mgmt.filterActive}
                setFilterActive={mgmt.setFilterActive}
                filterPermission={mgmt.filterPermission}
                setFilterPermission={mgmt.setFilterPermission}
                showCreateDialog={mgmt.showCreateDialog}
                setShowCreateDialog={mgmt.setShowCreateDialog}
                createFormData={mgmt.createFormData}
                setCreateFormData={mgmt.setCreateFormData}
                handleCreate={mgmt.handleCreate}
                resetCreateForm={mgmt.resetCreateForm}
                isCreatePending={mgmt.createMutation.isPending}
                editingUser={mgmt.editingUser}
                setEditingUser={mgmt.setEditingUser}
                updateFormData={mgmt.updateFormData}
                setUpdateFormData={mgmt.setUpdateFormData}
                handleUpdate={mgmt.handleUpdate}
                resetUpdateForm={mgmt.resetUpdateForm}
                handleEdit={mgmt.handleEdit}
                isUpdatePending={mgmt.updateMutation.isPending}
                resetPasswordUser={mgmt.resetPasswordUser}
                setResetPasswordUser={mgmt.setResetPasswordUser}
                passwordFormData={mgmt.passwordFormData}
                setPasswordFormData={mgmt.setPasswordFormData}
                handleResetPassword={mgmt.handleResetPassword}
                isResetPasswordPending={mgmt.resetPasswordMutation.isPending}
                deleteConfirm={mgmt.deleteConfirm}
                setDeleteConfirm={mgmt.setDeleteConfirm}
                onDeleteConfirm={(id) => mgmt.deleteMutation.mutate(id)}
                detailDrawerOpen={mgmt.detailDrawerOpen}
                setDetailDrawerOpen={mgmt.setDetailDrawerOpen}
                detailUserId={mgmt.detailUserId}
                setDetailUserId={mgmt.setDetailUserId}
                handleToggleActive={mgmt.handleToggleActive}
                handleGenerateResetCode={mgmt.handleGenerateResetCode}
                handleAdminVerifyEmail={mgmt.handleAdminVerifyEmail}
                handleAdminDisableMfa={mgmt.handleAdminDisableMfa}
                getInitials={mgmt.getInitials}
              />
            </TabsContent>

            <TabsContent value="groups" className="space-y-6 mt-0">
              <GroupsTab
                groupsList={mgmt.groupsList}
                filteredGroups={mgmt.filteredGroups}
                loadingGroups={mgmt.loadingGroups}
                groupSearchTerm={mgmt.groupSearchTerm}
                setGroupSearchTerm={mgmt.setGroupSearchTerm}
                createGroupDialogOpen={mgmt.createGroupDialogOpen}
                setCreateGroupDialogOpen={mgmt.setCreateGroupDialogOpen}
                deleteGroupDialogOpen={mgmt.deleteGroupDialogOpen}
                setDeleteGroupDialogOpen={mgmt.setDeleteGroupDialogOpen}
                cloneGroupDialogOpen={mgmt.cloneGroupDialogOpen}
                setCloneGroupDialogOpen={mgmt.setCloneGroupDialogOpen}
                groupDetailDrawerOpen={mgmt.groupDetailDrawerOpen}
                setGroupDetailDrawerOpen={mgmt.setGroupDetailDrawerOpen}
                selectedGroup={mgmt.selectedGroup}
                setSelectedGroup={mgmt.setSelectedGroup}
                loadGroups={mgmt.loadGroups}
                refetchGroups={mgmt.refetchGroups}
                handleCreateGroup={mgmt.handleCreateGroup}
                handleDeleteGroup={mgmt.handleDeleteGroup}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  )
}
