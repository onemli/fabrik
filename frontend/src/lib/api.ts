// lib/api.ts
//
// Low-level API helpers for MIM (ACI class metadata) endpoints. These bypass
// the services/ layer and call the MIM endpoints directly — used by ClassBrowserDialog
// and Explorer components where class data is fetched inline.

import axios from 'axios'
import type { MIMClass, MIMClassFullDetail, EnhancedMIMClass, PackageInfo, FavoriteClass, RecentClassEntry, APICQuery, QueryExecutionResult } from '@/types'
import { authService } from '@/services/auth'

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Add auth token to all requests
api.interceptors.request.use((config) => {
  const token = authService.getAccessToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Handle auth errors (401 refresh) and permission/quota errors (403/429 toast)
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config
    const status = error.response?.status

    if (status === 401 && !originalRequest._retry) {
      originalRequest._retry = true

      try {
        await authService.refreshAccessToken()
        const token = authService.getAccessToken()
        if (token) {
          originalRequest.headers.Authorization = `Bearer ${token}`
        }
        return api(originalRequest)
      } catch (refreshError) {
        authService.logout()
        window.location.href = '/login'
        return Promise.reject(refreshError)
      }
    }

    // Permission denied or quota exceeded — show toast with backend message
    if (status === 403 || status === 429) {
      const detail = error.response?.data?.detail
      if (detail && typeof detail === 'string') {
        // Lazy import to avoid circular deps
        import('sonner').then(({ toast }) => {
          toast.error(detail)
        })
      }
    }

    return Promise.reject(error)
  }
)

