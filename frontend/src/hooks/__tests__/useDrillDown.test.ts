// hooks/__tests__/useDrillDown.test.ts
//
// Tests for the useDrillDown hook: breadcrumb navigation, drill-in/out,
// child class grouping, scope detection, and DN synthesis.

import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDrillDown } from '../useDrillDown'

// Mock tableDetection — return simple structures so we test the hook logic,
// not the table detection engine
vi.mock('@/services/tableDetection', () => ({
  detectTableStructure: (data: any) => {
    if (!data) return null
    return {
      type: 'apic-imdata',
      columns: [{ key: 'dn', label: 'dn', type: 'string' }],
      totalItems: Array.isArray(data?.imdata) ? data.imdata.length : 0,
      hasNestedData: false,
    }
  },
  extractTableData: (data: any) => {
    if (!data?.imdata) return []
    return data.imdata.map((item: any) => {
      const cls = Object.keys(item)[0]
      return item[cls]?.attributes || {}
    })
  },
  filterEmptyColumns: (columns: any[]) => columns,
}))

// ── Test data: APIC-style MO tree ──

function makeApicData() {
  return {
    totalCount: '2',
    imdata: [
      {
        fvTenant: {
          attributes: { dn: 'uni/tn-Prod', name: 'Prod' },
          children: [
            {
              fvBD: {
                attributes: { dn: 'uni/tn-Prod/BD-web', name: 'web' },
                children: [
                  {
                    fvSubnet: {
                      attributes: { dn: 'uni/tn-Prod/BD-web/subnet-[10.0.0.1/24]', ip: '10.0.0.1/24' },
                    },
                  },
                ],
              },
            },
            {
              fvAp: {
                attributes: { dn: 'uni/tn-Prod/ap-WebApp', name: 'WebApp' },
              },
            },
          ],
        },
      },
      {
        fvTenant: {
          attributes: { dn: 'uni/tn-Test', name: 'Test' },
        },
      },
    ],
  }
}

function makeApicDataWithSupplemental() {
  return {
    totalCount: '1',
    imdata: [
      {
        fvTenant: {
          attributes: { dn: 'uni/tn-Prod', name: 'Prod' },
          children: [
            {
              fvBD: {
                attributes: { dn: 'uni/tn-Prod/BD-web', name: 'web' },
              },
            },
            {
              healthInst: {
                attributes: { dn: 'uni/tn-Prod/health', cur: '100' },
              },
            },
            {
              faultCounts: {
                attributes: { dn: 'uni/tn-Prod/fltCnts' },
              },
            },
          ],
        },
      },
    ],
  }
}

