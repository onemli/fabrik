// services/__tests__/dashboard.test.ts
//
// Tests for dashboardService: fetchStats, fetchPlatformInfo.

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
    text: () => Promise.resolve(JSON.stringify(body)),
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

describe('dashboardService', () => {
  let dashboardService: typeof import('../dashboard').dashboardService
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    vi.resetModules()
    const mod = await import('../dashboard')
    dashboardService = mod.dashboardService
  })

  describe('fetchStats', () => {
    it('returns dashboard stats', async () => {
      const stats = {
        generated_at: '2026-04-06T10:00:00Z',
        queries: { total_saved: 10, executions_24h: 5 },
        scheduled_tasks: { total: 3 },
        awx: { connections: 2 },
        time_machine: { total_snapshots: 100 },
        connections: { total: 2, active: 1, inactive: 1 },
        activity: [],
        attention: [],
      }
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, stats))

      const result = await dashboardService.fetchStats()
      expect(result.queries.total_saved).toBe(10)
      expect(result.connections.total).toBe(2)
    })

    it('includes auth header', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, {}))

      await dashboardService.fetchStats()

      const headers = fetchSpy.mock.calls[0][1].headers
      expect(headers.Authorization).toBe('Bearer test-token')
    })

    it('throws on error', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(500, {}))

      await expect(dashboardService.fetchStats()).rejects.toThrow('Dashboard stats failed: 500')
    })
  })

  describe('fetchPlatformInfo', () => {
    it('returns platform info', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, {
        demo_mode: false,
        version: '1.0.1',
        ldap_enabled: true,
      }))

      const result = await dashboardService.fetchPlatformInfo()
      expect(result.demo_mode).toBe(false)
      expect(result.version).toBe('1.0.1')
    })

    it('throws on error', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(500, {}))

      await expect(dashboardService.fetchPlatformInfo()).rejects.toThrow('Platform info failed: 500')
    })
  })
})
