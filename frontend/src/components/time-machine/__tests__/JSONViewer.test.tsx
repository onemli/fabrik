/**
 * JSONViewer Component Tests
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import JSONViewer from '../JSONViewer'

describe('JSONViewer', () => {

  // ── Rendering ──────────────────────────────────────────────────────────────

  it('renders without crashing', () => {
    expect(() => render(<JSONViewer data={{}} />)).not.toThrow()
  })

  it('renders a pre element', () => {
    const { container } = render(<JSONViewer data={{}} />)
    expect(container.querySelector('pre')).toBeInTheDocument()
  })

  it('renders a code element', () => {
    const { container } = render(<JSONViewer data={{}} />)
    expect(container.querySelector('code')).toBeInTheDocument()
  })

  // ── Data display ───────────────────────────────────────────────────────────

  it('displays simple string value', () => {
    const { container } = render(<JSONViewer data={{ name: 'tenant1' }} />)
    expect(container.innerHTML).toContain('tenant1')
  })

  it('displays numeric value', () => {
    const { container } = render(<JSONViewer data={{ count: 42 }} />)
    expect(container.innerHTML).toContain('42')
  })

  it('displays boolean true', () => {
    const { container } = render(<JSONViewer data={{ active: true }} />)
    expect(container.innerHTML).toContain('true')
  })

  it('displays boolean false', () => {
    const { container } = render(<JSONViewer data={{ active: false }} />)
    expect(container.innerHTML).toContain('false')
  })

  it('displays null value', () => {
    const { container } = render(<JSONViewer data={{ descr: null }} />)
    expect(container.innerHTML).toContain('null')
  })

  it('displays nested objects', () => {
    const data = { fvTenant: { attributes: { dn: 'uni/tn-t1' } } }
    const { container } = render(<JSONViewer data={data} />)
    expect(container.innerHTML).toContain('uni/tn-t1')
  })

  it('displays arrays', () => {
    const data = [{ fvTenant: { attributes: { dn: 'uni/tn-t1' } } }]
    const { container } = render(<JSONViewer data={data} />)
    expect(container.innerHTML).toContain('uni/tn-t1')
  })

  // ── Syntax highlighting ────────────────────────────────────────────────────

  it('applies blue colour class for keys', () => {
    const { container } = render(<JSONViewer data={{ myKey: 'val' }} />)
    // Keys should be wrapped in a span with text-blue-400
    const blue = container.querySelector('.text-blue-400')
    expect(blue).not.toBeNull()
    expect(blue!.textContent).toContain('myKey')
  })

  it('applies emerald colour class for string values', () => {
    const { container } = render(<JSONViewer data={{ k: 'hello' }} />)
    const emerald = container.querySelector('.text-emerald-400')
    expect(emerald).not.toBeNull()
    expect(emerald!.textContent).toContain('hello')
  })

  it('applies purple colour class for boolean values', () => {
    const { container } = render(<JSONViewer data={{ flag: true }} />)
    const purple = container.querySelector('.text-purple-400')
    expect(purple).not.toBeNull()
  })

  it('applies red colour class for null values', () => {
    const { container } = render(<JSONViewer data={{ n: null }} />)
    const red = container.querySelector('.text-red-400')
    expect(red).not.toBeNull()
  })

  it('applies amber colour class for numbers', () => {
    const { container } = render(<JSONViewer data={{ count: 99 }} />)
    const amber = container.querySelector('.text-amber-400')
    expect(amber).not.toBeNull()
  })

  // ── Edge cases ─────────────────────────────────────────────────────────────

  it('handles empty object', () => {
    const { container } = render(<JSONViewer data={{}} />)
    expect(container.querySelector('code')).toBeInTheDocument()
  })

  it('handles empty array', () => {
    const { container } = render(<JSONViewer data={[]} />)
    expect(container.querySelector('code')).toBeInTheDocument()
  })

  it('handles deeply nested data', () => {
    const data = {
      imdata: [
        { fvTenant: { attributes: { dn: 'uni/tn-t1', name: 'tenant1' } } },
        { fvBD: { attributes: { dn: 'uni/tn-t1/BD-bd1' } } },
      ]
    }
    const { container } = render(<JSONViewer data={data} />)
    expect(container.innerHTML).toContain('uni/tn-t1')
    expect(container.innerHTML).toContain('tenant1')
  })
})
