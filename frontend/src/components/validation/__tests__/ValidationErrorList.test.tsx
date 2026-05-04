/**
 * ValidationErrorList Component Tests
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ValidationErrorList } from '../ValidationErrorList'
import { ValidationError } from '@/services/validation'

describe('ValidationErrorList', () => {
  const mockErrors: ValidationError[] = [
    {
      row: 0,
      column: 'tenant',
      value: 'INVALID_TENANT',
      error_title: 'Invalid Tenant',
      error_message: 'Tenant name not found in the system',
      validation_type: 'query_list',
      allowed_values: ['ABC', 'XYZ', 'DEF'],
      cell_ref: 'B2',
    },
    {
      row: 1,
      column: 'vlan_id',
      value: '9999',
      error_title: 'Invalid VLAN',
      error_message: 'VLAN ID must be between 1 and 4094',
      validation_type: 'regex',
      cell_ref: 'C3',
    },
    {
      row: 2,
      column: 'ip_address',
      value: '256.1.1.1',
      error_title: 'Invalid IP',
      error_message: 'Invalid IPv4 address format',
      validation_type: 'regex',
      cell_ref: 'D4',
    },
  ]

  it('should render error count', () => {
    const onSelect = vi.fn()
    const onJumpToCell = vi.fn()

    render(
      <ValidationErrorList
        errors={mockErrors}
        selectedError={null}
        onSelect={onSelect}
        onJumpToCell={onJumpToCell}
      />
    )

    expect(screen.getByText('3 Errors')).toBeInTheDocument()
  })

  it('should render singular "Error" for single error', () => {
    const onSelect = vi.fn()
    const onJumpToCell = vi.fn()

    render(
      <ValidationErrorList
        errors={[mockErrors[0]]}
        selectedError={null}
        onSelect={onSelect}
        onJumpToCell={onJumpToCell}
      />
    )

    expect(screen.getByText('1 Error')).toBeInTheDocument()
  })

  it('should render all error items', () => {
    const onSelect = vi.fn()
    const onJumpToCell = vi.fn()

    render(
      <ValidationErrorList
        errors={mockErrors}
        selectedError={null}
        onSelect={onSelect}
        onJumpToCell={onJumpToCell}
      />
    )

    expect(screen.getByText('Invalid Tenant')).toBeInTheDocument()
    expect(screen.getByText('Invalid VLAN')).toBeInTheDocument()
    expect(screen.getByText('Invalid IP')).toBeInTheDocument()
  })

  it('should display error details', () => {
    const onSelect = vi.fn()
    const onJumpToCell = vi.fn()

    render(
      <ValidationErrorList
        errors={mockErrors}
        selectedError={null}
        onSelect={onSelect}
        onJumpToCell={onJumpToCell}
      />
    )

    // Error title
    expect(screen.getByText('Invalid Tenant')).toBeInTheDocument()

    // Cell reference and column
    expect(screen.getByText(/Cell B2/)).toBeInTheDocument()
    expect(screen.getByText(/tenant/)).toBeInTheDocument()

    // Error message
    expect(
      screen.getByText('Tenant name not found in the system')
    ).toBeInTheDocument()

    // Value
    expect(screen.getByText('"INVALID_TENANT"')).toBeInTheDocument()

    // Validation type badge
    expect(screen.getByText('query_list')).toBeInTheDocument()
  })

  it('should call onSelect and onJumpToCell when error is clicked', () => {
    const onSelect = vi.fn()
    const onJumpToCell = vi.fn()

    render(
      <ValidationErrorList
        errors={mockErrors}
        selectedError={null}
        onSelect={onSelect}
        onJumpToCell={onJumpToCell}
      />
    )

    const firstError = screen.getByText('Invalid Tenant').closest('button')
    fireEvent.click(firstError!)

    expect(onSelect).toHaveBeenCalledWith(mockErrors[0])
    expect(onJumpToCell).toHaveBeenCalledWith(mockErrors[0])
  })

  it('should highlight selected error', () => {
    const onSelect = vi.fn()
    const onJumpToCell = vi.fn()

    render(
      <ValidationErrorList
        errors={mockErrors}
        selectedError={mockErrors[1]}
        onSelect={onSelect}
        onJumpToCell={onJumpToCell}
      />
    )

    const selectedButton = screen.getByText('Invalid VLAN').closest('button')
    expect(selectedButton).toHaveClass('border-red-500')

    const unselectedButton = screen.getByText('Invalid Tenant').closest('button')
    expect(unselectedButton).not.toHaveClass('border-red-500')
  })

  it('should show empty state when no errors', () => {
    const onSelect = vi.fn()
    const onJumpToCell = vi.fn()

    render(
      <ValidationErrorList
        errors={[]}
        selectedError={null}
        onSelect={onSelect}
        onJumpToCell={onJumpToCell}
      />
    )

    expect(screen.getByText('0 Errors')).toBeInTheDocument()
    expect(screen.getByText('No validation errors')).toBeInTheDocument()
  })

  it('should render all validation types', () => {
    const onSelect = vi.fn()
    const onJumpToCell = vi.fn()

    render(
      <ValidationErrorList
        errors={mockErrors}
        selectedError={null}
        onSelect={onSelect}
        onJumpToCell={onJumpToCell}
      />
    )

    expect(screen.getByText('query_list')).toBeInTheDocument()
    expect(screen.getAllByText('regex')).toHaveLength(2)
  })

  it('should handle multiple clicks on same error', () => {
    const onSelect = vi.fn()
    const onJumpToCell = vi.fn()

    render(
      <ValidationErrorList
        errors={mockErrors}
        selectedError={null}
        onSelect={onSelect}
        onJumpToCell={onJumpToCell}
      />
    )

    const firstError = screen.getByText('Invalid Tenant').closest('button')

    fireEvent.click(firstError!)
    fireEvent.click(firstError!)

    expect(onSelect).toHaveBeenCalledTimes(2)
    expect(onJumpToCell).toHaveBeenCalledTimes(2)
  })

  it('should display truncated error messages', () => {
    const longError: ValidationError = {
      row: 0,
      column: 'description',
      value: 'long value',
      error_title: 'Too Long',
      error_message:
        'This is a very long error message that should be truncated when displayed in the error list to prevent it from taking too much space and making the UI look messy',
      validation_type: 'regex',
      cell_ref: 'A1',
    }

    const onSelect = vi.fn()
    const onJumpToCell = vi.fn()

    render(
      <ValidationErrorList
        errors={[longError]}
        selectedError={null}
        onSelect={onSelect}
        onJumpToCell={onJumpToCell}
      />
    )

    const messageElement = screen.getByText(/This is a very long error message/)
    expect(messageElement).toHaveClass('line-clamp-2')
  })

  it('should render AlertCircle icon for each error', () => {
    const onSelect = vi.fn()
    const onJumpToCell = vi.fn()

    const { container } = render(
      <ValidationErrorList
        errors={mockErrors}
        selectedError={null}
        onSelect={onSelect}
        onJumpToCell={onJumpToCell}
      />
    )

    const icons = container.querySelectorAll('svg')
    // Should have 3 AlertCircle icons (one per error)
    expect(icons.length).toBeGreaterThanOrEqual(3)
  })

  it('should handle error without allowed_values', () => {
    const errorWithoutValues: ValidationError = {
      row: 0,
      column: 'field',
      value: 'test',
      error_title: 'Error Title',
      error_message: 'Error message',
      validation_type: 'regex',
      cell_ref: 'A1',
    }

    const onSelect = vi.fn()
    const onJumpToCell = vi.fn()

    render(
      <ValidationErrorList
        errors={[errorWithoutValues]}
        selectedError={null}
        onSelect={onSelect}
        onJumpToCell={onJumpToCell}
      />
    )

    expect(screen.getByText('Error Title')).toBeInTheDocument()
    expect(screen.getByText('"test"')).toBeInTheDocument()
  })
})
