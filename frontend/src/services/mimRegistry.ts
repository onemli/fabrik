// services/mimRegistry.ts
//
// Client for the /api/mim-registry/ endpoints. See backend/mim_registry/views.py.

import { api } from './api'

export interface MIMVersionRow {
  apic_version: string
  class_count: number
  property_count: number
  rel_count: number
  imported_at: string
  imported_by_username: string | null
  is_active: boolean
}

export interface ActiveImport {
  task_id: string
  apic_version: string
  source: 'devnet'
  devnet_run_id?: string
  phase?: 'init' | 'downloading' | 'importing' | 'finalizing' | 'done'
  state?: 'pending' | 'running' | 'success' | 'failed' | 'cancelled'
}

export interface MIMStatusResponse {
  loaded_version: string | null
  active: MIMVersionRow | null
  active_import: ActiveImport | null
  history: MIMVersionRow[]
}

// ---------- DevNet streaming importer ----------

export interface DevNetVersion {
  version_key: string
  label: string
  fallback_chain: string[]
  is_supported: boolean
  display_order: number
  class_count_seed: number
  notes: string
}

export interface DevNetInstallResponse {
  run_id: string
  task_id: string
  version_key: string
  total_classes: number
  concurrency: number
}

export interface MIMImportRunRow {
  id: string
  version_key: string
  state: 'pending' | 'running' | 'success' | 'failed' | 'cancelled'
  phase: 'init' | 'downloading' | 'importing' | 'finalizing' | 'done'
  total_classes: number
  completed_count: number
  fallback_count: number
  not_found_count: number
  failed_count: number
  concurrency: number
  started_by_username: string | null
  started_at: string
  finished_at: string | null
  error_summary: string
  cancel_requested: boolean
}

export interface MIMImportJobRow {
  id: number
  class_pkg: string
  class_name: string
  qualified_name: string
  state: 'pending' | 'in_progress' | 'done' | 'not_found' | 'failed'
  source_version: string
  attempted_versions: string[]
  http_status_last: number | null
  last_error: string
  retry_count: number
  updated_at: string
}

export interface DevNetRunDetail {
  run: MIMImportRunRow
  failed_recent: MIMImportJobRow[]
}

export const mimRegistryService = {
  async getStatus(): Promise<MIMStatusResponse> {
    const { data } = await api.get('/api/mim-registry/status/')
    return data
  },

  async listDevNetVersions(): Promise<DevNetVersion[]> {
    const { data } = await api.get('/api/mim-registry/devnet/versions/')
    return data
  },

  async startDevNetImport(versionKey: string, concurrency?: number): Promise<DevNetInstallResponse> {
    const body: { version_key: string; concurrency?: number } = { version_key: versionKey }
    if (concurrency !== undefined) body.concurrency = concurrency
    const { data } = await api.post('/api/mim-registry/devnet/install/', body)
    return data
  },

  async getDevNetRun(runId: string): Promise<DevNetRunDetail> {
    const { data } = await api.get(`/api/mim-registry/devnet/runs/${runId}/`)
    return data
  },

  async cancelDevNetRun(runId: string): Promise<void> {
    await api.post(`/api/mim-registry/devnet/runs/${runId}/cancel/`)
  },

  async resumeDevNetRun(runId: string): Promise<{ task_id: string; run_id: string }> {
    const { data } = await api.post(`/api/mim-registry/devnet/runs/${runId}/resume/`)
    return data
  },
}
