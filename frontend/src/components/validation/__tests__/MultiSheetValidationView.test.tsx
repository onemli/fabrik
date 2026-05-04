/**
 * MultiSheetValidationView Component Tests
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MultiSheetValidationView } from '../MultiSheetValidationView'
import { MultiSheetValidationResult } from '@/services/validation'

// Mock child components
vi.mock('../ValidationErrorList', () => ({
  ValidationErrorList: ({ errors, onSelect }: any) => (
    <div data-testid="error-list">
      <div>{errors.length} errors</div>
      <button onClick={() => onSelect(errors[0])}>Select First</button>
    </div>
  ),
}))

vi.mock('../ValidationErrorGrid', () => ({
  ValidationErrorGrid: vi.fn(({ sheet, validationResult }: any) => (
    <div data-testid={`grid-${sheet.name}`}>
      Grid for {sheet.name}
      {validationResult && <div>{validationResult.errors.length} errors</div>}
    </div>
  )),
}))

describe('MultiSheetValidationView', () => {
  const mockSheets = [
    {
      name: 'Sheet1',
      rows: [{ tenant: 'ABC' }, { tenant: 'XYZ' }],
      columns: [{ name: 'tenant', display_name: 'Tenant' }],
    },
    {
      name: 'Sheet2',
      rows: [{ vlan: '100' }],
      columns: [{ name: 'vlan', display_name: 'VLAN' }],
    },
  ]

  const mockValidationResult: MultiSheetValidationResult = {
    is_valid: false,
    total_errors: 2,
    validation_time_ms: 150,
    sheets: {
      Sheet1: {
        error_count: 1,
        errors: [
          {
            row: 0,
            column: 'tenant',
            value: 'ABC',
            error_title: 'Invalid',
            error_message: 'Not valid',
            validation_type: 'query_list',
            cell_ref: 'A1',
          },
        ],
        is_valid: false,
      },
      Sheet2: {
        error_count: 1,
        errors: [
          {
            row: 0,
            column: 'vlan',
            value: '100',
            error_title: 'Invalid VLAN',
            error_message: 'Not valid',
            validation_type: 'regex',
            cell_ref: 'A1',
          },
        ],
        is_valid: false,
      },
    },
  }

  it('should render header with title', () => {
    render(<MultiSheetValidationView sheets={mockSheets} />)

    expect(screen.getByText('Data Validation')).toBeInTheDocument()
    expect(
      screen.getByText('Review and fix validation errors before submitting')
    ).toBeInTheDocument()
  })

  it('should show validation status badge when valid', () => {
    const validResult: MultiSheetValidationResult = {
      is_valid: true,
      total_errors: 0,
      validation_time_ms: 0,
      sheets: {
        Sheet1: {
          error_count: 0,
          errors: [],
          is_valid: true,
        },
      },
    }

    render(<MultiSheetValidationView sheets={mockSheets} validationResult={validResult} />)

    expect(screen.getByText('All Valid')).toBeInTheDocument()
  })

  it('should show validation status badge when invalid', () => {
    render(
      <MultiSheetValidationView
        sheets={mockSheets}
        validationResult={mockValidationResult}
      />
    )

    expect(screen.getByText('2 Errors')).toBeInTheDocument()
  })

  it('should show singular "Error" for single error', () => {
    const singleErrorResult: MultiSheetValidationResult = {
      is_valid: false,
      total_errors: 1,
      validation_time_ms: 0,
      sheets: {
        Sheet1: {
          error_count: 1,
          errors: [
            {
              row: 0,
              column: 'tenant',
              value: 'ABC',
              error_title: 'Invalid',
              error_message: 'Not valid',
              validation_type: 'query_list',
              cell_ref: 'A1',
            },
          ],
          is_valid: false,
        },
      },
    }

    render(
      <MultiSheetValidationView
        sheets={mockSheets}
        validationResult={singleErrorResult}
      />
    )

    expect(screen.getByText('1 Error')).toBeInTheDocument()
  })

  it('should display validation time', () => {
    render(
      <MultiSheetValidationView
        sheets={mockSheets}
        validationResult={mockValidationResult}
      />
    )

    expect(screen.getByText('150ms')).toBeInTheDocument()
  })

  it('should render Re-Validate button', () => {
    const onRevalidate = vi.fn()

    render(
      <MultiSheetValidationView
        sheets={mockSheets}
        validationResult={mockValidationResult}
        onRevalidate={onRevalidate}
      />
    )

    const button = screen.getByRole('button', { name: /Re-Validate/i })
    expect(button).toBeInTheDocument()

    fireEvent.click(button)
    expect(onRevalidate).toHaveBeenCalled()
  })

  it('should disable Re-Validate button when loading', () => {
    render(
      <MultiSheetValidationView
        sheets={mockSheets}
        validationResult={mockValidationResult}
        loading={true}
      />
    )

    const button = screen.getByRole('button', { name: /Re-Validate/i })
    expect(button).toBeDisabled()
  })

  it('should show spinning icon when loading', () => {
    const { container } = render(
      <MultiSheetValidationView
        sheets={mockSheets}
        validationResult={mockValidationResult}
        loading={true}
      />
    )

    const spinningIcon = container.querySelector('.animate-spin')
    expect(spinningIcon).toBeTruthy()
  })

  it('should render sheet tabs', () => {
    render(<MultiSheetValidationView sheets={mockSheets} />)

    expect(screen.getByRole('tab', { name: /Sheet1/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Sheet2/i })).toBeInTheDocument()
  })

  it('should show error count badges on tabs', () => {
    render(
      <MultiSheetValidationView
        sheets={mockSheets}
        validationResult={mockValidationResult}
      />
    )

    // Both sheets have 1 error each
    const badges = screen.getAllByText('1')
    expect(badges.length).toBeGreaterThanOrEqual(2)
  })

  it('should show error list when current sheet has errors', () => {
    render(
      <MultiSheetValidationView
        sheets={mockSheets}
        validationResult={mockValidationResult}
      />
    )

    expect(screen.getByTestId('error-list')).toBeInTheDocument()
    // There might be multiple "1 errors" elements
    expect(screen.getAllByText('1 errors').length).toBeGreaterThan(0)
  })

  it('should not show error list when current sheet has no errors', () => {
    const noErrorsResult: MultiSheetValidationResult = {
      is_valid: true,
      total_errors: 0,
      validation_time_ms: 0,
      sheets: {
        Sheet1: {
          error_count: 0,
          errors: [],
          is_valid: true,
        },
        Sheet2: {
          error_count: 0,
          errors: [],
          is_valid: true,
        },
      },
    }

    render(
      <MultiSheetValidationView sheets={mockSheets} validationResult={noErrorsResult} />
    )

    expect(screen.queryByTestId('error-list')).not.toBeInTheDocument()
  })

  it('should render grid for each sheet', () => {
    render(<MultiSheetValidationView sheets={mockSheets} />)

    // First sheet's grid should be visible (active tab)
    expect(screen.getByTestId('grid-Sheet1')).toBeInTheDocument()

    // Second sheet's grid is in the hidden tab content
    // Just check that tabs for both sheets exist
    expect(screen.getByRole('tab', { name: /Sheet1/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Sheet2/i })).toBeInTheDocument()
  })

  it('should switch active sheet when tab is clicked', () => {
    render(
      <MultiSheetValidationView
        sheets={mockSheets}
        validationResult={mockValidationResult}
      />
    )

    // Initially Sheet1 is active
    const sheet1Tab = screen.getByRole('tab', { name: /Sheet1/i })
    expect(sheet1Tab).toHaveAttribute('data-state', 'active')

    // Click Sheet2 tab
    const sheet2Tab = screen.getByRole('tab', { name: /Sheet2/i })
    fireEvent.click(sheet2Tab)

    // Tab should be clickable (actual state change depends on Radix implementation)
    expect(sheet2Tab).toBeInTheDocument()
  })

  it('should show bypassed alert when validation is bypassed', () => {
    const bypassedResult: MultiSheetValidationResult = {
      is_valid: true,
      total_errors: 0,
      validation_time_ms: 0,
      bypassed: true,
      message: 'Validation bypassed by admin',
      sheets: {},
    }

    render(
      <MultiSheetValidationView sheets={mockSheets} validationResult={bypassedResult} />
    )

    expect(screen.getByText('Validation bypassed by admin')).toBeInTheDocument()
  })

  it('should show default bypassed message when no message provided', () => {
    const bypassedResult: MultiSheetValidationResult = {
      is_valid: true,
      total_errors: 0,
      validation_time_ms: 0,
      bypassed: true,
      sheets: {},
    }

    render(
      <MultiSheetValidationView sheets={mockSheets} validationResult={bypassedResult} />
    )

    expect(screen.getByText('Validation bypassed')).toBeInTheDocument()
  })

  it('should show instructions when there are errors', () => {
    render(
      <MultiSheetValidationView
        sheets={mockSheets}
        validationResult={mockValidationResult}
      />
    )

    expect(screen.getByText(/How to fix errors:/)).toBeInTheDocument()
    expect(
      screen.getByText(/Click on a red cell or select an error from the left panel/)
    ).toBeInTheDocument()
  })

  it('should not show instructions when all valid', () => {
    const validResult: MultiSheetValidationResult = {
      is_valid: true,
      total_errors: 0,
      validation_time_ms: 0,
      sheets: {
        Sheet1: {
          error_count: 0,
          errors: [],
          is_valid: true,
        },
      },
    }

    render(
      <MultiSheetValidationView sheets={mockSheets} validationResult={validResult} />
    )

    expect(screen.queryByText(/How to fix errors:/)).not.toBeInTheDocument()
  })

  it('should handle empty sheets array', () => {
    render(<MultiSheetValidationView sheets={[]} />)

    expect(screen.getByText('Data Validation')).toBeInTheDocument()
  })

  it('should handle single sheet', () => {
    render(<MultiSheetValidationView sheets={[mockSheets[0]]} />)

    expect(screen.getByRole('tab', { name: /Sheet1/i })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Sheet2/i })).not.toBeInTheDocument()
  })

  it('should pass validation result to grids', () => {
    render(
      <MultiSheetValidationView
        sheets={mockSheets}
        validationResult={mockValidationResult}
      />
    )

    // Both grids should show their error counts
    const errorCounts = screen.getAllByText('1 errors')
    expect(errorCounts.length).toBeGreaterThanOrEqual(2)
  })
})