// MIM API
export const mimApi = {
  getClasses: async (limit = 100): Promise<MIMClass[]> => {
    const { data } = await api.get('/mim/classes/', { params: { limit } })
    return data
  },

  getClassDetail: async (className: string): Promise<MIMClassFullDetail> => {
    const { data } = await api.get(`/mim/classes/${className}/`)
    return data
  },

  searchClasses: async (query: string, limit = 50): Promise<MIMClass[]> => {
    const { data } = await api.get('/mim/classes/search/', {
      params: { q: query, limit },
    })
    return data
  },

  getContextRoots: async (): Promise<MIMClass[]> => {
    const { data } = await api.get('/mim/classes/roots/')
    return data
  },

  // Faz 3.2 — get_class_insights returns dnPattern + smartChildren (top 25
  // useful children, stats-filtered) + optimization + properties.
  getClassInsights: async (className: string): Promise<{
    dnPattern: { pattern: string; example: string; rnFormat: string; isContextRoot: boolean }
    smartChildren: { common: Array<{ className: string; label: string; classPkg?: string }>; statsCount: number; totalCount: number }
    optimization: { isContextRoot: boolean; preferredMethod: string; requiresParent: boolean; parentClass?: string; dnPattern: string }
    properties: { required: any[]; configurable: any[]; readOnly: any[] }
  }> => {
    const { data } = await api.get(`/mim/explorer/class/${className}/insights/`)
    return data
  },

  getClassHierarchy: async (className: string, depth = 3) => {
    const { data } = await api.get(`/mim/classes/${className}/hierarchy/`, {
      params: { depth },
    })
    return data
  },

  getRelatedClasses: async (className: string) => {
    const { data } = await api.get(`/mim/classes/${className}/related/`)
    return data
  },

  // Phase 1: Enhanced search endpoints
  enhancedSearchClasses: async (
    query: string,
    limit = 50,
    packageFilter?: string,
    filters?: {
      excludeDeprecated?: boolean
      excludeAbstract?: boolean
      excludeHidden?: boolean
      excludeMonitoring?: boolean
    }
  ): Promise<EnhancedMIMClass[]> => {
    const params: Record<string, string | number> = { q: query, limit }
    if (packageFilter) params.package = packageFilter
    if (filters?.excludeDeprecated) params.excludeDeprecated = 1
    if (filters?.excludeAbstract) params.excludeAbstract = 1
    if (filters?.excludeHidden) params.excludeHidden = 1
    if (filters?.excludeMonitoring) params.excludeMonitoring = 1
    const { data } = await api.get('/mim/classes/search/enhanced/', { params })
    return data
  },

  getPackages: async (): Promise<PackageInfo[]> => {
    const { data } = await api.get('/mim/packages/')
    return data
  },

  getTopPackages: async (limit = 20): Promise<PackageInfo[]> => {
    const { data } = await api.get('/mim/packages/top/', {
      params: { limit },
    })
    return data
  },

  searchChildClasses: async (
    parentClass: string,
    query: string,
    limit = 100
  ): Promise<MIMClass[]> => {
    const { data } = await api.get(`/mim/classes/${parentClass}/children/search/`, {
      params: { q: query, limit },
    })
    return data
  },

  // Faz 3.4 — org-wide trending classes (last N days, opt-in via UserProfile)
  getTrendingClasses: async (limit = 10, days = 30): Promise<Array<{
    className: string
    label: string
    classPkg: string
    usageScore: number
  }>> => {
    const { data } = await api.get('/mim/classes/trending/', { params: { limit, days } })
    return data
  },

  // Faz 2.2 — find classes by property name/label
  searchByProperty: async (
    query: string,
    limit = 50,
    packageFilter?: string,
    filters?: {
      excludeDeprecated?: boolean
      excludeAbstract?: boolean
      excludeHidden?: boolean
      excludeMonitoring?: boolean
    }
  ): Promise<EnhancedMIMClass[]> => {
    const params: Record<string, string | number> = { q: query, limit }
    if (packageFilter) params.package = packageFilter
    if (filters?.excludeDeprecated) params.excludeDeprecated = 1
    if (filters?.excludeAbstract) params.excludeAbstract = 1
    if (filters?.excludeHidden) params.excludeHidden = 1
    if (filters?.excludeMonitoring) params.excludeMonitoring = 1
    const { data } = await api.get('/mim/classes/by-property/', { params })
    return data
  },

  // LLM-powered class suggestion — every result validated against Neo4j MIM
  suggestClasses: async (
    description: string,
    parentClass?: string
  ): Promise<MIMClass[]> => {
    const { data } = await api.post('/mim/classes/suggest/', {
      description,
      ...(parentClass ? { parent_class: parentClass } : {}),
    })
    return data.suggestions as MIMClass[]
  },

  // Favorites (backend-stored, per-user)
  getFavorites: async (): Promise<FavoriteClass[]> => {
    const { data } = await api.get('/mim/favorites/')
    return data
  },

  addFavorite: async (favoriteData: {
    class_name: string
    label?: string
    class_pkg?: string
    note?: string
  }): Promise<FavoriteClass> => {
    const { data } = await api.post('/mim/favorites/', favoriteData)
    return data
  },

  updateFavorite: async (id: number, updates: { note?: string }): Promise<FavoriteClass> => {
    const { data } = await api.patch(`/mim/favorites/${id}/`, updates)
    return data
  },

  deleteFavorite: async (id: number): Promise<void> => {
    await api.delete(`/mim/favorites/${id}/`)
  },

  // Recent classes (backend-stored, per-user; falls back to localStorage offline)
  getRecentClasses: async (limit = 10): Promise<RecentClassEntry[]> => {
    const { data } = await api.get('/mim/recent/', { params: { limit } })
    return data
  },

  recordRecentClass: async (entry: {
    class_name: string
    label?: string
    class_pkg?: string
  }): Promise<RecentClassEntry> => {
    const { data } = await api.post('/mim/recent/', entry)
    return data
  },

  deleteRecentClass: async (id: number): Promise<void> => {
    await api.delete(`/mim/recent/${id}/`)
  },

  // Table Templates
  getTableTemplates: async (className?: string) => {
    const { data } = await api.get('/mim/table-templates/', {
      params: className ? { class_name: className } : undefined,
    })
    return data
  },

  getTableTemplate: async (id: number) => {
    const { data} = await api.get(`/mim/table-templates/${id}/`)
    return data
  },

  createTableTemplate: async (templateData: any) => {
    const { data } = await api.post('/mim/table-templates/', templateData)
    return data
  },

  updateTableTemplate: async (id: number, updates: any) => {
    const { data } = await api.patch(`/mim/table-templates/${id}/`, updates)
    return data
  },

  deleteTableTemplate: async (id: number): Promise<void> => {
    await api.delete(`/mim/table-templates/${id}/`)
  },

  // Table Preferences
  getTablePreferences: async (className?: string) => {
    const { data } = await api.get('/mim/table-preferences/', {
      params: className ? { class_name: className } : undefined,
    })
    return data
  },

  getTablePreference: async (id: number) => {
    const { data } = await api.get(`/mim/table-preferences/${id}/`)
    return data
  },

  createTablePreference: async (preferenceData: any) => {
    const { data } = await api.post('/mim/table-preferences/', preferenceData)
    return data
  },

  updateTablePreference: async (id: number, updates: any) => {
    const { data } = await api.patch(`/mim/table-preferences/${id}/`, updates)
    return data
  },

  deleteTablePreference: async (id: number): Promise<void> => {
    await api.delete(`/mim/table-preferences/${id}/`)
  },
}

// Query Builder API (to be implemented in backend)
export const queryApi = {
  generateQuery: async (flowData: unknown): Promise<APICQuery> => {
    const { data } = await api.post('/query/generate/', { flowData })
    return data
  },

  executeQuery: async (query: APICQuery): Promise<QueryExecutionResult> => {
    const { data } = await api.post('/query/execute/', { query })
    return data
  },

  saveQuery: async (name: string, flowData: unknown) => {
    const { data } = await api.post('/query/save/', { name, flowData })
    return data
  },

  loadQuery: async (id: string) => {
    const { data } = await api.get(`/query/${id}/`)
    return data
  },

  listQueries: async () => {
    const { data } = await api.get('/query/')
    return data
  },
}

export default api
