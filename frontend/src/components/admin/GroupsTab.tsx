// GroupsTab.tsx
//
// Groups tab content for the user management page. Renders group search bar,
// groups table with action dropdowns, and all group-related dialogs (create,
// edit, delete, clone) plus the detail drawer.

import { GroupDetail, SYSTEM_ADMIN_GROUP_NAME } from '../../services/userManagement'
import { Plus, Trash2, Key, Search, Shield, Users, RefreshCw, MoreVertical, Copy, Eye } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { CreateGroupDialog } from './CreateGroupDialog'
import { DeleteGroupDialog } from './DeleteGroupDialog'
import { CloneGroupDialog } from './CloneGroupDialog'
import { GroupDetailDrawer } from './GroupDetailDrawer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

interface GroupsTabProps {
  // Data
  groupsList: GroupDetail[]
  filteredGroups: GroupDetail[]
  loadingGroups: boolean

  // Search
  groupSearchTerm: string
  setGroupSearchTerm: (value: string) => void

  // Group dialogs
  createGroupDialogOpen: boolean
  setCreateGroupDialogOpen: (value: boolean) => void
  deleteGroupDialogOpen: boolean
  setDeleteGroupDialogOpen: (value: boolean) => void
  cloneGroupDialogOpen: boolean
  setCloneGroupDialogOpen: (value: boolean) => void
  groupDetailDrawerOpen: boolean
  setGroupDetailDrawerOpen: (value: boolean) => void
  selectedGroup: GroupDetail | null
  setSelectedGroup: (group: GroupDetail | null) => void

  // Handlers
  loadGroups: () => void
  refetchGroups: () => void
  handleCreateGroup: () => void
  handleDeleteGroup: (group: GroupDetail) => void
}

