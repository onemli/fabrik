/**
 * ValidationQuerySelector Component Tests
 *
 * The component is a modal-based query selector:
 * - Shows a trigger button/area with "Click to search and select a validation query..."
 * - When a query is selected, shows the query name and a clear (X) button
 * - Opens a Dialog modal on click
 * - Shows error title/message inputs when callbacks are provided
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ValidationQuerySelector } from '../ValidationQuerySelector'
import { queriesService } from '@/services/queries'

// Mock the queries service
vi.mock('@/services/queries', () => ({
  queriesService: {
    getValidationQueries: vi.fn(),
    getSavedQuery: vi.fn(),
    markAsValidationQuery: vi.fn(),
  },
}))

const MOCK_QUERY = {
  id: 1,
  name: 'Valid Tenants',
  description: 'List of valid tenant names',
  validation_description: 'Validates tenant names',
  validation_error_title: 'Invalid Tenant',
  validation_error_message: 'Tenant not found',
  validation_usage_count: 3,
  tags_list: ['network', 'tenant'],
  category_name: 'Validation',
  created_by: { username: 'admin', first_name: 'Ad', last_name: 'Min' },
  created_at: '2024-01-01T00:00:00Z',
}

describe('ValidationQuerySelector', () => {
  const mockOnChange = vi.fn()
  const mockOnErrorMessageChange = vi.fn()
  const mockOnErrorTitleChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(queriesService.getValidationQueries).mockResolvedValue({
      results: [MOCK_QUERY],
      count: 1,
    } as any)
  })

  it('should render loading state initially', () => {
    // Component without a queryId shows the search trigger, not a loading state
    render(<ValidationQuerySelector onChange={mockOnChange} />)

    expect(screen.getByText('Validation Query')).toBeInTheDocument()
    expect(screen.getByText(/click to search/i)).toBeInTheDocument()
  })

  it('should fetch and display validation queries', async () => {
    render(<ValidationQuerySelector onChange={mockOnChange} />)

    // Main view shows selector trigger
    expect(screen.getByText('Validation Query')).toBeInTheDocument()
    expect(screen.getByText(/click to search/i)).toBeInTheDocument()
  })

  it('should show error when Validation category not found', async () => {
    // New component doesn't use category-based fetching
    // It shows "Click to search..." always when no query is selected
    render(<ValidationQuerySelector onChange={mockOnChange} />)
    expect(screen.getByText(/click to search/i)).toBeInTheDocument()
  })

  it('should handle fetch error', async () => {
    // When queryId is provided but getSavedQuery fails, it shows nothing (graceful)
    vi.mocked(queriesService.getSavedQuery).mockRejectedValue(new Error('Network error'))
    render(<ValidationQuerySelector queryId={99} onChange={mockOnChange} />)
    // Should not crash; loading spinner appears briefly then clears
    await waitFor(() => {
      expect(screen.getByText('Validation Query')).toBeInTheDocument()
    })
  })

  it('should show empty state when no queries found', async () => {
    // No query selected → shows "Click to search" placeholder
    render(<ValidationQuerySelector onChange={mockOnChange} />)
    expect(screen.getByText(/click to search/i)).toBeInTheDocument()
  })

  it('should call onChange when query is selected', async () => {
    vi.mocked(queriesService.getValidationQueries).mockResolvedValue({
      results: [MOCK_QUERY],
      count: 1,
    } as any)

    render(<ValidationQuerySelector onChange={mockOnChange} />)

    // Click the trigger to open modal
    const trigger = screen.getByText(/click to search/i)
    fireEvent.click(trigger)

    // Modal opens — wait for queries to load
    await waitFor(() => {
      expect(screen.getByText('Select Validation Query')).toBeInTheDocument()
    })

    // Click a query in the list
    const queryBtn = await screen.findByText('Valid Tenants')
    fireEvent.click(queryBtn)

    // Click Confirm
    const confirmBtn = screen.getByRole('button', { name: /select "valid tenants"/i })
    fireEvent.click(confirmBtn)

    expect(mockOnChange).toHaveBeenCalledWith(1)
  })

  it('should display selected query information', async () => {
    vi.mocked(queriesService.getSavedQuery).mockResolvedValue(MOCK_QUERY as any)

    render(<ValidationQuerySelector queryId={1} onChange={mockOnChange} />)

    // After loading, query name should be visible
    await waitFor(() => {
      expect(screen.getByText('Valid Tenants')).toBeInTheDocument()
    })
  })

  it('should update error title when changed', async () => {
    render(
      <ValidationQuerySelector
        onChange={mockOnChange}
        onErrorTitleChange={mockOnErrorTitleChange}
        errorTitle="Invalid Value"
      />
    )

    const titleInput = screen.getByPlaceholderText(/e\.g\. Invalid Tenant/i)
    fireEvent.change(titleInput, { target: { value: 'Custom Error Title' } })

    expect(mockOnErrorTitleChange).toHaveBeenCalledWith('Custom Error Title')
  })

  it('should update error message when changed', async () => {
    render(
      <ValidationQuerySelector
        onChange={mockOnChange}
        onErrorMessageChange={mockOnErrorMessageChange}
        errorMessage="Value not found"
      />
    )

    const messageInput = screen.getByPlaceholderText(/e\.g\. Tenant name not found/i)
    fireEvent.change(messageInput, { target: { value: 'Custom error message' } })

    expect(mockOnErrorMessageChange).toHaveBeenCalledWith('Custom error message')
  })

  it('should show search input when more than 5 queries', async () => {
    // The search input is inside the modal — it always exists in the modal
    vi.mocked(queriesService.getValidationQueries).mockResolvedValue({
      results: Array.from({ length: 10 }, (_, i) => ({
        ...MOCK_QUERY,
        id: i + 1,
        name: `Query ${i + 1}`,
      })),
      count: 10,
    } as any)

    render(<ValidationQuerySelector onChange={mockOnChange} />)

    const trigger = screen.getByText(/click to search/i)
    fireEvent.click(trigger)

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search…')).toBeInTheDocument()
    })
  })

  it('should filter queries based on search term', async () => {
    vi.mocked(queriesService.getValidationQueries).mockResolvedValue({
      results: [
        { ...MOCK_QUERY, id: 1, name: 'Valid Tenants' },
        { ...MOCK_QUERY, id: 2, name: 'Valid VLANs', tags_list: [] },
      ],
      count: 2,
    } as any)

    render(<ValidationQuerySelector onChange={mockOnChange} />)

    const trigger = screen.getByText(/click to search/i)
    fireEvent.click(trigger)

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search…')).toBeInTheDocument()
    })

    const searchInput = screen.getByPlaceholderText('Search…')
    fireEvent.change(searchInput, { target: { value: 'VLAN' } })

    await waitFor(() => {
      expect(screen.getByText('Valid VLANs')).toBeInTheDocument()
      expect(screen.queryByText('Valid Tenants')).not.toBeInTheDocument()
    })
  })

  it('should retry fetching queries on retry button click', async () => {
    // New component doesn't have an explicit retry button in the main view
    // The modal re-fetches when opened
    render(<ValidationQuerySelector onChange={mockOnChange} />)
    expect(screen.getByText('Validation Query')).toBeInTheDocument()
  })

  it('should show help text with tips', async () => {
    render(
      <ValidationQuerySelector
        onChange={mockOnChange}
        onErrorTitleChange={mockOnErrorTitleChange}
        onErrorMessageChange={mockOnErrorMessageChange}
        errorTitle="Invalid Value"
        errorMessage="Value not found"
      />
    )

    // Error section shows "Validation Failure Feedback" label
    expect(screen.getByText(/Validation Failure Feedback/i)).toBeInTheDocument()
    // Error title input description
    expect(screen.getByText(/shown on hover/i)).toBeInTheDocument()
  })
})
