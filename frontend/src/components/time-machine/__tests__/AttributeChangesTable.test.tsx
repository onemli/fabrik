/**
 * AttributeChangesTable Component Tests
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import AttributeChangesTable from '../AttributeChangesTable'

describe('AttributeChangesTable', () => {

  // ── Null / empty guards ──────────────────────────────────────────────────

  it('renders nothing when changes is empty array', () => {
    const { container } = render(<AttributeChangesTable changes={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when changes is undefined', () => {
    const { container } = render(
      <AttributeChangesTable changes={undefined as any} />
    )
    expect(container.firstChild).toBeNull()
  })

  // ── Basic rendering ──────────────────────────────────────────────────────

  it('renders the header with change count', () => {
    const changes = [{ key: 'name', old: 'foo', new: 'bar' }]
    render(<AttributeChangesTable changes={changes} />)
    expect(screen.getByText(/Attribute Changes \(1\)/)).toBeInTheDocument()
  })

  it('renders table headers', () => {
    const changes = [{ key: 'name', old: 'a', new: 'b' }]
    render(<AttributeChangesTable changes={changes} />)
    expect(screen.getByText('Attribute')).toBeInTheDocument()
    expect(screen.getByText('Before')).toBeInTheDocument()
    expect(screen.getByText('After')).toBeInTheDocument()
  })

  it('renders attribute key', () => {
    const changes = [{ key: 'descr', old: 'old', new: 'new' }]
    render(<AttributeChangesTable changes={changes} />)
    expect(screen.getByText('descr')).toBeInTheDocument()
  })

  it('renders old value', () => {
    const changes = [{ key: 'name', old: 'OldValue', new: 'NewValue' }]
    render(<AttributeChangesTable changes={changes} />)
    expect(screen.getByText('OldValue')).toBeInTheDocument()
  })

  it('renders new value', () => {
    const changes = [{ key: 'name', old: 'OldValue', new: 'NewValue' }]
    render(<AttributeChangesTable changes={changes} />)
    expect(screen.getByText('NewValue')).toBeInTheDocument()
  })

  // ── Null / undefined values ───────────────────────────────────────────────

  it('shows "null" text for null old value', () => {
    const changes = [{ key: 'descr', old: null, new: 'something' }]
    render(<AttributeChangesTable changes={changes} />)
    expect(screen.getAllByText('null').length).toBeGreaterThan(0)
  })

  it('shows "null" text for null new value', () => {
    const changes = [{ key: 'descr', old: 'something', new: null }]
    render(<AttributeChangesTable changes={changes} />)
    expect(screen.getAllByText('null').length).toBeGreaterThan(0)
  })

  it('shows "null" text for undefined old value', () => {
    const changes = [{ key: 'descr', old: undefined, new: 'x' }]
    render(<AttributeChangesTable changes={changes} />)
    expect(screen.getAllByText('null').length).toBeGreaterThan(0)
  })

  // ── Multiple changes ───────────────────────────────────────────────────────

  it('renders multiple change rows', () => {
    const changes = [
      { key: 'name', old: 'a', new: 'b' },
      { key: 'descr', old: 'x', new: 'y' },
      { key: 'status', old: '1', new: '2' },
    ]
    render(<AttributeChangesTable changes={changes} />)
    expect(screen.getByText(/Attribute Changes \(3\)/)).toBeInTheDocument()
    expect(screen.getByText('name')).toBeInTheDocument()
    expect(screen.getByText('descr')).toBeInTheDocument()
    expect(screen.getByText('status')).toBeInTheDocument()
  })

  it('renders boolean values as strings', () => {
    const changes = [{ key: 'enabled', old: false, new: true }]
    render(<AttributeChangesTable changes={changes} />)
    expect(screen.getByText('false')).toBeInTheDocument()
    expect(screen.getByText('true')).toBeInTheDocument()
  })

  it('renders numeric values as strings', () => {
    const changes = [{ key: 'count', old: 0, new: 42 }]
    render(<AttributeChangesTable changes={changes} />)
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
  })
})
