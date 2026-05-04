// services/auth.ts
//
// Low-level auth API calls: login, logout, register, refresh token, get profile.
// The auth store (store/authStore.ts) is the source of truth for the current user
// and JWT; this file just handles the HTTP mechanics.

const API_BASE_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '')

export interface Group {
  id: number
  name: string
  permission_count?: number
}

export interface User {
  id: number
  username: string
  email: string
  first_name: string
  last_name: string
  date_joined: string
  last_login: string | null
  is_staff: boolean
  is_superuser?: boolean
  is_active?: boolean
  groups?: Group[]
  group_names?: string[]
  is_admin?: boolean
  query_count: number
  favorite_count: number
  profile?: {
    display_timezone: string
    date_format: string
    time_format: string
  }
  email_service_available?: boolean
  effective_features?: Record<string, boolean>
  email_verified?: boolean
  mfa_enabled?: boolean
  auth_source?: 'local' | 'ldap'
}

export interface AuthTokens {
  access: string
  refresh: string
}

export interface RegisterData {
  username: string
  email: string
  password: string
  password_confirm: string
  first_name: string
  last_name: string
}

export interface LoginData {
  username: string
  password: string
}

export interface PasswordResetResponse {
  message: string
  fallback: boolean
}

export interface QuotaUsageResponse {
  quota: Record<string, number | boolean>
  usage: Record<string, number>
}

class AuthService {
  private accessToken: string | null = null
  private refreshToken: string | null = null

  constructor() {
    // Load tokens from localStorage on init
    this.accessToken = localStorage.getItem('access_token')
    this.refreshToken = localStorage.getItem('refresh_token')
  }

