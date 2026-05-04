/**
 * AnnotationDialog Component Tests
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AnnotationDialog from '../AnnotationDialog'

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  label: '',
  annotation: '',
  onLabelChange: vi.fn(),
  onAnnotationChange: vi.fn(),
  onSave: vi.fn(),
  isSaving: false,
}

describe('AnnotationDialog', () => {

  // ── Visibility ─────────────────────────────────────────────────────────────

  it('renders dialog content when open=true', () => {
    render(<AnnotationDialog {...defaultProps} />)
    expect(screen.getByText('Add Note to Snapshot')).toBeInTheDocument()
  })

  it('does not show dialog content when open=false', () => {
    render(<AnnotationDialog {...defaultProps} open={false} />)
    expect(screen.queryByText('Add Note to Snapshot')).not.toBeInTheDocument()
  })

  // ── Form fields ────────────────────────────────────────────────────────────

  it('renders Label input', () => {
    render(<AnnotationDialog {...defaultProps} />)
    expect(screen.getByLabelText('Label (short tag)')).toBeInTheDocument()
  })

  it('renders Note textarea', () => {
    render(<AnnotationDialog {...defaultProps} />)
    expect(screen.getByLabelText('Note')).toBeInTheDocument()
  })

  it('shows provided label value in the input', () => {
    render(<AnnotationDialog {...defaultProps} label="Before deploy" />)
    const input = screen.getByLabelText('Label (short tag)') as HTMLInputElement
    expect(input.value).toBe('Before deploy')
  })

  it('shows provided annotation value in the textarea', () => {
    render(<AnnotationDialog {...defaultProps} annotation="Some long note" />)
    const textarea = screen.getByLabelText('Note') as HTMLTextAreaElement
    expect(textarea.value).toBe('Some long note')
  })

  // ── Callbacks ──────────────────────────────────────────────────────────────

  it('calls onLabelChange when label input changes', () => {
    const onLabelChange = vi.fn()
    render(<AnnotationDialog {...defaultProps} onLabelChange={onLabelChange} />)
    fireEvent.change(screen.getByLabelText('Label (short tag)'), {
      target: { value: 'new label' },
    })
    expect(onLabelChange).toHaveBeenCalledWith('new label')
  })

  it('calls onAnnotationChange when note textarea changes', () => {
    const onAnnotationChange = vi.fn()
    render(<AnnotationDialog {...defaultProps} onAnnotationChange={onAnnotationChange} />)
    fireEvent.change(screen.getByLabelText('Note'), {
      target: { value: 'my note' },
    })
    expect(onAnnotationChange).toHaveBeenCalledWith('my note')
  })

  it('calls onSave when Save button is clicked', () => {
    const onSave = vi.fn()
    render(<AnnotationDialog {...defaultProps} onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    expect(onSave).toHaveBeenCalled()
  })

  it('calls onOpenChange(false) when Cancel is clicked', () => {
    const onOpenChange = vi.fn()
    render(<AnnotationDialog {...defaultProps} onOpenChange={onOpenChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  // ── Saving state ───────────────────────────────────────────────────────────

  it('shows "Saving..." text when isSaving=true', () => {
    render(<AnnotationDialog {...defaultProps} isSaving={true} />)
    expect(screen.getByText('Saving...')).toBeInTheDocument()
  })

  it('shows "Save" text when isSaving=false', () => {
    render(<AnnotationDialog {...defaultProps} isSaving={false} />)
    expect(screen.getByRole('button', { name: /^Save$/ })).toBeInTheDocument()
  })

  it('Save button is disabled when isSaving=true', () => {
    render(<AnnotationDialog {...defaultProps} isSaving={true} />)
    const btn = screen.getByRole('button', { name: /Saving/ })
    expect(btn).toBeDisabled()
  })

  it('Save button is not disabled when isSaving=false', () => {
    render(<AnnotationDialog {...defaultProps} isSaving={false} />)
    const btn = screen.getByRole('button', { name: /^Save$/ })
    expect(btn).not.toBeDisabled()
  })
})
