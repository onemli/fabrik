// createErrorCellRenderer Tests — Tabulator version
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { applyErrorHighlights } from '../createErrorCellRenderer'
import { ValidationError } from '@/services/validation'

describe('applyErrorHighlights', () => {
  const mockErrors: ValidationError[] = [
    {
      row: 0,
      column: 'tenant',
      value: 'INVALID',
      error_title: 'Invalid Tenant',
      error_message: 'Tenant not found',
      validation_type: 'query_list',
      cell_ref: 'A1',
    },
    {
      row: 1,
      column: 'vlan_id',
      value: '9999',
      error_title: 'Invalid VLAN',
      error_message: 'VLAN out of range',
      validation_type: 'regex',
      cell_ref: 'B2',
    },
  ]

  let mockTable: any
  let mockCellElements: Map<string, HTMLElement>
  let mockOnCellClick: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockOnCellClick = vi.fn()
    mockCellElements = new Map()

    // Build mock table with rows and cells
    const buildMockCell = (field: string, rowIndex: number) => {
      const el = document.createElement('td')
      mockCellElements.set(`${rowIndex}-${field}`, el)
      return {
        getColumn: () => ({ getField: () => field }),
        getElement: () => el,
      }
    }

    mockTable = {
      getRows: () => [
        {
          getCells: () => [
            buildMockCell('tenant', 0),
            buildMockCell('vlan_id', 0),
          ],
        },
        {
          getCells: () => [
            buildMockCell('tenant', 1),
            buildMockCell('vlan_id', 1),
          ],
        },
        {
          getCells: () => [
            buildMockCell('tenant', 2),
            buildMockCell('vlan_id', 2),
          ],
        },
      ],
    }
  })

  it('should return a cleanup function', () => {
    const cleanup = applyErrorHighlights(mockTable, mockErrors, mockOnCellClick)
    expect(typeof cleanup).toBe('function')
  })

  it('should apply error class to cells with errors', () => {
    applyErrorHighlights(mockTable, mockErrors, mockOnCellClick)

    const errorCell = mockCellElements.get('0-tenant')!
    expect(errorCell.classList.contains('tabulator-validation-error')).toBe(true)
    expect(errorCell.getAttribute('title')).toBe('Invalid Tenant')
  })

  it('should apply error to second error cell', () => {
    applyErrorHighlights(mockTable, mockErrors, mockOnCellClick)

    const errorCell = mockCellElements.get('1-vlan_id')!
    expect(errorCell.classList.contains('tabulator-validation-error')).toBe(true)
    expect(errorCell.getAttribute('title')).toBe('Invalid VLAN')
  })

  it('should not apply error class to clean cells', () => {
    applyErrorHighlights(mockTable, mockErrors, mockOnCellClick)

    const cleanCell = mockCellElements.get('2-tenant')!
    expect(cleanCell.classList.contains('tabulator-validation-error')).toBe(false)
  })

  it('should set cursor to pointer when click handler provided', () => {
    applyErrorHighlights(mockTable, mockErrors, mockOnCellClick)

    const errorCell = mockCellElements.get('0-tenant')!
    expect(errorCell.style.cursor).toBe('pointer')
  })

  it('should fire click handler on error cell click', () => {
    applyErrorHighlights(mockTable, mockErrors, mockOnCellClick)

    const errorCell = mockCellElements.get('0-tenant')!
    errorCell.click()

    expect(mockOnCellClick).toHaveBeenCalledWith(mockErrors[0])
  })

  it('should return noop when no errors', () => {
    const cleanup = applyErrorHighlights(mockTable, [], mockOnCellClick)
    expect(typeof cleanup).toBe('function')
    cleanup() // should not throw
  })

  it('should return noop when table is null', () => {
    const cleanup = applyErrorHighlights(null, mockErrors, mockOnCellClick)
    expect(typeof cleanup).toBe('function')
  })

  it('should clean up click handlers on cleanup call', () => {
    const cleanup = applyErrorHighlights(mockTable, mockErrors, mockOnCellClick)

    const errorCell = mockCellElements.get('0-tenant')!
    cleanup()

    // Reset mock and click again — should not fire
    mockOnCellClick.mockClear()
    errorCell.click()
    expect(mockOnCellClick).not.toHaveBeenCalled()
  })

  it('should work without click handler', () => {
    expect(() => {
      applyErrorHighlights(mockTable, mockErrors)
    }).not.toThrow()

    const errorCell = mockCellElements.get('0-tenant')!
    expect(errorCell.classList.contains('tabulator-validation-error')).toBe(true)
    expect(errorCell.style.cursor).toBe('default')
  })
})
