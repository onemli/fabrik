// services/pipeline.ts
//
// API client for pipeline execution — multi-stage queries where each stage's
// output feeds the next stage as filter input.

import { authService } from './auth'
import type { PipelineExecution, PipelineStageResult } from '@/types'

const API_BASE_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '')

class PipelineService {
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    const token = authService.getAccessToken()
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
    return headers
  }

  async executePipeline(
    flowData: { nodes: unknown[]; edges: unknown[] },
    connectionId: number,
    queryName: string,
    savedQueryId?: number
  ): Promise<PipelineExecution> {
    const response = await fetch(`${API_BASE_URL}/api/queries/pipeline-executions/`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        flow_data: flowData,
        apic_connection_id: connectionId,
        query_name: queryName,
        saved_query_id: savedQueryId,
      }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Pipeline execution failed' }))
      throw new Error(error.error || 'Pipeline execution failed')
    }

    return response.json()
  }

  async getPipelineStatus(jobId: string): Promise<PipelineExecution> {
    const response = await fetch(`${API_BASE_URL}/api/queries/pipeline-executions/${jobId}/`, {
      headers: this.getHeaders(),
    })

    if (!response.ok) {
      throw new Error('Failed to fetch pipeline status')
    }

    return response.json()
  }

  async getPipelineStages(jobId: string): Promise<PipelineStageResult[]> {
    const response = await fetch(`${API_BASE_URL}/api/queries/pipeline-executions/${jobId}/stages/`, {
      headers: this.getHeaders(),
    })

    if (!response.ok) {
      throw new Error('Failed to fetch pipeline stages')
    }

    return response.json()
  }

  async cancelPipeline(jobId: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/queries/pipeline-executions/${jobId}/cancel/`, {
      method: 'POST',
      headers: this.getHeaders(),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to cancel pipeline' }))
      throw new Error(error.error || 'Failed to cancel pipeline')
    }
  }

  async listPipelines(): Promise<PipelineExecution[]> {
    const response = await fetch(`${API_BASE_URL}/api/queries/pipeline-executions/`, {
      headers: this.getHeaders(),
    })

    if (!response.ok) {
      throw new Error('Failed to fetch pipelines')
    }

    return response.json()
  }
}

export const pipelineService = new PipelineService()
