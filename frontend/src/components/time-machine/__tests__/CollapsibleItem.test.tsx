/**
 * CollapsibleItem Component Tests
 */
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CollapsibleItem from '../CollapsibleItem'

const Content = () => <div>Expanded content</div>

describe('CollapsibleItem', () => {

  // ── Type labels ────────────────────────────────────────────────────────────

  it('shows "Added" label for type added', () => {
    render(
      <CollapsibleItem type="added" dn="uni/tn-t1" index={0}
        content={<Content />} />
    )
    expect(screen.getByText('Added')).toBeInTheDocument()
  })

  it('shows "Modified" label for type modified', () => {
    render(
      <CollapsibleItem type="modified" dn="uni/tn-t1" index={0}
        content={<Content />} />
    )
    expect(screen.getByText('Modified')).toBeInTheDocument()
  })

  it('shows "Deleted" label for type deleted', () => {
    render(
      <CollapsibleItem type="deleted" dn="uni/tn-t1" index={0}
        content={<Content />} />
    )
    expect(screen.getByText('Deleted')).toBeInTheDocument()
  })

  // ── DN display ─────────────────────────────────────────────────────────────

  it('shows the dn in the header', () => {
    render(
      <CollapsibleItem type="added" dn="uni/tn-tenant1/BD-bd1" index={0}
        content={<Content />} />
    )
    expect(screen.getByText('uni/tn-tenant1/BD-bd1')).toBeInTheDocument()
  })

  // ── Expand / collapse ──────────────────────────────────────────────────────

  it('content is hidden initially', () => {
    render(
      <CollapsibleItem type="added" dn="uni/tn-t1" index={0}
        content={<Content />} />
    )
    expect(screen.queryByText('Expanded content')).not.toBeInTheDocument()
  })

  it('content is shown after clicking the header button', () => {
    render(
      <CollapsibleItem type="added" dn="uni/tn-t1" index={0}
        content={<Content />} />
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Expanded content')).toBeInTheDocument()
  })

  it('content is hidden again after second click', () => {
    render(
      <CollapsibleItem type="added" dn="uni/tn-t1" index={0}
        content={<Content />} />
    )
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByText('Expanded content')).not.toBeInTheDocument()
  })

  it('renders any ReactNode as content', () => {
    const RichContent = () => (
      <div>
        <span>Before</span>
        <span>After</span>
      </div>
    )
    render(
      <CollapsibleItem type="modified" dn="uni/tn-t1" index={0}
        content={<RichContent />} />
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Before')).toBeInTheDocument()
    expect(screen.getByText('After')).toBeInTheDocument()
  })

  // ── Styling sanity ─────────────────────────────────────────────────────────

  it('renders without crashing for each type', () => {
    for (const type of ['added', 'modified', 'deleted'] as const) {
      expect(() =>
        render(
          <CollapsibleItem type={type} dn="x" index={0} content={<span>c</span>} />
        )
      ).not.toThrow()
    }
  })
})
