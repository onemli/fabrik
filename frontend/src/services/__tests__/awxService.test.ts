/**
 * AWX Service Tests
 *
 * Tests all API methods in awxService against mocked axios responses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { awxService } from '../awx'
import { api } from '../api'

vi.mock('../api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

const mockApi = vi.mocked(api)

// ── Helpers ───────────────────────────────────────────────────────────────────

const CONNECTION = {
  id: 'conn-1',
  name: 'Test AWX',
  url: 'https://awx.test',
  auth_type: 'token' as const,
  verify_ssl: true,
  timeout: 30,
  is_public: false,
  created_by: { id: 1, username: 'admin', email: 'a@t.com' },
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

const TEMPLATE = {
  id: 'tmpl-1',
  name: 'Deploy Template',
  awx_type: 'job_template' as const,
  awx_template_id: 42,
  awx_template_name: 'Deploy',
  table_schemas: [],
  variable_mappings: {},
  execution_mode: 'bulk' as const,
  execution_count: 0,
  success_count: 0,
  failure_count: 0,
}

const REQUEST = {
  id: 'req-1',
  title: 'My Request',
  status: 'pending',
  input_data: { data: [] },
  created_at: '2024-01-01T00:00:00Z',
}

const EXECUTION = {
  id: 'exec-1',
  status: 'running',
  progress_percentage: 50,
  awx_job_id: 99,
  created_at: '2024-01-01T00:00:00Z',
}

// ── Connections ───────────────────────────────────────────────────────────────

describe('awxService.connections', () => {

  beforeEach(() => { vi.clearAllMocks() })

  it('listConnections() calls GET /api/awx/connections/', async () => {
    mockApi.get.mockResolvedValueOnce({ data: [CONNECTION] })
    const result = await awxService.listConnections()
    expect(mockApi.get).toHaveBeenCalledWith('/api/awx/connections/')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Test AWX')
  })

  it('getConnection(id) calls GET /api/awx/connections/{id}/', async () => {
    mockApi.get.mockResolvedValueOnce({ data: CONNECTION })
    const result = await awxService.getConnection('conn-1')
    expect(mockApi.get).toHaveBeenCalledWith('/api/awx/connections/conn-1/')
    expect(result.id).toBe('conn-1')
  })

  it('createConnection() calls POST /api/awx/connections/', async () => {
    mockApi.post.mockResolvedValueOnce({ data: CONNECTION })
    const result = await awxService.createConnection({
      name: 'New', url: 'https://awx', auth_type: 'token', token: 'tok',
    })
    expect(mockApi.post).toHaveBeenCalledWith(
      '/api/awx/connections/',
      expect.objectContaining({ name: 'New' })
    )
    expect(result.id).toBe('conn-1')
  })

  it('updateConnection() calls PATCH /api/awx/connections/{id}/', async () => {
    mockApi.patch.mockResolvedValueOnce({ data: { ...CONNECTION, name: 'Updated' } })
    const result = await awxService.updateConnection('conn-1', { name: 'Updated' })
    expect(mockApi.patch).toHaveBeenCalledWith(
      '/api/awx/connections/conn-1/',
      { name: 'Updated' }
    )
    expect(result.name).toBe('Updated')
  })

  it('deleteConnection() calls DELETE /api/awx/connections/{id}/', async () => {
    mockApi.delete.mockResolvedValueOnce({ data: {} })
    await awxService.deleteConnection('conn-1')
    expect(mockApi.delete).toHaveBeenCalledWith('/api/awx/connections/conn-1/')
  })

  it('testConnection() calls POST /api/awx/connections/{id}/test/', async () => {
    mockApi.post.mockResolvedValueOnce({
      data: { success: true, message: 'Connected', metadata: { version: '24.0' } }
    })
    const result = await awxService.testConnection('conn-1')
    expect(mockApi.post).toHaveBeenCalledWith('/api/awx/connections/conn-1/test/')
    expect(result.success).toBe(true)
  })

  it('handles testConnection failure response', async () => {
    mockApi.post.mockResolvedValueOnce({
      data: { success: false, error: 'Connection refused' }
    })
    const result = await awxService.testConnection('conn-1')
    expect(result.success).toBe(false)
  })
})

// ── Templates ─────────────────────────────────────────────────────────────────

describe('awxService.templates', () => {

  beforeEach(() => { vi.clearAllMocks() })

  it('listTemplates() calls GET /api/awx/templates/', async () => {
    mockApi.get.mockResolvedValueOnce({ data: { results: [TEMPLATE], count: 1 } })
    await awxService.listTemplates()
    expect(mockApi.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/awx/templates')
    )
  })

  it('createTemplate() calls POST /api/awx/templates/', async () => {
    mockApi.post.mockResolvedValueOnce({ data: TEMPLATE })
    await awxService.createTemplate({
      name: 'New', awx_connection: 'conn-1',
      awx_type: 'job_template', awx_template_id: 1, awx_template_name: 'JT',
      table_schemas: [], variable_mappings: {},
    })
    expect(mockApi.post).toHaveBeenCalledWith('/api/awx/templates/', expect.any(Object))
  })

  it('updateTemplate() calls PATCH /api/awx/templates/{id}/', async () => {
    mockApi.patch.mockResolvedValueOnce({ data: TEMPLATE })
    await awxService.updateTemplate('tmpl-1', { name: 'Updated' })
    expect(mockApi.patch).toHaveBeenCalledWith('/api/awx/templates/tmpl-1/', { name: 'Updated' })
  })

  it('deleteTemplate() calls DELETE /api/awx/templates/{id}/', async () => {
    mockApi.delete.mockResolvedValueOnce({ data: {} })
    await awxService.deleteTemplate('tmpl-1')
    expect(mockApi.delete).toHaveBeenCalledWith('/api/awx/templates/tmpl-1/')
  })
})

// ── Requests ──────────────────────────────────────────────────────────────────

describe('awxService.requests', () => {

  beforeEach(() => { vi.clearAllMocks() })

  it('listRequests() calls GET /api/awx/requests/', async () => {
    mockApi.get.mockResolvedValueOnce({ data: { results: [REQUEST], count: 1 } })
    await awxService.listRequests({})
    expect(mockApi.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/awx/requests')
    )
  })

  it('createRequest() calls POST /api/awx/requests/', async () => {
    mockApi.post.mockResolvedValueOnce({ data: REQUEST })
    await awxService.createRequest({
      title: 'Req', template: 'tmpl-1',
      awx_connection: 'conn-1', input_data: { data: [] },
      awx_credential_id: 1, awx_credential_name: 'cred',
    })
    expect(mockApi.post).toHaveBeenCalledWith('/api/awx/requests/', expect.any(Object))
  })

  it('executeRequest() calls POST /api/awx/requests/{id}/execute/', async () => {
    mockApi.post.mockResolvedValueOnce({
      data: { task_id: 'task-1', message: 'ok', request_id: 'req-1' }
    })
    const result = await awxService.executeRequest('req-1')
    expect(mockApi.post).toHaveBeenCalledWith('/api/awx/requests/req-1/execute/')
    expect(result).toHaveProperty('task_id')
  })

  it('executeRequest() calls POST /api/awx/requests/{id}/execute/', async () => {
    mockApi.post.mockResolvedValueOnce({ data: { task_id: 'task-1', message: 'ok' } })
    const result = await awxService.executeRequest('req-1')
    expect(mockApi.post).toHaveBeenCalledWith('/api/awx/requests/req-1/execute/')
    expect(result).toHaveProperty('task_id')
  })
})

// ── Executions ────────────────────────────────────────────────────────────────

describe('awxService.executions', () => {

  beforeEach(() => { vi.clearAllMocks() })

  it('listExecutions() calls GET /api/awx/executions/', async () => {
    mockApi.get.mockResolvedValueOnce({ data: { results: [EXECUTION], count: 1 } })
    await awxService.listExecutions({})
    expect(mockApi.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/awx/executions')
    )
  })

  it('getExecution(id) calls GET /api/awx/executions/{id}/', async () => {
    mockApi.get.mockResolvedValueOnce({ data: EXECUTION })
    const result = await awxService.getExecution('exec-1')
    expect(mockApi.get).toHaveBeenCalledWith('/api/awx/executions/exec-1/')
    expect(result.id).toBe('exec-1')
  })

  it('cancelExecution() calls POST /api/awx/executions/{id}/cancel/', async () => {
    mockApi.post.mockResolvedValueOnce({ data: { success: true } })
    await awxService.cancelExecution('exec-1')
    expect(mockApi.post).toHaveBeenCalledWith('/api/awx/executions/exec-1/cancel/')
  })

  it('getExecutionStdout() calls GET /api/awx/executions/{id}/stdout/', async () => {
    mockApi.get.mockResolvedValueOnce({
      data: { stdout: 'PLAY [all] ****\r\n' }
    })
    const result = await awxService.getExecutionStdout('exec-1')
    expect(mockApi.get).toHaveBeenCalledWith(
      expect.stringContaining('exec-1')
    )
    expect(result).toHaveProperty('stdout')
  })
})

// ── Error Handling ────────────────────────────────────────────────────────────

describe('awxService error propagation', () => {

  beforeEach(() => { vi.clearAllMocks() })

  it('propagates network errors from listConnections()', async () => {
    mockApi.get.mockRejectedValueOnce(new Error('Network error'))
    await expect(awxService.listConnections()).rejects.toThrow('Network error')
  })

  it('propagates 404 errors from getConnection()', async () => {
    const err = Object.assign(new Error('Not Found'), { response: { status: 404 } })
    mockApi.get.mockRejectedValueOnce(err)
    await expect(awxService.getConnection('nonexistent')).rejects.toThrow()
  })

  it('propagates 400 errors from createConnection()', async () => {
    const err = Object.assign(new Error('Bad Request'), {
      response: { status: 400, data: { name: ['This field is required.'] } }
    })
    mockApi.post.mockRejectedValueOnce(err)
    await expect(
      awxService.createConnection({ name: '', url: '', auth_type: 'token' })
    ).rejects.toThrow()
  })
})
