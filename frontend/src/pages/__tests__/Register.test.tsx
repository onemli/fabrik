// pages/__tests__/Register.test.tsx
//
// Tests for the Register page: form rendering, validation, submission.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Register from '../Register'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual as any,
    useNavigate: () => mockNavigate,
  }
})

const mockRegister = vi.fn()
const mockClearError = vi.fn()

vi.mock('@/store/authStore', () => ({
  useAuthStore: () => ({
    register: mockRegister,
    user: null,
    isLoading: false,
    error: null,
    clearError: mockClearError,
  }),
}))

vi.mock('@/assets/fabrik_dark.svg', () => ({ default: 'fabrik_dark.svg' }))

function getField(id: string) {
  return document.getElementById(id) as HTMLInputElement
}

function renderRegister() {
  return render(
    <MemoryRouter>
      <Register />
    </MemoryRouter>
  )
}

describe('Register', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders registration form fields', () => {
    renderRegister()

    expect(screen.getByRole('heading', { name: 'Create account' })).toBeInTheDocument()
    expect(getField('username')).toBeInTheDocument()
    expect(getField('email')).toBeInTheDocument()
    expect(getField('password')).toBeInTheDocument()
    expect(getField('password_confirm')).toBeInTheDocument()
  })

  it('renders sign-in link', () => {
    renderRegister()

    expect(screen.getByText('Sign in')).toBeInTheDocument()
  })

  it('validates email format', async () => {
    renderRegister()

    // Fill all fields but with invalid email
    fireEvent.change(getField('username'), { target: { value: 'user' } })
    fireEvent.change(getField('email'), { target: { value: 'invalid' } })
    fireEvent.change(getField('password'), { target: { value: 'password123' } })
    fireEvent.change(getField('password_confirm'), { target: { value: 'password123' } })

    // Submit form programmatically (bypassing HTML5 type=email validation)
    const form = screen.getByRole('button', { name: /create account/i }).closest('form')!
    fireEvent.submit(form)

    await waitFor(() => {
      expect(screen.getByText('Email is invalid')).toBeInTheDocument()
    })
  })

  it('validates password length', async () => {
    renderRegister()

    fireEvent.change(getField('username'), { target: { value: 'user' } })
    fireEvent.change(getField('email'), { target: { value: 'test@test.com' } })
    fireEvent.change(getField('password'), { target: { value: 'short' } })
    fireEvent.change(getField('password_confirm'), { target: { value: 'short' } })

    const form = screen.getByRole('button', { name: /create account/i }).closest('form')!
    fireEvent.submit(form)

    await waitFor(() => {
      expect(screen.getByText('Password must be at least 8 characters')).toBeInTheDocument()
    })
  })

  it('validates password match', async () => {
    renderRegister()

    fireEvent.change(getField('username'), { target: { value: 'user' } })
    fireEvent.change(getField('email'), { target: { value: 'test@test.com' } })
    fireEvent.change(getField('password'), { target: { value: 'password123' } })
    fireEvent.change(getField('password_confirm'), { target: { value: 'different123' } })

    const form = screen.getByRole('button', { name: /create account/i }).closest('form')!
    fireEvent.submit(form)

    await waitFor(() => {
      expect(screen.getByText('Passwords do not match')).toBeInTheDocument()
    })
  })

  it('calls register with valid data', async () => {
    mockRegister.mockResolvedValue(undefined)
    renderRegister()

    fireEvent.change(getField('username'), { target: { value: 'newuser' } })
    fireEvent.change(getField('email'), { target: { value: 'new@test.com' } })
    fireEvent.change(getField('first_name'), { target: { value: 'New' } })
    fireEvent.change(getField('last_name'), { target: { value: 'User' } })
    fireEvent.change(getField('password'), { target: { value: 'password123' } })
    fireEvent.change(getField('password_confirm'), { target: { value: 'password123' } })

    const form = screen.getByRole('button', { name: /create account/i }).closest('form')!
    fireEvent.submit(form)

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith(expect.objectContaining({
        username: 'newuser',
        email: 'new@test.com',
        password: 'password123',
      }))
    })
  })

  it('sets document title', () => {
    renderRegister()

    expect(document.title).toBe('Fabrik — Create Account')
  })
})
