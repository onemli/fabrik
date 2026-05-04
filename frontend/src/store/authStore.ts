// store/authStore.ts
//
// Zustand store for authentication state. Persists JWT token and user profile
// to localStorage so users stay logged in across page refreshes.
// The api.ts interceptor reads from this store on every request.

import { create } from 'zustand'
import { authService, User } from '../services/auth'
import { queryClient } from '../lib/queryClient'

// Thrown when the server says "password correct, MFA required"
export class MFARequiredError extends Error {
  constructor() { super('MFA_REQUIRED') }
}

interface AuthState {
  user: User | null
  isLoading: boolean
  error: string | null

  // Actions
  login: (username: string, password: string) => Promise<void>
  ldapLogin: (username: string, password: string) => Promise<void>
  mfaLogin: (username: string, password: string, totpCode?: string, backupCode?: string) => Promise<void>
  register: (data: {
    username: string
    email: string
    password: string
    password_confirm: string
    first_name: string
    last_name: string
  }) => Promise<void>
  logout: () => void
  loadUser: () => Promise<void>
  clearError: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: false,
  error: null,

  login: async (username: string, password: string) => {
    set({ isLoading: true, error: null })
    try {
      const result = await authService.login({ username, password })
      // authService.login() returns tokens on 200, but if status was 202
      // the raw response is handled inside authService — we check for mfa_required
      if ((result as any).mfa_required) {
        set({ isLoading: false })
        throw new MFARequiredError()
      }
      const user = await authService.getProfile()
      set({ user, isLoading: false })
    } catch (error) {
      if (error instanceof MFARequiredError) {
        throw error  // re-throw so Login.tsx can handle it
      }
      set({
        error: error instanceof Error ? error.message : 'Login failed',
        isLoading: false
      })
      throw error
    }
  },

  ldapLogin: async (username: string, password: string) => {
    set({ isLoading: true, error: null })
    try {
      const result = await authService.ldapLogin({ username, password })
      if ((result as any).mfa_required) {
        set({ isLoading: false })
        throw new MFARequiredError()
      }
      const user = await authService.getProfile()
      set({ user, isLoading: false })
    } catch (error) {
      if (error instanceof MFARequiredError) throw error
      set({
        error: error instanceof Error ? error.message : 'LDAP login failed',
        isLoading: false,
      })
      throw error
    }
  },

  mfaLogin: async (username: string, password: string, totpCode?: string, backupCode?: string) => {
    set({ isLoading: true, error: null })
    try {
      await authService.mfaLogin(username, password, totpCode, backupCode)
      const user = await authService.getProfile()
      set({ user, isLoading: false })
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'MFA login failed',
        isLoading: false,
      })
      throw error
    }
  },

  register: async (data) => {
    set({ isLoading: true, error: null })
    try {
      await authService.register(data)
      // Auto-login after registration
      await authService.login({
        username: data.username,
        password: data.password
      })
      const user = await authService.getProfile()
      set({ user, isLoading: false })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Registration failed'
      set({ error: errorMessage, isLoading: false })
      throw error
    }
  },

  logout: () => {
    authService.logout()
    // Wipe the React Query cache so the next user cannot see the previous
    // user's profile, permissions, or any other cached per-user response.
    queryClient.clear()
    set({ user: null, error: null })
  },

  loadUser: async () => {
    if (!authService.isAuthenticated()) {
      set({ user: null, isLoading: false })
      return
    }

    set({ isLoading: true })
    try {
      // Proactively refresh if the token is already expired or within 30 seconds
      // of expiry — avoids a guaranteed-to-fail getProfile() call on startup.
      if (authService.isTokenExpiringSoon(30)) {
        await authService.refreshAccessToken()
      }
      const user = await authService.getProfile()
      set({ user, isLoading: false })
    } catch (error) {
      authService.logout()
      set({ user: null, isLoading: false })
    }
  },

  clearError: () => set({ error: null }),
}))
