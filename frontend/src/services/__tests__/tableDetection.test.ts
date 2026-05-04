/**
 * Table Detection Service Tests
 *
 * CRITICAL: These tests verify the smart table detection engine ($10,000 requirement)
 * - APIC pattern detection (imdata structure)
 * - Generic array detection
 * - Single object detection
 * - Column type inference
 * - Priority field ordering
 * - Auto-hide meta fields
 */
import { describe, it, expect } from 'vitest'
import {
  detectTableStructure,
  extractTableData,
  filterEmptyColumns,
  type ColumnDefinition,
  type TableStructure
} from '../tableDetection'

describe('tableDetection Service', () => {
  describe('APIC Pattern Detection', () => {
    it('CRITICAL: should detect APIC imdata structure', () => {
      const apicData = {
        totalCount: '2',
        imdata: [
          {
            fvTenant: {
              attributes: {
                name: 'tenant1',
                dn: 'uni/tn-tenant1',
                descr: 'Test tenant',
              }
            }
          },
          {
            fvTenant: {
              attributes: {
                name: 'tenant2',
                dn: 'uni/tn-tenant2',
                descr: 'Second tenant',
              }
            }
          }
        ]
      }

      const result = detectTableStructure(apicData)

      expect(result).not.toBeNull()
      expect(result?.type).toBe('apic')
      expect(result?.className).toBe('fvTenant')
      expect(result?.totalItems).toBe(2)
      expect(result?.dataPath).toBe('imdata[*].fvTenant.attributes')
    })

    it('CRITICAL: should prioritize common APIC fields', () => {
      const apicData = {
        imdata: [
          {
            fvBD: {
              attributes: {
                modTs: '2023-01-01',
                name: 'bd1',
                dn: 'uni/tn-tenant/BD-bd1',
                descr: 'Bridge domain',
                status: 'created',
                childAction: '',
              }
            }
          }
        ]
      }

      const result = detectTableStructure(apicData)

      expect(result).not.toBeNull()
      const columns = result!.columns

      // Priority fields should come first
      const firstColumns = columns.slice(0, 4).map(c => c.field)
      expect(firstColumns).toContain('name')
      expect(firstColumns).toContain('dn')
      expect(firstColumns).toContain('descr')
      expect(firstColumns).toContain('status')

      // Meta fields should be at the end or hidden
      const nameIndex = columns.findIndex(c => c.field === 'name')
      const modTsIndex = columns.findIndex(c => c.field === 'modTs')
      expect(nameIndex).toBeLessThan(modTsIndex)
    })

    it('CRITICAL: should auto-hide meta fields', () => {
      const apicData = {
        imdata: [
          {
            fvTenant: {
              attributes: {
                name: 'tenant1',
                childAction: '',
                modTs: '2023-01-01',
                lcOwn: 'local',
              }
            }
          }
        ]
      }

      const result = detectTableStructure(apicData)

      expect(result).not.toBeNull()
      const columns = result!.columns

      // Meta fields should be marked as not visible or alwaysHide
      const childActionCol = columns.find(c => c.field === 'childAction')
      const modTsCol = columns.find(c => c.field === 'modTs')
      const lcOwnCol = columns.find(c => c.field === 'lcOwn')

      expect(childActionCol?.visible).toBe(false)
      // modTs is intentionally visible for Time Machine drift detection
      expect(modTsCol?.visible).toBe(true)
      expect(lcOwnCol?.visible).toBe(false)
    })

    it('should detect nested data in APIC response', () => {
      const apicData = {
        imdata: [
          {
            fvTenant: {
              attributes: {
                name: 'tenant1',
              },
              children: [
                { fvBD: { attributes: { name: 'bd1' } } }
              ]
            }
          }
        ]
      }

      const result = detectTableStructure(apicData)

      expect(result).not.toBeNull()
      expect(result?.hasNestedData).toBe(true)
    })

    it('should handle empty imdata', () => {
      const apicData = {
        totalCount: '0',
        imdata: []
      }

      const result = detectTableStructure(apicData)

      expect(result).not.toBeNull()
      expect(result?.type).toBe('apic')
      expect(result?.totalItems).toBe(0)
      expect(result?.columns).toEqual([])
    })
  })

  describe('Generic Array Detection', () => {
    it('CRITICAL: should detect generic array structure', () => {
      const arrayData = [
        { id: 1, name: 'Item 1', value: 100 },
        { id: 2, name: 'Item 2', value: 200 },
      ]

      const result = detectTableStructure(arrayData)

      expect(result).not.toBeNull()
      expect(result?.type).toBe('array')
      expect(result?.totalItems).toBe(2)
      expect(result?.columns.length).toBe(3)
    })

    it('should infer all fields from array objects', () => {
      const arrayData = [
        { a: 1, b: 'x' },
        { b: 'y', c: true },
        { a: 2, c: false },
      ]

      const result = detectTableStructure(arrayData)

      expect(result).not.toBeNull()
      const fields = result!.columns.map(c => c.field).sort()
      expect(fields).toEqual(['a', 'b', 'c'])
    })

    it('should detect nested data in arrays', () => {
      const arrayData = [
        {
          id: 1,
          nested: { value: 'test' },
          array: [1, 2, 3]
        }
      ]

      const result = detectTableStructure(arrayData)

      expect(result).not.toBeNull()
      expect(result?.hasNestedData).toBe(true)

      const nestedCol = result!.columns.find(c => c.field === 'nested')
      const arrayCol = result!.columns.find(c => c.field === 'array')

      expect(nestedCol?.dataType).toBe('object')
      expect(arrayCol?.dataType).toBe('array')
    })

    it('should handle empty array', () => {
      const result = detectTableStructure([])

      expect(result).not.toBeNull()
      expect(result?.type).toBe('array')
      expect(result?.totalItems).toBe(0)
      expect(result?.columns).toEqual([])
    })
  })

  describe('Single Object Detection', () => {
    it('CRITICAL: should detect single object structure', () => {
      const objectData = {
        id: 1,
        name: 'Test',
        active: true,
      }

      const result = detectTableStructure(objectData)

      expect(result).not.toBeNull()
      expect(result?.type).toBe('object')
      expect(result?.totalItems).toBe(1)
      expect(result?.columns.length).toBe(3)
    })

    it('should convert object to single-row table', () => {
      const objectData = {
        setting1: 'value1',
        setting2: 42,
      }

      const result = detectTableStructure(objectData)
      const extracted = extractTableData(objectData, result!)

      expect(extracted).toEqual([objectData])
    })
  })

  describe('Data Type Detection', () => {
    it('CRITICAL: should correctly detect data types', () => {
      const data = [
        {
          stringField: 'text',
          numberField: 123,
          booleanField: true,
          dateField: '2023-01-01T00:00:00Z',
          objectField: { nested: true },
          arrayField: [1, 2, 3],
          nullField: null,
        }
      ]

      const result = detectTableStructure(data)

      expect(result).not.toBeNull()
      const columns = result!.columns

      expect(columns.find(c => c.field === 'stringField')?.dataType).toBe('string')
      expect(columns.find(c => c.field === 'numberField')?.dataType).toBe('number')
      expect(columns.find(c => c.field === 'booleanField')?.dataType).toBe('boolean')
      expect(columns.find(c => c.field === 'dateField')?.dataType).toBe('date')
      expect(columns.find(c => c.field === 'objectField')?.dataType).toBe('object')
      expect(columns.find(c => c.field === 'arrayField')?.dataType).toBe('array')
      expect(columns.find(c => c.field === 'nullField')?.dataType).toBe('string') // null defaults to string
    })

    it('should detect ISO date strings', () => {
      const data = [
        { timestamp: '2023-12-14T10:30:00Z' }
      ]

      const result = detectTableStructure(data)
      const timestampCol = result?.columns.find(c => c.field === 'timestamp')

      expect(timestampCol?.dataType).toBe('date')
    })
  })

  describe('Column Label Formatting', () => {
    it('should format camelCase to Title Case', () => {
      const data = [{ myFieldName: 'test' }]
      const result = detectTableStructure(data)

      expect(result?.columns[0].label).toBe('My Field Name')
    })

    it('should handle APIC abbreviations', () => {
      const apicData = {
        imdata: [{
          fvTenant: {
            attributes: {
              dn: 'uni/tn-test',
              descr: 'Test description',
              adminSt: 'up',
              operSt: 'up',
            }
          }
        }]
      }

      const result = detectTableStructure(apicData)
      const columns = result!.columns

      expect(columns.find(c => c.field === 'dn')?.label).toBe('DN')
      expect(columns.find(c => c.field === 'descr')?.label).toBe('Description')
      expect(columns.find(c => c.field === 'adminSt')?.label).toBe('Admin State')
      expect(columns.find(c => c.field === 'operSt')?.label).toBe('Operational State')
    })
  })

  describe('extractTableData', () => {
    it('CRITICAL: should extract APIC data correctly', () => {
      const apicData = {
        imdata: [
          { fvTenant: { attributes: { name: 'tenant1' } } },
          { fvTenant: { attributes: { name: 'tenant2' } } },
        ]
      }

      const structure: TableStructure = {
        type: 'apic',
        className: 'fvTenant',
        dataPath: 'imdata[*].fvTenant.attributes',
        columns: [],
        totalItems: 2,
        hasNestedData: false,
      }

      const result = extractTableData(apicData, structure)

      expect(result).toEqual([
        { name: 'tenant1' },
        { name: 'tenant2' },
      ])
    })

    it('should extract array data', () => {
      const arrayData = [{ a: 1 }, { a: 2 }]
      const structure: TableStructure = {
        type: 'array',
        columns: [],
        totalItems: 2,
        hasNestedData: false,
      }

      const result = extractTableData(arrayData, structure)

      expect(result).toEqual(arrayData)
    })

    it('should extract single object as array', () => {
      const objectData = { a: 1 }
      const structure: TableStructure = {
        type: 'object',
        columns: [],
        totalItems: 1,
        hasNestedData: false,
      }

      const result = extractTableData(objectData, structure)

      expect(result).toEqual([objectData])
    })
  })

  describe('filterEmptyColumns', () => {
    it('CRITICAL: should hide columns with all empty values', () => {
      const columns: ColumnDefinition[] = [
        { field: 'name', label: 'Name', visible: true, order: 0, dataType: 'string' },
        { field: 'empty', label: 'Empty', visible: true, order: 1, dataType: 'string' },
      ]

      const data = [
        { name: 'value1', empty: null },
        { name: 'value2', empty: '' },
        { name: 'value3', empty: undefined },
      ]

      const result = filterEmptyColumns(columns, data)

      expect(result[0].visible).toBe(true) // name should remain visible
      expect(result[1].visible).toBe(false) // empty should be hidden
    })

    it('should keep column visible if at least one value exists', () => {
      const columns: ColumnDefinition[] = [
        { field: 'partiallyEmpty', label: 'Partial', visible: true, order: 0, dataType: 'string' },
      ]

      const data = [
        { partiallyEmpty: null },
        { partiallyEmpty: 'hasValue' },
        { partiallyEmpty: null },
      ]

      const result = filterEmptyColumns(columns, data)

      expect(result[0].visible).toBe(true)
    })
  })

  describe('Edge Cases', () => {
    it('should handle null data', () => {
      const result = detectTableStructure(null)
      expect(result).toBeNull()
    })

    it('should handle undefined data', () => {
      const result = detectTableStructure(undefined)
      expect(result).toBeNull()
    })

    it('should handle primitive values', () => {
      expect(detectTableStructure('string')).toBeNull()
      expect(detectTableStructure(123)).toBeNull()
      expect(detectTableStructure(true)).toBeNull()
    })

    it('should handle APIC data without attributes', () => {
      const apicData = {
        imdata: [
          { fvTenant: {} }
        ]
      }

      const result = detectTableStructure(apicData)
      expect(result).not.toBeNull()
      expect(result?.columns.length).toBe(0)
    })
  })
})
