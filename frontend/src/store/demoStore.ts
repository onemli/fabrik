// store/demoStore.ts
//
// Fetches platform info on app startup to know if we're running in demo mode.
// Components use useDemoMode() to check and conditionally disable write actions.

import { create } from 'zustand'
import { dashboardService, PlatformInfo } from '../services/dashboard'

interface DemoStore {
  isDemoMode: boolean
  version: string
  ldapEnabled: boolean
  isLoaded: boolean
  loadPlatformInfo: () => Promise<void>
}

export const useDemoStore = create<DemoStore>((set) => ({
  isDemoMode: false,
  version: '',
  ldapEnabled: false,
  isLoaded: false,

  loadPlatformInfo: async () => {
    try {
      const info: PlatformInfo = await dashboardService.fetchPlatformInfo()
      set({
        isDemoMode: info.demo_mode,
        version: info.version,
        ldapEnabled: info.ldap_enabled,
        isLoaded: true,
      })
    } catch {
      set({ isLoaded: true })
    }
  },
}))

export const useDemoMode = () => useDemoStore((s) => s.isDemoMode)
