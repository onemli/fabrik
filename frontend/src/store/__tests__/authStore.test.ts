// store/__tests__/authStore.test.ts
//
// Tests for useAuthStore: login, logout, loadUser, MFA flow, register, error handling.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from '@testing-library/react'

vi.mock('../../services/auth', () => ({
  authService: {
    login: vi.fn(),
    ldapLogin: vi.fn(),
    mfaLogin: vi.fn(),
    register: vi.fn(),
    getProfile: vi.fn(),
    logout: vi.fn(),
    isAuthenticated: vi.fn(),
    isTokenExpiringSoon: vi.fn(),
    refreshAccessToken: vi.fn(),
  },
}))

import { useAuthStore, MFARequiredError } from '../authStore'
import { authService } from '../../services/auth'

const mockAuthService = authService as any

describe('useAuthStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store state
    useAuthStore.setState({ user: null, isLoading: false, error: null })
  })

  describe('login', () => {
    it('sets user on successful login', async () => {
      const mockUser = { id: 1, username: 'admin' }
      mockAuthService.login.mockResolvedValueOnce({ access: 'tok', refresh: 'ref' })
      mockAuthService.getProfile.mockResolvedValueOnce(mockUser)

      await act(async () => {
        await useAuthStore.getState().login('admin', 'pass')
      })

      expect(useAuthStore.getState().user).toEqual(mockUser)
      expect(useAuthStore.getState().isLoading).toBe(false)
      expect(useAuthStore.getState().error).toBeNull()
    })

    it('throws MFARequiredError on 202 response', async () => {
      mockAuthService.login.mockResolvedValueOnce({ mfa_required: true })

      let thrown: Error | null = null
      try {
        await useAuthStore.getState().login('admin', 'pass')
      } catch (e) {
        thrown = e as Error
      }

      expect(thrown).toBeInstanceOf(MFARequiredError)
      expect(useAuthStore.getState().user).toBeNull()
      expect(useAuthStore.getState().isLoading).toBe(false)
    })

    it('sets error on login failure', async () => {
      mockAuthService.login.mockRejectedValueOnce(new Error('Invalid credentials'))

      let thrown: Error | null = null
      try {
        await useAuthStore.getState().login('admin', 'wrong')
      } catch (e) {
        thrown = e as Error
      }

      expect(thrown?.message).toBe('Invalid credentials')
      expect(useAuthStore.getState().error).toBe('Invalid credentials')
      expect(useAuthStore.getState().isLoading).toBe(false)
    })
  })

  describe('ldapLogin', () => {
    it('sets user on successful LDAP login', async () => {
      const mockUser = { id: 1, username: 'ldapuser' }
      mockAuthService.ldapLogin.mockResolvedValueOnce({ access: 'tok' })
      mockAuthService.getProfile.mockResolvedValueOnce(mockUser)

      await act(async () => {
        await useAuthStore.getState().ldapLogin('ldapuser', 'pass')
      })

      expect(useAuthStore.getState().user?.username).toBe('ldapuser')
    })
  })

  describe('mfaLogin', () => {
    it('sets user after MFA verification', async () => {
      const mockUser = { id: 1, username: 'admin' }
      mockAuthService.mfaLogin.mockResolvedValueOnce({ access: 'tok' })
      mockAuthService.getProfile.mockResolvedValueOnce(mockUser)

      await act(async () => {
        await useAuthStore.getState().mfaLogin('admin', 'pass', '123456')
      })

      expect(useAuthStore.getState().user?.username).toBe('admin')
    })

    it('sets error on MFA failure', async () => {
      mockAuthService.mfaLogin.mockRejectedValueOnce(new Error('Invalid TOTP code'))

      let thrown: Error | null = null
      try {
        await useAuthStore.getState().mfaLogin('admin', 'pass', '000000')
      } catch (e) {
        thrown = e as Error
      }

      expect(thrown?.message).toBe('Invalid TOTP code')
      expect(useAuthStore.getState().error).toBe('Invalid TOTP code')
    })
  })

  describe('register', () => {
    it('auto-logs in after registration', async () => {
      const mockUser = { id: 2, username: 'newuser' }
      mockAuthService.register.mockResolvedValueOnce({ id: 2 })
      mockAuthService.login.mockResolvedValueOnce({ access: 'tok' })
      mockAuthService.getProfile.mockResolvedValueOnce(mockUser)

      await act(async () => {
        await useAuthStore.getState().register({
          username: 'newuser',
          email: 'new@test.com',
          password: 'Pass123!',
          password_confirm: 'Pass123!',
          first_name: 'New',
          last_name: 'User',
        })
      })

      expect(useAuthStore.getState().user?.username).toBe('newuser')
    })
  })

  describe('logout', () => {
    it('clears user and calls authService.logout', () => {
      useAuthStore.setState({ user: { id: 1 } as any })

      act(() => {
        useAuthStore.getState().logout()
      })

      expect(mockAuthService.logout).toHaveBeenCalled()
      expect(useAuthStore.getState().user).toBeNull()
      expect(useAuthStore.getState().error).toBeNull()
    })
  })

  describe('loadUser', () => {
    it('loads user when authenticated', async () => {
      const mockUser = { id: 1, username: 'admin' }
      mockAuthService.isAuthenticated.mockReturnValue(true)
      mockAuthService.isTokenExpiringSoon.mockReturnValue(false)
      mockAuthService.getProfile.mockResolvedValueOnce(mockUser)

      await act(async () => {
        await useAuthStore.getState().loadUser()
      })

      expect(useAuthStore.getState().user).toEqual(mockUser)
    })

    it('refreshes token if expiring soon', async () => {
      mockAuthService.isAuthenticated.mockReturnValue(true)
      mockAuthService.isTokenExpiringSoon.mockReturnValue(true)
      mockAuthService.refreshAccessToken.mockResolvedValueOnce('new-token')
      mockAuthService.getProfile.mockResolvedValueOnce({ id: 1 })

      await act(async () => {
        await useAuthStore.getState().loadUser()
      })

      expect(mockAuthService.refreshAccessToken).toHaveBeenCalled()
    })

    it('sets user to null when not authenticated', async () => {
      mockAuthService.isAuthenticated.mockReturnValue(false)

      await act(async () => {
        await useAuthStore.getState().loadUser()
      })

      expect(useAuthStore.getState().user).toBeNull()
    })

    it('logs out on profile fetch failure', async () => {
      mockAuthService.isAuthenticated.mockReturnValue(true)
      mockAuthService.isTokenExpiringSoon.mockReturnValue(false)
      mockAuthService.getProfile.mockRejectedValueOnce(new Error('Unauthorized'))

      await act(async () => {
        await useAuthStore.getState().loadUser()
      })

      expect(mockAuthService.logout).toHaveBeenCalled()
      expect(useAuthStore.getState().user).toBeNull()
    })
  })

  describe('clearError', () => {
    it('clears error state', () => {
      useAuthStore.setState({ error: 'Some error' })

      act(() => {
        useAuthStore.getState().clearError()
      })

      expect(useAuthStore.getState().error).toBeNull()
    })
  })
})
