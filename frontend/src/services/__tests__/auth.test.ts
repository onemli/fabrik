// services/__tests__/auth.test.ts
//
// Tests for the AuthService class: login, logout, register, token refresh,
// profile management, and MFA flows.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Helper to build a minimal Response for fetch mock
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

describe('AuthService', () => {
  let authService: typeof import('../auth').authService
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    localStorage.clear()
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    // Re-import to get a fresh instance
    vi.resetModules()
    const mod = await import('../auth')
    authService = mod.authService
  })

  // =============================================
  // Login
  // =============================================

  describe('login', () => {
    it('stores tokens on successful login', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, {
        access: 'test-access-token',
        refresh: 'test-refresh-token',
      }))

      const result = await authService.login({ username: 'admin', password: 'pass' })

      expect(result).toEqual({ access: 'test-access-token', refresh: 'test-refresh-token' })
      expect(localStorage.getItem('access_token')).toBe('test-access-token')
      expect(localStorage.getItem('refresh_token')).toBe('test-refresh-token')
      expect(authService.isAuthenticated()).toBe(true)
    })

    it('returns mfa_required on 202 status', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(202, {}))

      const result = await authService.login({ username: 'admin', password: 'pass' })

      expect(result).toEqual({ mfa_required: true })
    })

    it('throws on failed login', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(401, { detail: 'Invalid credentials' }))

      await expect(authService.login({ username: 'admin', password: 'wrong' }))
        .rejects.toThrow('Invalid credentials')
    })
  })

  // =============================================
  // Logout
  // =============================================

  describe('logout', () => {
    it('clears tokens from localStorage', () => {
      localStorage.setItem('access_token', 'tok')
      localStorage.setItem('refresh_token', 'ref')

      authService.logout()

      expect(localStorage.getItem('access_token')).toBeNull()
      expect(localStorage.getItem('refresh_token')).toBeNull()
      expect(authService.isAuthenticated()).toBe(false)
    })
  })

  // =============================================
  // Token Refresh
  // =============================================

  describe('refreshAccessToken', () => {
    it('updates access token on success', async () => {
      // Set initial tokens
      localStorage.setItem('refresh_token', 'old-refresh')
      vi.resetModules()
      const mod = await import('../auth')
      authService = mod.authService

      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { access: 'new-access-token' }))

      const result = await authService.refreshAccessToken()

      expect(result).toBe('new-access-token')
      expect(localStorage.getItem('access_token')).toBe('new-access-token')
    })

    it('throws when no refresh token available', async () => {
      await expect(authService.refreshAccessToken())
        .rejects.toThrow('No refresh token available')
    })

    it('calls logout on refresh failure', async () => {
      localStorage.setItem('refresh_token', 'bad-refresh')
      vi.resetModules()
      const mod = await import('../auth')
      authService = mod.authService

      fetchSpy.mockResolvedValueOnce(jsonResponse(401, { detail: 'Token expired' }))

      await expect(authService.refreshAccessToken()).rejects.toThrow('Token refresh failed')
      expect(authService.isAuthenticated()).toBe(false)
    })
  })

  // =============================================
  // Register
  // =============================================

  describe('register', () => {
    it('returns user on successful registration', async () => {
      const user = { id: 1, username: 'newuser', email: 'new@test.com' }
      fetchSpy.mockResolvedValueOnce(jsonResponse(201, user))

      const result = await authService.register({
        username: 'newuser',
        email: 'new@test.com',
        password: 'Password123!',
        password_confirm: 'Password123!',
        first_name: 'New',
        last_name: 'User',
      })

      expect(result.username).toBe('newuser')
    })

    it('throws on registration failure', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(400, { username: ['Already exists'] }))

      await expect(authService.register({
        username: 'existing',
        email: 'a@b.com',
        password: 'p',
        password_confirm: 'p',
        first_name: 'A',
        last_name: 'B',
      })).rejects.toThrow()
    })
  })

  // =============================================
  // Profile
  // =============================================

  describe('getProfile', () => {
    it('returns profile data', async () => {
      localStorage.setItem('access_token', 'valid-tok')
      vi.resetModules()
      const mod = await import('../auth')
      authService = mod.authService

      fetchSpy.mockResolvedValueOnce(jsonResponse(200, {
        id: 1, username: 'admin', email: 'admin@test.com',
      }))

      const profile = await authService.getProfile()
      expect(profile.username).toBe('admin')
    })
  })

  // =============================================
  // isAuthenticated / getAccessToken
  // =============================================

  describe('isAuthenticated', () => {
    it('returns false when no token', () => {
      expect(authService.isAuthenticated()).toBe(false)
    })

    it('returns true when token exists', async () => {
      localStorage.setItem('access_token', 'some-token')
      vi.resetModules()
      const mod = await import('../auth')
      expect(mod.authService.isAuthenticated()).toBe(true)
    })
  })

  describe('getAccessToken', () => {
    it('returns null when no token', () => {
      expect(authService.getAccessToken()).toBeNull()
    })

    it('returns token from localStorage', async () => {
      localStorage.setItem('access_token', 'my-token')
      vi.resetModules()
      const mod = await import('../auth')
      expect(mod.authService.getAccessToken()).toBe('my-token')
    })
  })

  // =============================================
  // Token Expiry Check
  // =============================================

  describe('isTokenExpiringSoon', () => {
    it('returns false when no token', () => {
      expect(authService.isTokenExpiringSoon()).toBe(false)
    })

    it('returns true when token expires within buffer', async () => {
      // Create a JWT with exp 60 seconds from now (less than 120 buffer)
      const exp = Math.floor(Date.now() / 1000) + 60
      const payload = btoa(JSON.stringify({ exp }))
      const fakeJwt = `header.${payload}.signature`

      localStorage.setItem('access_token', fakeJwt)
      vi.resetModules()
      const mod = await import('../auth')

      expect(mod.authService.isTokenExpiringSoon(120)).toBe(true)
    })

    it('returns false when token is not expiring soon', async () => {
      const exp = Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
      const payload = btoa(JSON.stringify({ exp }))
      const fakeJwt = `header.${payload}.signature`

      localStorage.setItem('access_token', fakeJwt)
      vi.resetModules()
      const mod = await import('../auth')

      expect(mod.authService.isTokenExpiringSoon(120)).toBe(false)
    })
  })

  // =============================================
  // Password Reset
  // =============================================

  describe('requestPasswordReset', () => {
    it('returns response on success', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, {
        message: 'Reset email sent',
        fallback: false,
      }))

      const result = await authService.requestPasswordReset('admin')
      expect(result.message).toBe('Reset email sent')
      expect(result.fallback).toBe(false)
    })

    it('throws on failure', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(404, { detail: 'User not found' }))

      await expect(authService.requestPasswordReset('nobody'))
        .rejects.toThrow('User not found')
    })
  })

  // =============================================
  // Change Password
  // =============================================

  describe('changePassword', () => {
    it('succeeds without error', async () => {
      localStorage.setItem('access_token', 'tok')
      vi.resetModules()
      const mod = await import('../auth')
      authService = mod.authService

      fetchSpy.mockResolvedValueOnce(jsonResponse(200, {}))

      await expect(authService.changePassword('old', 'new', 'new'))
        .resolves.toBeUndefined()
    })
  })

  // =============================================
  // MFA
  // =============================================

  describe('MFA flows', () => {
    beforeEach(async () => {
      localStorage.setItem('access_token', 'tok')
      vi.resetModules()
      const mod = await import('../auth')
      authService = mod.authService
    })

    it('mfaSetup returns secret and QR code', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, {
        secret: 'ABCDEF',
        otpauth_uri: 'otpauth://totp/...',
        qr_code: 'data:image/png;base64,...',
      }))

      const result = await authService.mfaSetup()
      expect(result.secret).toBe('ABCDEF')
    })

    it('mfaStatus returns enabled state', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, {
        mfa_enabled: true,
        backup_codes_remaining: 5,
      }))

      const result = await authService.mfaStatus()
      expect(result.mfa_enabled).toBe(true)
      expect(result.backup_codes_remaining).toBe(5)
    })

    it('mfaLogin stores tokens', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, {
        access: 'mfa-access',
        refresh: 'mfa-refresh',
      }))

      const result = await authService.mfaLogin('admin', 'pass', '123456')
      expect(result.access).toBe('mfa-access')
      expect(localStorage.getItem('access_token')).toBe('mfa-access')
    })
  })
})
