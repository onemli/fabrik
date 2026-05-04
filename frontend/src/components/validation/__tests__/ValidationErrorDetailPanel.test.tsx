/**
 * ValidationErrorDetailPanel Component Tests
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ValidationErrorDetailPanel } from '../ValidationErrorDetailPanel'
import { ValidationError } from '@/services/validation'

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('ValidationErrorDetailPanel', () => {
  const mockError: ValidationError = {
    row: 0,
    column: 'tenant',
    value: 'INVALID_TENANT',
    error_title: 'Invalid Tenant',
    error_message: 'Tenant name not found in the system',
    validation_type: 'query_list',
    allowed_values: ['ABC', 'XYZ', 'DEF'],
    cell_ref: 'B2',
  }

  it('should render error details', () => {
    const onClose = vi.fn()
    render(<ValidationErrorDetailPanel error={mockError} onClose={onClose} />)

    expect(screen.getByText('Invalid Tenant')).toBeInTheDocument()
    expect(screen.getByText('Tenant name not found in the system')).toBeInTheDocument()
    expect(screen.getByText(/Cell: B2/)).toBeInTheDocument()
    expect(screen.getByText(/Type: query_list/)).toBeInTheDocument()
  })

  it('should display current value', () => {
    const onClose = vi.fn()
    render(<ValidationErrorDetailPanel error={mockError} onClose={onClose} />)

    expect(screen.getByText('"INVALID_TENANT"')).toBeInTheDocument()
    expect(screen.getByText('Current value:')).toBeInTheDocument()
  })

  it('should display allowed values as badges', () => {
    const onClose = vi.fn()
    render(<ValidationErrorDetailPanel error={mockError} onClose={onClose} />)

    expect(screen.getByText('ABC')).toBeInTheDocument()
    expect(screen.getByText('XYZ')).toBeInTheDocument()
    expect(screen.getByText('DEF')).toBeInTheDocument()
    expect(screen.getByText(/Allowed values \(3 shown\):/)).toBeInTheDocument()
  })

  it('should show "and more" badge for query_list type', () => {
    const onClose = vi.fn()
    render(<ValidationErrorDetailPanel error={mockError} onClose={onClose} />)

    expect(screen.getByText('... and more')).toBeInTheDocument()
  })

  it('should not show "and more" for non-query types', () => {
    const onClose = vi.fn()
    const staticListError = { ...mockError, validation_type: 'static_list' as const }

    render(<ValidationErrorDetailPanel error={staticListError} onClose={onClose} />)

    expect(screen.queryByText('... and more')).not.toBeInTheDocument()
  })

  it('should call onClose when close button is clicked', () => {
    const onClose = vi.fn()
    render(<ValidationErrorDetailPanel error={mockError} onClose={onClose} />)

    const closeButton = screen.getByRole('button', { name: '' })
    fireEvent.click(closeButton)

    expect(onClose).toHaveBeenCalled()
  })

  it('should show copy button for current value', () => {
    const onClose = vi.fn()
    render(<ValidationErrorDetailPanel error={mockError} onClose={onClose} />)

    expect(screen.getByText('Copy')).toBeInTheDocument()
  })

  it('should not show allowed values section when none provided', () => {
    const onClose = vi.fn()
    const errorWithoutValues = { ...mockError, allowed_values: undefined }

    render(<ValidationErrorDetailPanel error={errorWithoutValues} onClose={onClose} />)

    expect(screen.queryByText(/Allowed values/)).not.toBeInTheDocument()
  })

  it('should show help text for copying values', () => {
    const onClose = vi.fn()
    render(<ValidationErrorDetailPanel error={mockError} onClose={onClose} />)

    expect(
      screen.getByText(/Click a value to copy to clipboard, then paste into the cell/)
    ).toBeInTheDocument()
  })
})
