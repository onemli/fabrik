// services/apic.ts
//
// API client for APIC connection management endpoints. Wraps /api/apic-connections/.
// Test connection calls into the backend which then actually tries to log in to
// the APIC — credentials are never sent raw to the frontend.

import { authService } from './auth'

const API_BASE_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '')

export interface APICConnection {
  id: number
  name: string
  description?: string
  url: string
  username: string
  verify_ssl: boolean
  timeout: number
  is_active: boolean
  is_public: boolean
  last_tested_at?: string
  last_test_status?: boolean
  last_test_message?: string
  created_by: {
    id: number
    username: string
    first_name: string
    last_name: string
  }
  created_at: string
  updated_at: string
  can_edit: boolean
  can_delete: boolean
}

export interface APICConnectionCreate {
  name: string
  description?: string
  url: string
  username: string
  password: string
  verify_ssl?: boolean
  timeout?: number
  is_active?: boolean
  is_public?: boolean
}

export interface QueryExecutionRequest {
  connection_id: number
  query_path: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  data?: any
}

export interface QueryExecutionResponse {
  success: boolean
  data?: any
  error?: string
  connection: {
    id: number
    name: string
    url: string
  }
}

class APICService {
  private async fetch(endpoint: string, options?: RequestInit): Promise<any> {
    const token = authService.getAccessToken()
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    }

    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        ...headers,
        ...options?.headers,
      },
    })

    // Get response text first to handle empty/invalid JSON
    const text = await response.text()
    let data: any = null

    // Try to parse JSON if response has content
    if (text && text.trim()) {
      try {
        data = JSON.parse(text)
      } catch (e) {
        throw new Error(`Invalid JSON response: ${text.substring(0, 100)}`)
      }
    }

    if (!response.ok) {
      if (response.status === 401) {
        try {
          await authService.refreshAccessToken()
          return this.fetch(endpoint, options)
        } catch {
          authService.logout()
          window.location.href = '/login'
          throw new Error('Authentication failed')
        }
      }

      const errorMessage = data?.detail || data?.error || data?.message || `HTTP ${response.status}: ${response.statusText}`
      throw new Error(errorMessage)
    }

    return data || {}
  }

  // Connections
  async getConnections(): Promise<APICConnection[]> {
    return this.fetch('/api/apic/connections/')
  }

  async getConnection(id: number): Promise<APICConnection> {
    return this.fetch(`/api/apic/connections/${id}/`)
  }

  async createConnection(data: APICConnectionCreate): Promise<APICConnection> {
    return this.fetch('/api/apic/connections/', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateConnection(id: number, data: Partial<APICConnectionCreate>): Promise<APICConnection> {
    return this.fetch(`/api/apic/connections/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  async deleteConnection(id: number): Promise<void> {
    await this.fetch(`/api/apic/connections/${id}/`, {
      method: 'DELETE',
    })
  }

  async testConnection(id: number, signal?: AbortSignal): Promise<{ success: boolean; message: string }> {
    return this.fetch(`/api/apic/connections/${id}/test/`, {
      method: 'POST',
      signal,
    })
  }

  async executeQuery(request: QueryExecutionRequest, signal?: AbortSignal): Promise<QueryExecutionResponse> {
    return this.fetch('/api/apic/connections/execute_query/', {
      method: 'POST',
      body: JSON.stringify(request),
      signal,
    })
  }
}

export const apicService = new APICService()
