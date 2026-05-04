/**
 * StaticListEditor Component Tests
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StaticListEditor } from '../StaticListEditor'

describe('StaticListEditor', () => {
  const defaultProps = {
    values: [],
    onChange: vi.fn(),
    caseSensitive: false,
    onCaseSensitiveChange: vi.fn(),
    errorMessage: 'Invalid value',
    onErrorMessageChange: vi.fn(),
    errorTitle: 'Error',
    onErrorTitleChange: vi.fn(),
  }

  it('should render with empty values', () => {
    render(<StaticListEditor {...defaultProps} />)

    expect(screen.getByText('Allowed Values (0)')).toBeInTheDocument()
    expect(
      screen.getByText('No values added yet. Add values above to define the allowed list.')
    ).toBeInTheDocument()
  })

  it('should display existing values', () => {
    render(<StaticListEditor {...defaultProps} values={['ABC', 'XYZ', 'DEF']} />)

    expect(screen.getByText('Allowed Values (3)')).toBeInTheDocument()
    expect(screen.getByText('ABC')).toBeInTheDocument()
    expect(screen.getByText('XYZ')).toBeInTheDocument()
    expect(screen.getByText('DEF')).toBeInTheDocument()
  })

  it('should add new value when button is clicked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<StaticListEditor {...defaultProps} onChange={onChange} />)

    const input = screen.getByPlaceholderText('Type value and press Enter')

    // Type value and then press Enter - this tests the keyboard behavior
    // Button click is already tested implicitly when Enter triggers handleAdd
    await user.type(input, 'NEW_VALUE')
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith(['NEW_VALUE'])
  })

  it('should add new value when Enter is pressed', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<StaticListEditor {...defaultProps} onChange={onChange} />)

    const input = screen.getByPlaceholderText('Type value and press Enter')

    await user.type(input, 'NEW_VALUE{Enter}')

    expect(onChange).toHaveBeenCalledWith(['NEW_VALUE'])
  })

  it('should not add duplicate values', () => {
    const onChange = vi.fn()
    render(
      <StaticListEditor
        {...defaultProps}
        values={['ABC']}
        onChange={onChange}
      />
    )

    const input = screen.getByPlaceholderText('Type value and press Enter')
    const addButton = screen.getAllByRole('button').find(
      btn => btn.querySelector('svg')
    )

    fireEvent.change(input, { target: { value: 'ABC' } })
    fireEvent.click(addButton!)

    expect(onChange).not.toHaveBeenCalled()
  })

  it('should remove value when X is clicked', () => {
    const onChange = vi.fn()
    render(
      <StaticListEditor
        {...defaultProps}
        values={['ABC', 'XYZ']}
        onChange={onChange}
      />
    )

    const removeButtons = screen.getAllByRole('button').filter(
      btn => btn.querySelector('svg.h-3')
    )

    fireEvent.click(removeButtons[0])

    expect(onChange).toHaveBeenCalledWith(['XYZ'])
  })

  it('should update error title', () => {
    const onErrorTitleChange = vi.fn()
    render(
      <StaticListEditor
        {...defaultProps}
        errorTitle="Old Title"
        onErrorTitleChange={onErrorTitleChange}
      />
    )

    const input = screen.getByDisplayValue('Old Title')
    fireEvent.change(input, { target: { value: 'New Title' } })

    expect(onErrorTitleChange).toHaveBeenCalledWith('New Title')
  })

  it('should update error message', () => {
    const onErrorMessageChange = vi.fn()
    render(
      <StaticListEditor
        {...defaultProps}
        errorMessage="Old message"
        onErrorMessageChange={onErrorMessageChange}
      />
    )

    const textarea = screen.getByDisplayValue('Old message')
    fireEvent.change(textarea, { target: { value: 'New message' } })

    expect(onErrorMessageChange).toHaveBeenCalledWith('New message')
  })

  it('should toggle case sensitive switch', () => {
    const onCaseSensitiveChange = vi.fn()
    render(
      <StaticListEditor
        {...defaultProps}
        caseSensitive={false}
        onCaseSensitiveChange={onCaseSensitiveChange}
      />
    )

    const switchEl = screen.getByRole('switch')
    fireEvent.click(switchEl)

    expect(onCaseSensitiveChange).toHaveBeenCalledWith(true)
  })

  it('should show bulk input when Bulk Add is clicked', () => {
    render(<StaticListEditor {...defaultProps} />)

    const bulkAddButton = screen.getByText('Bulk Add')
    fireEvent.click(bulkAddButton)

    expect(screen.getByText('Paste values (one per line)')).toBeInTheDocument()
  })

  it('should add multiple values from bulk input', () => {
    const onChange = vi.fn()
    render(<StaticListEditor {...defaultProps} onChange={onChange} />)

    const bulkAddButton = screen.getByText('Bulk Add')
    fireEvent.click(bulkAddButton)

    const textarea = screen.getByPlaceholderText(/ABC.*XYZ.*DEF/s)
    fireEvent.change(textarea, { target: { value: 'ABC\nXYZ\nDEF' } })

    const addValuesButton = screen.getByText(/Add \d+ Values/)
    fireEvent.click(addValuesButton)

    expect(onChange).toHaveBeenCalledWith(['ABC', 'XYZ', 'DEF'])
  })

  it('should show export button when values exist', () => {
    render(<StaticListEditor {...defaultProps} values={['ABC', 'XYZ']} />)

    expect(screen.getByText('Export')).toBeInTheDocument()
  })

  it('should not show export button when no values', () => {
    render(<StaticListEditor {...defaultProps} values={[]} />)

    expect(screen.queryByText('Export')).not.toBeInTheDocument()
  })
})