export function GroupsTab(props: GroupsTabProps) {
  const {
    groupsList, filteredGroups, loadingGroups,
    groupSearchTerm, setGroupSearchTerm,
    createGroupDialogOpen, setCreateGroupDialogOpen,
    deleteGroupDialogOpen, setDeleteGroupDialogOpen,
    cloneGroupDialogOpen, setCloneGroupDialogOpen,
    groupDetailDrawerOpen, setGroupDetailDrawerOpen,
    selectedGroup, setSelectedGroup,
    loadGroups, refetchGroups, handleCreateGroup, handleDeleteGroup,
  } = props

  const onGroupSuccess = (action: string) => {
    loadGroups()
    refetchGroups()
    toast.success(`Group ${action} successfully`)
  }

  return (
    <div className="space-y-6">
      {/* Search and Actions */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            type="text"
            placeholder="Search groups..."
            value={groupSearchTerm}
            onChange={(e) => setGroupSearchTerm(e.target.value)}
            className="pl-9 h-10"
          />
        </div>
        <Button onClick={() => loadGroups()} variant="outline" size="sm" className="h-10">
          <RefreshCw className="h-4 w-4" />
        </Button>
        <Button onClick={handleCreateGroup} className="h-10">
          <Plus className="h-4 w-4 mr-2" />
          Create Group
        </Button>
      </div>

      {/* Groups Table */}
      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left py-1.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">Group</th>
                <th className="text-left py-1.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">Members</th>
                <th className="text-left py-1.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">Permissions</th>
                <th className="text-right py-1.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loadingGroups ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center">
                    <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto"></div>
                  </td>
                </tr>
              ) : filteredGroups.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center">
                    <div className="flex flex-col items-center justify-center space-y-3">
                      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                        <Shield className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="font-medium">No groups found</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          {groupSearchTerm ? 'Try adjusting your search' : 'Create a group to get started'}
                        </p>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredGroups.map((group) => (
                  <GroupRow
                    key={group.id}
                    group={group}
                    onRowClick={() => { setSelectedGroup(group); setGroupDetailDrawerOpen(true) }}
                    onViewDetails={() => { setSelectedGroup(group); setGroupDetailDrawerOpen(true) }}
                    onClone={() => { setSelectedGroup(group); setCloneGroupDialogOpen(true) }}
                    onDelete={() => handleDeleteGroup(group)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {filteredGroups.length > 0 && (
          <div className="px-4 py-1.5 border-t bg-muted/20">
            <p className="text-sm text-muted-foreground">
              Showing <span className="font-medium text-foreground">{filteredGroups.length}</span> of{' '}
              <span className="font-medium text-foreground">{groupsList.length}</span> groups
            </p>
          </div>
        )}
      </div>

      {/* Group Dialogs */}
      <CreateGroupDialog
        open={createGroupDialogOpen}
        onClose={() => setCreateGroupDialogOpen(false)}
        onSuccess={() => { onGroupSuccess('created'); setCreateGroupDialogOpen(false) }}
      />

      {selectedGroup && (
        <>
          <DeleteGroupDialog
            open={deleteGroupDialogOpen}
            onClose={() => { setDeleteGroupDialogOpen(false); setSelectedGroup(null) }}
            onSuccess={() => { onGroupSuccess('deleted'); setDeleteGroupDialogOpen(false); setSelectedGroup(null) }}
            group={selectedGroup}
          />

          <CloneGroupDialog
            open={cloneGroupDialogOpen}
            onClose={() => { setCloneGroupDialogOpen(false); setSelectedGroup(null) }}
            onSuccess={() => { onGroupSuccess('cloned'); setCloneGroupDialogOpen(false); setSelectedGroup(null) }}
            group={selectedGroup}
          />
        </>
      )}

      <GroupDetailDrawer
        open={groupDetailDrawerOpen}
        onClose={() => {
          setGroupDetailDrawerOpen(false)
          setSelectedGroup(null)
        }}
        groupId={selectedGroup?.id || null}
        onSaved={() => onGroupSuccess('updated')}
        onClone={(group) => {
          setGroupDetailDrawerOpen(false)
          setSelectedGroup(group)
          setCloneGroupDialogOpen(true)
        }}
        onDelete={(group) => {
          setGroupDetailDrawerOpen(false)
          setSelectedGroup(group)
          setDeleteGroupDialogOpen(true)
        }}
      />
    </div>
  )
}

// Single row in the groups table
function GroupRow({
  group, onRowClick, onViewDetails, onClone, onDelete,
}: {
  group: GroupDetail
  onRowClick: () => void
  onViewDetails: () => void
  onClone: () => void
  onDelete: () => void
}) {
  return (
    <tr
      className="hover:bg-muted/50 transition-colors cursor-pointer group"
      onClick={onRowClick}
    >
      <td className="py-1.5 px-4">
        <div className="flex items-center gap-2">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-medium">{group.name}</span>
              {group.name === SYSTEM_ADMIN_GROUP_NAME && (
                <Badge variant="secondary" className="text-xs">System</Badge>
              )}
              {group.user_count === 0 && (
                <Badge variant="outline" className="text-xs">Empty</Badge>
              )}
            </div>
          </div>
        </div>
      </td>
      <td className="py-1.5 px-4">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{group.user_count || 0}</span>
          {group.recent_users && group.recent_users.length > 0 && (
            <div className="flex -space-x-2 ml-1">
              {group.recent_users.slice(0, 3).map((user) => (
                <Avatar key={user.id} className="h-6 w-6 border-2 border-background">
                  <AvatarFallback className="text-[10px]">
                    {user.username.substring(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              ))}
            </div>
          )}
        </div>
      </td>
      <td className="py-1.5 px-4">
        <div className="flex items-center gap-2">
          <Key className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{group.permissions.length}</span>
        </div>
      </td>
      <td className="py-1.5 px-4">
        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onViewDetails() }} className="gap-2">
                <Eye className="h-4 w-4" />
                Open
              </DropdownMenuItem>
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onClone() }} className="gap-2">
                <Copy className="h-4 w-4" />
                Clone
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={(e) => { e.stopPropagation(); onDelete() }}
                disabled={group.name === SYSTEM_ADMIN_GROUP_NAME}
                className="gap-2 text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </td>
    </tr>
  )
}
