// pages/__tests__/Notifications.test.tsx
//
// Tests for the Notifications page: rendering, filtering, empty state.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Mock the api module before importing Notifications
vi.mock('@/services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}))

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

import Notifications from '../Notifications'
import { api } from '@/services/api'

const mockNotifications = [
  {
    id: '1',
    type: 'info',
    title: 'Query completed',
    message: 'Your tenant query finished.',
    is_read: false,
    created_at: new Date().toISOString(),
  },
  {
    id: '2',
    type: 'success',
    title: 'Task scheduled',
    message: 'Backup task is now active.',
    is_read: true,
    created_at: new Date().toISOString(),
  },
  {
    id: '3',
    type: 'error',
    title: 'Execution failed',
    message: 'APIC connection timed out.',
    is_read: false,
    created_at: new Date(Date.now() - 3 * 86400000).toISOString(), // 3 days ago
  },
]

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('Notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(api.get as any).mockResolvedValue({ data: mockNotifications })
  })

  it('renders heading and notification count', async () => {
    render(<Notifications />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText('Notifications')).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.getByText(/3 total/)).toBeInTheDocument()
    })
  })

  it('shows unread count', async () => {
    render(<Notifications />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText('2 unread')).toBeInTheDocument()
    })
  })

  it('renders notification titles', async () => {
    render(<Notifications />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText('Query completed')).toBeInTheDocument()
      expect(screen.getByText('Task scheduled')).toBeInTheDocument()
      expect(screen.getByText('Execution failed')).toBeInTheDocument()
    })
  })

  it('renders notification messages', async () => {
    render(<Notifications />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText('Your tenant query finished.')).toBeInTheDocument()
    })
  })

  it('shows empty state when no notifications', async () => {
    (api.get as any).mockResolvedValue({ data: [] })

    render(<Notifications />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText('All caught up')).toBeInTheDocument()
    })
  })

  it('filters by search text', async () => {
    render(<Notifications />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText('Query completed')).toBeInTheDocument()
    })

    const searchInput = screen.getByPlaceholderText(/search/i)
    fireEvent.change(searchInput, { target: { value: 'APIC' } })

    await waitFor(() => {
      expect(screen.queryByText('Query completed')).not.toBeInTheDocument()
      expect(screen.getByText('Execution failed')).toBeInTheDocument()
    })
  })

  it('renders tab filters', async () => {
    render(<Notifications />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText('All')).toBeInTheDocument()
      expect(screen.getByText(/Unread/)).toBeInTheDocument()
      expect(screen.getByText(/Read/)).toBeInTheDocument()
    })
  })

  it('renders type filter chips', async () => {
    render(<Notifications />, { wrapper: createWrapper() })

    await waitFor(() => {
      // Type filter buttons
      expect(screen.getByText('Info')).toBeInTheDocument()
      expect(screen.getByText('Success')).toBeInTheDocument()
      expect(screen.getByText('Error')).toBeInTheDocument()
    })
  })
})
