// services/auditLog.ts
//
// API client for the audit log (admin-only). Supports filtered paginated reads
// and settings management (which categories to log and for how long to retain).

import { authService } from './auth'
import type { AuditLog, AuditLogSettings, LoginAttempt, PaginatedAuditLogs } from '../types/audit'

const API_BASE_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '')

export interface AuditLogFilters {
  page?: number
  category?: string
  action?: string
  resource_type?: string
  user?: number
  success?: boolean
  start_date?: string
  end_date?: string
  search?: string
}

class AuditLogService {
  private getHeaders(): HeadersInit {
    const token = authService.getAccessToken()
    return {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    }
  }

  async listLogs(filters?: AuditLogFilters): Promise<PaginatedAuditLogs> {
    const params = new URLSearchParams()
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          params.append(key, value.toString())
        }
      })
    }

    const url = `${API_BASE_URL}/api/audit/logs/${params.toString() ? '?' + params.toString() : ''}`

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to fetch audit logs: ${response.status} ${errorText}`)
    }

    const data = await response.json()
    return data
  }

  async getLog(id: string): Promise<AuditLog> {
    const response = await fetch(`${API_BASE_URL}/api/audit/logs/${id}/`, {
      method: 'GET',
      headers: this.getHeaders(),
    })

    if (!response.ok) {
      throw new Error('Failed to fetch audit log')
    }

    return response.json()
  }

  async exportLogs(filters?: AuditLogFilters): Promise<void> {
    const params = new URLSearchParams()
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          params.append(key, value.toString())
        }
      })
    }

    const url = `${API_BASE_URL}/api/audit/logs/export/${params.toString() ? '?' + params.toString() : ''}`
    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    })

    if (!response.ok) {
      throw new Error('Failed to export logs')
    }

    const blob = await response.blob()
    const downloadUrl = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = downloadUrl
    a.download = `audit_logs_${new Date().toISOString().split('T')[0]}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.URL.revokeObjectURL(downloadUrl)
  }

  async getSettings(): Promise<AuditLogSettings> {
    const response = await fetch(`${API_BASE_URL}/api/audit/settings/1/`, {
      method: 'GET',
      headers: this.getHeaders(),
    })

    if (!response.ok) {
      throw new Error('Failed to fetch audit settings')
    }

    return response.json()
  }

  async updateSettings(data: Partial<AuditLogSettings>): Promise<AuditLogSettings> {
    const response = await fetch(`${API_BASE_URL}/api/audit/settings/1/`, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify(data),
    })

    if (!response.ok) {
      throw new Error('Failed to update audit settings')
    }

    return response.json()
  }

  async getLoginAttempts(filters?: { start_date?: string; end_date?: string; username?: string }): Promise<{ results: LoginAttempt[] }> {
    const params = new URLSearchParams()
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.append(key, value)
      })
    }

    const url = `${API_BASE_URL}/api/audit/login-attempts/${params.toString() ? '?' + params.toString() : ''}`
    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    })

    if (!response.ok) {
      throw new Error('Failed to fetch login attempts')
    }

    return response.json()
  }

  async getStats(): Promise<{ total_logs: number; by_category: Array<{ category: string; count: number }>; by_action: Array<{ action: string; count: number }> }> {
    const response = await fetch(`${API_BASE_URL}/api/audit/logs/stats/`, {
      method: 'GET',
      headers: this.getHeaders(),
    })

    if (!response.ok) {
      throw new Error('Failed to fetch stats')
    }

    return response.json()
  }
}

export const auditLogService = new AuditLogService()
