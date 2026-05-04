// services/__tests__/apic.test.ts
//
// Tests for the APICService class: connection CRUD, test connection,
// query execution, and error handling.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock auth service before importing apic
vi.mock('../auth', () => ({
  authService: {
    getAccessToken: vi.fn(() => 'test-token'),
    refreshAccessToken: vi.fn(),
    logout: vi.fn(),
  },
}))

function textResponse(status: number, body: any): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(typeof body === 'string' ? JSON.parse(body) : body),
    text: () => Promise.resolve(text),
    headers: new Headers(),
    redirected: false,
    type: 'basic',
    url: '',
    clone: () => textResponse(status, body),
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response
}

describe('APICService', () => {
  let apicService: typeof import('../apic').apicService
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    vi.resetModules()
    const mod = await import('../apic')
    apicService = mod.apicService
  })

  // =============================================
  // getConnections
  // =============================================

  describe('getConnections', () => {
    it('returns list of connections', async () => {
      const connections = [
        { id: 1, name: 'APIC-1', url: 'https://apic1.example.com' },
        { id: 2, name: 'APIC-2', url: 'https://apic2.example.com' },
      ]
      fetchSpy.mockResolvedValueOnce(textResponse(200, connections))

      const result = await apicService.getConnections()
      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('APIC-1')
    })
  })

  // =============================================
  // getConnection
  // =============================================

  describe('getConnection', () => {
    it('returns a single connection', async () => {
      const conn = { id: 1, name: 'APIC-1', url: 'https://apic1.example.com' }
      fetchSpy.mockResolvedValueOnce(textResponse(200, conn))

      const result = await apicService.getConnection(1)
      expect(result.id).toBe(1)
      expect(result.name).toBe('APIC-1')
    })
  })

  // =============================================
  // createConnection
  // =============================================

  describe('createConnection', () => {
    it('creates and returns new connection', async () => {
      const created = { id: 3, name: 'New APIC', url: 'https://new-apic.example.com' }
      fetchSpy.mockResolvedValueOnce(textResponse(201, created))

      const result = await apicService.createConnection({
        name: 'New APIC',
        url: 'https://new-apic.example.com',
        username: 'admin',
        password: 'pass',
      })
      expect(result.id).toBe(3)

      // Verify request body
      const call = fetchSpy.mock.calls[0]
      expect(call[1].method).toBe('POST')
      const body = JSON.parse(call[1].body)
      expect(body.name).toBe('New APIC')
    })
  })

  // =============================================
  // updateConnection
  // =============================================

  describe('updateConnection', () => {
    it('updates and returns connection', async () => {
      const updated = { id: 1, name: 'Updated APIC', url: 'https://apic1.example.com' }
      fetchSpy.mockResolvedValueOnce(textResponse(200, updated))

      const result = await apicService.updateConnection(1, { name: 'Updated APIC' })
      expect(result.name).toBe('Updated APIC')

      const call = fetchSpy.mock.calls[0]
      expect(call[1].method).toBe('PATCH')
    })
  })

  // =============================================
  // deleteConnection
  // =============================================

  describe('deleteConnection', () => {
    it('deletes without error', async () => {
      // DELETE returns empty body
      fetchSpy.mockResolvedValueOnce(textResponse(204, ''))

      await expect(apicService.deleteConnection(1)).resolves.toBeUndefined()

      const call = fetchSpy.mock.calls[0]
      expect(call[1].method).toBe('DELETE')
    })
  })

  // =============================================
  // testConnection
  // =============================================

  describe('testConnection', () => {
    it('returns success result', async () => {
      fetchSpy.mockResolvedValueOnce(textResponse(200, {
        success: true,
        message: 'Connection successful',
      }))

      const result = await apicService.testConnection(1)
      expect(result.success).toBe(true)
      expect(result.message).toBe('Connection successful')
    })

    it('returns failure result', async () => {
      fetchSpy.mockResolvedValueOnce(textResponse(200, {
        success: false,
        message: 'Authentication failed',
      }))

      const result = await apicService.testConnection(1)
      expect(result.success).toBe(false)
    })
  })

  // =============================================
  // executeQuery
  // =============================================

  describe('executeQuery', () => {
    it('executes query and returns result', async () => {
      const queryResult = {
        success: true,
        data: { totalCount: '2', imdata: [{}, {}] },
        connection: { id: 1, name: 'APIC-1', url: 'https://apic1.example.com' },
      }
      fetchSpy.mockResolvedValueOnce(textResponse(200, queryResult))

      const result = await apicService.executeQuery({
        connection_id: 1,
        query_path: '/api/class/fvTenant.json',
      })
      expect(result.success).toBe(true)
      expect(result.data.totalCount).toBe('2')
    })

    it('sends POST request with correct body', async () => {
      fetchSpy.mockResolvedValueOnce(textResponse(200, { success: true }))

      await apicService.executeQuery({
        connection_id: 1,
        query_path: '/api/class/fvTenant.json',
        method: 'GET',
      })

      const call = fetchSpy.mock.calls[0]
      expect(call[1].method).toBe('POST')
      const body = JSON.parse(call[1].body)
      expect(body.connection_id).toBe(1)
      expect(body.query_path).toBe('/api/class/fvTenant.json')
    })
  })

  // =============================================
  // Error handling
  // =============================================

  describe('error handling', () => {
    it('throws on HTTP error with detail message', async () => {
      fetchSpy.mockResolvedValueOnce(textResponse(400, { detail: 'Bad request' }))

      await expect(apicService.getConnections()).rejects.toThrow('Bad request')
    })

    it('throws on invalid JSON response', async () => {
      const resp = {
        ok: true,
        status: 200,
        text: () => Promise.resolve('not json {broken'),
        headers: new Headers(),
        redirected: false,
        statusText: 'OK',
        type: 'basic',
        url: '',
        body: null,
        bodyUsed: false,
        clone: () => resp,
        json: () => Promise.reject(new Error('bad json')),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        blob: () => Promise.resolve(new Blob()),
        formData: () => Promise.resolve(new FormData()),
        bytes: () => Promise.resolve(new Uint8Array()),
      } as Response

      fetchSpy.mockResolvedValueOnce(resp)

      await expect(apicService.getConnections()).rejects.toThrow('Invalid JSON')
    })

    it('includes Authorization header', async () => {
      fetchSpy.mockResolvedValueOnce(textResponse(200, []))

      await apicService.getConnections()

      const call = fetchSpy.mock.calls[0]
      expect(call[1].headers['Authorization']).toBe('Bearer test-token')
    })
  })
})
