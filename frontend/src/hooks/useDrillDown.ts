// hooks/useDrillDown.ts
//
// Client-side drill-down navigation through APIC MO child hierarchies.
// When the user clicks a row in SmartTable, this hook walks the children[]
// array in the cached query result and builds the next level's rows without
// a new network request. Maintains a breadcrumb stack for navigating back up.

import { useState, useMemo, useCallback } from 'react'
import type { TableStructure, ColumnDefinition } from '@/services/tableDetection'
import { detectTableStructure, extractTableData, filterEmptyColumns } from '@/services/tableDetection'

// ─── Types ────────────────────────────────────────────────────────

export interface BreadcrumbLevel {
  /** Breadcrumb display text, e.g. "fvTenant: Prod" */
  label: string
  /** ACI class at this level */
  className: string
  /** DN of the MO whose children we're viewing */
  parentDn: string
}

export interface ChildClassGroup {
  className: string
  count: number
}

export interface DrillDownResult {
  /* ── State ── */

  /** Breadcrumb path (empty = root) */
  breadcrumb: BreadcrumbLevel[]
  /** True when viewing root-level data */
  isAtRoot: boolean
  /** Rows to display at current level */
  rows: Record<string, unknown>[]
  /** Table structure (columns etc.) for current level */
  structure: TableStructure | null
  /** Filtered columns with empty-column hiding applied */
  columns: ColumnDefinition[]

  /* ── Child navigation ── */

  /** Child class groups at current level (null if no children) */
  childGroups: ChildClassGroup[] | null
  /** Active child class filter (null = all) */
  activeChildClass: string | null
  /** Map of DN → true for rows that have children */
  expandableRows: Set<string>

  /* ── Parent context ── */

  /** Attributes of the parent MO when drilled (null at root) */
  parentAttributes: Record<string, unknown> | null
  /** Class name of the parent MO when drilled (null at root) */
  parentClassName: string | null

  /* ── Data depth info ── */

  /**
   * Detected scope of the APIC response:
   * - 'self': no children at all (rsp-subtree not set)
   * - 'children': has 1 level of children (rsp-subtree=children)
   * - 'full': has multi-level children (rsp-subtree=full)
   * - null: not an APIC response
   */
  detectedScope: 'self' | 'children' | 'full' | null
  /** True when current level has no deeper data (leaf of available tree) */
  isLeafLevel: boolean

  /* ── Actions ── */

  /** Drill into a row's children */
  drillInto: (dn: string) => void
  /** Filter children by class name (null = show all) */
  filterByClass: (className: string | null) => void
  /** Navigate to a specific breadcrumb index (-1 = root) */
  navigateTo: (index: number) => void
  /** Go up one level */
  goBack: () => void
  /** Reset to root */
  reset: () => void
}

// ─── Constants ────────────────────────────────────────────────────

/**
 * APIC supplemental data classes injected via rsp-subtree-include.
 * These are NOT structural MO children — they are operational metadata
 * (health, faults, stats, audit logs, etc.) and must be excluded from
 * drill-down navigation and child grouping.
 */
const SUPPLEMENTAL_CLASSES = new Set([
  'healthInst',
  'healthNodeInst',
  'faultCounts',
  'faultInst',
  'faultDelegate',
  'faultRec',
  'statsHier',
  'auditLog',
  'eventRecord',
  'deploymentRecord',
  'taskInst',
])

/**
 * Filter out supplemental data objects from a children array.
 * Returns only structural MO children.
 */
function filterStructuralChildren(children: any[]): any[] {
  return children.filter((child) => {
    const className = Object.keys(child)[0]
    return className && !SUPPLEMENTAL_CLASSES.has(className)
  })
}

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Synthesize DN for children that only have RN.
 *
 * APIC `rsp-subtree=full` returns nested children with `rn` (Relative Name)
 * but NOT `dn` (Distinguished Name). We compute dn = parentDn + "/" + rn.
 * This mutates the data in-place (single pass on first load).
 */
function synthesizeDns(imdata: any[]): void {
  for (const item of imdata) {
    const className = Object.keys(item)[0]
    if (!className) continue
    const mo = item[className]
    const parentDn = mo?.attributes?.dn
    if (parentDn && mo.children?.length) {
      synthesizeChildDns(mo.children, parentDn)
    }
  }
}

