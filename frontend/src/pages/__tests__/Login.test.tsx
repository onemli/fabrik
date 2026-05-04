// pages/__tests__/Login.test.tsx
//
// Tests for the Login page: form rendering, submission, MFA flow, error display.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Login from '../Login'

// Mock navigation
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual as any,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ state: null, pathname: '/login' }),
  }
})

// Mock auth store
const mockLogin = vi.fn()
const mockLdapLogin = vi.fn()
const mockMfaLogin = vi.fn()
const mockClearError = vi.fn()

vi.mock('@/store/authStore', () => ({
  useAuthStore: () => ({
    login: mockLogin,
    ldapLogin: mockLdapLogin,
    mfaLogin: mockMfaLogin,
    user: null,
    isLoading: false,
    error: null,
    clearError: mockClearError,
  }),
  MFARequiredError: class MFARequiredError extends Error {
    constructor() { super('MFA required') }
  },
}))

// Mock demo store
vi.mock('@/store/demoStore', () => ({
  useDemoStore: () => ({
    isLoaded: true,
    loadPlatformInfo: vi.fn(),
  }),
}))

// Mock SVG import
vi.mock('@/assets/fabrik_dark.svg', () => ({ default: 'fabrik_dark.svg' }))

// Mock fetch for LDAP check
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ ldap_enabled: false }),
}))

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>
  )
}

describe('Login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders sign-in heading and form fields', () => {
    renderLogin()

    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByLabelText('Username')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('renders register link', () => {
    renderLogin()

    expect(screen.getByText('Create one')).toBeInTheDocument()
  })

  it('renders forgot password link', () => {
    renderLogin()

    expect(screen.getByText('Forgot password?')).toBeInTheDocument()
  })

  it('calls login on form submit', async () => {
    mockLogin.mockResolvedValue(undefined)
    renderLogin()

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('admin', 'secret')
    })
  })

  it('navigates after successful login', async () => {
    mockLogin.mockResolvedValue(undefined)
    renderLogin()

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pass' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true })
    })
  })

  it('shows MFA step when MFARequiredError is thrown', async () => {
    const { MFARequiredError } = await import('@/store/authStore')
    mockLogin.mockRejectedValue(new MFARequiredError())
    renderLogin()

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pass' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(screen.getByText('Two-factor authentication')).toBeInTheDocument()
    })
  })

  it('toggles password visibility', () => {
    renderLogin()

    const passwordInput = screen.getByLabelText('Password')
    expect(passwordInput).toHaveAttribute('type', 'password')

    // Find the eye toggle button (it's the button containing the Eye icon, inside the password field wrapper)
    const toggleButtons = screen.getAllByRole('button')
    const eyeButton = toggleButtons.find(btn => btn.closest('.relative'))
    if (eyeButton) {
      fireEvent.click(eyeButton)
    }
  })

  it('sets document title on mount', () => {
    renderLogin()

    expect(document.title).toBe('Fabrik — Sign In')
  })
})
