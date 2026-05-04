// services/__tests__/api.test.ts
//
// Tests the core API client's JWT refresh and logout behavior.
// These scenarios protect against the exact bug we hit: expired access tokens
// silently breaking all API calls instead of refreshing or redirecting to login.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock errorHandler before importing api — avoids pulling in the real module
vi.mock('../../lib/errorHandler', () => ({
  formatError: (err: any) => ({
    title: `Error ${err.response?.status ?? 0}`,
    description: err.message || 'Unknown error',
  }),
}))

const REFRESH_ENDPOINT = '/api/auth/token/refresh/'

// Helpers to build minimal Response-like objects for fetch mock
function jsonResponse(status: number, body: Record<string, any>): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers(),
    redirected: false,
    statusText: '',
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

describe('api client', () => {
  let api: typeof import('../api').api
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    localStorage.clear()
    localStorage.setItem('access_token', 'valid-access')
    localStorage.setItem('refresh_token', 'valid-refresh')

    fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    // Fresh import each test to reset module state
    vi.resetModules()
    const mod = await import('../api')
    api = mod.api
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -- Happy path --

  it('sends Bearer token on every request', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { ok: true }))

    await api.get('/api/test/')

    const [, init] = fetchSpy.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer valid-access')
  })

  it('returns parsed JSON on success', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { items: [1, 2, 3] }))

    const { data } = await api.get('/api/items/')

    expect(data).toEqual({ items: [1, 2, 3] })
  })

  it('returns null data on 204 No Content', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(204, {}))

    const { data } = await api.delete('/api/items/1/')

    expect(data).toBeNull()
  })

  it('sends JSON body on POST', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(201, { id: 1 }))

    await api.post('/api/items/', { name: 'test' })

    const [, init] = fetchSpy.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ name: 'test' })
  })

  // -- Token refresh on 401 --

  it('refreshes token and retries on 401', async () => {
    // First call: 401 (expired access token)
    fetchSpy.mockResolvedValueOnce(jsonResponse(401, { detail: 'Token expired' }))
    // Refresh call: success
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { access: 'new-access' }))
    // Retry: success
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { data: 'secret' }))

    const { data } = await api.get('/api/protected/')

    // Verify refresh was called with correct payload
    const [refreshUrl, refreshInit] = fetchSpy.mock.calls[1]
    expect(refreshUrl).toContain(REFRESH_ENDPOINT)
    expect(JSON.parse(refreshInit.body)).toEqual({ refresh: 'valid-refresh' })

    // Verify retry used the new token
    const [, retryInit] = fetchSpy.mock.calls[2]
    expect(retryInit.headers.Authorization).toBe('Bearer new-access')

    // Verify new token was persisted
    expect(localStorage.getItem('access_token')).toBe('new-access')

    expect(data).toEqual({ data: 'secret' })
  })

  it('does not retry more than once after refresh', async () => {
    // First call: 401
    fetchSpy.mockResolvedValueOnce(jsonResponse(401, { detail: 'Expired' }))
    // Refresh: success
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { access: 'new-access' }))
    // Retry: still 401 (e.g. token revoked server-side)
    fetchSpy.mockResolvedValueOnce(jsonResponse(401, { detail: 'Revoked' }))

    await expect(api.get('/api/protected/')).rejects.toThrow()

    // 3 calls total: original + refresh + retry. No infinite loop.
    expect(fetchSpy).toHaveBeenCalledTimes(3)
  })

  // -- Force logout scenarios --

  it('redirects to /login when refresh token is missing', async () => {
    localStorage.removeItem('refresh_token')
    fetchSpy.mockResolvedValueOnce(jsonResponse(401, { detail: 'Expired' }))

    await expect(api.get('/api/protected/')).rejects.toThrow()

    expect(localStorage.getItem('access_token')).toBeNull()
    expect(window.location.href).toContain('/login')
  })

  it('redirects to /login when refresh endpoint returns 401', async () => {
    // Original: 401
    fetchSpy.mockResolvedValueOnce(jsonResponse(401, { detail: 'Expired' }))
    // Refresh: also 401 (refresh token expired)
    fetchSpy.mockResolvedValueOnce(jsonResponse(401, { detail: 'Refresh expired' }))

    await expect(api.get('/api/protected/')).rejects.toThrow()

    expect(localStorage.getItem('access_token')).toBeNull()
    expect(localStorage.getItem('refresh_token')).toBeNull()
    expect(window.location.href).toContain('/login')
  })

  it('redirects to /login when refresh request fails with network error', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(401, { detail: 'Expired' }))
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await expect(api.get('/api/protected/')).rejects.toThrow()

    expect(localStorage.getItem('access_token')).toBeNull()
    expect(window.location.href).toContain('/login')
  })

  // -- Non-auth errors pass through --

  it('throws APIError on 403 without attempting refresh', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(403, { detail: 'Forbidden' }))

    await expect(api.get('/api/admin/')).rejects.toThrow('Forbidden')

    // Only 1 call — no refresh attempt
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('throws APIError on 500 without attempting refresh', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(500, { detail: 'Internal error' }))

    await expect(api.get('/api/broken/')).rejects.toThrow('Internal error')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('throws network error when fetch rejects', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await expect(api.get('/api/offline/')).rejects.toThrow('Failed to fetch')
  })

  // -- All HTTP methods --

  it.each(['get', 'post', 'put', 'patch', 'delete'] as const)(
    '%s method sends correct HTTP method',
    async (method) => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(method === 'delete' ? 204 : 200, {}))

      const body = method === 'get' || method === 'delete' ? undefined : { key: 'val' }
      await (api[method] as any)('/api/test/', body)

      const [, init] = fetchSpy.mock.calls[0]
      expect(init.method).toBe(method.toUpperCase())
    },
  )
})