  private getHeaders(includeAuth = true): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    }

    if (includeAuth && this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`
    }

    return headers
  }

  async register(data: RegisterData): Promise<User> {
    const response = await fetch(`${API_BASE_URL}/api/auth/register/`, {
      method: 'POST',
      headers: this.getHeaders(false),
      body: JSON.stringify(data),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(JSON.stringify(error))
    }

    return response.json()
  }

  async login(data: LoginData): Promise<AuthTokens | { mfa_required: true }> {
    const response = await fetch(`${API_BASE_URL}/api/auth/login/`, {
      method: 'POST',
      headers: this.getHeaders(false),
      body: JSON.stringify(data),
    })

    if (response.status === 202) {
      // MFA required — password was correct but user needs to verify TOTP
      return { mfa_required: true } as any
    }

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || 'Login failed')
    }

    const tokens: AuthTokens = await response.json()

    // Store tokens
    this.accessToken = tokens.access
    this.refreshToken = tokens.refresh
    localStorage.setItem('access_token', tokens.access)
    localStorage.setItem('refresh_token', tokens.refresh)

    return tokens
  }

  async refreshAccessToken(): Promise<string> {
    if (!this.refreshToken) {
      throw new Error('No refresh token available')
    }

    const response = await fetch(`${API_BASE_URL}/api/auth/token/refresh/`, {
      method: 'POST',
      headers: this.getHeaders(false),
      body: JSON.stringify({ refresh: this.refreshToken }),
    })

    if (!response.ok) {
      this.logout()
      throw new Error('Token refresh failed')
    }

    const { access } = await response.json()
    this.accessToken = access
    localStorage.setItem('access_token', access)

    return access
  }

  async getProfile(): Promise<User> {
    const response = await fetch(`${API_BASE_URL}/api/auth/profile/`, {
      method: 'GET',
      headers: this.getHeaders(),
    })

    if (!response.ok) {
      if (response.status === 401) {
        // Try to refresh token
        try {
          await this.refreshAccessToken()
          // Retry the request
          return this.getProfile()
        } catch {
          throw new Error('Authentication failed')
        }
      }
      throw new Error('Failed to fetch profile')
    }

    return response.json()
  }

  async updateProfile(data: Partial<User>): Promise<User> {
    const response = await fetch(`${API_BASE_URL}/api/auth/profile/`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(data),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(JSON.stringify(error))
    }

    return response.json()
  }

  async changePassword(oldPassword: string, newPassword: string, newPasswordConfirm: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/auth/password/change/`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        old_password: oldPassword,
        new_password: newPassword,
        new_password_confirm: newPasswordConfirm,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(JSON.stringify(error))
    }
  }

  logout(): void {
    this.accessToken = null
    this.refreshToken = null
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
  }

  isAuthenticated(): boolean {
    return !!this.accessToken
  }

  getAccessToken(): string | null {
    return this.accessToken
  }

  /** Decode JWT payload without verification (client-side only). */
  private decodeTokenExpiry(token: string): number | null {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]))
      return typeof payload.exp === 'number' ? payload.exp : null
    } catch {
      return null
    }
  }

  /** Returns true if the access token expires within `bufferSeconds`. */
  isTokenExpiringSoon(bufferSeconds = 120): boolean {
    if (!this.accessToken) return false
    const exp = this.decodeTokenExpiry(this.accessToken)
    if (!exp) return false
    return exp - Math.floor(Date.now() / 1000) < bufferSeconds
  }

  /** Proactively refresh the access token if it expires within 2 minutes. */
  async refreshIfNeeded(): Promise<void> {
    if (!this.isAuthenticated()) return
    if (!this.isTokenExpiringSoon(120)) return
    try {
      await this.refreshAccessToken()
    } catch {
      // Refresh failed — user will be logged out on next 401
    }
  }

  /** Fetch the user's session timeout preference from the backend. */
  async getSessionTimeout(): Promise<number> {
    const response = await fetch(`${API_BASE_URL}/api/auth/session-timeout/`, {
      headers: this.getHeaders(),
    })
    if (!response.ok) return 480 // default 8h
    const data = await response.json()
    return data.session_timeout_minutes as number
  }

  /** Save the user's session timeout preference to the backend. */
  async setSessionTimeout(minutes: number): Promise<void> {
    await fetch(`${API_BASE_URL}/api/auth/session-timeout/`, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify({ session_timeout_minutes: minutes }),
    })
  }

  /** Request password reset via email. Returns fallback flag if email unavailable. */
  async requestPasswordReset(username: string): Promise<PasswordResetResponse> {
    const response = await fetch(`${API_BASE_URL}/api/auth/password-reset/`, {
      method: 'POST',
      headers: this.getHeaders(false),
      body: JSON.stringify({ username }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || 'Password reset request failed')
    }

    return response.json()
  }

  /** Confirm password reset using email token. */
  async confirmPasswordResetToken(
    token: string, newPassword: string, newPasswordConfirm: string
  ): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/auth/password-reset/confirm/`, {
      method: 'POST',
      headers: this.getHeaders(false),
      body: JSON.stringify({
        method: 'token',
        token,
        new_password: newPassword,
        new_password_confirm: newPasswordConfirm,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Password reset failed')
    }
  }

  /** Confirm password reset using admin-generated code. */
  async confirmPasswordResetCode(
    username: string, code: string, newPassword: string, newPasswordConfirm: string
  ): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/auth/password-reset/confirm/`, {
      method: 'POST',
      headers: this.getHeaders(false),
      body: JSON.stringify({
        method: 'code',
        username,
        code,
        new_password: newPassword,
        new_password_confirm: newPasswordConfirm,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Password reset failed')
    }
  }

  /** Fetch auth health status. */
  async getAuthHealth(): Promise<Record<string, unknown>> {
    const response = await fetch(`${API_BASE_URL}/api/auth/health/`, {
      headers: this.getHeaders(),
    })
    if (!response.ok) return {}
    return response.json()
  }

  /** Fetch current user's quota and usage. */
  async getQuotaUsage(): Promise<QuotaUsageResponse> {
    const response = await fetch(`${API_BASE_URL}/api/auth/quota-usage/`, {
      headers: this.getHeaders(),
    })
    if (!response.ok) throw new Error('Failed to fetch quota usage')
    return response.json()
  }

  // --- Email Verification ---

  async sendVerificationEmail(): Promise<{ message: string; fallback?: boolean }> {
    const response = await fetch(`${API_BASE_URL}/api/auth/email/send-verification/`, {
      method: 'POST',
      headers: this.getHeaders(),
    })
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to send verification email')
    }
    return response.json()
  }

  async verifyEmail(token: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/auth/email/verify/`, {
      method: 'POST',
      headers: this.getHeaders(false),
      body: JSON.stringify({ token }),
    })
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Verification failed')
    }
  }

  // --- MFA / TOTP ---

  async mfaSetup(): Promise<{ secret: string; otpauth_uri: string; qr_code: string }> {
    const response = await fetch(`${API_BASE_URL}/api/auth/mfa/setup/`, {
      method: 'POST',
      headers: this.getHeaders(),
    })
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'MFA setup failed')
    }
    return response.json()
  }

  async mfaVerify(code: string): Promise<{ message: string; backup_codes: string[] }> {
    const response = await fetch(`${API_BASE_URL}/api/auth/mfa/verify/`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ code }),
    })
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'MFA verification failed')
    }
    return response.json()
  }

  async mfaDisable(password: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/auth/mfa/disable/`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ password }),
    })
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to disable MFA')
    }
  }

  async mfaStatus(): Promise<{ mfa_enabled: boolean; backup_codes_remaining: number }> {
    const response = await fetch(`${API_BASE_URL}/api/auth/mfa/status/`, {
      headers: this.getHeaders(),
    })
    if (!response.ok) throw new Error('Failed to fetch MFA status')
    return response.json()
  }

  async mfaRegenerateBackupCodes(password: string): Promise<{ backup_codes: string[] }> {
    const response = await fetch(`${API_BASE_URL}/api/auth/mfa/backup-codes/`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ password }),
    })
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to regenerate backup codes')
    }
    return response.json()
  }

  async ldapLogin(data: LoginData): Promise<AuthTokens | { mfa_required: true }> {
    const response = await fetch(`${API_BASE_URL}/api/auth/ldap-login/`, {
      method: 'POST',
      headers: this.getHeaders(false),
      body: JSON.stringify(data),
    })

    if (response.status === 202) {
      return { mfa_required: true } as any
    }

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || 'LDAP login failed')
    }

    const tokens: AuthTokens = await response.json()
    this.accessToken = tokens.access
    this.refreshToken = tokens.refresh
    localStorage.setItem('access_token', tokens.access)
    localStorage.setItem('refresh_token', tokens.refresh)
    return tokens
  }

  async mfaLogin(
    username: string, password: string, totpCode?: string, backupCode?: string
  ): Promise<AuthTokens> {
    const response = await fetch(`${API_BASE_URL}/api/auth/mfa-login/`, {
      method: 'POST',
      headers: this.getHeaders(false),
      body: JSON.stringify({
        username,
        password,
        totp_code: totpCode || '',
        backup_code: backupCode || '',
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'MFA login failed')
    }

    const tokens: AuthTokens = await response.json()
    this.accessToken = tokens.access
    this.refreshToken = tokens.refresh
    localStorage.setItem('access_token', tokens.access)
    localStorage.setItem('refresh_token', tokens.refresh)
    return tokens
  }
}

export const authService = new AuthService()
