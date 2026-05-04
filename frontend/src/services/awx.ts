// services/awx.ts
//
// API client for all AWX-related endpoints: connections, templates, requests,
// executions, validation lists, column templates, and AWX import.
// Uses the shared `api` axios instance (JWT auth + 401 redirect handled there).

import { api } from './api'

export interface AWXConnection {
  id: string
  name: string
  description: string
  url: string
  auth_type: 'token' | 'basic'
  username?: string
  verify_ssl: boolean
  timeout: number
  credential_prefix?: string
  awx_version?: string
  last_tested_at?: string
  last_test_status?: 'success' | 'failed'
  created_by: {
    id: number
    username: string
    email: string
  }
  is_public: boolean
  is_shared_with_me?: boolean
  created_at: string
  updated_at: string
  can_edit?: boolean
  can_delete?: boolean
}

export interface AWXConnectionCreate {
  name: string
  description?: string
  url: string
  auth_type: 'token' | 'basic'
  token?: string
  username?: string
  password?: string
  verify_ssl?: boolean
  timeout?: number
  credential_prefix?: string
  is_public?: boolean
  shared_with_ids?: number[]
}

export interface TemplateCategory {
  id: string
  name: string
  description: string
  color: string
  icon: string | null
  display_order: number
  template_count: number
  created_by: {
    id: number
    username: string
    email: string
  }
  created_at: string
  updated_at: string
}

export interface AutomationTemplate {
  id: string
  name: string
  description: string
  awx_connection: string
  awx_type: 'job_template' | 'workflow_template'
  awx_type_display: string
  awx_template_id: number
  awx_template_name: string
  workflow_job_nodes: Array<{
    order: number
    job_template_id: number
    name: string
  }>
  table_schemas: any[]
  variable_mappings: Record<string, any>
  category: string | null
  category_name?: string
  tags: string[]
  execution_count: number
  success_count: number
  failure_count: number
  success_rate: number
  last_executed_at: string | null
  created_by: {
    id: number
    username: string
    email: string
  }
  is_public: boolean
  execution_mode?: 'bulk'
  requires_validation?: boolean
  enable_check_mode?: boolean
  row_limit?: number
  created_at: string
  updated_at: string
  can_edit: boolean
  can_delete: boolean
}

export interface AWXJobTemplate {
  id: number
  name: string
  description: string
  project: number
  playbook: string
  ask_variables_on_launch: boolean
  survey_enabled: boolean
  survey_spec?: any
}

export interface AWXWorkflowTemplate {
  id: number
  name: string
  description: string
  ask_variables_on_launch: boolean
  survey_enabled: boolean
  survey_spec?: any
  workflow_nodes?: Array<{
    id: number
    unified_job_template: number
    identifier: string
    success_nodes: number[]
    failure_nodes: number[]
    always_nodes: number[]
  }>
}

export interface AutomationRequest {
  id: string
  title: string
  description: string
  status: 'pending' | 'running' | 'successful' | 'failed' | 'cancelled'
  template: string
  template_name?: string
  input_data: any[]
  requested_by?: {
    id: number
    username: string
    email: string
  }
  requested_at: string
  awx_job_id?: number
  awx_connection_url?: string
  created_at: string
  updated_at: string
}

export interface AutomationExecution {
  id: string
  automation_request: string
  automation_request_title: string
  template_name: string
  awx_job_id: number | null
  awx_job_url?: string
  status: 'pending' | 'waiting' | 'running' | 'successful' | 'failed' | 'error' | 'canceled'
  progress_percentage: number
  current_task?: string
  playbook_counts: {
    ok?: number
    changed?: number
    unreachable?: number
    failed?: number
    skipped?: number
    rescued?: number
    ignored?: number
  }
  execution_metadata?: {
    workflow_nodes?: Array<{
      id: number
      job: number
      status: string
      summary_fields?: {
        job?: {
          id: number
          name: string
          status: string
          type: string
        }
      }
    }>
    [key: string]: any
  }
  result_stdout?: string
  result_traceback?: string
  started_at?: string
  finished_at?: string
  elapsed_seconds?: number
  relaunch_of: string | null
  relaunch_count: number
  can_relaunch: boolean
  created_at: string
  updated_at: string
}

