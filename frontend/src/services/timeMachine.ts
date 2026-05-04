// services/timeMachine.ts
//
// API client for Time Machine endpoints under /api/time-machine/.
// All snapshot capture, comparison, heatmap, annotation, and settings calls live here.

import { authService } from './auth'

const API_BASE_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '')

export interface TimeMachineSnapshot {
  id: string
  query_name: string
  class_name: string
  result_count: number
  result_size_bytes: number
  executed_at: string
  executed_by: string | null
  apic_connection_name: string
  execution_time_ms: number | null
  result_hash: string
  is_duplicate: boolean
  query_version: string
  query_version_hash: string
  execution_type: 'manual' | 'scheduled'
  has_changes: boolean
  annotation: string | null
  label: string | null
}

export interface TimeMachineSnapshotDetail extends TimeMachineSnapshot {
  result_data: any
  apic_connection_id: number
}

export interface TimeMachineQuery {
  type: 'saved'
  id: number
  name: string
  snapshot_count: number
  latest_execution: string
  version: string
  enable_time_machine: boolean
}

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export interface SnapshotComparison {
  snapshot_from: {
    id: string
    executed_at: string
    result_count: number
  }
  snapshot_to: {
    id: string
    executed_at: string
    result_count: number
  }
  diff: {
    added: Array<{ dn: string; object: any }>
    modified: Array<{ dn: string; before: any; after: any; attribute_changes: Array<{ key: string; old: any; new: any }> }>
    deleted: Array<{ dn: string; object: any }>
    total_changes: number
  }
  identical: boolean
}

// Attribute timeline types — N-snapshot evolution for a single DN
export interface TimelinePoint {
  snapshot_id: string
  executed_at: string
  present: boolean
  attributes: Record<string, any>
}

export interface AttributeEvolution {
  attribute: string
  change_count: number
  is_stable: boolean
  distinct_values: string[]
  values: Array<{
    executed_at: string
    snapshot_id: string
    value: any
    changed: boolean
  }>
}

export interface AttributeTimelineResult {
  dn: string
  saved_query_id: number
  snapshot_count: number
  points: TimelinePoint[]
  attribute_evolution: AttributeEvolution[]
  tracked_attributes: string[]
}

export interface TimeMachineSettings {
  retention_policy: 'unlimited' | 'days' | 'count'
  retention_days: number
  retention_count: number
  max_snapshot_size_mb: number
  warn_large_snapshots: boolean
  auto_cleanup_enabled: boolean
  store_duplicates: boolean
}

export interface CleanupPreview {
  snapshots_to_delete: number
  total_size_mb: number
  oldest_snapshot: string | null
  newest_snapshot: string | null
}

export interface HeatmapDayData {
  count: number
  has_changes: boolean
}

export interface HeatmapData {
  year: number
  data: Record<string, HeatmapDayData>
}

class TimeMachineService {
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
        try {
          await authService.refreshAccessToken()
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

    if (response.status === 204) {
      return undefined
    }

    const text = await response.text()
    return text ? JSON.parse(text) : undefined
  }

