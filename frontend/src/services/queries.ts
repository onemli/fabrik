// services/queries.ts
//
// API client for saved query CRUD, execution logs, and the query builder's
// generate/preview endpoints.

import { authService } from './auth'

const API_BASE_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '')

export interface Category {
  id: number
  name: string
  description?: string
  color: string
  icon?: string
  query_count: number
  created_at: string
  updated_at: string
}

export interface SavedQueryListItem {
  id: number
  name: string
  description?: string
  category: number | null
  category_name?: string
  tags_list: string[]
  created_by: {
    id: number
    username: string
    first_name: string
    last_name: string
    email: string
  }
  is_public: boolean
  is_template: boolean
  execution_count: number
  last_executed_at: string | null
  created_at: string
  updated_at: string
  is_favorite: boolean
  // Validation query fields
  is_validation_query?: boolean
  validation_description?: string
  validation_error_message?: string
  validation_error_title?: string
  validation_usage_count?: number
  last_validated_at?: string | null
}

export interface SavedQueryDetail extends SavedQueryListItem {
  flow_data: {
    nodes: any[]
    edges: any[]
  }
  generated_query: string
  // Raw comma-separated tags string — `tags_list` is the parsed array inherited
  // from SavedQueryListItem. Both fields come from the detail serializer.
  tags?: string
  variables?: any[]
  shared_with: number[]
  favorited_by: number[]
  can_edit: boolean
  can_delete: boolean
  enable_time_machine?: boolean
  enable_pagination?: boolean
  page_size?: number
}

export interface PaginatedResponse<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

export interface SavedQueryCreate {
  name: string
  description?: string
  flow_data: {
    nodes: any[]
    edges: any[]
  }
  generated_query: string
  category?: number
  tags?: string
  is_public?: boolean
  is_template?: boolean
  variables?: any[]
  enable_time_machine?: boolean
  enable_pagination?: boolean
  page_size?: number
}