describe('useDrillDown', () => {
  describe('initial state', () => {
    it('starts at root with empty breadcrumb', () => {
      const { result } = renderHook(() => useDrillDown(makeApicData()))

      expect(result.current.isAtRoot).toBe(true)
      expect(result.current.breadcrumb).toEqual([])
    })

    it('returns rows from root-level imdata', () => {
      const { result } = renderHook(() => useDrillDown(makeApicData()))

      expect(result.current.rows.length).toBe(2)
    })

    it('detects structure as non-null for APIC data', () => {
      const { result } = renderHook(() => useDrillDown(makeApicData()))

      expect(result.current.structure).not.toBeNull()
    })

    it('returns null for non-APIC data', () => {
      const { result } = renderHook(() => useDrillDown({ foo: 'bar' }))

      expect(result.current.isAtRoot).toBe(true)
      expect(result.current.rows).toEqual([])
      expect(result.current.detectedScope).toBeNull()
    })

    it('handles null data', () => {
      const { result } = renderHook(() => useDrillDown(null))

      expect(result.current.isAtRoot).toBe(true)
      expect(result.current.rows).toEqual([])
    })
  })

  describe('scope detection', () => {
    it('detects "full" when grandchildren exist', () => {
      const { result } = renderHook(() => useDrillDown(makeApicData()))

      // fvTenant has fvBD children, fvBD has fvSubnet grandchildren → full
      expect(result.current.detectedScope).toBe('full')
    })

    it('detects "self" when no children exist', () => {
      const data = {
        totalCount: '1',
        imdata: [
          { fvTenant: { attributes: { dn: 'uni/tn-Prod', name: 'Prod' } } },
        ],
      }

      const { result } = renderHook(() => useDrillDown(data))

      expect(result.current.detectedScope).toBe('self')
    })

    it('detects "children" when one level of children exists', () => {
      const data = {
        totalCount: '1',
        imdata: [
          {
            fvTenant: {
              attributes: { dn: 'uni/tn-Prod', name: 'Prod' },
              children: [
                { fvBD: { attributes: { dn: 'uni/tn-Prod/BD-web', name: 'web' } } },
              ],
            },
          },
        ],
      }

      const { result } = renderHook(() => useDrillDown(data))

      expect(result.current.detectedScope).toBe('children')
    })
  })

  describe('expandable rows', () => {
    it('marks rows with structural children as expandable', () => {
      const { result } = renderHook(() => useDrillDown(makeApicData()))

      // uni/tn-Prod has children, uni/tn-Test does not
      expect(result.current.expandableRows.has('uni/tn-Prod')).toBe(true)
      expect(result.current.expandableRows.has('uni/tn-Test')).toBe(false)
    })

    it('excludes supplemental classes from expandability', () => {
      const data = {
        totalCount: '1',
        imdata: [
          {
            fvTenant: {
              attributes: { dn: 'uni/tn-Prod', name: 'Prod' },
              children: [
                { healthInst: { attributes: { dn: 'uni/tn-Prod/health', cur: '100' } } },
              ],
            },
          },
        ],
      }

      const { result } = renderHook(() => useDrillDown(data))

      // healthInst is supplemental — shouldn't count as expandable
      expect(result.current.expandableRows.has('uni/tn-Prod')).toBe(false)
    })
  })

  describe('drillInto', () => {
    it('drills into a node and shows children', () => {
      const { result } = renderHook(() => useDrillDown(makeApicData()))

      act(() => {
        result.current.drillInto('uni/tn-Prod')
      })

      expect(result.current.isAtRoot).toBe(false)
      expect(result.current.breadcrumb).toHaveLength(1)
      expect(result.current.breadcrumb[0].parentDn).toBe('uni/tn-Prod')
      expect(result.current.breadcrumb[0].className).toBe('fvTenant')
    })

    it('does nothing for a node without children', () => {
      const { result } = renderHook(() => useDrillDown(makeApicData()))

      act(() => {
        result.current.drillInto('uni/tn-Test')
      })

      expect(result.current.isAtRoot).toBe(true)
    })

    it('shows child class groups after drilling', () => {
      const { result } = renderHook(() => useDrillDown(makeApicData()))

      act(() => {
        result.current.drillInto('uni/tn-Prod')
      })

      // Should have fvBD and fvAp groups
      expect(result.current.childGroups).not.toBeNull()
      expect(result.current.childGroups!.length).toBe(2)
      const classNames = result.current.childGroups!.map((g) => g.className)
      expect(classNames).toContain('fvBD')
      expect(classNames).toContain('fvAp')
    })

    it('excludes supplemental classes from child groups', () => {
      const { result } = renderHook(() => useDrillDown(makeApicDataWithSupplemental()))

      act(() => {
        result.current.drillInto('uni/tn-Prod')
      })

      // Only fvBD should be in groups, not healthInst or faultCounts
      expect(result.current.childGroups).not.toBeNull()
      expect(result.current.childGroups!.length).toBe(1)
      expect(result.current.childGroups![0].className).toBe('fvBD')
    })

    it('provides parent attributes when drilled', () => {
      const { result } = renderHook(() => useDrillDown(makeApicData()))

      act(() => {
        result.current.drillInto('uni/tn-Prod')
      })

      expect(result.current.parentAttributes).toEqual({ dn: 'uni/tn-Prod', name: 'Prod' })
      expect(result.current.parentClassName).toBe('fvTenant')
    })
  })

  describe('filterByClass', () => {
    it('filters children by class name', () => {
      const { result } = renderHook(() => useDrillDown(makeApicData()))

      act(() => {
        result.current.drillInto('uni/tn-Prod')
      })
      act(() => {
        result.current.filterByClass('fvBD')
      })

      expect(result.current.activeChildClass).toBe('fvBD')
      // Rows should only contain fvBD attributes
      expect(result.current.rows.every((r) => r.name === 'web')).toBe(true)
    })

    it('clears filter with null', () => {
      const { result } = renderHook(() => useDrillDown(makeApicData()))

      act(() => {
        result.current.drillInto('uni/tn-Prod')
      })
      act(() => {
        result.current.filterByClass('fvBD')
      })
      act(() => {
        result.current.filterByClass(null)
      })

      expect(result.current.activeChildClass).toBeNull()
    })
  })

  describe('navigation', () => {
    it('goBack returns to root from first level', () => {
      const { result } = renderHook(() => useDrillDown(makeApicData()))

      act(() => {
        result.current.drillInto('uni/tn-Prod')
      })

      expect(result.current.isAtRoot).toBe(false)

      act(() => {
        result.current.goBack()
      })

      expect(result.current.isAtRoot).toBe(true)
    })

    it('navigateTo(-1) resets to root', () => {
      const { result } = renderHook(() => useDrillDown(makeApicData()))

      act(() => {
        result.current.drillInto('uni/tn-Prod')
      })
      act(() => {
        result.current.navigateTo(-1)
      })

      expect(result.current.isAtRoot).toBe(true)
      expect(result.current.breadcrumb).toEqual([])
    })

    it('reset clears all state', () => {
      const { result } = renderHook(() => useDrillDown(makeApicData()))

      act(() => {
        result.current.drillInto('uni/tn-Prod')
      })
      act(() => {
        result.current.filterByClass('fvBD')
      })
      act(() => {
        result.current.reset()
      })

      expect(result.current.isAtRoot).toBe(true)
      expect(result.current.activeChildClass).toBeNull()
    })

    it('supports multi-level drill-down', () => {
      const { result } = renderHook(() => useDrillDown(makeApicData()))

      // Drill into tenant
      act(() => {
        result.current.drillInto('uni/tn-Prod')
      })

      // Drill into BD
      act(() => {
        result.current.drillInto('uni/tn-Prod/BD-web')
      })

      expect(result.current.breadcrumb).toHaveLength(2)
      expect(result.current.breadcrumb[0].parentDn).toBe('uni/tn-Prod')
      expect(result.current.breadcrumb[1].parentDn).toBe('uni/tn-Prod/BD-web')
    })

    it('goBack from deep level returns to previous level', () => {
      const { result } = renderHook(() => useDrillDown(makeApicData()))

      act(() => {
        result.current.drillInto('uni/tn-Prod')
      })
      act(() => {
        result.current.drillInto('uni/tn-Prod/BD-web')
      })
      act(() => {
        result.current.goBack()
      })

      expect(result.current.breadcrumb).toHaveLength(1)
      expect(result.current.breadcrumb[0].parentDn).toBe('uni/tn-Prod')
    })

    it('navigateTo(0) returns to first breadcrumb level', () => {
      const { result } = renderHook(() => useDrillDown(makeApicData()))

      act(() => {
        result.current.drillInto('uni/tn-Prod')
      })
      act(() => {
        result.current.drillInto('uni/tn-Prod/BD-web')
      })
      act(() => {
        result.current.navigateTo(0)
      })

      expect(result.current.breadcrumb).toHaveLength(1)
    })
  })

  describe('isLeafLevel', () => {
    it('is true at leaf level with no expandable rows', () => {
      const { result } = renderHook(() => useDrillDown(makeApicData()))

      // Drill to BD-web → subnet has no children → leaf
      act(() => {
        result.current.drillInto('uni/tn-Prod')
      })
      act(() => {
        result.current.drillInto('uni/tn-Prod/BD-web')
      })

      expect(result.current.isLeafLevel).toBe(true)
    })
  })

  describe('DN synthesis', () => {
    it('synthesizes dn from rn when dn is missing', () => {
      const data = {
        totalCount: '1',
        imdata: [
          {
            fvTenant: {
              attributes: { dn: 'uni/tn-Prod', name: 'Prod' },
              children: [
                {
                  fvBD: {
                    attributes: { rn: 'BD-web', name: 'web' },
                  },
                },
              ],
            },
          },
        ],
      }

      const { result } = renderHook(() => useDrillDown(data))

      // After synthesis, drilling should work because dn was computed
      act(() => {
        result.current.drillInto('uni/tn-Prod')
      })

      // The child should now have dn = "uni/tn-Prod/BD-web"
      expect(result.current.rows.length).toBeGreaterThan(0)
    })
  })
})
