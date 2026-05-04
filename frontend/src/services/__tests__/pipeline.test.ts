// services/__tests__/pipeline.test.ts
//
// Tests for the PipelineService class: execute, status, stages, cancel, list.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../auth', () => ({
  authService: {
    getAccessToken: vi.fn(() => 'test-token'),
  },
}))

function jsonResponse(status: number, body: any): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
    headers: new Headers(),
    redirected: false,
    type: 'basic',
    url: '',
    clone: () => jsonResponse(status, body),
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    text: () => Promise.resolve(JSON.stringify(body)),
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response
}

describe('PipelineService', () => {
  let pipelineService: typeof import('../pipeline').pipelineService
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    vi.resetModules()
    const mod = await import('../pipeline')
    pipelineService = mod.pipelineService
  })

  describe('executePipeline', () => {
    it('sends correct request body', async () => {
      const execution = { id: 'job-123', status: 'pending' }
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, execution))

      const flowData = { nodes: [{ id: 'n1' }], edges: [] }
      const result = await pipelineService.executePipeline(flowData, 1, 'Test Query', 42)

      expect(result.id).toBe('job-123')
      const call = fetchSpy.mock.calls[0]
      expect(call[1].method).toBe('POST')
      const body = JSON.parse(call[1].body)
      expect(body.flow_data).toEqual(flowData)
      expect(body.apic_connection_id).toBe(1)
      expect(body.query_name).toBe('Test Query')
      expect(body.saved_query_id).toBe(42)
    })

    it('throws on error', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(400, { error: 'No class nodes found' }))
      await expect(pipelineService.executePipeline({ nodes: [], edges: [] }, 1, 'Q'))
        .rejects.toThrow('No class nodes found')
    })
  })

  describe('getPipelineStatus', () => {
    it('returns execution status', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, {
        id: 'job-123', status: 'running', completed_iterations: 1, total_iterations: 3,
      }))

      const result = await pipelineService.getPipelineStatus('job-123')
      expect(result.status).toBe('running')
    })

    it('throws on not found', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(404, {}))
      await expect(pipelineService.getPipelineStatus('bad-id'))
        .rejects.toThrow('Failed to fetch pipeline status')
    })
  })

  describe('getPipelineStages', () => {
    it('returns stage results', async () => {
      const stages = [
        { stage_index: 0, class_name: 'fvTenant', status: 'success', result_count: 5 },
        { stage_index: 1, class_name: 'fvBD', status: 'success', result_count: 12 },
      ]
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, stages))

      const result = await pipelineService.getPipelineStages('job-123')
      expect(result).toHaveLength(2)
      expect(result[0].class_name).toBe('fvTenant')
    })
  })

  describe('cancelPipeline', () => {
    it('cancels without error', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, {}))
      await expect(pipelineService.cancelPipeline('job-123')).resolves.toBeUndefined()
      expect(fetchSpy.mock.calls[0][1].method).toBe('POST')
    })

    it('throws on cancel failure', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(400, { error: 'Already completed' }))
      await expect(pipelineService.cancelPipeline('job-123'))
        .rejects.toThrow('Already completed')
    })
  })

  describe('listPipelines', () => {
    it('returns pipeline list', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, [
        { id: 'job-1', status: 'completed' },
        { id: 'job-2', status: 'running' },
      ]))

      const result = await pipelineService.listPipelines()
      expect(result).toHaveLength(2)
    })
  })

  describe('auth headers', () => {
    it('includes Authorization header', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, []))
      await pipelineService.listPipelines()
      expect(fetchSpy.mock.calls[0][1].headers['Authorization']).toBe('Bearer test-token')
    })
  })
})
