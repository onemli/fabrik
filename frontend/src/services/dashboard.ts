// services/dashboard.ts
//
// Thin client for the /api/dashboard/stats/ endpoint. All heavy lifting
// happens on the backend — this just ferries the JSON to React components.

import { authService } from './auth'

const API_BASE_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '')

export interface DashboardStats {
  generated_at: string
  queries: {
    total_saved: number
    executions_24h: number
    prev_24h: number
    running_now: number
    success_24h: number
    failed_24h: number
    success_rate_7d: number | null
    sparkline_7d: number[]
  }
  scheduled_tasks: {
    total: number
    active: number
    paused: number
    disabled: number
    executions_24h: number
    prev_24h: number
    success_24h: number
    failed_24h: number
    running_now: number
    overdue: number
    sparkline_7d: number[]
  }
  awx: {
    connections: number
    templates: number
    requests_7d: number
    prev_7d: number
    running_jobs: number
    successful_7d: number
    failed_7d: number
    failed_24h: number
    success_rate_7d: number | null
    sparkline_7d: number[]
  }
  time_machine: {
    total_snapshots: number
    snapshots_24h: number
    changes_detected_24h: number
    monitored_queries: number
    annotated_snapshots: number
  }
  connections: {
    total: number
    active: number
    inactive: number
  }
  activity: Array<{
    time: string | null
    action: string
    resource: string
    user: string
    success: boolean
  }>
  attention: Array<{
    severity: 'critical' | 'warning' | 'info'
    message: string
    link: string
  }>
}

async function fetchStats(): Promise<DashboardStats> {
  const token = authService.getAccessToken()
  const res = await fetch(`${API_BASE_URL}/api/dashboard/stats/`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) throw new Error(`Dashboard stats failed: ${res.status}`)
  return res.json()
}

export interface PlatformInfo {
  demo_mode: boolean
  version: string
  ldap_enabled: boolean
}

async function fetchPlatformInfo(): Promise<PlatformInfo> {
  const res = await fetch(`${API_BASE_URL}/api/dashboard/platform-info/`)
  if (!res.ok) throw new Error(`Platform info failed: ${res.status}`)
  return res.json()
}

export const dashboardService = { fetchStats, fetchPlatformInfo }