class QueriesService {
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
        } catch {
          authService.logout()
          window.location.href = '/login'
          throw new Error('Authentication failed')
        }
      }

      const error = await response.json().catch(() => ({ detail: 'Request failed' }))
      throw new Error(error.detail || JSON.stringify(error))
    }

    // Handle 204 No Content (DELETE operations)
    if (response.status === 204) {
      return undefined
    }

    // Handle empty responses
    const text = await response.text()
    return text ? JSON.parse(text) : undefined
  }

  // Categories
  async getCategories(): Promise<Category[]> {
    return this.fetch('/api/queries/categories/')
  }

  async createCategory(data: { name: string; description?: string; color?: string; icon?: string }): Promise<Category> {
    return this.fetch('/api/queries/categories/', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateCategory(id: number, data: Partial<Category>): Promise<Category> {
    return this.fetch(`/api/queries/categories/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  async deleteCategory(id: number): Promise<void> {
    await this.fetch(`/api/queries/categories/${id}/`, {
      method: 'DELETE',
    })
  }

  // Saved Queries
  async getSavedQueries(params?: {
    category?: number
    is_favorite?: boolean
    is_owner?: boolean
    search?: string
  }): Promise<SavedQueryListItem[]> {
    const searchParams = new URLSearchParams()
    if (params?.category) searchParams.set('category', params.category.toString())
    if (params?.is_favorite) searchParams.set('is_favorite', 'true')
    if (params?.is_owner) searchParams.set('is_owner', 'true')
    if (params?.search) searchParams.set('search', params.search)

    const query = searchParams.toString() ? `?${searchParams.toString()}` : ''
    const response = await this.fetch(`/api/queries/saved-queries/${query}`)

    // Handle paginated response (extract results array)
    if (response && typeof response === 'object' && 'results' in response) {
      return response.results
    }

    // Handle non-paginated response (already an array)
    return response
  }

  async getSavedQueriesPaginated(params?: {
    page?: number
    page_size?: number
    category?: number
    is_favorite?: boolean
    is_owner?: boolean
    is_template?: boolean
    search?: string
  }): Promise<PaginatedResponse<SavedQueryListItem>> {
    const searchParams = new URLSearchParams()
    if (params?.page) searchParams.set('page', params.page.toString())
    if (params?.page_size) searchParams.set('page_size', params.page_size.toString())
    if (params?.category) searchParams.set('category', params.category.toString())
    if (params?.is_favorite) searchParams.set('is_favorite', 'true')
    if (params?.is_owner) searchParams.set('is_owner', 'true')
    if (params?.is_template !== undefined) searchParams.set('is_template', params.is_template.toString())
    if (params?.search) searchParams.set('search', params.search)

    const query = searchParams.toString() ? `?${searchParams.toString()}` : ''
    return this.fetch(`/api/queries/saved-queries/${query}`)
  }

  // Alias for backward compatibility (used by ValidationQuerySelector)
  async getQueries(params?: {
    page?: number
    page_size?: number
    category?: number
    is_favorite?: boolean
    is_owner?: boolean
    is_template?: boolean
    search?: string
  }): Promise<PaginatedResponse<SavedQueryListItem>> {
    return this.getSavedQueriesPaginated(params)
  }

  async getSavedQuery(id: number): Promise<SavedQueryDetail> {
    return this.fetch(`/api/queries/saved-queries/${id}/`)
  }

  async createSavedQuery(data: SavedQueryCreate): Promise<SavedQueryDetail> {
    return this.fetch('/api/queries/saved-queries/', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateSavedQuery(id: number, data: Partial<SavedQueryCreate>): Promise<SavedQueryDetail> {
    return this.fetch(`/api/queries/saved-queries/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  async deleteSavedQuery(id: number): Promise<void> {
    await this.fetch(`/api/queries/saved-queries/${id}/`, {
      method: 'DELETE',
    })
  }

  async favoriteQuery(id: number): Promise<{ is_favorite: boolean }> {
    return this.fetch(`/api/queries/saved-queries/${id}/favorite/`, {
      method: 'POST',
    })
  }

  async duplicateQuery(id: number): Promise<SavedQueryDetail> {
    return this.fetch(`/api/queries/saved-queries/${id}/duplicate/`, {
      method: 'POST',
    })
  }

  async executeQuery(id: number, executionData?: {
    success: boolean
    execution_time_ms: number
    result_count: number
    error_message?: string
    response_content?: any
  }): Promise<any> {
    return this.fetch(`/api/queries/saved-queries/${id}/execute/`, {
      method: 'POST',
      body: JSON.stringify(executionData || {}),
    })
  }

  // Helper method for backward compatibility
  async saveQuery(
    name: string,
    flow_data: { nodes: any[]; edges: any[] },
    generated_query: string,
    is_template?: boolean,
    category?: number
  ): Promise<SavedQueryDetail> {
    return this.createSavedQuery({
      name,
      flow_data,
      generated_query,
      is_template,
      category,
    })
  }

  // Alias for consistency
  async deleteQuery(id: number): Promise<void> {
    return this.deleteSavedQuery(id)
  }

  // Export/Import operations
  async exportQueries(queryIds: number[]): Promise<any> {
    const token = authService.getAccessToken()
    const response = await fetch(`${API_BASE_URL}/api/queries/saved-queries/export/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ query_ids: queryIds }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to export queries')
    }

    return response.json()
  }

  async importQueries(importData: any): Promise<{
    success_count: number
    error_count: number
    created_queries: SavedQueryDetail[]
    errors: Array<{ index: number; name: string; errors: any }>
  }> {
    const token = authService.getAccessToken()
    const response = await fetch(`${API_BASE_URL}/api/queries/saved-queries/import_queries/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(importData),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.errors || 'Failed to import queries')
    }

    return response.json()
  }

  async validateConnection(parentClass: string, childClass: string): Promise<{
    isValid: boolean
    message: string
    parentClass: string
    childClass: string
  }> {
    return this.fetch('/api/queries/saved-queries/validate-connection/', {
      method: 'POST',
      body: JSON.stringify({
        parentClass,
        childClass
      })
    })
  }

  async getChildClasses(parentClass: string): Promise<Array<{
    className: string
    label: string
    description?: string
  }>> {
    const response = await this.fetch(
      `/api/queries/saved-queries/child-classes/?parent=${encodeURIComponent(parentClass)}`
    )
    return response.children || []
  }

  async previewQuery(flowData: any, previewNodeId: string, connectionId: number, signal?: AbortSignal): Promise<{
    success: boolean
    results: any[]
    count: number
    query: string
    is_preview: boolean
  }> {
    return this.fetch('/api/queries/saved-queries/preview/', {
      method: 'POST',
      body: JSON.stringify({
        flow_data: flowData,
        preview_node_id: previewNodeId,
        connection_id: connectionId
      }),
      signal
    })
  }

  async generateQueryPath(flowData: any, forceStrategy?: string): Promise<{
    success: boolean
    preview_query: string
    strategy: string
    estimated_cost: number
    suggestions: string[]
    metadata: any
  }> {
    return this.fetch('/api/queries/saved-queries/generate-query/', {
      method: 'POST',
      body: JSON.stringify({
        flow_data: flowData,
        force_strategy: forceStrategy
      })
    })
  }

  /**
   * Generate query preview with optimization metadata (Phase 2)
   * This is the new recommended method for getting query previews
   */
  async generatePreview(flowData: any, forceStrategy?: string): Promise<{
    success: boolean
    preview_query: string
    strategy: string
    estimated_cost: number
    suggestions: string[]
    metadata: any
  }> {
    return this.fetch('/api/queries/saved-queries/generate-query/', {
      method: 'POST',
      body: JSON.stringify({
        flow_data: flowData,
        force_strategy: forceStrategy
      })
    })
  }

  // ── Validation Query actions ──────────────────────────────────

  async getValidationQueries(params?: {
    search?: string
    category?: number
    page?: number
    page_size?: number
  }): Promise<PaginatedResponse<SavedQueryListItem>> {
    const searchParams = new URLSearchParams()
    searchParams.set('is_validation_query', 'true')
    if (params?.search) searchParams.set('search', params.search)
    if (params?.category) searchParams.set('category', params.category.toString())
    if (params?.page) searchParams.set('page', params.page.toString())
    if (params?.page_size) searchParams.set('page_size', params.page_size.toString())
    return this.fetch(`/api/queries/saved-queries/?${searchParams.toString()}`)
  }

  async markAsValidationQuery(id: number, data: {
    is_validation_query: boolean
  }): Promise<SavedQueryDetail> {
    return this.fetch(`/api/queries/saved-queries/${id}/mark-as-validation/`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async exportValidationQueries(queryIds?: number[]): Promise<void> {
    const token = authService.getAccessToken()
    const response = await fetch(`${API_BASE_URL}/api/queries/saved-queries/export-validation/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(queryIds ? { query_ids: queryIds } : {}),
    })
    if (!response.ok) {
      const err = await response.json()
      throw new Error(err.error || 'Export failed')
    }
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fabrik_validation_queries_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async importValidationQueries(data: any, onDuplicate: 'skip' | 'overwrite' | 'rename' = 'skip'): Promise<{
    imported: number
    skipped: number
    overwritten: number
    errors: Array<{ index: number; name: string; error: string }>
    queries: number[]
  }> {
    return this.fetch('/api/queries/saved-queries/import-validation/', {
      method: 'POST',
      body: JSON.stringify({ ...data, on_duplicate: onDuplicate }),
    })
  }
}

export const queriesService = new QueriesService()
