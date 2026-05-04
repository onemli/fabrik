// services/validation.ts
//
// API client for validation lists and schema column validation. Validation lists
// define allowed values for schema columns (static or query-backed). The validate
// endpoint uploads a file and returns per-cell errors for the MultiSheetValidationView.

import { authService } from './auth'

const API_BASE_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '')

export interface ValidationList {
  id: string
  name: string
  description: string
  values: string[]
  case_sensitive: boolean
  error_message: string
  error_message_title: string
  created_by?: {
    id: number
    username: string
    first_name: string
    last_name: string
    email: string
  }
  is_public: boolean
  usage_count: number
  last_used_at: string | null
  created_at: string
  updated_at: string
  can_edit: boolean
  can_delete: boolean
}

export interface ValidationListCreate {
  name: string
  description: string
  values: string[]
  case_sensitive: boolean
  error_message: string
  error_message_title: string
  is_public: boolean
}

export interface ValidationUsage {
  id: string
  template: string
  template_name: string
  sheet_name: string
  column_name: string
  validation_type: 'regex' | 'static_list' | 'query_list'
  validation_list: string | null
  validation_list_name: string | null
  validation_query: number | null
  validation_query_name: string | null
  created_at: string
  created_by: number | null
  created_by_username: string | null
}

export interface ValidationError {
  row: number
  column: string
  value: any
  error_title: string
  error_message: string
  validation_type: 'regex' | 'static_list' | 'query_list'
  allowed_values?: string[]
  cell_ref: string
}

export interface SheetValidationResult {
  is_valid: boolean
  error_count: number
  errors: ValidationError[]
}

export interface MultiSheetValidationResult {
  is_valid: boolean
  sheets: Record<string, SheetValidationResult>
  total_errors: number
  validation_time_ms: number
  bypassed?: boolean
  message?: string
}

class ValidationService {
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

    if (!response.ok) {
      if (response.status === 401) {
        // Try to refresh token
        try {
          await authService.refreshAccessToken()
          // Retry the request
          return this.fetch(endpoint, options)
        } catch (refreshError) {
          authService.logout()
          window.location.href = '/login'
          throw new Error('Authentication failed')
        }
      }

      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.error || errorData.detail || `HTTP ${response.status}`)
    }

    return response.json()
  }

  /**
   * Get all validation lists
   */
  async getValidationLists(params?: {
    search?: string
    ordering?: string
  }): Promise<ValidationList[]> {
    const queryParams = new URLSearchParams()
    if (params?.search) queryParams.append('search', params.search)
    if (params?.ordering) queryParams.append('ordering', params.ordering)

    const queryString = queryParams.toString()
    const response = await this.fetch(`/api/awx/validation-lists/${queryString ? `?${queryString}` : ''}`)

    // Handle paginated response from DRF
    if (response && typeof response === 'object' && 'results' in response) {
      return response.results
    }

    // Fallback for non-paginated response
    return Array.isArray(response) ? response : []
  }

  /**
   * Get validation list by ID
   */
  async getValidationList(id: string): Promise<ValidationList> {
    return this.fetch(`/api/awx/validation-lists/${id}/`)
  }

  /**
   * Create new validation list
   */
  async createValidationList(data: ValidationListCreate): Promise<ValidationList> {
    return this.fetch('/api/awx/validation-lists/', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  /**
   * Update validation list
   */
  async updateValidationList(id: string, data: Partial<ValidationListCreate>): Promise<ValidationList> {
    return this.fetch(`/api/awx/validation-lists/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  /**
   * Delete validation list
   */
  async deleteValidationList(id: string): Promise<void> {
    return this.fetch(`/api/awx/validation-lists/${id}/`, {
      method: 'DELETE',
    })
  }

  /**
   * Get usages of a validation list
   */
  async getValidationListUsages(id: string): Promise<{
    validation_list: { id: string; name: string }
    usage_count: number
    usages: ValidationUsage[]
  }> {
    return this.fetch(`/api/awx/validation-lists/${id}/usages/`)
  }

  /**
   * Validate multi-sheet data against template
   */
  async validateSheets(
    templateId: string,
    sheets: Record<string, any[]>
  ): Promise<MultiSheetValidationResult> {
    return this.fetch(`/api/awx/templates/${templateId}/validate-sheets/`, {
      method: 'POST',
      body: JSON.stringify({ sheets }),
    })
  }
}

export interface RegexPattern {
  id: string
  name: string
  description: string
  pattern: string
  category: 'network' | 'naming' | 'format' | 'security' | 'custom'
  test_strings: { value: string; should_match: boolean }[]
  flags: string[]
  error_message: string
  created_by?: {
    id: number
    username: string
    first_name: string
    last_name: string
    email: string
  }
  is_public: boolean
  usage_count: number
  last_used_at: string | null
  created_at: string
  updated_at: string
  can_edit: boolean
  can_delete: boolean
}

export interface RegexPatternCreate {
  name: string
  description: string
  pattern: string
  category: string
  test_strings: { value: string; should_match: boolean }[]
  flags: string[]
  error_message: string
  is_public: boolean
}

export interface RegexTestResult {
  valid: boolean
  error: string | null
  results: {
    value: string
    is_match: boolean
    match_start: number | null
    match_end: number | null
    matched_text: string | null
  }[]
}

class RegexPatternService {
  private async fetch(endpoint: string, options?: RequestInit): Promise<any> {
    const token = authService.getAccessToken()
    const headers: HeadersInit = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: { ...headers, ...options?.headers },
    })

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
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.error || errorData.detail || `HTTP ${response.status}`)
    }

    return response.json()
  }

  async getPatterns(params?: {
    search?: string
    ordering?: string
    category?: string
  }): Promise<RegexPattern[]> {
    const qp = new URLSearchParams()
    if (params?.search) qp.append('search', params.search)
    if (params?.ordering) qp.append('ordering', params.ordering)
    if (params?.category) qp.append('category', params.category)
    const qs = qp.toString()
    const response = await this.fetch(`/api/awx/regex-patterns/${qs ? `?${qs}` : ''}`)
    if (response && typeof response === 'object' && 'results' in response) return response.results
    return Array.isArray(response) ? response : []
  }

  async getPattern(id: string): Promise<RegexPattern> {
    return this.fetch(`/api/awx/regex-patterns/${id}/`)
  }

  async createPattern(data: RegexPatternCreate): Promise<RegexPattern> {
    return this.fetch('/api/awx/regex-patterns/', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updatePattern(id: string, data: Partial<RegexPatternCreate>): Promise<RegexPattern> {
    return this.fetch(`/api/awx/regex-patterns/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  async deletePattern(id: string): Promise<void> {
    return this.fetch(`/api/awx/regex-patterns/${id}/`, { method: 'DELETE' })
  }

  async testPattern(pattern: string, flags: string[], testStrings: string[]): Promise<RegexTestResult> {
    return this.fetch('/api/awx/regex-patterns/test/', {
      method: 'POST',
      body: JSON.stringify({ pattern, flags, test_strings: testStrings }),
    })
  }
}

export const regexPatternService = new RegexPatternService()

export const validationService = new ValidationService()
