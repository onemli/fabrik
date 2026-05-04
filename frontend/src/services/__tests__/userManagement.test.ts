// services/__tests__/userManagement.test.ts
//
// Tests for UserManagementService: user CRUD, groups, permissions, password reset,
// quota, admin actions.

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

describe('UserManagementService', () => {
  let userManagementService: typeof import('../userManagement').userManagementService
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    vi.resetModules()
    const mod = await import('../userManagement')
    userManagementService = mod.userManagementService
  })

  // ============================================================
  // USER MANAGEMENT
  // ============================================================

  describe('listUsers', () => {
    it('returns paginated users', async () => {
      const response = { count: 1, next: null, previous: null, results: [{ id: 1, username: 'admin' }] }
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, response))

      const result = await userManagementService.listUsers()
      expect(result.count).toBe(1)
    })

    it('passes query params', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { count: 0, results: [] }))

      await userManagementService.listUsers({ search: 'admin', is_active: true })

      const url = fetchSpy.mock.calls[0][0] as string
      expect(url).toContain('search=admin')
      expect(url).toContain('is_active=true')
    })
  })

  describe('getUser', () => {
    it('returns user by id', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { id: 1, username: 'admin' }))

      const result = await userManagementService.getUser(1)
      expect(result.username).toBe('admin')
    })
  })

  describe('createUser', () => {
    it('creates user with POST', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(201, { id: 2, username: 'newuser' }))

      const result = await userManagementService.createUser({
        username: 'newuser',
        email: 'new@test.com',
        password: 'Pass123!',
        password_confirm: 'Pass123!',
        first_name: 'New',
        last_name: 'User',
        is_active: true,
      })

      expect(result.username).toBe('newuser')
      expect(fetchSpy.mock.calls[0][1].method).toBe('POST')
    })

    it('throws on validation error', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(400, { username: ['Already exists'] }))

      await expect(userManagementService.createUser({
        username: 'existing',
        email: 'a@b.com',
        password: 'p',
        password_confirm: 'p',
        first_name: 'A',
        last_name: 'B',
        is_active: true,
      })).rejects.toThrow()
    })
  })

  describe('updateUser', () => {
    it('sends PATCH request', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { id: 1, is_active: false }))

      await userManagementService.updateUser(1, { is_active: false })

      expect(fetchSpy.mock.calls[0][1].method).toBe('PATCH')
    })
  })

  describe('deleteUser', () => {
    it('sends DELETE request', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, {}))

      await expect(userManagementService.deleteUser(1)).resolves.toBeUndefined()
      expect(fetchSpy.mock.calls[0][1].method).toBe('DELETE')
    })
  })

  describe('resetPassword', () => {
    it('sends password reset POST', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, {}))

      await expect(
        userManagementService.resetPassword(1, 'NewPass123!', 'NewPass123!')
      ).resolves.toBeUndefined()

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
      expect(body.new_password).toBe('NewPass123!')
    })
  })

  describe('activateUser / deactivateUser', () => {
    it('activates user', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, {}))

      await expect(userManagementService.activateUser(1)).resolves.toBeUndefined()
      expect(fetchSpy.mock.calls[0][0]).toContain('/activate/')
    })

    it('deactivates user', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, {}))

      await expect(userManagementService.deactivateUser(1)).resolves.toBeUndefined()
      expect(fetchSpy.mock.calls[0][0]).toContain('/deactivate/')
    })
  })

  // ============================================================
  // GROUP MANAGEMENT
  // ============================================================

  describe('listGroups', () => {
    it('returns paginated groups', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { count: 1, results: [{ id: 1, name: 'Admin' }] }))

      const result = await userManagementService.listGroups()
      expect(result.count).toBe(1)
    })
  })

  describe('createGroup', () => {
    it('creates group', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(201, { id: 2, name: 'Operators' }))

      const result = await userManagementService.createGroup({ name: 'Operators' })
      expect(result.name).toBe('Operators')
    })
  })

  describe('deleteGroup', () => {
    it('deletes group', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, {}))

      await expect(userManagementService.deleteGroup(1)).resolves.toBeUndefined()
    })
  })

  describe('cloneGroup', () => {
    it('clones group with new name', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { id: 3, name: 'Admin Copy' }))

      const result = await userManagementService.cloneGroup(1, 'Admin Copy')
      expect(result.name).toBe('Admin Copy')

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
      expect(body.name).toBe('Admin Copy')
    })
  })

  // ============================================================
  // PERMISSIONS
  // ============================================================

  describe('listPermissions', () => {
    it('returns paginated permissions', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { count: 10, results: [] }))

      await userManagementService.listPermissions({ app_label: 'queries' })

      const url = fetchSpy.mock.calls[0][0] as string
      expect(url).toContain('app_label=queries')
    })
  })

  describe('getEffectivePermissions', () => {
    it('returns user effective permissions', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, [
        { id: 1, codename: 'add_query', source: 'Admin' },
      ]))

      const result = await userManagementService.getEffectivePermissions(1)
      expect(result).toHaveLength(1)
      expect(result[0].source).toBe('Admin')
    })
  })

  // ============================================================
  // ADMIN ACTIONS
  // ============================================================

  describe('generateResetCode', () => {
    it('returns reset code', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, {
        code: 'ABC123',
        expires_at: '2026-04-07T00:00:00Z',
        message: 'Code generated',
      }))

      const result = await userManagementService.generateResetCode(1)
      expect(result.code).toBe('ABC123')
    })
  })

  describe('adminVerifyEmail', () => {
    it('verifies email', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { message: 'Email verified' }))

      const result = await userManagementService.adminVerifyEmail(1)
      expect(result.message).toBe('Email verified')
    })
  })

  describe('adminDisableMfa', () => {
    it('disables MFA', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { message: 'MFA disabled' }))

      const result = await userManagementService.adminDisableMfa(1)
      expect(result.message).toBe('MFA disabled')
    })
  })

  // ============================================================
  // QUOTA
  // ============================================================

  describe('getGroupQuota', () => {
    it('returns quota data', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { group_name: 'Admin', max_saved_queries: 100 }))

      const result = await userManagementService.getGroupQuota(1)
      expect(result?.max_saved_queries).toBe(100)
    })

    it('returns null on 404', async () => {
      fetchSpy.mockResolvedValueOnce({ ok: false, status: 404, json: () => Promise.resolve({}) } as Response)

      const result = await userManagementService.getGroupQuota(999)
      expect(result).toBeNull()
    })
  })

  describe('getAuthHealth', () => {
    it('returns health data', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { status: 'healthy' }))

      const result = await userManagementService.getAuthHealth()
      expect(result.status).toBe('healthy')
    })

    it('returns empty object on error', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(500, {}))

      const result = await userManagementService.getAuthHealth()
      expect(result).toEqual({})
    })
  })

  describe('auth headers', () => {
    it('includes Authorization header', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { count: 0, results: [] }))

      await userManagementService.listUsers()

      const headers = fetchSpy.mock.calls[0][1].headers
      expect(headers['Authorization']).toBe('Bearer test-token')
    })
  })
})