function synthesizeChildDns(children: any[], parentDn: string): void {
  for (const child of children) {
    const className = Object.keys(child)[0]
    if (!className) continue
    const mo = child[className]
    if (!mo?.attributes) continue

    // If DN is missing but RN exists, synthesize DN
    if (!mo.attributes.dn && mo.attributes.rn) {
      mo.attributes.dn = parentDn + '/' + mo.attributes.rn
    }

    const childDn = mo.attributes.dn
    if (childDn && mo.children?.length) {
      synthesizeChildDns(mo.children, childDn)
    }
  }
}

/**
 * Walk the MO tree to find a specific MO by DN.
 * Returns the full MO object: { attributes: {...}, children: [...] }
 */
function findMoByDn(imdata: any[], targetDn: string): any | null {
  for (const item of imdata) {
    const className = Object.keys(item)[0]
    if (!className) continue
    const mo = item[className]
    const dn = mo?.attributes?.dn

    if (dn === targetDn) return mo

    // If target is a descendant, recurse into children
    if (targetDn.startsWith(dn + '/') && mo.children?.length) {
      const found = findMoInChildren(mo.children, targetDn)
      if (found) return found
    }
  }
  return null
}

function findMoInChildren(children: any[], targetDn: string): any | null {
  for (const child of children) {
    const className = Object.keys(child)[0]
    if (!className) continue
    const mo = child[className]
    const dn = mo?.attributes?.dn

    if (dn === targetDn) return mo

    if (dn && targetDn.startsWith(dn + '/') && mo.children?.length) {
      const found = findMoInChildren(mo.children, targetDn)
      if (found) return found
    }
  }
  return null
}

/**
 * Group children array by class name (excludes supplemental data classes).
 */
