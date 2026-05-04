// services/api.ts
//
// Axios instance with JWT auth interceptors. Every API call goes through here.
// On 401, the interceptor clears the auth store and redirects to /login instead
// of letting individual callers handle it. Token is read from the auth store
// on every request so logout takes effect immediately.

import { formatError } from '../lib/errorHandler'
import { useAuthStore } from '../store/authStore'

const API_BASE_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '')

const getAuthToken = () => {
  return localStorage.getItem('access_token')
}

const getHeaders = () => {
  const token = getAuthToken()
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

// Try to refresh the JWT token using the stored refresh token.
// On success, stores the new access token and returns true.
// On failure, clears auth state and redirects to /login.
async function handleTokenRefresh(): Promise<boolean> {
  const refreshToken = localStorage.getItem('refresh_token')
  if (!refreshToken) {
    forceLogout()
    return false
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/token/refresh/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh: refreshToken }),
    })

    if (!response.ok) {
      forceLogout()
      return false
    }

    const data = await response.json()
    localStorage.setItem('access_token', data.access)
    return true
  } catch {
    forceLogout()
    return false
  }
}

function forceLogout() {
  localStorage.removeItem('access_token')
  localStorage.removeItem('refresh_token')
  // Clear auth store state before redirect so components that still reference
  // the user object see null instead of stale data — prevents "cannot read
  // properties" errors during the brief gap before the page navigates away.
  useAuthStore.getState().logout()
  window.location.href = '/login'
}

/**
 * Enhanced API Error with user-friendly messaging
 */
class APIError extends Error {
  readonly status: number
  readonly response: { status: number; data: any }
  readonly title: string
  readonly description: string
  readonly suggestedAction?: string

  constructor(response: Response, responseData: any) {
    super(responseData?.detail || `HTTP ${response.status}`)
    this.name = 'APIError'
    this.status = response.status
    this.response = { status: response.status, data: responseData }

    const formatted = formatError({
      response: { status: response.status, data: responseData },
      code: responseData?.code,
      message: responseData?.detail || responseData?.error,
    })

    this.title = formatted.title
    this.description = formatted.description
    this.suggestedAction = formatted.suggestedAction
  }
}

// Core request handler with 401 → refresh → retry logic.
// If refresh also fails, forces logout and redirects to /login.
async function request(method: string, url: string, body?: any, isRetry = false): Promise<{ data: any }> {
  try {
    const response = await fetch(`${API_BASE_URL}${url}`, {
      method,
      headers: getHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    })

    // 401 on first attempt → try token refresh then retry once
    if (response.status === 401 && !isRetry) {
      const refreshed = await handleTokenRefresh()
      if (refreshed) return request(method, url, body, true)
      // handleTokenRefresh already redirected to /login
      throw new APIError(response, { detail: 'Session expired' })
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'No response from server' }))
      throw new APIError(response, error)
    }

    if (response.status === 204) return { data: null }

    const data = await response.json()
    return { data }
  } catch (error: any) {
    if (error instanceof APIError) throw error
    throw new APIError(
      { status: 0 } as Response,
      { code: 'ERR_NETWORK', detail: error.message }
    )
  }
}

export const api = {
  get:    (url: string)            => request('GET', url),
  post:   (url: string, body?: any) => request('POST', url, body),
  put:    (url: string, body?: any) => request('PUT', url, body),
  patch:  (url: string, body?: any) => request('PATCH', url, body),
  delete: (url: string)            => request('DELETE', url),
}
