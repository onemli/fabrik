// services/__tests__/timeMachine.test.ts
//
// Tests for the TimeMachineService class: capture, queries, snapshots,
// comparison, settings, cleanup, heatmap, annotation, timeline.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../auth', () => ({
  authService: {
    getAccessToken: vi.fn(() => 'test-token'),
    refreshAccessToken: vi.fn(),
    logout: vi.fn(),
  },
}))

function jsonResponse(status: number, body: any): Response {
  const text = JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(text),
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
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response
}

function emptyResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'No Content',
    json: () => Promise.reject(new Error('no body')),
    text: () => Promise.resolve(''),
    headers: new Headers(),
    redirected: false,
    type: 'basic',
    url: '',
    clone: () => emptyResponse(status),
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response
}

describe('TimeMachineService', () => {
  let timeMachineService: typeof import('../timeMachine').timeMachineService
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    vi.resetModules()
    const mod = await import('../timeMachine')
    timeMachineService = mod.timeMachineService
  })

  describe('captureSnapshot', () => {
    it('sends capture request with correct body', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { success: true, snapshot_id: 'snap-1' }))

      const result = await timeMachineService.captureSnapshot({
        result_data: [{ dn: 'uni/tn-prod' }],
        apic_connection_id: 1,
        apic_connection_name: 'APIC-1',
        saved_query_id: 42,
        query_name: 'Tenants',
        class_name: 'fvTenant',
      })

      expect(result.success).toBe(true)
      expect(result.snapshot_id).toBe('snap-1')
      const call = fetchSpy.mock.calls[0]
      expect(call[1].method).toBe('POST')
      const body = JSON.parse(call[1].body)
      expect(body.saved_query_id).toBe(42)
      expect(body.class_name).toBe('fvTenant')
    })

    it('returns skipped when duplicate', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { success: true, skipped: true }))

      const result = await timeMachineService.captureSnapshot({
        result_data: [],
        apic_connection_id: 1,
        apic_connection_name: 'APIC-1',
      })

      expect(result.skipped).toBe(true)
    })
  })

  describe('listQueries', () => {
    it('returns queries list', async () => {
      const queries = {
        queries: [
          { id: 1, name: 'Tenants', snapshot_count: 5, type: 'saved' },
          { id: 2, name: 'BDs', snapshot_count: 3, type: 'saved' },
        ],
      }
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, queries))

      const result = await timeMachineService.listQueries()
      expect(result.queries).toHaveLength(2)
      expect(result.queries[0].name).toBe('Tenants')
    })
  })

  describe('getQuerySnapshots', () => {
    it('passes saved_query_id as query param', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { snapshots: [] }))

      await timeMachineService.getQuerySnapshots({ saved_query_id: 42 })

      const url = fetchSpy.mock.calls[0][0]
      expect(url).toContain('saved_query_id=42')
    })

    it('passes optional limit param', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { snapshots: [] }))

      await timeMachineService.getQuerySnapshots({ saved_query_id: 42, limit: 10 })

      const url = fetchSpy.mock.calls[0][0]
      expect(url).toContain('limit=10')
    })
  })

  describe('getSnapshotDetail', () => {
    it('fetches snapshot by id', async () => {
      const snapshot = { id: 'snap-1', query_name: 'Tenants', result_count: 5, result_data: [] }
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, snapshot))

      const result = await timeMachineService.getSnapshotDetail('snap-1')
      expect(result.id).toBe('snap-1')

      const url = fetchSpy.mock.calls[0][0]
      expect(url).toContain('/snapshots/snap-1/')
    })
  })

  describe('compareSnapshots', () => {
    it('sends comparison request', async () => {
      const comparison = {
        snapshot_from: { id: 'snap-1', executed_at: '2026-01-01', result_count: 5 },
        snapshot_to: { id: 'snap-2', executed_at: '2026-01-02', result_count: 6 },
        diff: { added: [], modified: [], deleted: [], total_changes: 1 },
        identical: false,
      }
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, comparison))

      const result = await timeMachineService.compareSnapshots({
        snapshot_from_id: 'snap-1',
        snapshot_to_id: 'snap-2',
      })

      expect(result.identical).toBe(false)
      expect(result.diff.total_changes).toBe(1)
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
      expect(body.snapshot_from_id).toBe('snap-1')
    })
  })

  describe('getSettings', () => {
    it('returns settings', async () => {
      const settings = {
        retention_policy: 'days',
        retention_days: 30,
        retention_count: 100,
        max_snapshot_size_mb: 50,
        warn_large_snapshots: true,
        auto_cleanup_enabled: true,
        store_duplicates: false,
      }
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, settings))

      const result = await timeMachineService.getSettings()
      expect(result.retention_policy).toBe('days')
      expect(result.retention_days).toBe(30)
    })
  })

  describe('updateSettings', () => {
    it('sends PUT with partial settings', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { message: 'Settings updated' }))

      const result = await timeMachineService.updateSettings({ retention_days: 60 })

      expect(result.message).toBe('Settings updated')
      const call = fetchSpy.mock.calls[0]
      expect(call[1].method).toBe('PUT')
      const body = JSON.parse(call[1].body)
      expect(body.retention_days).toBe(60)
    })
  })

  describe('cleanupPreview', () => {
    it('returns preview data', async () => {
      const preview = {
        snapshots_to_delete: 10,
        total_size_mb: 25.5,
        oldest_snapshot: '2025-01-01',
        newest_snapshot: '2025-06-01',
      }
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, preview))

      const result = await timeMachineService.cleanupPreview()
      expect(result.snapshots_to_delete).toBe(10)
    })

    it('passes optional query_id', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { snapshots_to_delete: 3 }))

      await timeMachineService.cleanupPreview(42)

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
      expect(body.query_id).toBe(42)
    })
  })

  describe('executeCleanup', () => {
    it('returns cleanup result', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { message: 'Cleaned up', deleted_count: 5 }))

      const result = await timeMachineService.executeCleanup()
      expect(result.deleted_count).toBe(5)
    })
  })

  describe('getHeatmapData', () => {
    it('passes saved_query_id and optional year', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { year: 2026, data: {} }))

      await timeMachineService.getHeatmapData({ saved_query_id: 42, year: 2026 })

      const url = fetchSpy.mock.calls[0][0]
      expect(url).toContain('saved_query_id=42')
      expect(url).toContain('year=2026')
    })
  })

  describe('annotateSnapshot', () => {
    it('sends annotation request', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, {
        id: 'snap-1', annotation: 'Production deploy', label: 'release',
      }))

      const result = await timeMachineService.annotateSnapshot('snap-1', {
        annotation: 'Production deploy',
        label: 'release',
      })

      expect(result.annotation).toBe('Production deploy')
      const url = fetchSpy.mock.calls[0][0]
      expect(url).toContain('/snap-1/annotate/')
    })
  })

  describe('getAttributeTimeline', () => {
    it('passes query params correctly', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, {
        dn: 'uni/tn-prod',
        saved_query_id: 42,
        snapshot_count: 3,
        points: [],
        attribute_evolution: [],
        tracked_attributes: [],
      }))

      await timeMachineService.getAttributeTimeline({
        saved_query_id: 42,
        dn: 'uni/tn-prod',
        limit: 10,
      })

      const url = fetchSpy.mock.calls[0][0]
      expect(url).toContain('saved_query_id=42')
      expect(url).toContain('dn=uni%2Ftn-prod')
      expect(url).toContain('limit=10')
    })
  })

  describe('error handling', () => {
    it('throws on HTTP error with detail', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(400, { detail: 'Invalid query' }))

      await expect(timeMachineService.listQueries())
        .rejects.toThrow('Invalid query')
    })

    it('handles 204 No Content', async () => {
      fetchSpy.mockResolvedValueOnce(emptyResponse(204))

      const result = await timeMachineService.executeCleanup()
      expect(result).toBeUndefined()
    })
  })

  describe('auth headers', () => {
    it('includes Authorization header', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { queries: [] }))

      await timeMachineService.listQueries()

      expect(fetchSpy.mock.calls[0][1].headers['Authorization']).toBe('Bearer test-token')
    })
  })
})
