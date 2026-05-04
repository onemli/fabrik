// Static configuration objects and type definitions for the task management page.
// Kept separate so column definitions and components can import without pulling
// in the entire page bundle.

import {
  Clock,
  PlayCircle,
  PauseCircle,
  XCircle,
  CheckCircle2,
  Database,
  Camera,
} from 'lucide-react'

export interface ScheduledTask {
  id: string
  name: string
  description?: string
  priority: 'low' | 'medium' | 'high'
  order: number
  query_name: string
  saved_query: string
  apic_connection_ids: number[]
  variable_values?: Record<string, any>
  retry_enabled: boolean
  retry_count: number
  retry_interval_minutes: number
  frequency: 'once' | 'hourly' | 'daily' | 'weekly' | 'monthly'
  schedule_description: string
  status: 'active' | 'paused' | 'disabled'
  last_run_at?: string
  next_run_at?: string
  execution_count: number
  success_count: number
  failure_count: number
  success_rate: number
  created_at: string
  // System task fields
  task_type?: 'apic_query' | 'system_maintenance' | 'system_monitoring' | 'system_sync' | 'system_snapshot'
  category?: string
  is_system_task?: boolean
  system_task_handler?: string
}

export interface ScheduledExecution {
  id: string
  task_name: string
  scheduled_task: string
  apic_connection_id: number
  apic_connection_name: string
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled'
  result_count?: number
  error_message?: string
  retry_attempt: number
  is_retry: boolean
  created_at: string
  completed_at?: string
  execution_time_ms?: number
  duration_seconds?: number
}

export const priorityConfig = {
  high: { label: 'High', color: 'bg-red-500/10 text-red-500 border-red-500/20' },
  medium: { label: 'Medium', color: 'bg-orange-500/10 text-orange-500 border-orange-500/20' },
  low: { label: 'Low', color: 'bg-blue-500/10 text-blue-500 border-blue-500/20' },
}

export const statusConfig = {
  active: { label: 'Active', color: 'bg-green-500/10 text-green-500 border-green-500/20', icon: PlayCircle },
  paused: { label: 'Paused', color: 'bg-orange-500/10 text-orange-500 border-orange-500/20', icon: PauseCircle },
  disabled: { label: 'Disabled', color: 'bg-gray-500/10 text-muted-foreground border-gray-500/20', icon: XCircle },
}

export const executionStatusConfig = {
  pending: { label: 'Pending', color: 'bg-gray-500/10 text-muted-foreground', icon: Clock },
  running: { label: 'Running', color: 'bg-blue-500/10 text-blue-500', icon: PlayCircle },
  success: { label: 'Success', color: 'bg-green-500/10 text-green-500', icon: CheckCircle2 },
  failed: { label: 'Failed', color: 'bg-red-500/10 text-red-500', icon: XCircle },
  cancelled: { label: 'Cancelled', color: 'bg-gray-500/10 text-muted-foreground', icon: XCircle },
}

export const categoryConfig = {
  'Storage Management': {
    label: 'Storage Management',
    color: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
    icon: Database,
    description: 'Storage cleanup and compression tasks'
  },
  'Snapshot Management': {
    label: 'Snapshot Management',
    color: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    icon: Camera,
    description: 'Time Machine snapshot cleanup'
  },
}