function groupChildrenByClass(children: any[]): ChildClassGroup[] {
  const structural = filterStructuralChildren(children)
  const counts = new Map<string, number>()
  for (const child of structural) {
    const className = Object.keys(child)[0]
    if (!className) continue
    counts.set(className, (counts.get(className) || 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([className, count]) => ({ className, count }))
    .sort((a, b) => b.count - a.count)
}

/**
 * Extract attribute rows from a children array, optionally filtered by class.
 * Excludes supplemental data classes. When showing all classes, prepends a _className column.
 */
function extractChildRows(
  children: any[],
  classFilter: string | null
): Record<string, unknown>[] {
  const structural = filterStructuralChildren(children)
  const rows: Record<string, unknown>[] = []

  for (const child of structural) {
    const className = Object.keys(child)[0]
    if (!className) continue
    if (classFilter && className !== classFilter) continue

    const attrs = child[className]?.attributes
    if (!attrs) continue

    if (classFilter) {
      rows.push({ ...attrs })
    } else {
      // When showing all classes, add class column
      rows.push({ _className: className, ...attrs })
    }
  }

  return rows
}

/**
 * Build a display label from a DN and class name.
 * e.g. DN "uni/tn-Prod/BD-web" → "web" (last segment, cleaned of RN prefix)
 */
function buildLabel(dn: string, className: string): string {
  if (!dn) return className
  const segments = dn.split('/')
  const last = segments[segments.length - 1]
  // Remove RN prefix (e.g., "tn-Prod" → "Prod", "BD-web" → "web")
  const dashIndex = last.indexOf('-')
  const name = dashIndex >= 0 ? last.substring(dashIndex + 1) : last
  return `${className}: ${name}`
}

/**
 * Build a TableStructure from extracted rows (for child-level display).
 */
function buildChildStructure(
  rows: Record<string, unknown>[],
  className: string | null
): { structure: TableStructure; columns: ColumnDefinition[] } {
  if (rows.length === 0) {
    return {
      structure: { type: 'array', columns: [], totalItems: 0, hasNestedData: false },
      columns: [],
    }
  }

  // When showing mixed classes, wrap in a simple array structure
  if (!className) {
    // Build an APIC-like result for detectTableStructure to handle
    const structure = detectTableStructure(rows)
    if (structure) {
      const filtered = filterEmptyColumns(structure.columns, rows)
      return { structure, columns: filtered }
    }
  }

  // For single-class view, build synthetic APIC response for detection
  const syntheticApic = {
    totalCount: String(rows.length),
    imdata: rows.map(row => ({
      [className!]: { attributes: row }
    }))
  }
  const structure = detectTableStructure(syntheticApic)
  if (structure) {
    const extracted = extractTableData(syntheticApic, structure)
    const filtered = filterEmptyColumns(structure.columns, extracted)
    return { structure, columns: filtered }
  }

  // Fallback: treat as plain array
  const fallback = detectTableStructure(rows)
  const cols = fallback ? filterEmptyColumns(fallback.columns, rows) : []
  return {
    structure: fallback || { type: 'array', columns: [], totalItems: rows.length, hasNestedData: false },
    columns: cols,
  }
}

/**
 * Build a set of DNs that have structural children (excludes supplemental data).
 */
function getExpandableDns(items: any[], isRoot: boolean): Set<string> {
  const expandable = new Set<string>()

  for (const item of items) {
    const className = Object.keys(item)[0]
    if (!className) continue
    const mo = isRoot ? item[className] : item[className]
    const dn = mo?.attributes?.dn
    if (dn && mo?.children?.length > 0) {
      // Only mark as expandable if there are structural (non-supplemental) children
      const structural = filterStructuralChildren(mo.children)
      if (structural.length > 0) {
        expandable.add(dn)
      }
    }
  }

  return expandable
}

// ─── Hook ─────────────────────────────────────────────────────────

export function useDrillDown(rawData: any): DrillDownResult {
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbLevel[]>([])
  const [activeChildClass, setActiveChildClass] = useState<string | null>(null)

  const isAtRoot = breadcrumb.length === 0

  // Determine if rawData is APIC pattern
  const isApic = rawData?.imdata && Array.isArray(rawData.imdata)
  const imdata: any[] = isApic ? rawData.imdata : []

  // Synthesize DN for children that only have RN (APIC rsp-subtree=full)
  // Single pass, mutates in-place. Safe to re-run (idempotent — skips if dn exists).
  useMemo(() => {
    if (imdata.length > 0) synthesizeDns(imdata)
  }, [imdata])

  // ── Root-level data ──
  const rootStructure = useMemo(() => {
    if (!isApic) return null
    return detectTableStructure(rawData)
  }, [rawData, isApic])

  const rootRows = useMemo(() => {
    if (!rootStructure || !isApic) return []
    return extractTableData(rawData, rootStructure)
  }, [rawData, rootStructure, isApic])

  const rootColumns = useMemo(() => {
    if (!rootStructure) return []
    return filterEmptyColumns(rootStructure.columns, rootRows)
  }, [rootStructure, rootRows])

  const rootExpandable = useMemo(
    () => getExpandableDns(imdata, true),
    [imdata]
  )

  // ── Drilled-level data ──
  const currentParentDn = breadcrumb.length > 0 ? breadcrumb[breadcrumb.length - 1].parentDn : null

  const currentParentMo = useMemo(() => {
    if (!currentParentDn) return null
    return findMoByDn(imdata, currentParentDn)
  }, [imdata, currentParentDn])

  const currentChildren = useMemo(() => {
    if (!currentParentMo) return []
    return currentParentMo.children || []
  }, [currentParentMo])

  const childGroups = useMemo((): ChildClassGroup[] | null => {
    if (isAtRoot) {
      // At root level, check if ANY item has children
      if (rootExpandable.size === 0) return null
      return null // No class grouping at root
    }
    if (currentChildren.length === 0) return null
    return groupChildrenByClass(currentChildren)
  }, [isAtRoot, currentChildren, rootExpandable])

  const drilledRows = useMemo(() => {
    if (isAtRoot || currentChildren.length === 0) return []
    return extractChildRows(currentChildren, activeChildClass)
  }, [isAtRoot, currentChildren, activeChildClass])

  const drilledMeta = useMemo(() => {
    if (isAtRoot) return null
    return buildChildStructure(drilledRows, activeChildClass)
  }, [isAtRoot, drilledRows, activeChildClass])

  const drilledExpandable = useMemo(() => {
    if (isAtRoot || currentChildren.length === 0) return new Set<string>()
    // Filter children by active class
    const filtered = activeChildClass
      ? currentChildren.filter((c: any) => Object.keys(c)[0] === activeChildClass)
      : currentChildren
    return getExpandableDns(filtered, false)
  }, [isAtRoot, currentChildren, activeChildClass])

  // ── Computed outputs ──
  const rows = isAtRoot ? rootRows : drilledRows
  const structure = isAtRoot ? rootStructure : (drilledMeta?.structure ?? null)
  const columns = isAtRoot ? rootColumns : (drilledMeta?.columns ?? [])
  const expandableRows = isAtRoot ? rootExpandable : drilledExpandable

  // Parent context for detail card
  const parentAttributes = useMemo((): Record<string, unknown> | null => {
    if (!currentParentMo) return null
    return currentParentMo.attributes || null
  }, [currentParentMo])

  const parentClassName = useMemo((): string | null => {
    if (breadcrumb.length === 0) return null
    return breadcrumb[breadcrumb.length - 1].className
  }, [breadcrumb])

  // ── Data depth detection ──
  // Detect the scope of data available (self / children / full)
  const detectedScope = useMemo((): 'self' | 'children' | 'full' | null => {
    if (!isApic || imdata.length === 0) return null

    // Check if ANY root MO has structural children (exclude supplemental data)
    let hasChildren = false
    let hasGrandchildren = false

    for (const item of imdata) {
      const cls = Object.keys(item)[0]
      if (!cls) continue
      const mo = item[cls]
      if (mo?.children?.length > 0) {
        const structural = filterStructuralChildren(mo.children)
        if (structural.length > 0) {
          hasChildren = true
          // Check if any structural child also has children (grandchildren)
          for (const child of structural) {
            const childCls = Object.keys(child)[0]
            if (!childCls) continue
            const childChildren = child[childCls]?.children
            if (childChildren?.length > 0) {
              const structuralGrandchildren = filterStructuralChildren(childChildren)
              if (structuralGrandchildren.length > 0) {
                hasGrandchildren = true
                break
              }
            }
          }
          if (hasGrandchildren) break
        }
      }
    }

    if (!hasChildren) return 'self'
    if (!hasGrandchildren) return 'children'
    return 'full'
  }, [isApic, imdata])

  // True when current level has no expandable rows (leaf of available data)
  const isLeafLevel = !isAtRoot && expandableRows.size === 0

  // ── Actions ──
  const drillInto = useCallback((dn: string) => {
    const mo = findMoByDn(imdata, dn)
    if (!mo?.children?.length) return

    // Determine the class name of this MO
    // Walk imdata to find the wrapping class name
    const className = findClassNameForDn(imdata, dn) || 'MO'
    const label = buildLabel(dn, className)

    setBreadcrumb(prev => [...prev, { label, className, parentDn: dn }])
    setActiveChildClass(null) // Reset filter when drilling
  }, [imdata])

  const filterByClass = useCallback((className: string | null) => {
    setActiveChildClass(className)
  }, [])

  const navigateTo = useCallback((index: number) => {
    if (index < 0) {
      setBreadcrumb([])
      setActiveChildClass(null)
    } else {
      setBreadcrumb(prev => prev.slice(0, index + 1))
      setActiveChildClass(null)
    }
  }, [])

  const goBack = useCallback(() => {
    setBreadcrumb(prev => {
      if (prev.length === 0) return prev
      return prev.slice(0, -1)
    })
    setActiveChildClass(null)
  }, [])

  const reset = useCallback(() => {
    setBreadcrumb([])
    setActiveChildClass(null)
  }, [])

  return {
    breadcrumb,
    isAtRoot,
    rows,
    structure,
    columns,
    childGroups,
    activeChildClass,
    expandableRows,
    parentAttributes,
    parentClassName,
    detectedScope,
    isLeafLevel,
    drillInto,
    filterByClass,
    navigateTo,
    goBack,
    reset,
  }
}

/**
 * Find the ACI class name that wraps a given DN in the imdata tree.
 */
function findClassNameForDn(imdata: any[], targetDn: string): string | null {
  for (const item of imdata) {
    const className = Object.keys(item)[0]
    if (!className) continue
    const mo = item[className]
    if (mo?.attributes?.dn === targetDn) return className
    if (targetDn.startsWith(mo?.attributes?.dn + '/') && mo.children) {
      const found = findClassInChildren(mo.children, targetDn)
      if (found) return found
    }
  }
  return null
}

function findClassInChildren(children: any[], targetDn: string): string | null {
  for (const child of children) {
    const className = Object.keys(child)[0]
    if (!className) continue
    const mo = child[className]
    if (mo?.attributes?.dn === targetDn) return className
    if (targetDn.startsWith(mo?.attributes?.dn + '/') && mo.children) {
      const found = findClassInChildren(mo.children, targetDn)
      if (found) return found
    }
  }
  return null
}
