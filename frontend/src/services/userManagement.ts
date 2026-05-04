// services/userManagement.ts
//
// API client for user and group management — create/update/delete users, assign
// groups, reset passwords, and manage Django permissions. All endpoints require
// staff/admin access; the backend enforces this at the permission_classes level.

import { authService } from './auth'

const API_BASE_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '')

// ============================================================
// TYPES
// ============================================================

export interface ContentType {
  id: number
  app_label: string
  model: string
}

export interface Permission {
  id: number
  name: string
  codename: string
  content_type: ContentType
  category?: string
  description?: string
  is_dangerous?: boolean
}

export interface GroupBasic {
  id: number
  name: string
  permission_count?: number
  user_count?: number
  recent_users?: Array<{
    id: number
    username: string
    email: string
  }>
}

export interface GroupDetail extends GroupBasic {
  permissions: Permission[]
  user_count: number
  users: Array<{
    id: number
    username: string
    email: string
    is_active: boolean
  }>
}

export interface UserManagementUser {
  id: number
  username: string
  email: string
  first_name: string
  last_name: string
  is_active: boolean
  is_staff: boolean
  is_superuser: boolean
  last_login: string | null
  date_joined: string
  groups: GroupBasic[]
  group_names: string[]
  is_admin: boolean
  query_count: number
}

// Extending Record<string, unknown> adds the index signature that generic form
// components like UserFormDialog rely on to read/write arbitrary fields.
export interface CreateUserData extends Record<string, unknown> {
  username: string
  email: string
  password: string
  password_confirm: string
  first_name: string
  last_name: string
  is_active: boolean
  group_ids?: number[]
}

export interface UpdateUserData extends Record<string, unknown> {
  email?: string
  first_name?: string
  last_name?: string
  is_active?: boolean
  is_staff?: boolean
  is_superuser?: boolean
  group_ids?: number[]
  permission_ids?: number[]
}

export interface EffectivePermission extends Permission {
  source: string  // "direct" | group name
}

export interface CreateGroupData {
  name: string
  permission_ids?: number[]
}

export interface UpdateGroupData {
  name?: string
  permission_ids?: number[]
}

export interface PasswordResetData {
  new_password: string
  new_password_confirm: string
}

export interface PaginatedResponse<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

class UserManagementService {
  private getHeaders(): HeadersInit {
    const token = authService.getAccessToken()
    return {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    }
  }

  // ============================================================
  // USER MANAGEMENT
  // ============================================================

