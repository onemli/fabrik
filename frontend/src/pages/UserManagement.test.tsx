/**
 * UserManagement Page Tests
 *
 * Tests for user and group management functionality
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import UserManagement from './UserManagement'
import { usePermissions } from '@/hooks/usePermissions'
import { userManagementService } from '@/services/userManagement'

// Mock dependencies
vi.mock('@/hooks/usePermissions')
vi.mock('@/services/userManagement')
vi.mock('@/contexts/TimezoneContext', () => ({
  useTimezone: () => ({
    preferences: { display_timezone: 'UTC', date_format: 'DD/MM/YYYY', time_format: '24h' },
  }),
  formatDate: (date: any) => date ? String(date) : '—',
  formatTime: (date: any) => date ? String(date) : '—',
  formatDateTime: (date: any) => date ? String(date) : '—',
  useFormatters: () => ({
    formatDate: (date: any) => date ? String(date) : '—',
    formatTime: (date: any) => date ? String(date) : '—',
    formatDateTime: (date: any) => date ? String(date) : '—',
  }),
}))
vi.mock('@/components/Breadcrumbs', () => ({
  Breadcrumbs: () => <div data-testid="breadcrumbs">Breadcrumbs</div>
}))

const mockUsers = {
  count: 3,
  next: null,
  previous: null,
  results: [
    {
      id: 1,
      username: 'admin',
      email: 'admin@test.com',
      first_name: 'Admin',
      last_name: 'User',
      is_active: true,
      is_staff: true,
      is_superuser: true,
      groups: [{ id: 1, name: 'Admin' }],
      query_count: 5,
      last_login: '2024-01-01T00:00:00Z',
    },
    {
      id: 2,
      username: 'onemli',
      email: 'onemli@test.com',
      first_name: 'Onemli',
      last_name: 'Test',
      is_active: true,
      is_staff: false,
      is_superuser: false,
      groups: [{ id: 2, name: 'Users' }],
      query_count: 10,
      last_login: '2024-01-02T00:00:00Z',
    },
    {
      id: 3,
      username: 'inactive',
      email: 'inactive@test.com',
      first_name: 'Inactive',
      last_name: 'User',
      is_active: false,
      is_staff: false,
      is_superuser: false,
      groups: [],
      query_count: 0,
      last_login: null,
    },
  ],
}

const mockGroups = {
  count: 2,
  next: null,
  previous: null,
  results: [
    { id: 1, name: 'Admin', permissions: [], user_count: 1, users: [] },
    { id: 2, name: 'Users', permissions: [], user_count: 2, users: [] },
  ],
}

describe('UserManagement', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })

    vi.clearAllMocks()
    vi.mocked(usePermissions).mockReturnValue({
      isAdmin: true,
      user: { id: 1, username: 'admin' } as any,
    } as any)
    vi.mocked(userManagementService.listUsers).mockResolvedValue(mockUsers as any)
    vi.mocked(userManagementService.listGroups).mockResolvedValue(mockGroups)
  })

  afterEach(() => {
    queryClient.clear()
  })

  const renderWithProviders = (component: React.ReactElement) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>{component}</BrowserRouter>
      </QueryClientProvider>
    )
  }

  describe('Access Control', () => {
    it('should show access denied for non-admin users', () => {
      vi.mocked(usePermissions).mockReturnValue({
        isAdmin: false,
        user: null,
      } as any)

      renderWithProviders(<UserManagement />)

      expect(screen.getByText('Access Denied')).toBeInTheDocument()
      expect(
        screen.getByText("You don't have permission to access this page.")
      ).toBeInTheDocument()
    })

    it('should render page for admin users', async () => {
      renderWithProviders(<UserManagement />)

      await waitFor(() => {
        expect(screen.getByText('Team Management')).toBeInTheDocument()
      })
    })
  })

  describe('User List Display', () => {
    it('should display all users correctly', async () => {
      renderWithProviders(<UserManagement />)

      await waitFor(() => {
        expect(screen.getByText('admin')).toBeInTheDocument()
        expect(screen.getByText('onemli')).toBeInTheDocument()
        expect(screen.getByText('inactive')).toBeInTheDocument()
      })

      expect(userManagementService.listUsers).toHaveBeenCalled()
    })

    it('should show user emails', async () => {
      renderWithProviders(<UserManagement />)

      await waitFor(() => {
        expect(screen.getByText('admin@test.com')).toBeInTheDocument()
        expect(screen.getByText('onemli@test.com')).toBeInTheDocument()
      })
    })

    it('should show group badges', async () => {
      renderWithProviders(<UserManagement />)

      await waitFor(() => {
        expect(screen.getByText('Admin')).toBeInTheDocument()
      })
    })
  })

  describe('Search Functionality', () => {
    it('should filter users by search term', async () => {
      const user = userEvent.setup()
      renderWithProviders(<UserManagement />)

      await waitFor(() => {
        expect(screen.getByText('admin')).toBeInTheDocument()
      })

      const searchInput = screen.getByPlaceholderText('Search users...')
      await user.type(searchInput, 'onemli')

      await waitFor(() => {
        expect(screen.getByText('onemli')).toBeInTheDocument()
        expect(screen.queryByText('admin')).not.toBeInTheDocument()
      })
    })

    it('should show empty state when no matches', async () => {
      const user = userEvent.setup()
      renderWithProviders(<UserManagement />)

      await waitFor(() => {
        expect(screen.getByText('admin')).toBeInTheDocument()
      })

      const searchInput = screen.getByPlaceholderText('Search users...')
      await user.type(searchInput, 'nonexistent')

      await waitFor(() => {
        expect(screen.queryByText('admin')).not.toBeInTheDocument()
        expect(screen.queryByText('onemli')).not.toBeInTheDocument()
      })
    })
  })

  describe('Tabs', () => {
    it('should show Users tab by default', async () => {
      renderWithProviders(<UserManagement />)

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /Users/i })).toBeInTheDocument()
        expect(screen.getByRole('tab', { name: /Groups/i })).toBeInTheDocument()
      })
    })

    it('should switch to Groups tab', async () => {
      const user = userEvent.setup()
      renderWithProviders(<UserManagement />)

      await waitFor(() => {
        expect(screen.getByText('admin')).toBeInTheDocument()
      })

      const groupsTab = screen.getByRole('tab', { name: /Groups/i })
      await user.click(groupsTab)

      await waitFor(() => {
        // Groups tab should be active
        expect(groupsTab).toHaveAttribute('data-state', 'active')
      })
    })
  })

  describe('Loading States', () => {
    it('should show loading spinner while loading', () => {
      vi.mocked(userManagementService.listUsers).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      )

      renderWithProviders(<UserManagement />)

      expect(screen.getByText('Loading users...')).toBeInTheDocument()
    })
  })

  describe('Empty States', () => {
    it('should handle empty user list', async () => {
      vi.mocked(userManagementService.listUsers).mockResolvedValue({
        count: 0,
        next: null,
        previous: null,
        results: [],
      })

      renderWithProviders(<UserManagement />)

      await waitFor(() => {
        // Page should still render
        expect(screen.getByText('Team Management')).toBeInTheDocument()
      })
    })
  })

  describe('API Integration', () => {
    it('should call listUsers on mount', async () => {
      renderWithProviders(<UserManagement />)

      await waitFor(() => {
        expect(userManagementService.listUsers).toHaveBeenCalled()
      })
    })

    it('should call listGroups on mount', async () => {
      renderWithProviders(<UserManagement />)

      await waitFor(() => {
        expect(userManagementService.listGroups).toHaveBeenCalled()
      })
    })
  })
})
