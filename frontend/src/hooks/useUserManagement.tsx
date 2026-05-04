// useUserManagement.ts
//
// All state, queries, mutations, and handlers for the user management page.
// Extracted from UserManagement.tsx to keep the page component thin.

import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  userManagementService,
  UserManagementUser,
  CreateUserData,
  UpdateUserData,
  PasswordResetData,
  GroupDetail,
  SYSTEM_ADMIN_GROUP_NAME,
} from '../services/userManagement'
import { usePermissions } from './usePermissions'
import { useDebounce } from './useDebounce'
import { toast } from 'sonner'
import { useFormatters } from '@/contexts/TimezoneContext'

export function useUserManagement() {
  const queryClient = useQueryClient()
  const { isAdmin, user: currentUser } = usePermissions()
  const { formatTime } = useFormatters()

  // User tab state
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [editingUser, setEditingUser] = useState<UserManagementUser | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<UserManagementUser | null>(null)
  const [resetPasswordUser, setResetPasswordUser] = useState<UserManagementUser | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterGroup, setFilterGroup] = useState<string>('all')
  const [filterActive, setFilterActive] = useState<string>('all')
  const [filterPermission, setFilterPermission] = useState<string>('all')
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false)
  const [detailUserId, setDetailUserId] = useState<number | null>(null)

  const debouncedSearch = useDebounce(searchQuery, 300)

  // Group tab state
  const [groupsList, setGroupsList] = useState<GroupDetail[]>([])
  const [loadingGroups, setLoadingGroups] = useState(true)
  const [groupSearchTerm, setGroupSearchTerm] = useState('')
  const [createGroupDialogOpen, setCreateGroupDialogOpen] = useState(false)
  const [deleteGroupDialogOpen, setDeleteGroupDialogOpen] = useState(false)
  const [cloneGroupDialogOpen, setCloneGroupDialogOpen] = useState(false)
  const [groupDetailDrawerOpen, setGroupDetailDrawerOpen] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState<GroupDetail | null>(null)

  const debouncedGroupSearch = useDebounce(groupSearchTerm, 300)

  // Form state
  const [createFormData, setCreateFormData] = useState<CreateUserData>({
    username: '',
    email: '',
    password: '',
    password_confirm: '',
    first_name: '',
    last_name: '',
    is_active: true,
    group_ids: [],
  })

  const [updateFormData, setUpdateFormData] = useState<UpdateUserData>({
    email: '',
    first_name: '',
    last_name: '',
    is_active: true,
    group_ids: [],
  })

  const [passwordFormData, setPasswordFormData] = useState<PasswordResetData>({
    new_password: '',
    new_password_confirm: '',
  })

  // Queries
  const {
    data: usersResponse,
    isLoading: isLoadingUsers,
    refetch: refetchUsers,
    error: usersError,
  } = useQuery({
    queryKey: ['users', filterPermission],
    queryFn: () => userManagementService.listUsers({
      permission_id: filterPermission !== 'all' ? parseInt(filterPermission) : undefined,
    }),
    enabled: isAdmin,
  })

  const users = usersResponse?.results || []

  const { data: groupsResponse, refetch: refetchGroups } = useQuery({
    queryKey: ['groups'],
    queryFn: () => userManagementService.listGroups(),
    enabled: isAdmin,
  })

  const groups = groupsResponse?.results || []

  const { data: permissionsResponse } = useQuery({
    queryKey: ['permissions-all'],
    queryFn: () => userManagementService.listPermissions({ page_size: 1000 }),
    enabled: isAdmin,
  })

  const allPermissions = permissionsResponse?.results || []

  // Client-side filtering
  const filteredUsers = useMemo(() => {
    return users.filter(user => {
      const matchesSearch = !debouncedSearch ||
        user.username.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        user.email.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        (user.first_name || '').toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        (user.last_name || '').toLowerCase().includes(debouncedSearch.toLowerCase())

      const matchesGroup = filterGroup === 'all' ||
        (user.groups && user.groups.some(g => g.id.toString() === filterGroup))

      const matchesStatus = filterActive === 'all' ||
        (filterActive === 'active' && user.is_active) ||
        (filterActive === 'inactive' && !user.is_active)

      return matchesSearch && matchesGroup && matchesStatus
    })
  }, [users, debouncedSearch, filterGroup, filterActive])

  // Statistics
  const stats = useMemo(() => {
    const totalUsers = users.length
    const activeUsers = users.filter(u => u.is_active).length
    const adminUsers = users.filter(u => u.is_superuser || u.groups.some(g => g.name === SYSTEM_ADMIN_GROUP_NAME)).length
    const totalQueries = users.reduce((sum, u) => sum + (u.query_count || 0), 0)

    return { totalUsers, activeUsers, adminUsers, totalQueries }
  }, [users])

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: CreateUserData) => userManagementService.createUser(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      refetchUsers()
      setShowCreateDialog(false)
      resetCreateForm()
      toast.success('User created successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to create user: ${error.message}`)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateUserData }) =>
      userManagementService.updateUser(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      refetchUsers()
      setEditingUser(null)
      resetUpdateForm()
      toast.success('User updated successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to update user: ${error.message}`)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => userManagementService.deleteUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      refetchUsers()
      setDeleteConfirm(null)
      toast.success('User deleted successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete user: ${error.message}`)
    },
  })

  const resetPasswordMutation = useMutation({
    mutationFn: ({ id, new_password, new_password_confirm }: { id: number; new_password: string; new_password_confirm: string }) =>
      userManagementService.resetPassword(id, new_password, new_password_confirm),
    onSuccess: () => {
      setResetPasswordUser(null)
      setPasswordFormData({ new_password: '', new_password_confirm: '' })
      toast.success('Password reset successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to reset password: ${error.message}`)
    },
  })

  const activateMutation = useMutation({
    mutationFn: (id: number) => userManagementService.activateUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      refetchUsers()
      toast.success('User activated successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to activate user: ${error.message}`)
    },
  })

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => userManagementService.deactivateUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      refetchUsers()
      toast.success('User deactivated successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to deactivate user: ${error.message}`)
    },
  })

  // Handlers
  const handleGenerateResetCode = async (user: UserManagementUser) => {
    try {
      const resetResult = await userManagementService.generateResetCode(user.id)
      toast.success(
        <div className="space-y-1">
          <p className="font-medium">Reset code for {user.username}</p>
          <code className="block bg-muted px-2 py-1 rounded text-lg tracking-widest font-mono">{resetResult.code}</code>
          <p className="text-xs text-muted-foreground">Expires: {formatTime(resetResult.expires_at)}</p>
        </div>,
        { duration: 30000 }
      )
    } catch (err: unknown) {
      toast.error(`Failed: ${(err as Error).message}`)
    }
  }

  const handleAdminVerifyEmail = async (user: UserManagementUser) => {
    try {
      await userManagementService.adminVerifyEmail(user.id)
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success(`Email verified for ${user.username}`)
    } catch (err: unknown) {
      toast.error(`Failed: ${(err as Error).message}`)
    }
  }

  const handleAdminDisableMfa = async (user: UserManagementUser) => {
    try {
      await userManagementService.adminDisableMfa(user.id)
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success(`MFA disabled for ${user.username}`)
    } catch (err: unknown) {
      toast.error(`Failed: ${(err as Error).message}`)
    }
  }

  const resetCreateForm = () => {
    setCreateFormData({
      username: '',
      email: '',
      password: '',
      password_confirm: '',
      first_name: '',
      last_name: '',
      is_active: true,
      group_ids: [],
    })
  }

  const resetUpdateForm = () => {
    setUpdateFormData({
      email: '',
      first_name: '',
      last_name: '',
      is_active: true,
      group_ids: [],
    })
  }

  const handleEdit = (user: UserManagementUser) => {
    setEditingUser(user)
    setUpdateFormData({
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      is_active: user.is_active,
      group_ids: user.groups.map(g => g.id),
    })
  }

  const handleCreate = () => {
    if (createFormData.password !== createFormData.password_confirm) {
      toast.error('Passwords do not match')
      return
    }
    createMutation.mutate(createFormData)
  }

  const handleUpdate = () => {
    if (!editingUser) return
    updateMutation.mutate({ id: editingUser.id, data: updateFormData })
  }

  const handleResetPassword = () => {
    if (!resetPasswordUser) return
    if (passwordFormData.new_password !== passwordFormData.new_password_confirm) {
      toast.error('Passwords do not match')
      return
    }
    resetPasswordMutation.mutate({
      id: resetPasswordUser.id,
      new_password: passwordFormData.new_password,
      new_password_confirm: passwordFormData.new_password_confirm
    })
  }

  const handleToggleActive = (user: UserManagementUser) => {
    if (user.is_active) {
      deactivateMutation.mutate(user.id)
    } else {
      activateMutation.mutate(user.id)
    }
  }

  // Group management
  const loadGroups = async () => {
    try {
      setLoadingGroups(true)
      const response = await userManagementService.listGroups()
      setGroupsList(response.results)
    } catch (_error) {
      toast.error('Failed to load groups')
    } finally {
      setLoadingGroups(false)
    }
  }

  useEffect(() => {
    if (isAdmin) {
      loadGroups()
    }
  }, [isAdmin])

  const handleCreateGroup = () => {
    setCreateGroupDialogOpen(true)
  }

  const handleDeleteGroup = (group: GroupDetail) => {
    setSelectedGroup(group)
    setDeleteGroupDialogOpen(true)
  }

  const filteredGroups = useMemo(() => {
    return (groupsList || []).filter(group =>
      group.name.toLowerCase().includes(debouncedGroupSearch.toLowerCase())
    )
  }, [groupsList, debouncedGroupSearch])

  const getInitials = (firstName: string, lastName: string, username: string) => {
    if (firstName && lastName) {
      return `${firstName[0]}${lastName[0]}`.toUpperCase()
    }
    if (firstName) return firstName[0].toUpperCase()
    return username.slice(0, 2).toUpperCase()
  }

  return {
    isAdmin, currentUser,
    showCreateDialog, setShowCreateDialog, editingUser, setEditingUser,
    deleteConfirm, setDeleteConfirm, resetPasswordUser, setResetPasswordUser,
    searchQuery, setSearchQuery, filterGroup, setFilterGroup,
    filterActive, setFilterActive, filterPermission, setFilterPermission,
    detailDrawerOpen, setDetailDrawerOpen, detailUserId, setDetailUserId,
    users, isLoadingUsers, usersError, refetchUsers, groups, allPermissions, filteredUsers, stats,
    createMutation, updateMutation, deleteMutation, resetPasswordMutation,
    createFormData, setCreateFormData, updateFormData, setUpdateFormData,
    passwordFormData, setPasswordFormData,
    handleGenerateResetCode, handleAdminVerifyEmail, handleAdminDisableMfa,
    resetCreateForm, resetUpdateForm, handleEdit, handleCreate, handleUpdate,
    handleResetPassword, handleToggleActive,
    groupsList, loadingGroups, groupSearchTerm, setGroupSearchTerm,
    createGroupDialogOpen, setCreateGroupDialogOpen,
    deleteGroupDialogOpen, setDeleteGroupDialogOpen, cloneGroupDialogOpen, setCloneGroupDialogOpen,
    groupDetailDrawerOpen, setGroupDetailDrawerOpen,
    selectedGroup, setSelectedGroup,
    filteredGroups, loadGroups, refetchGroups,
    handleCreateGroup, handleDeleteGroup, getInitials,
  }
}
