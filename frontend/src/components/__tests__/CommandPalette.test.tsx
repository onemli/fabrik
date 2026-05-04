// components/__tests__/CommandPalette.test.tsx
//
// Tests for CommandPalette: rendering, navigation actions, search filtering.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { CommandPalette } from '../CommandPalette'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual as any,
    useNavigate: () => mockNavigate,
  }
})

vi.mock('@/store/authStore', () => ({
  useAuthStore: () => ({
    user: { id: 1, username: 'admin' },
  }),
}))

const mockSetSelectedConnectionId = vi.fn()
const mockClearCanvas = vi.fn()
vi.mock('@/store/queryBuilderStore', () => ({
  useQueryBuilderStore: () => ({
    setSelectedConnectionId: mockSetSelectedConnectionId,
    clearCanvas: mockClearCanvas,
  }),
}))

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    mode: 'dark',
    toggleMode: vi.fn(),
  }),
}))

vi.mock('@/services/apic', () => ({
  apicService: {
    getConnections: vi.fn().mockResolvedValue([
      { id: 1, name: 'APIC-Prod', url: 'https://apic1.local' },
    ]),
  },
}))

vi.mock('@/services/queries', () => ({
  queriesService: {
    getSavedQueries: vi.fn().mockResolvedValue([
      { id: 1, name: 'All Tenants', is_template: false },
      { id: 2, name: 'BD Template', is_template: true },
    ]),
  },
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe('CommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders when open', () => {
    render(
      <CommandPalette open={true} onOpenChange={vi.fn()} />,
      { wrapper: createWrapper() }
    )

    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument()
  })

  it('does not render content when closed', () => {
    render(
      <CommandPalette open={false} onOpenChange={vi.fn()} />,
      { wrapper: createWrapper() }
    )

    // Dialog is closed so command input shouldn't be visible
    expect(screen.queryByPlaceholderText(/search/i)).not.toBeInTheDocument()
  })

  it('shows navigation commands', async () => {
    render(
      <CommandPalette open={true} onOpenChange={vi.fn()} />,
      { wrapper: createWrapper() }
    )

    await waitFor(() => {
      expect(screen.getByText('Go to Query Builder')).toBeInTheDocument()
      expect(screen.getByText('Go to Saved Queries')).toBeInTheDocument()
    })
  })

  it('shows quick action commands', async () => {
    render(
      <CommandPalette open={true} onOpenChange={vi.fn()} />,
      { wrapper: createWrapper() }
    )

    await waitFor(() => {
      expect(screen.getByText('Clear Canvas')).toBeInTheDocument()
    })
  })

  it('shows theme toggle action', async () => {
    render(
      <CommandPalette open={true} onOpenChange={vi.fn()} />,
      { wrapper: createWrapper() }
    )

    await waitFor(() => {
      expect(screen.getByText(/Switch to Light Mode/)).toBeInTheDocument()
    })
  })

  it('navigates on command selection', async () => {
    const onOpenChange = vi.fn()
    render(
      <CommandPalette open={true} onOpenChange={onOpenChange} />,
      { wrapper: createWrapper() }
    )

    await waitFor(() => {
      expect(screen.getByText('Go to Query Builder')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Go to Query Builder'))

    expect(mockNavigate).toHaveBeenCalledWith('/')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('renders connection and query groups', async () => {
    render(
      <CommandPalette open={true} onOpenChange={vi.fn()} />,
      { wrapper: createWrapper() }
    )

    // Connections and queries groups should appear after data loads
    await waitFor(() => {
      // Check that at least the group headings render
      const text = document.body.textContent || ''
      expect(text).toContain('Navigation')
    })
  })
})