  async listUsers(params?: {
    page?: number
    group_id?: number
    is_active?: boolean
    search?: string
    permission_id?: number
  }): Promise<PaginatedResponse<UserManagementUser>> {
    const queryParams = new URLSearchParams()
    if (params?.page) queryParams.append('page', params.page.toString())
    if (params?.group_id) queryParams.append('group_id', params.group_id.toString())
    if (params?.is_active !== undefined) queryParams.append('is_active', params.is_active.toString())
    if (params?.search) queryParams.append('search', params.search)
    if (params?.permission_id) queryParams.append('permission_id', params.permission_id.toString())

    const url = `${API_BASE_URL}/api/auth/management/${queryParams.toString() ? '?' + queryParams.toString() : ''}`
    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || 'Failed to fetch users')
    }

    return response.json()
  }

  async getUser(id: number): Promise<UserManagementUser> {
    const response = await fetch(`${API_BASE_URL}/api/auth/management/${id}/`, {
      method: 'GET',
      headers: this.getHeaders(),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || 'Failed to fetch user')
    }

    return response.json()
  }

  async createUser(data: CreateUserData): Promise<UserManagementUser> {
    const response = await fetch(`${API_BASE_URL}/api/auth/management/`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(data),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(JSON.stringify(error))
    }

    return response.json()
  }

  async updateUser(id: number, data: UpdateUserData): Promise<UserManagementUser> {
    const response = await fetch(`${API_BASE_URL}/api/auth/management/${id}/`, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify(data),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(JSON.stringify(error))
    }

    return response.json()
  }

  async deleteUser(id: number): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/auth/management/${id}/`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || error.detail || 'Failed to delete user')
    }
  }

  async resetPassword(id: number, new_password: string, new_password_confirm: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/auth/management/${id}/reset_password/`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ new_password, new_password_confirm }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(JSON.stringify(error))
    }
  }

  async activateUser(id: number): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/auth/management/${id}/activate/`, {
      method: 'POST',
      headers: this.getHeaders(),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || 'Failed to activate user')
    }
  }

  async deactivateUser(id: number): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/auth/management/${id}/deactivate/`, {
      method: 'POST',
      headers: this.getHeaders(),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || error.detail || 'Failed to deactivate user')
    }
  }

  async getUserDirectPermissions(id: number): Promise<Permission[]> {
    const response = await fetch(`${API_BASE_URL}/api/auth/management/${id}/user_permissions/`, {
      method: 'GET',
      headers: this.getHeaders(),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || 'Failed to fetch user permissions')
    }

    return response.json()
  }

  async addPermissionsToUser(id: number, permission_ids: number[]): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/auth/management/${id}/add_permissions/`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ permission_ids }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || 'Failed to add permissions')
    }
  }

  async removePermissionsFromUser(id: number, permission_ids: number[]): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/auth/management/${id}/remove_permissions/`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ permission_ids }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || 'Failed to remove permissions')
    }
  }

  async getEffectivePermissions(id: number): Promise<EffectivePermission[]> {
    const response = await fetch(`${API_BASE_URL}/api/auth/management/${id}/effective_permissions/`, {
      method: 'GET',
      headers: this.getHeaders(),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || 'Failed to fetch effective permissions')
    }

    return response.json()
  }

  // ============================================================
  // GROUP MANAGEMENT
  // ============================================================

  async listGroups(params?: {
    page?: number
    search?: string
  }): Promise<PaginatedResponse<GroupDetail>> {
    const queryParams = new URLSearchParams()
    if (params?.page) queryParams.append('page', params.page.toString())
    if (params?.search) queryParams.append('search', params.search)

    const queryString = queryParams.toString()
    const url = `${API_BASE_URL}/api/auth/groups/${queryString ? '?' + queryString : ''}`
    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || 'Failed to fetch groups')
    }

    return response.json()
  }

  async getGroup(id: number): Promise<GroupDetail> {
    const response = await fetch(`${API_BASE_URL}/api/auth/groups/${id}/`, {
      method: 'GET',
      headers: this.getHeaders(),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || 'Failed to fetch group')
    }

    return response.json()
  }

  async createGroup(data: CreateGroupData): Promise<GroupDetail> {
    const response = await fetch(`${API_BASE_URL}/api/auth/groups/`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(data),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(JSON.stringify(error))
    }

    return response.json()
  }

  async updateGroup(id: number, data: UpdateGroupData): Promise<GroupDetail> {
    const response = await fetch(`${API_BASE_URL}/api/auth/groups/${id}/`, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify(data),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(JSON.stringify(error))
    }

    return response.json()
  }

  async deleteGroup(id: number): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/auth/groups/${id}/`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || 'Failed to delete group')
    }
  }

  async addPermissionsToGroup(id: number, permission_ids: number[]): Promise<GroupDetail> {
    const response = await fetch(`${API_BASE_URL}/api/auth/groups/${id}/add_permissions/`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ permission_ids }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || 'Failed to add permissions')
    }

    return response.json()
  }

  async removePermissionsFromGroup(id: number, permission_ids: number[]): Promise<GroupDetail> {
    const response = await fetch(`${API_BASE_URL}/api/auth/groups/${id}/remove_permissions/`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ permission_ids }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || 'Failed to remove permissions')
    }

    return response.json()
  }

  async getRoleTemplates(): Promise<Record<string, {
    name: string
    description: string
    permission_ids: number[]
    icon: string
    color: string
  }>> {
    const response = await fetch(`${API_BASE_URL}/api/auth/groups/role_templates/`, {
      method: 'GET',
      headers: this.getHeaders(),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || 'Failed to fetch role templates')
    }

    return response.json()
  }

  async cloneGroup(id: number, newName: string): Promise<GroupDetail> {
    const response = await fetch(`${API_BASE_URL}/api/auth/groups/${id}/clone/`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ name: newName }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw error
    }

    return response.json()
  }

  // ============================================================
  // PERMISSION MANAGEMENT
  // ============================================================

  async listPermissions(params?: {
    page?: number
    page_size?: number
    app_label?: string
    content_type?: number
    search?: string
  }): Promise<PaginatedResponse<Permission>> {
    const queryParams = new URLSearchParams()
    if (params?.page) queryParams.append('page', params.page.toString())
    if (params?.page_size) queryParams.append('page_size', params.page_size.toString())
    if (params?.app_label) queryParams.append('app_label', params.app_label)
    if (params?.content_type) queryParams.append('content_type', params.content_type.toString())
    if (params?.search) queryParams.append('search', params.search)

    const queryString = queryParams.toString()
    const url = `${API_BASE_URL}/api/auth/permissions/${queryString ? '?' + queryString : ''}`
    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || 'Failed to fetch permissions')
    }

    return response.json()
  }

  async getPermission(id: number): Promise<Permission> {
    const response = await fetch(`${API_BASE_URL}/api/auth/permissions/${id}/`, {
      method: 'GET',
      headers: this.getHeaders(),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || 'Failed to fetch permission')
    }

    return response.json()
  }

  // ============================================================
  // PASSWORD RESET CODE (ADMIN)
  // ============================================================

  async generateResetCode(userId: number): Promise<{
    code: string
    expires_at: string
    message: string
  }> {
    const response = await fetch(`${API_BASE_URL}/api/auth/management/${userId}/generate_reset_code/`, {
      method: 'POST',
      headers: this.getHeaders(),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || 'Failed to generate reset code')
    }

    return response.json()
  }

  // ============================================================
  // ADMIN: EMAIL VERIFICATION & MFA BYPASS
  // ============================================================

  async adminVerifyEmail(userId: number): Promise<{ message: string }> {
    const response = await fetch(`${API_BASE_URL}/api/auth/management/${userId}/verify_email/`, {
      method: 'POST',
      headers: this.getHeaders(),
    })
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || 'Failed to verify email')
    }
    return response.json()
  }

  async adminDisableMfa(userId: number): Promise<{ message: string }> {
    const response = await fetch(`${API_BASE_URL}/api/auth/management/${userId}/disable_mfa/`, {
      method: 'POST',
      headers: this.getHeaders(),
    })
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || 'Failed to disable MFA')
    }
    return response.json()
  }

  // ============================================================
  // GROUP QUOTA MANAGEMENT
  // ============================================================

  async getGroupQuota(groupId: number): Promise<GroupQuotaData | null> {
    const response = await fetch(`${API_BASE_URL}/api/auth/groups/${groupId}/quota/`, {
      headers: this.getHeaders(),
    })

    if (response.status === 404) return null
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || 'Failed to fetch group quota')
    }

    return response.json()
  }

  async updateGroupQuota(groupId: number, data: Partial<GroupQuotaData>): Promise<GroupQuotaData> {
    const response = await fetch(`${API_BASE_URL}/api/auth/groups/${groupId}/quota/`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(data),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(JSON.stringify(error))
    }

    return response.json()
  }

  // ============================================================
  // AUTH HEALTH
  // ============================================================

  async getAuthHealth(): Promise<Record<string, unknown>> {
    const response = await fetch(`${API_BASE_URL}/api/auth/health/`, {
      headers: this.getHeaders(),
    })
    if (!response.ok) return {}
    return response.json()
  }
}

export interface GroupQuotaData {
  group_name: string
  max_saved_queries: number
  max_scheduled_tasks: number
  max_apic_connections: number
  max_awx_requests_daily: number
  max_awx_concurrent: number
  max_query_results: number
  max_export_rows: number
  query_execution_daily: number
  can_create_queries: boolean
  can_execute_queries: boolean
  can_create_scheduled: boolean
  can_use_awx: boolean
  can_use_time_machine: boolean
  can_export_data: boolean
  can_share_resources: boolean
  can_use_ai_builder: boolean
  ai_analysis_daily?: number
}

export const userManagementService = new UserManagementService()

// Hard-coded name of the bootstrap admin group. Backend
// `FabrikModelPermissions` / `IsAdminOrSuperuser` match by this literal
// string to grant RBAC bypass; renaming or duplicating the constant in
// individual files invites drift and silent permission breakage.
export const SYSTEM_ADMIN_GROUP_NAME = 'Admin'
