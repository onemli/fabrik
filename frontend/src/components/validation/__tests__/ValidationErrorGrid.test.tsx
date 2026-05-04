// ValidationErrorGrid Component Tests — Tabulator version
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ValidationErrorGrid } from '../ValidationErrorGrid'
import { ValidationError, SheetValidationResult } from '@/services/validation'

// Mock react-tabulator
vi.mock('react-tabulator', () => ({
  ReactTabulator: vi.fn(({ data, columns }: any) => (
    <div
      data-testid="tabulator"
      data-rows={JSON.stringify(data)}
      data-columns={JSON.stringify(columns?.map((c: any) => ({
        title: c.title,
        field: c.field,
        headerSort: c.headerSort,
        headerFilter: c.headerFilter,
        resizable: c.resizable,
      })))}
    >
      Mocked Tabulator
    </div>
  )),
}))

vi.mock('tabulator-tables/dist/css/tabulator_simple.min.css', () => ({}))
vi.mock('@/components/SchemaDesigner/tabulator-fabrik.css', () => ({}))

vi.mock('../ValidationErrorDetailPanel', () => ({
  ValidationErrorDetailPanel: ({ error, onClose }: any) => (
    <div data-testid="detail-panel">
      <div>{error.error_title}</div>
      <button onClick={onClose}>Close</button>
    </div>
  ),
}))

vi.mock('../createErrorCellRenderer', () => ({
  applyErrorHighlights: vi.fn(() => () => {}),
}))

describe('ValidationErrorGrid', () => {
  const mockSheet = {
    name: 'Template1',
    rows: [
      { tenant: 'ABC', vlan_id: '100' },
      { tenant: 'INVALID', vlan_id: '200' },
      { tenant: 'XYZ', vlan_id: '9999' },
    ],
    columns: [
      { name: 'tenant', display_name: 'Tenant Name' },
      { name: 'vlan_id', display_name: 'VLAN ID' },
    ],
  }

  const mockErrors: ValidationError[] = [
    {
      row: 1,
      column: 'tenant',
      value: 'INVALID',
      error_title: 'Invalid Tenant',
      error_message: 'Tenant not found',
      validation_type: 'query_list',
      cell_ref: 'A2',
    },
    {
      row: 2,
      column: 'vlan_id',
      value: '9999',
      error_title: 'Invalid VLAN',
      error_message: 'VLAN out of range',
      validation_type: 'regex',
      cell_ref: 'B3',
    },
  ]

  const mockValidationResult: SheetValidationResult = {
    error_count: 2,
    errors: mockErrors,
    is_valid: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render Tabulator', () => {
    render(<ValidationErrorGrid sheet={mockSheet} />)
    expect(screen.getByTestId('tabulator')).toBeInTheDocument()
  })

  it('should configure columns correctly', () => {
    render(<ValidationErrorGrid sheet={mockSheet} />)

    const grid = screen.getByTestId('tabulator')
    const cols = JSON.parse(grid.getAttribute('data-columns') || '[]')

    expect(cols).toEqual([
      expect.objectContaining({ field: 'tenant', title: 'Tenant Name' }),
      expect.objectContaining({ field: 'vlan_id', title: 'VLAN ID' }),
    ])
  })

  it('should pass sheet rows as data', () => {
    render(<ValidationErrorGrid sheet={mockSheet} />)

    const grid = screen.getByTestId('tabulator')
    const rows = JSON.parse(grid.getAttribute('data-rows') || '[]')

    expect(rows).toEqual(mockSheet.rows)
  })

  it('should enable header sort and filter', () => {
    render(<ValidationErrorGrid sheet={mockSheet} />)

    const grid = screen.getByTestId('tabulator')
    const cols = JSON.parse(grid.getAttribute('data-columns') || '[]')

    expect(cols[0].headerSort).toBe(true)
    expect(cols[0].headerFilter).toBe(true)
    expect(cols[0].resizable).toBe(true)
  })

  it('should not show detail panel initially', () => {
    render(<ValidationErrorGrid sheet={mockSheet} />)
    expect(screen.queryByTestId('detail-panel')).not.toBeInTheDocument()
  })

  it('should show detail panel when selectedError is provided', () => {
    render(
      <ValidationErrorGrid
        sheet={mockSheet}
        selectedError={mockErrors[0]}
        validationResult={mockValidationResult}
      />
    )

    expect(screen.getByTestId('detail-panel')).toBeInTheDocument()
    expect(screen.getByText('Invalid Tenant')).toBeInTheDocument()
  })

  it('should handle empty sheet rows', () => {
    const emptySheet = { ...mockSheet, rows: [] }
    render(<ValidationErrorGrid sheet={emptySheet} />)

    const grid = screen.getByTestId('tabulator')
    const rows = JSON.parse(grid.getAttribute('data-rows') || '[]')
    expect(rows).toEqual([])
  })

  it('should handle sheet with no columns', () => {
    const noColumnsSheet = { ...mockSheet, columns: [] }
    render(<ValidationErrorGrid sheet={noColumnsSheet} />)

    const grid = screen.getByTestId('tabulator')
    const cols = JSON.parse(grid.getAttribute('data-columns') || '[]')
    expect(cols).toEqual([])
  })

  it('should use forward ref correctly', () => {
    const ref = { current: null }
    render(<ValidationErrorGrid ref={ref} sheet={mockSheet} />)
    expect(ref.current).toBeDefined()
  })

  it('should have correct display name', () => {
    expect(ValidationErrorGrid.displayName).toBe('ValidationErrorGrid')
  })
})