export const awxService = {
  // ============ AWX Connections ============

  async listConnections() {
    const response = await api.get('/api/awx/connections/')
    // Handle both paginated and non-paginated responses
    if (response.data.results) {
      return response.data.results as AWXConnection[]
    }
    return response.data as AWXConnection[]
  },

  async getConnection(id: string) {
    const response = await api.get(`/api/awx/connections/${id}/`)
    return response.data as AWXConnection
  },

  async createConnection(data: AWXConnectionCreate) {
    const response = await api.post('/api/awx/connections/', data)
    return response.data as AWXConnection
  },

  async updateConnection(id: string, data: Partial<AWXConnectionCreate>) {
    const response = await api.patch(`/api/awx/connections/${id}/`, data)
    return response.data as AWXConnection
  },

  async deleteConnection(id: string) {
    await api.delete(`/api/awx/connections/${id}/`)
  },

  async listCredentials(connectionId: string, params?: {
    credential_type?: number
    search?: string
    page?: number
    page_size?: number
  }) {
    const queryParams = new URLSearchParams()
    if (params?.credential_type) queryParams.append('credential_type', params.credential_type.toString())
    if (params?.search) queryParams.append('search', params.search)
    if (params?.page) queryParams.append('page', params.page.toString())
    if (params?.page_size) queryParams.append('page_size', params.page_size.toString())

    const url = `/api/awx/connections/${connectionId}/credentials/${queryParams.toString() ? '?' + queryParams.toString() : ''}`
    const response = await api.get(url)
    return response.data as {
      count: number
      results: Array<{
        id: number
        name: string
        description: string
        credential_type: number
        credential_type_name?: string
      }>
    }
  },

  async listCredentialTypes(connectionId: string) {
    const response = await api.get(`/api/awx/connections/${connectionId}/credential-types/`)
    return response.data as {
      count: number
      results: Array<{
        id: number
        name: string
        description: string
        kind: string
      }>
    }
  },

  async testConnection(id: string) {
    const response = await api.post(`/api/awx/connections/${id}/test/`)
    return response.data as {
      success: boolean
      message?: string
      error?: string
      metadata?: {
        version: string
        active_node: string
        install_uuid: string
      }
    }
  },

  async getConnectionTemplates(id: string, page = 1, pageSize = 50) {
    const response = await api.get(`/api/awx/connections/${id}/templates/?page=${page}&page_size=${pageSize}`)
    return response.data as {
      count: number
      results: any[]
    }
  },

  // ============ Template Categories ============

  async listCategories() {
    const response = await api.get('/api/awx/categories/')
    // Handle both paginated and non-paginated responses
    if (response.data.results) {
      return response.data.results as TemplateCategory[]
    }
    return response.data as TemplateCategory[]
  },

  async getCategory(id: string) {
    const response = await api.get(`/api/awx/categories/${id}/`)
    return response.data as TemplateCategory
  },

  async createCategory(data: {
    name: string
    description?: string
    color?: string
    icon?: string
    display_order?: number
  }) {
    const response = await api.post('/api/awx/categories/', data)
    return response.data as TemplateCategory
  },

  async updateCategory(id: string, data: Partial<TemplateCategory>) {
    const response = await api.patch(`/api/awx/categories/${id}/`, data)
    return response.data as TemplateCategory
  },

  async deleteCategory(id: string) {
    await api.delete(`/api/awx/categories/${id}/`)
  },

  // ============ Automation Templates ============

  async listTemplates(params?: {
    category?: string
    awx_type?: string
    search?: string
    ordering?: string
    page?: number
    page_size?: number
  }) {
    const queryParams = new URLSearchParams()
    if (params?.category) queryParams.append('category', params.category)
    if (params?.awx_type) queryParams.append('awx_type', params.awx_type)
    if (params?.search) queryParams.append('search', params.search)
    if (params?.ordering) queryParams.append('ordering', params.ordering)
    if (params?.page) queryParams.append('page', params.page.toString())
    if (params?.page_size) queryParams.append('page_size', params.page_size.toString())

    const url = `/api/awx/templates/${queryParams.toString() ? '?' + queryParams.toString() : ''}`
    const response = await api.get(url)

    // Handle both paginated and non-paginated responses
    if (response.data.results) {
      return response.data.results as AutomationTemplate[]
    }
    return response.data as AutomationTemplate[]
  },

  async getTemplate(id: string) {
    const response = await api.get(`/api/awx/templates/${id}/`)
    return response.data as AutomationTemplate
  },

  async createTemplate(data: {
    name: string
    description?: string
    awx_connection: string
    awx_type: 'job_template' | 'workflow_template'
    awx_template_id: number
    awx_template_name: string
    workflow_job_nodes?: any[]
    table_schemas?: any[]
    variable_mappings?: Record<string, any>
    category?: string | null
    tags?: string[]
    is_public?: boolean
  }) {
    const response = await api.post('/api/awx/templates/', data)
    return response.data as AutomationTemplate
  },

  async updateTemplate(id: string, data: Partial<AutomationTemplate>) {
    const response = await api.patch(`/api/awx/templates/${id}/`, data)
    return response.data as AutomationTemplate
  },

  async deleteTemplate(id: string) {
    await api.delete(`/api/awx/templates/${id}/`)
  },

  async validateTemplateInput(id: string, inputData: any, connectionId?: string) {
    const response = await api.post(`/api/awx/templates/${id}/validate-input/`, {
      input_data: inputData,
      connection_id: connectionId && connectionId.trim() !== '' ? parseInt(connectionId) : undefined
    })
    return response.data as { task_id: string; status: string; polling_interval: number }
  },

  async getValidationStatus(taskId: string) {
    const response = await api.get(`/api/awx/templates/validation-status/${taskId}/`)
    return response.data as {
      state: string
      status: string
      progress: number
      result?: { valid: boolean; errors: any[] }
      completed?: boolean
      error?: string
    }
  },

  // ============ AWX Connection - Browse Templates ============

  async getJobTemplates(connectionId: string, params?: { page?: number; page_size?: number; name?: string }) {
    const queryParams = new URLSearchParams()
    if (params?.page) queryParams.append('page', params.page.toString())
    if (params?.page_size) queryParams.append('page_size', params.page_size.toString())
    if (params?.name) queryParams.append('name', params.name)

    const url = `/api/awx/connections/${connectionId}/job-templates/${queryParams.toString() ? '?' + queryParams.toString() : ''}`
    const response = await api.get(url)
    return response.data as { count: number; results: AWXJobTemplate[] }
  },

  async getJobTemplateDetail(connectionId: string, templateId: number) {
    const response = await api.get(`/api/awx/connections/${connectionId}/job-templates/${templateId}/`)
    return response.data as AWXJobTemplate
  },

  async getWorkflowTemplates(connectionId: string, params?: { page?: number; page_size?: number; name?: string }) {
    const queryParams = new URLSearchParams()
    if (params?.page) queryParams.append('page', params.page.toString())
    if (params?.page_size) queryParams.append('page_size', params.page_size.toString())
    if (params?.name) queryParams.append('name', params.name)

    const url = `/api/awx/connections/${connectionId}/workflow-templates/${queryParams.toString() ? '?' + queryParams.toString() : ''}`
    const response = await api.get(url)
    return response.data as { count: number; results: AWXWorkflowTemplate[] }
  },

  async getWorkflowTemplateDetail(connectionId: string, templateId: number) {
    const response = await api.get(`/api/awx/connections/${connectionId}/workflow-templates/${templateId}/`)
    return response.data as AWXWorkflowTemplate
  },

  // ============ Automation Requests ============

  async listRequests(params?: {
    status?: string
    search?: string
    page?: number
    page_size?: number
  }) {
    const queryParams = new URLSearchParams()
    if (params?.status) queryParams.append('status', params.status)
    if (params?.search) queryParams.append('search', params.search)
    if (params?.page) queryParams.append('page', params.page.toString())
    if (params?.page_size) queryParams.append('page_size', params.page_size.toString())

    const url = `/api/awx/requests/${queryParams.toString() ? '?' + queryParams.toString() : ''}`
    const response = await api.get(url)
    // Backend returns paginated response: { count, next, previous, results }
    return (response.data.results || response.data) as AutomationRequest[]
  },

  async getRequest(id: string) {
    const response = await api.get(`/api/awx/requests/${id}/`)
    return response.data
  },

  async createRequest(data: {
    title: string
    description?: string
    template: string
    awx_connection: string
    target_apic?: string | number
    input_data: any
    check_mode?: boolean
    awx_credential_id: number
    awx_credential_name: string
    status?: 'draft'
  }) {
    const response = await api.post('/api/awx/requests/', data)
    return response.data as AutomationRequest
  },

  async updateRequest(id: string, data: any) {
    const response = await api.patch(`/api/awx/requests/${id}/`, data)
    return response.data
  },

  async deleteRequest(id: string) {
    await api.delete(`/api/awx/requests/${id}/`)
  },

  async getRequestDetail(id: string) {
    const response = await api.get(`/api/awx/requests/${id}/`)
    return response.data as AutomationRequest
  },

  async executeRequest(id: string) {
    const response = await api.post(`/api/awx/requests/${id}/execute/`)
    return response.data as {
      task_id: string
      message: string
      request_id: string
      execution_id?: string
    }
  },

  async retryExecution(requestId: string, executionId: string) {
    const response = await api.post(`/api/awx/requests/${requestId}/retry/`, { execution_id: executionId })
    return response.data as { task_id: string; message: string }
  },

  // ============ Automation Executions ============

  async listExecutions(params?: {
    search?: string
    page?: number
    page_size?: number
  }) {
    const queryParams = new URLSearchParams()
    if (params?.search) queryParams.append('search', params.search)
    if (params?.page) queryParams.append('page', params.page.toString())
    if (params?.page_size) queryParams.append('page_size', params.page_size.toString())

    const url = `/api/awx/executions/${queryParams.toString() ? '?' + queryParams.toString() : ''}`
    const response = await api.get(url)
    // Handle both paginated and non-paginated responses
    if (response.data.results) {
      return response.data.results as AutomationExecution[]
    }
    return response.data as AutomationExecution[]
  },

  async getExecution(id: string) {
    const response = await api.get(`/api/awx/executions/${id}/`)
    return response.data
  },

  async getExecutionStdout(id: string) {
    const response = await api.get(`/api/awx/executions/${id}/stdout/`)
    return response.data as {
      stdout: string
      status: string
      progress: number
    }
  },

  async cancelExecution(id: string) {
    const response = await api.post(`/api/awx/executions/${id}/cancel/`)
    return response.data as {
      message: string
    }
  },

  async relaunchExecution(id: string): Promise<{
    new_execution_id: string
    new_awx_job_id: number
    message: string
  }> {
    const response = await api.post(`/api/awx/executions/${id}/relaunch/`)
    return response.data
  },

}
