/**
 * ValidationModeSelector Component Tests
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ValidationModeSelector } from '../ValidationModeSelector'

describe('ValidationModeSelector', () => {
  it('should render with default value', () => {
    const onChange = vi.fn()
    render(<ValidationModeSelector value="none" onChange={onChange} />)

    expect(screen.getByText('Validation Mode')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('should display all validation modes', () => {
    const onChange = vi.fn()
    render(<ValidationModeSelector value="none" onChange={onChange} />)

    const trigger = screen.getByRole('combobox')
    fireEvent.click(trigger)

    // Mode names might appear in multiple places, so use getAllByText
    expect(screen.getAllByText('No Validation').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Regex Pattern').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Static List').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Query Validation').length).toBeGreaterThan(0)
  })

  it('should call onChange when mode is selected', () => {
    const onChange = vi.fn()
    render(<ValidationModeSelector value="none" onChange={onChange} />)

    const trigger = screen.getByRole('combobox')
    fireEvent.click(trigger)

    const regexOption = screen.getByText('Regex Pattern')
    fireEvent.click(regexOption)

    expect(onChange).toHaveBeenCalledWith('regex')
  })

  it('should show badge for non-none modes', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <ValidationModeSelector value="none" onChange={onChange} />
    )

    // For "none" mode, No Validation is shown
    expect(screen.getAllByText('No Validation').length).toBeGreaterThan(0)

    rerender(<ValidationModeSelector value="regex" onChange={onChange} />)

    // For "regex" mode, Regex Pattern should be visible
    expect(screen.getAllByText('Regex Pattern').length).toBeGreaterThan(0)
  })

  it('should be disabled when disabled prop is true', () => {
    const onChange = vi.fn()
    render(<ValidationModeSelector value="none" onChange={onChange} disabled />)

    const trigger = screen.getByRole('combobox')
    expect(trigger).toBeDisabled()
  })

  it('should display mode description', () => {
    const onChange = vi.fn()
    render(<ValidationModeSelector value="regex" onChange={onChange} />)

    // Description might appear in multiple places, use getAllByText
    expect(screen.getAllByText('Validate using regular expression').length).toBeGreaterThan(0)
  })
})
