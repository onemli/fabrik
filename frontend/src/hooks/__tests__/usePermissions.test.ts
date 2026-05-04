// hooks/__tests__/usePermissions.test.ts
//
// Tests for usePermissions hook: admin detection, feature flags, quota access.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

vi.mock('../../store/authStore', () => ({
  useAuthStore: vi.fn(),
}))

import { usePermissions } from '../usePermissions'
import { useAuthStore } from '../../store/authStore'

const mockUseAuthStore = useAuthStore as any

function setUser(user: any) {
  mockUseAuthStore.mockReturnValue({ user })
}

describe('usePermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('isAuthenticated', () => {
    it('returns false when no user', () => {
      setUser(null)

      const { result } = renderHook(() => usePermissions())
      expect(result.current.isAuthenticated).toBe(false)
    })

    it('returns true when user exists', () => {
      setUser({ id: 1, username: 'admin' })

      const { result } = renderHook(() => usePermissions())
      expect(result.current.isAuthenticated).toBe(true)
    })
  })

  describe('isAdmin', () => {
    it('detects superuser', () => {
      setUser({ is_superuser: true })

      const { result } = renderHook(() => usePermissions())
      expect(result.current.isAdmin).toBe(true)
    })

    it('detects is_admin flag', () => {
      setUser({ is_admin: true })

      const { result } = renderHook(() => usePermissions())
      expect(result.current.isAdmin).toBe(true)
    })

    it('detects Admin group membership', () => {
      setUser({ group_names: ['Admin'] })

      const { result } = renderHook(() => usePermissions())
      expect(result.current.isAdmin).toBe(true)
    })

    it('returns false for regular user', () => {
      setUser({ group_names: ['Viewer'] })

      const { result } = renderHook(() => usePermissions())
      expect(result.current.isAdmin).toBe(false)
    })
  })

  describe('isOperator', () => {
    it('detects Operator group', () => {
      setUser({ group_names: ['Operator'] })

      const { result } = renderHook(() => usePermissions())
      expect(result.current.isOperator).toBe(true)
    })
  })

  describe('hasFeature', () => {
    it('returns true for admin regardless of features', () => {
      setUser({ is_superuser: true, effective_features: { can_use_awx: false } })

      const { result } = renderHook(() => usePermissions())
      expect(result.current.hasFeature('can_use_awx')).toBe(true)
    })

    it('reads from effective_features', () => {
      setUser({ effective_features: { can_use_awx: false } })

      const { result } = renderHook(() => usePermissions())
      expect(result.current.canUseAwx).toBe(false)
    })

    it('defaults to true for unconfigured features', () => {
      setUser({ effective_features: {} })

      const { result } = renderHook(() => usePermissions())
      expect(result.current.canCreateQueries).toBe(true)
    })

    it('defaults to true when no effective_features', () => {
      setUser({ id: 1 })

      const { result } = renderHook(() => usePermissions())
      expect(result.current.canExportData).toBe(true)
    })
  })

  describe('permission helpers', () => {
    it('canManageUsers is true for admin', () => {
      setUser({ is_superuser: true })

      const { result } = renderHook(() => usePermissions())
      expect(result.current.canManageUsers).toBe(true)
    })

    it('canManageUsers is false for non-admin', () => {
      setUser({ group_names: ['Viewer'] })

      const { result } = renderHook(() => usePermissions())
      expect(result.current.canManageUsers).toBe(false)
    })

    it('canViewQueries is true when authenticated', () => {
      setUser({ id: 1 })

      const { result } = renderHook(() => usePermissions())
      expect(result.current.canViewQueries).toBe(true)
    })
  })

  describe('emailServiceAvailable', () => {
    it('returns email service status', () => {
      setUser({ email_service_available: true })

      const { result } = renderHook(() => usePermissions())
      expect(result.current.emailServiceAvailable).toBe(true)
    })

    it('defaults to false', () => {
      setUser({ id: 1 })

      const { result } = renderHook(() => usePermissions())
      expect(result.current.emailServiceAvailable).toBe(false)
    })
  })
})
