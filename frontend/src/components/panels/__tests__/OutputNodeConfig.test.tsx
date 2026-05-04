/**
 * OutputNodeConfig Component Tests
 *
 * CRITICAL: These tests verify the Time Machine toggle functionality ($10,000 requirement)
 * - Time Machine toggle should update node data
 * - UI should show correct state based on enableTimeMachine flag
 * - Confirmation message should appear when enabled
 *
 * CRITICAL: These tests verify the Table Templates toggle functionality ($10,000 requirement)
 * - Table Templates toggle should update node data
 * - UI should show correct state based on track_execution_history flag
 * - Confirmation message should appear when enabled
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OutputNodeConfig } from '../OutputNodeConfig'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'

// Mock the store
vi.mock('@/store/queryBuilderStore', () => ({
  useQueryBuilderStore: vi.fn(),
}))

vi.mock('@/services/queries', () => ({
  queriesService: {
    updateSavedQuery: vi.fn().mockResolvedValue({}),
  },
}))

// Create a QueryClient for tests
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
})

// Helper to render with providers
const renderWithProviders = (ui: React.ReactElement) => {
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  )
}

describe('OutputNodeConfig', () => {
  const mockUpdateNode = vi.fn()
  const mockNodeId = 'output-node-1'

  beforeEach(() => {
    vi.clearAllMocks()

    // Mock store return value
    vi.mocked(useQueryBuilderStore).mockReturnValue({
      updateNode: mockUpdateNode,
      nodes: [],
      edges: [],
      isInteractive: true,
      requestNodeDeletion: vi.fn(),
      currentQueryId: 'saved-query-123', // Required for canEnableTimeMachine
      currentQueryMetadata: { name: 'Test Query' },
      showLogoNotification: vi.fn(),
    } as any)
  })

  describe('Time Machine Toggle', () => {
    it('should render Time Machine section with toggle', () => {
      const mockData = { enableTimeMachine: false, label: "Output", id: "output-1" }

      renderWithProviders(
        <OutputNodeConfig
          nodeId={mockNodeId}
          data={mockData}
        />
      )

      // Check for Time Machine heading
      expect(screen.getByText('Time Machine')).toBeInTheDocument()

      // Check for description
      expect(screen.getByText('Track execution history')).toBeInTheDocument()
      expect(screen.getByText(/Save query results over time/)).toBeInTheDocument()

      // Check for toggle switch
      const toggle = screen.getByRole('switch', { name: /track execution history/i })
      expect(toggle).toBeInTheDocument()
      expect(toggle).not.toBeChecked()
    })

    it('CRITICAL: should call updateNode when Time Machine is enabled', () => {
      const mockData = { enableTimeMachine: false, label: "Output", id: "output-1" }

      renderWithProviders(
        <OutputNodeConfig
          nodeId={mockNodeId}
          data={mockData}
        />
      )

      // Find and click the toggle
      const toggle = screen.getByRole('switch', { name: /track execution history/i })
      fireEvent.click(toggle)

      // Verify updateNode was called with correct parameters
      // Note: handler also sets enablePagination as part of mutual exclusion logic
      expect(mockUpdateNode).toHaveBeenCalledTimes(1)
      expect(mockUpdateNode).toHaveBeenCalledWith(
        mockNodeId,
        expect.objectContaining({ enableTimeMachine: true })
      )
    })

    it('CRITICAL: should call updateNode when Time Machine is disabled', () => {
      const mockData = { enableTimeMachine: true, label: "Output", id: "output-1" }

      renderWithProviders(
        <OutputNodeConfig
          nodeId={mockNodeId}
          data={mockData}
        />
      )

      // Find and click the toggle (to disable)
      const toggle = screen.getByRole('switch', { name: /track execution history/i })
      fireEvent.click(toggle)

      // Verify updateNode was called with false
      expect(mockUpdateNode).toHaveBeenCalledTimes(1)
      expect(mockUpdateNode).toHaveBeenCalledWith(mockNodeId, {
        enableTimeMachine: false
      })
    })

    it('should show toggle as checked when Time Machine is enabled', () => {
      const mockData = { enableTimeMachine: true, label: "Output", id: "output-1" }

      renderWithProviders(
        <OutputNodeConfig
          nodeId={mockNodeId}
          data={mockData}
        />
      )

      const toggle = screen.getByRole('switch', { name: /track execution history/i })
      expect(toggle).toBeChecked()
    })

    it('should show toggle as unchecked when Time Machine is disabled', () => {
      const mockData = { enableTimeMachine: false, label: "Output", id: "output-1" }

      renderWithProviders(
        <OutputNodeConfig
          nodeId={mockNodeId}
          data={mockData}
        />
      )

      const toggle = screen.getByRole('switch', { name: /track execution history/i })
      expect(toggle).not.toBeChecked()
    })

    it('should handle undefined enableTimeMachine (defaults to false)', () => {
      const mockData = { label: "Output", id: "output-1" }

      renderWithProviders(
        <OutputNodeConfig
          nodeId={mockNodeId}
          data={mockData}
        />
      )

      const toggle = screen.getByRole('switch', { name: /track execution history/i })
      expect(toggle).not.toBeChecked()
    })
  })

  describe('Time Machine Enabled Confirmation', () => {
    it('should NOT show confirmation message when Time Machine is disabled', () => {
      const mockData = { enableTimeMachine: false, label: "Output", id: "output-1" }

      renderWithProviders(
        <OutputNodeConfig
          nodeId={mockNodeId}
          data={mockData}
        />
      )

      // Confirmation message should not be present
      expect(screen.queryByText('Time Machine Enabled')).not.toBeInTheDocument()
      expect(screen.queryByText(/Query results will be captured automatically/)).not.toBeInTheDocument()
    })

    it('CRITICAL: should show confirmation message when Time Machine is enabled', () => {
      const mockData = { enableTimeMachine: true, label: "Output", id: "output-1" }

      renderWithProviders(
        <OutputNodeConfig
          nodeId={mockNodeId}
          data={mockData}
        />
      )

      // "Time Machine Enabled" appears in both TM section and Pagination warning — use unique description
      // The TM confirmation section has this unique text:
      expect(screen.getByText(/Query results will be captured automatically/)).toBeInTheDocument()
      expect(screen.getByText(/View and compare historical snapshots/)).toBeInTheDocument()
    })

    it('should have correct styling for confirmation message', () => {
      const mockData = { enableTimeMachine: true, label: "Output", id: "output-1" }

      renderWithProviders(
        <OutputNodeConfig
          nodeId={mockNodeId}
          data={mockData}
        />
      )

      // Find the TM confirmation div via its unique description text
      const description = screen.getByText(/Query results will be captured automatically/)
      const confirmation = description.closest('div')
      expect(confirmation).toHaveClass('bg-muted/50')
      expect(confirmation).toHaveClass('border-border')
    })
  })

  describe('Component UI Structure', () => {
    it('should render output configuration description', () => {
      const mockData = { enableTimeMachine: false, label: "Output", id: "output-1" }

      renderWithProviders(
        <OutputNodeConfig
          nodeId={mockNodeId}
          data={mockData}
        />
      )

      // Component shows toggle label and description instead of a top-level description
      expect(screen.getByText(/Save query results over time/)).toBeInTheDocument()
    })

    it('should render Clock icon for Time Machine section', () => {
      const mockData = { enableTimeMachine: false, label: "Output", id: "output-1" }

      const { container } = renderWithProviders(
        <OutputNodeConfig
          nodeId={mockNodeId}
          data={mockData}
        />
      )

      // Check for Clock icon (lucide-react renders as svg)
      const clockIcon = container.querySelector('svg')
      expect(clockIcon).toBeInTheDocument()
    })

    it('should have proper accessibility labels', () => {
      const mockData = { enableTimeMachine: false, label: "Output", id: "output-1" }

      renderWithProviders(
        <OutputNodeConfig
          nodeId={mockNodeId}
          data={mockData}
        />
      )

      // Check for proper label association for Time Machine
      const timeMachineLabel = screen.getByText('Track execution history')
      expect(timeMachineLabel).toHaveAttribute('for', 'enable-time-machine')

      const timeMachineToggle = screen.getByRole('switch', { name: /track execution history/i })
      expect(timeMachineToggle).toHaveAttribute('id', 'enable-time-machine')

      // Check for proper label association for Table Templates
      const tableTemplatesLabel = screen.getByText('Save table templates')
      expect(tableTemplatesLabel).toHaveAttribute('for', 'track-execution-history')

      const tableTemplatesToggle = screen.getByRole('switch', { name: /save table templates/i })
      expect(tableTemplatesToggle).toHaveAttribute('id', 'track-execution-history')
    })
  })

  describe('Integration Tests', () => {
    it('CRITICAL: should toggle Time Machine from disabled to enabled', () => {
      const mockData = { enableTimeMachine: false, label: "Output", id: "output-1" }

      const { rerender } = renderWithProviders(
        <OutputNodeConfig
          nodeId={mockNodeId}
          data={mockData}
        />
      )

      // Initial state - disabled
      const timeMachineToggle = screen.getByRole('switch', { name: /track execution history/i })
      expect(timeMachineToggle).not.toBeChecked()
      expect(screen.queryByText(/Query results will be captured automatically/)).not.toBeInTheDocument()

      // Click to enable
      fireEvent.click(timeMachineToggle)
      expect(mockUpdateNode).toHaveBeenCalledWith(
        mockNodeId,
        expect.objectContaining({ enableTimeMachine: true })
      )

      // Simulate re-render with updated data
      rerender(
        <QueryClientProvider client={queryClient}>
          <OutputNodeConfig
            nodeId={mockNodeId}
            data={{ enableTimeMachine: true, label: "Output", id: "output-1" }}
          />
        </QueryClientProvider>
      )

      // Verify new state - use unique description (TM Enabled text appears multiple times)
      const updatedToggle = screen.getByRole('switch', { name: /track execution history/i })
      expect(updatedToggle).toBeChecked()
      expect(screen.getByText(/Query results will be captured automatically/)).toBeInTheDocument()
    })

    it('CRITICAL: should toggle Time Machine from enabled to disabled', () => {
      const mockData = { enableTimeMachine: true, label: "Output", id: "output-1" }

      const { rerender } = renderWithProviders(
        <OutputNodeConfig
          nodeId={mockNodeId}
          data={mockData}
        />
      )

      // Initial state - enabled — use unique description text
      const timeMachineToggle = screen.getByRole('switch', { name: /track execution history/i })
      expect(timeMachineToggle).toBeChecked()
      expect(screen.getByText(/Query results will be captured automatically/)).toBeInTheDocument()

      // Click to disable
      fireEvent.click(timeMachineToggle)
      expect(mockUpdateNode).toHaveBeenCalledWith(
        mockNodeId,
        expect.objectContaining({ enableTimeMachine: false })
      )

      // Simulate re-render with updated data
      rerender(
        <QueryClientProvider client={queryClient}>
          <OutputNodeConfig
            nodeId={mockNodeId}
            data={{ enableTimeMachine: false, label: "Output", id: "output-1" }}
          />
        </QueryClientProvider>
      )

      // Verify new state
      const updatedToggle = screen.getByRole('switch', { name: /track execution history/i })
      expect(updatedToggle).not.toBeChecked()
      expect(screen.queryByText(/Query results will be captured automatically/)).not.toBeInTheDocument()
    })
  })

  describe('Table Templates Toggle', () => {
    it('should render Table Templates section with toggle', () => {
      const mockData = { track_execution_history: false, label: "Output", id: "output-1" }

      renderWithProviders(
        <OutputNodeConfig
          nodeId={mockNodeId}
          data={mockData}
        />
      )

      // Check for Table Templates heading
      expect(screen.getByText('Table Templates')).toBeInTheDocument()

      // Check for description
      expect(screen.getByText('Save table templates')).toBeInTheDocument()
      expect(screen.getByText(/Persist table column configurations/)).toBeInTheDocument()

      // Check for toggle switch
      const toggle = screen.getByRole('switch', { name: /save table templates/i })
      expect(toggle).toBeInTheDocument()
      expect(toggle).not.toBeChecked()
    })

    it('CRITICAL: should call updateNode when Table Templates is enabled', () => {
      const mockData = { track_execution_history: false, label: "Output", id: "output-1" }

      renderWithProviders(
        <OutputNodeConfig
          nodeId={mockNodeId}
          data={mockData}
        />
      )

      // Find and click the toggle
      const toggle = screen.getByRole('switch', { name: /save table templates/i })
      fireEvent.click(toggle)

      // Verify updateNode was called with correct parameters
      expect(mockUpdateNode).toHaveBeenCalledWith(mockNodeId, {
        track_execution_history: true
      })
    })

    it('CRITICAL: should call updateNode when Table Templates is disabled', () => {
      const mockData = { track_execution_history: true, label: "Output", id: "output-1" }

      renderWithProviders(
        <OutputNodeConfig
          nodeId={mockNodeId}
          data={mockData}
        />
      )

      // Find and click the toggle (to disable)
      const toggle = screen.getByRole('switch', { name: /save table templates/i })
      fireEvent.click(toggle)

      // Verify updateNode was called with false
      expect(mockUpdateNode).toHaveBeenCalledWith(mockNodeId, {
        track_execution_history: false
      })
    })

    it('should show toggle as checked when Table Templates is enabled', () => {
      const mockData = { track_execution_history: true, label: "Output", id: "output-1" }

      renderWithProviders(
        <OutputNodeConfig
          nodeId={mockNodeId}
          data={mockData}
        />
      )

      const toggle = screen.getByRole('switch', { name: /save table templates/i })
      expect(toggle).toBeChecked()
    })

    it('should show toggle as unchecked when Table Templates is disabled', () => {
      const mockData = { track_execution_history: false, label: "Output", id: "output-1" }

      renderWithProviders(
        <OutputNodeConfig
          nodeId={mockNodeId}
          data={mockData}
        />
      )

      const toggle = screen.getByRole('switch', { name: /save table templates/i })
      expect(toggle).not.toBeChecked()
    })

    it('should handle undefined track_execution_history (defaults to false)', () => {
      const mockData = { label: "Output", id: "output-1" }

      renderWithProviders(
        <OutputNodeConfig
          nodeId={mockNodeId}
          data={mockData}
        />
      )

      const toggle = screen.getByRole('switch', { name: /save table templates/i })
      expect(toggle).not.toBeChecked()
    })
  })

  describe('Table Templates Enabled Confirmation', () => {
    it('should NOT show confirmation message when Table Templates is disabled', () => {
      const mockData = { track_execution_history: false, label: "Output", id: "output-1" }

      renderWithProviders(
        <OutputNodeConfig
          nodeId={mockNodeId}
          data={mockData}
        />
      )

      // Confirmation message should not be present
      expect(screen.queryByText('Table Templates Enabled')).not.toBeInTheDocument()
      expect(screen.queryByText(/Column configurations, visibility settings/)).not.toBeInTheDocument()
    })

    it('CRITICAL: should show confirmation message when Table Templates is enabled', () => {
      const mockData = { track_execution_history: true, label: "Output", id: "output-1" }

      renderWithProviders(
        <OutputNodeConfig
          nodeId={mockNodeId}
          data={mockData}
        />
      )

      // Confirmation message should be present
      expect(screen.getByText('Table Templates Enabled')).toBeInTheDocument()
      expect(screen.getByText(/Column configurations, visibility settings/)).toBeInTheDocument()
      expect(screen.getByText(/Access saved templates via the Table tab/)).toBeInTheDocument()
    })

    it('should have correct styling for confirmation message', () => {
      const mockData = { track_execution_history: true, label: "Output", id: "output-1" }

      renderWithProviders(
        <OutputNodeConfig
          nodeId={mockNodeId}
          data={mockData}
        />
      )

      // Find the container div wrapping the confirmation message
      const confirmation = screen.getByText('Table Templates Enabled').closest('div')
      expect(confirmation).toHaveClass('bg-muted/50')
      expect(confirmation).toHaveClass('border-border')
    })
  })

  describe('Both Features Integration', () => {
    it('CRITICAL: should handle both Time Machine and Table Templates enabled', () => {
      const mockData = {
        enableTimeMachine: true,
        track_execution_history: true,
        label: "Output",
        id: "output-1"
      }

      renderWithProviders(
        <OutputNodeConfig
          nodeId={mockNodeId}
          data={mockData}
        />
      )

      // Both toggles should be checked
      const timeMachineToggle = screen.getByRole('switch', { name: /track execution history/i })
      const tableTemplatesToggle = screen.getByRole('switch', { name: /save table templates/i })

      expect(timeMachineToggle).toBeChecked()
      expect(tableTemplatesToggle).toBeChecked()

      // Both confirmation messages should be present — use unique descriptions
      expect(screen.getByText(/Query results will be captured automatically/)).toBeInTheDocument()
      expect(screen.getByText(/Column configurations, visibility settings/)).toBeInTheDocument()
    })

    it('should render Table2 icon for Table Templates section', () => {
      const mockData = { track_execution_history: false, label: "Output", id: "output-1" }

      const { container } = renderWithProviders(
        <OutputNodeConfig
          nodeId={mockNodeId}
          data={mockData}
        />
      )

      // Check for icons (lucide-react renders as svg)
      const icons = container.querySelectorAll('svg')
      expect(icons.length).toBeGreaterThan(1) // Clock + Table2 icons
    })
  })
})