  /**
   * Capture a query execution snapshot
   */
  async captureSnapshot(params: {
    result_data: any
    apic_connection_id: number
    apic_connection_name: string
    saved_query_id?: number
    query_name?: string
    class_name?: string
    query_structure?: any
    execution_time_ms?: number
  }): Promise<{ success: boolean; snapshot_id?: string; skipped?: boolean; error?: string }> {
    return this.fetch('/api/time-machine/capture/', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  /**
   * List all queries with Time Machine snapshots
   */
  async listQueries(): Promise<{ queries: TimeMachineQuery[] }> {
    return this.fetch('/api/time-machine/queries/')
  }

  /**
   * Get snapshots for a specific SAVED query
   */
  async getQuerySnapshots(params: {
    saved_query_id: number
    limit?: number
    offset?: number
    date?: string | null
    timezone?: string
  }): Promise<{ snapshots: TimeMachineSnapshot[]; total_count: number }> {
    const searchParams = new URLSearchParams()
    searchParams.set('saved_query_id', params.saved_query_id.toString())
    if (params.limit) searchParams.set('limit', params.limit.toString())
    if (params.offset) searchParams.set('offset', params.offset.toString())
    if (params.date) searchParams.set('date', params.date)
    if (params.timezone) searchParams.set('timezone', params.timezone)

    return this.fetch(`/api/time-machine/snapshots/?${searchParams.toString()}`)
  }

  /**
   * Get detailed snapshot data
   */
  async getSnapshotDetail(snapshotId: string): Promise<TimeMachineSnapshotDetail> {
    return this.fetch(`/api/time-machine/snapshots/${snapshotId}/`)
  }

  /**
   * Compare two snapshots
   */
  async compareSnapshots(params: {
    snapshot_from_id: string
    snapshot_to_id: string
  }): Promise<SnapshotComparison> {
    return this.fetch('/api/time-machine/compare/', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  /**
   * Get Time Machine settings
   */
  async getSettings(): Promise<TimeMachineSettings> {
    return this.fetch('/api/time-machine/settings/')
  }

  /**
   * Update Time Machine settings
   */
  async updateSettings(settings: Partial<TimeMachineSettings>): Promise<{ message: string }> {
    return this.fetch('/api/time-machine/settings/', {
      method: 'PUT',
      body: JSON.stringify(settings),
    })
  }

  /**
   * Preview cleanup based on current settings
   */
  async cleanupPreview(queryId?: number): Promise<CleanupPreview> {
    return this.fetch('/api/time-machine/cleanup/preview/', {
      method: 'POST',
      body: JSON.stringify({ query_id: queryId }),
    })
  }

  /**
   * Execute cleanup
   */
  async executeCleanup(queryId?: number): Promise<{ message: string; deleted_count: number }> {
    return this.fetch('/api/time-machine/cleanup/execute/', {
      method: 'POST',
      body: JSON.stringify({ query_id: queryId }),
    })
  }

  /**
   * Get heatmap data for a query and year
   */
  async getHeatmapData(params: {
    saved_query_id: number
    year?: number
    timezone?: string
  }): Promise<HeatmapData> {
    const searchParams = new URLSearchParams()
    searchParams.set('saved_query_id', params.saved_query_id.toString())
    if (params.year) searchParams.set('year', params.year.toString())
    if (params.timezone) searchParams.set('timezone', params.timezone)
    return this.fetch(`/api/time-machine/heatmap/?${searchParams.toString()}`)
  }

  /**
   * Annotate a snapshot with a note or label
   */
  async annotateSnapshot(
    snapshotId: string,
    params: { annotation?: string; label?: string }
  ): Promise<{ id: string; annotation: string | null; label: string | null }> {
    return this.fetch(`/api/time-machine/snapshots/${snapshotId}/annotate/`, {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  // Get N-snapshot attribute evolution for a specific DN
  async getAttributeTimeline(params: {
    saved_query_id: number
    dn: string
    limit?: number
    from_date?: string
    to_date?: string
  }): Promise<AttributeTimelineResult> {
    const searchParams = new URLSearchParams()
    searchParams.set('saved_query_id', params.saved_query_id.toString())
    searchParams.set('dn', params.dn)
    if (params.limit) searchParams.set('limit', params.limit.toString())
    if (params.from_date) searchParams.set('from_date', params.from_date)
    if (params.to_date) searchParams.set('to_date', params.to_date)
    return this.fetch(`/api/time-machine/timeline/?${searchParams.toString()}`)
  }

  // List DNs from the latest snapshot of a saved query (autocomplete source)
  async listDnsInQuery(
    savedQueryId: number,
    search: string = '',
    limit: number = 50,
  ): Promise<{ dns: Array<{ dn: string; className: string }>; count: number }> {
    const sp = new URLSearchParams({ q: search, limit: limit.toString() })
    return this.fetch(
      `/api/time-machine/saved-queries/${savedQueryId}/dns/?${sp.toString()}`,
    )
  }
}

export const timeMachineService = new TimeMachineService()
