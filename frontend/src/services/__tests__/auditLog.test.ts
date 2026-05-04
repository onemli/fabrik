// services/__tests__/auditLog.test.ts
//
// Tests for AuditLogService: listLogs, getLog, exportLogs, settings, login attempts, stats.

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

describe('AuditLogService', () => {
  let auditLogService: typeof import('../auditLog').auditLogService
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    vi.resetModules()
    const mod = await import('../auditLog')
    auditLogService = mod.auditLogService
  })

  describe('listLogs', () => {
    it('returns paginated logs', async () => {
      const response = { count: 2, next: null, previous: null, results: [{ id: '1' }, { id: '2' }] }
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, response))

      const result = await auditLogService.listLogs()
      expect(result.count).toBe(2)
      expect(result.results).toHaveLength(2)
    })

    it('passes filter params as query string', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { count: 0, results: [] }))

      await auditLogService.listLogs({ category: 'auth', page: 2 })

      const url = fetchSpy.mock.calls[0][0] as string
      expect(url).toContain('category=auth')
      expect(url).toContain('page=2')
    })

    it('throws on error', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Forbidden'),
      } as Response)

      await expect(auditLogService.listLogs()).rejects.toThrow('Failed to fetch audit logs')
    })
  })

  describe('getLog', () => {
    it('returns single log entry', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { id: '123', action: 'login' }))

      const result = await auditLogService.getLog('123')
      expect(result.id).toBe('123')
    })
  })

  describe('getSettings', () => {
    it('returns audit settings', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { user_management_retention_days: 90 }))

      const result = await auditLogService.getSettings()
      expect(result.user_management_retention_days).toBe(90)
    })
  })

  describe('updateSettings', () => {
    it('sends PATCH request', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { retention_days: 60 }))

      await auditLogService.updateSettings({ retention_days: 60 } as any)

      const call = fetchSpy.mock.calls[0]
      expect(call[1].method).toBe('PATCH')
    })
  })

  describe('getLoginAttempts', () => {
    it('returns login attempts', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { results: [{ username: 'admin' }] }))

      const result = await auditLogService.getLoginAttempts()
      expect(result.results).toHaveLength(1)
    })

    it('passes filter params', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { results: [] }))

      await auditLogService.getLoginAttempts({ username: 'admin' })

      const url = fetchSpy.mock.calls[0][0] as string
      expect(url).toContain('username=admin')
    })
  })

  describe('getStats', () => {
    it('returns stats', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, {
        total_logs: 100,
        by_category: [{ category: 'auth', count: 50 }],
        by_action: [],
      }))

      const result = await auditLogService.getStats()
      expect(result.total_logs).toBe(100)
    })
  })

  describe('auth headers', () => {
    it('includes Authorization header', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { count: 0, results: [] }))

      await auditLogService.listLogs()

      const headers = fetchSpy.mock.calls[0][1].headers
      expect(headers['Authorization']).toBe('Bearer test-token')
    })
  })
})
