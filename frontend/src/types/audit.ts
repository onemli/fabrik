// types/audit.ts
//
// TypeScript types for audit log entries. These come from the backend AuditLog
// model and are read-only from the frontend — admins view them on the Audit Logs
// page; nothing in the UI creates or modifies them directly.

export interface AuditLog {
  id: string
  timestamp: string
  user: {
    id: number
    username: string
    email: string
  } | null
  username: string
  ip_address: string | null
  user_agent?: string
  category: string
  category_display: string
  action: string
  action_display: string
  resource_type: string
  resource_id: string
  resource_name: string
  description: string
  metadata: Record<string, any>
  content?: string
  content_size: number
  content_truncated: boolean
  success: boolean
  error_message: string
}

export interface AuditLogSettings {
  // Category toggles
  user_management_enabled: boolean
  group_permission_enabled: boolean
  query_content_enabled: boolean
  login_logout_enabled: boolean
  settings_changes_enabled: boolean
  api_access_enabled: boolean

  // Retention (days)
  user_management_retention_days: number
  group_permission_retention_days: number
  query_content_retention_days: number
  login_logout_retention_days: number
  settings_changes_retention_days: number
  api_access_retention_days: number

  // Content
  max_content_size_mb: number
  compress_large_content: boolean

  // Cleanup
  auto_cleanup_enabled: boolean
  cleanup_time_hour: number

  updated_at: string
  updated_by: number | null
}

export interface LoginAttempt {
  id: number
  timestamp: string
  username: string
  user: number | null
  ip_address: string
  user_agent: string
  success: boolean
  failure_reason: string
  session_key: string
}

export interface PaginatedAuditLogs {
  count: number
  next: string | null
  previous: string | null
  results: AuditLog[]
}
