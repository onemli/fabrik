// store/__tests__/demoStore.test.ts
//
// Tests for useDemoStore and useDemoMode: loadPlatformInfo, demo mode detection.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from '@testing-library/react'

vi.mock('../../services/dashboard', () => ({
  dashboardService: {
    fetchPlatformInfo: vi.fn(),
  },
}))

import { useDemoStore } from '../demoStore'
import { dashboardService } from '../../services/dashboard'

const mockDashboardService = dashboardService as any

describe('useDemoStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useDemoStore.setState({ isDemoMode: false, version: '', ldapEnabled: false, isLoaded: false })
  })

  describe('loadPlatformInfo', () => {
    it('sets platform info on success', async () => {
      mockDashboardService.fetchPlatformInfo.mockResolvedValueOnce({
        demo_mode: true,
        version: '2.1.0',
        ldap_enabled: true,
      })

      await act(async () => {
        await useDemoStore.getState().loadPlatformInfo()
      })

      expect(useDemoStore.getState().isDemoMode).toBe(true)
      expect(useDemoStore.getState().version).toBe('2.1.0')
      expect(useDemoStore.getState().ldapEnabled).toBe(true)
      expect(useDemoStore.getState().isLoaded).toBe(true)
    })

    it('sets isLoaded on failure', async () => {
      mockDashboardService.fetchPlatformInfo.mockRejectedValueOnce(new Error('Network error'))

      await act(async () => {
        await useDemoStore.getState().loadPlatformInfo()
      })

      expect(useDemoStore.getState().isDemoMode).toBe(false)
      expect(useDemoStore.getState().isLoaded).toBe(true)
    })

    it('defaults to non-demo mode', () => {
      expect(useDemoStore.getState().isDemoMode).toBe(false)
    })
  })
})
