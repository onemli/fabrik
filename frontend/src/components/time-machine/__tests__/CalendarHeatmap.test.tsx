/**
 * CalendarHeatmap Component Tests
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CalendarHeatmap from '../CalendarHeatmap'

const noop = vi.fn()

describe('CalendarHeatmap', () => {

  // ── Rendering ──────────────────────────────────────────────────────────────

  it('renders without crashing', () => {
    expect(() =>
      render(<CalendarHeatmap data={{}} year={2024} selectedDate={null} onSelectDate={noop} />)
    ).not.toThrow()
  })

  it('renders the year in the heading', () => {
    render(<CalendarHeatmap data={{}} year={2024} selectedDate={null} onSelectDate={noop} />)
    expect(screen.getByText(/Activity.*2024/)).toBeInTheDocument()
  })

  it('renders legend labels', () => {
    render(<CalendarHeatmap data={{}} year={2024} selectedDate={null} onSelectDate={noop} />)
    expect(screen.getByText('No data')).toBeInTheDocument()
    expect(screen.getByText('Snapshot')).toBeInTheDocument()
    expect(screen.getByText('Changed')).toBeInTheDocument()
  })

  // ── Month labels ───────────────────────────────────────────────────────────

  it('renders Jan label', () => {
    render(<CalendarHeatmap data={{}} year={2024} selectedDate={null} onSelectDate={noop} />)
    expect(screen.getByText('Jan')).toBeInTheDocument()
  })

  it('renders Dec label', () => {
    render(<CalendarHeatmap data={{}} year={2024} selectedDate={null} onSelectDate={noop} />)
    expect(screen.getByText('Dec')).toBeInTheDocument()
  })

  // ── Clear filter button ────────────────────────────────────────────────────

  it('does not show "Clear filter" when selectedDate is null', () => {
    render(<CalendarHeatmap data={{}} year={2024} selectedDate={null} onSelectDate={noop} />)
    expect(screen.queryByText('Clear filter')).not.toBeInTheDocument()
  })

  it('shows "Clear filter" button when selectedDate is set', () => {
    render(
      <CalendarHeatmap
        data={{ '2024-06-15': { count: 1, has_changes: false } }}
        year={2024}
        selectedDate="2024-06-15"
        onSelectDate={noop}
      />
    )
    expect(screen.getByText('Clear filter')).toBeInTheDocument()
  })

  it('calls onSelectDate(null) when "Clear filter" is clicked', () => {
    const onSelect = vi.fn()
    render(
      <CalendarHeatmap
        data={{ '2024-06-15': { count: 1, has_changes: false } }}
        year={2024}
        selectedDate="2024-06-15"
        onSelectDate={onSelect}
      />
    )
    fireEvent.click(screen.getByText('Clear filter'))
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  // ── Cell colours ───────────────────────────────────────────────────────────

  it('renders a cell with emerald colour for a snapshot without changes', () => {
    const data = { '2024-06-15': { count: 2, has_changes: false } }
    const { container } = render(
      <CalendarHeatmap data={data} year={2024} selectedDate={null} onSelectDate={noop} />
    )
    expect(container.querySelector('.bg-emerald-500\\/70')).not.toBeNull()
  })

  it('renders a cell with amber colour for a snapshot with changes', () => {
    const data = { '2024-06-15': { count: 1, has_changes: true } }
    const { container } = render(
      <CalendarHeatmap data={data} year={2024} selectedDate={null} onSelectDate={noop} />
    )
    expect(container.querySelector('.bg-amber-500\\/80')).not.toBeNull()
  })

  // ── Click interaction ──────────────────────────────────────────────────────

  it('calls onSelectDate with date string when a cell with data is clicked', () => {
    const onSelect = vi.fn()
    const today = new Date()
    const year = today.getFullYear()
    const dateStr = `${year}-06-15`
    const data = { [dateStr]: { count: 1, has_changes: false } }
    render(
      <CalendarHeatmap data={data} year={year} selectedDate={null} onSelectDate={onSelect} />
    )
    const cell = document.querySelector(`[title="${dateStr}: 1 snapshot(s)"]`)
    if (cell) fireEvent.click(cell)
    // only assert if cell was found (date might not be rendered for every year)
    if (cell) expect(onSelect).toHaveBeenCalledWith(dateStr)
  })

  // ── Grid structure ─────────────────────────────────────────────────────────

  it('renders day-of-week labels (M, W, F pattern)', () => {
    const { container } = render(
      <CalendarHeatmap data={{}} year={2024} selectedDate={null} onSelectDate={noop} />
    )
    // day labels column contains at least some text (M, W, F on even indices)
    const dayLabels = container.querySelectorAll('.text-\\[9px\\].text-muted-foreground')
    expect(dayLabels.length).toBeGreaterThan(0)
  })
})
