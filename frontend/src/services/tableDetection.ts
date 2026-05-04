// services/tableDetection.ts
//
// Auto-detection logic for SmartTable column structure from raw APIC JSON.
// Inspects the first few rows to infer field names, types, and nesting depth.
// Handles APIC's imdata[] envelope, flat attribute objects, and arrays of values.

export interface ColumnDefinition {
  field: string
  label: string
  visible: boolean
  order: number
  width?: number
  dataType: 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array'
  locked?: boolean // Cannot be hidden
  alwaysHide?: boolean // Always hidden
}

export interface TableStructure {
  type: 'apic' | 'array' | 'object' | 'unknown'
  className?: string // For APIC pattern
  dataPath?: string // JSONPath to data
  columns: ColumnDefinition[]
  totalItems: number
  hasNestedData: boolean
}

// Priority fields for APIC classes (show first)
const APIC_PRIORITY_FIELDS = ['name', 'dn', 'descr', 'status', 'adminSt', 'operSt']

// Fields to always hide
const APIC_HIDDEN_FIELDS = [
  'childAction',
  // 'modTs', // Now visible - useful for Time Machine drift detection and audit trail
  'lcOwn',
  'rn',
  'uid',
  'monPolDn',
  'extMngdBy',
  'configIssues',
  'stateQual',
  'tCl',
  'tDn',
  'tType',
  'annotation',
]

/**
 * Main detection function - analyzes JSON and returns table structure
 */
export function detectTableStructure(data: any): TableStructure | null {
  if (!data) return null

  // APIC Pattern Detection
  if (isAPICPattern(data)) {
    return detectAPICStructure(data)
  }

  // Unwrapped APIC array — the post-processor pipeline strips the outer
  // `imdata` envelope before the chain runs, so by the time data reaches
  // the table it often looks like [{fvBD: {attributes: {...}}}, ...].
  // Without this re-wrap, detectArrayStructure would see a single column
  // "fvBD" full of nested objects, which is the "weird table" users hit.
  if (Array.isArray(data) && isUnwrappedAPICArray(data)) {
    return detectAPICStructure({ imdata: data })
  }

  // Generic Array Detection
  if (Array.isArray(data)) {
    return detectArrayStructure(data)
  }

  // Single Object Detection
  if (typeof data === 'object') {
    return detectObjectStructure(data)
  }

  return null
}

/**
 * Checks whether an array looks like an APIC imdata payload that has had
 * the outer envelope stripped. Each row should be a single-key dict whose
 * value is an object containing `attributes` (the canonical APIC class
 * envelope shape: `{fvBD: {attributes: {...}, children?: [...]}}`).
 *
 * Sample-based — checks at most 10 rows so a 50k-row result doesn't pay
 * the cost of full validation.
 */
function isUnwrappedAPICArray(data: any[]): boolean {
  if (data.length === 0) return false

  for (const item of data.slice(0, 10)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false
    const keys = Object.keys(item)
    if (keys.length !== 1) return false
    const inner = item[keys[0]]
    if (!inner || typeof inner !== 'object' || Array.isArray(inner)) return false
    if (!('attributes' in inner)) return false
  }
  return true
}

/**
 * Check if data matches APIC response pattern
 * Pattern: { imdata: [{className: { attributes: {...}, children: [...] }}] }
 */
function isAPICPattern(data: any): boolean {
  return !!(
    data &&
    typeof data === 'object' &&
    data.imdata &&
    Array.isArray(data.imdata)
  )
}

/**
 * Detect APIC-specific structure
 */
function detectAPICStructure(data: any): TableStructure {
  const imdata = data.imdata || []
  const firstItem = imdata[0]

  if (!firstItem) {
    return {
      type: 'apic',
      columns: [],
      totalItems: 0,
      hasNestedData: false,
    }
  }

  // APIC supplemental data classes injected via rsp-subtree-include.
  // These are NOT structural MO children and must not trigger nested-data mode.
  const SUPPLEMENTAL_CLASSES = new Set([
    'healthInst', 'healthNodeInst', 'faultCounts', 'faultInst',
    'faultDelegate', 'faultRec', 'statsHier', 'auditLog',
    'eventRecord', 'deploymentRecord', 'taskInst',
  ])

  // Extract class name (e.g., 'fvTenant', 'fvBD')
  const className = Object.keys(firstItem)[0]
  const classObject = firstItem[className]
  const hasChildren = !!(classObject?.children && classObject.children.length > 0
    && classObject.children.some((c: any) => {
      const cls = Object.keys(c)[0]
      return cls && !SUPPLEMENTAL_CLASSES.has(cls)
    })
  )

  // Sample multiple items to find all possible fields
  const allFields = new Set<string>()
  const fieldTypes = new Map<string, Set<string>>()

  imdata.slice(0, 20).forEach((item: any) => {
    const attrs = item[className]?.attributes || {}
    Object.keys(attrs).forEach((key) => {
      allFields.add(key)

      const value = attrs[key]
      const type = detectDataType(value)

      if (!fieldTypes.has(key)) {
        fieldTypes.set(key, new Set())
      }
      fieldTypes.get(key)!.add(type)
    })
  })

  // Create column definitions
  const columns: ColumnDefinition[] = []
  let order = 0

  // Add priority fields first
  APIC_PRIORITY_FIELDS.forEach((field) => {
    if (allFields.has(field)) {
      const types = fieldTypes.get(field) || new Set(['string'])
      const dataType = types.size === 1 ? Array.from(types)[0] : 'string'

      columns.push({
        field,
        label: formatFieldLabel(field),
        visible: true,
        order: order++,
        dataType: dataType as any,
        locked: field === 'name' || field === 'dn', // Name and DN cannot be hidden
      })
      allFields.delete(field)
    }
  })

  // Add remaining fields
  Array.from(allFields)
    .filter((field) => !APIC_HIDDEN_FIELDS.includes(field))
    .sort()
    .forEach((field) => {
      const types = fieldTypes.get(field) || new Set(['string'])
      const dataType = types.size === 1 ? Array.from(types)[0] : 'string'

      columns.push({
        field,
        label: formatFieldLabel(field),
        visible: true,
        order: order++,
        dataType: dataType as any,
      })
    })

  // Add hidden fields
  APIC_HIDDEN_FIELDS.forEach((field) => {
    if (allFields.has(field)) {
      columns.push({
        field,
        label: formatFieldLabel(field),
        visible: false,
        order: order++,
        dataType: 'string',
        alwaysHide: true,
      })
    }
  })

  return {
    type: 'apic',
    className,
    dataPath: `imdata[*].${className}.attributes`,
    columns,
    totalItems: imdata.length,
    hasNestedData: hasChildren,
  }
}

/**
 * Detect generic array structure
 */
function detectArrayStructure(data: any[]): TableStructure {
  if (data.length === 0) {
    return {
      type: 'array',
      columns: [],
      totalItems: 0,
      hasNestedData: false,
    }
  }

  // Sample first items to detect columns
  const allFields = new Set<string>()
  const fieldTypes = new Map<string, Set<string>>()
  let hasNested = false

  data.slice(0, 20).forEach((item) => {
    if (typeof item === 'object' && item !== null) {
      Object.keys(item).forEach((key) => {
        allFields.add(key)

        const value = item[key]
        const type = detectDataType(value)

        if (type === 'object' || type === 'array') {
          hasNested = true
        }

        if (!fieldTypes.has(key)) {
          fieldTypes.set(key, new Set())
        }
        fieldTypes.get(key)!.add(type)
      })
    }
  })

  // Create columns
  const columns: ColumnDefinition[] = Array.from(allFields)
    .sort()
    .map((field, index) => {
      const types = fieldTypes.get(field) || new Set(['string'])
      const dataType = types.size === 1 ? Array.from(types)[0] : 'string'

      return {
        field,
        label: formatFieldLabel(field),
        visible: true,
        order: index,
        dataType: dataType as any,
      }
    })

  return {
    type: 'array',
    columns,
    totalItems: data.length,
    hasNestedData: hasNested,
  }
}

/**
 * Detect single object structure (convert to single-row table)
 */
function detectObjectStructure(data: any): TableStructure {
  const fields = Object.keys(data)
  let hasNested = false

  const columns: ColumnDefinition[] = fields.map((field, index) => {
    const value = data[field]
    const dataType = detectDataType(value)

    if (dataType === 'object' || dataType === 'array') {
      hasNested = true
    }

    return {
      field,
      label: formatFieldLabel(field),
      visible: true,
      order: index,
      dataType: dataType as any,
    }
  })

  return {
    type: 'object',
    columns,
    totalItems: 1,
    hasNestedData: hasNested,
  }
}

/**
 * Detect data type of a value
 */
function detectDataType(value: any): string {
  if (value === null || value === undefined) return 'string'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'

  // Check if it's a date string
  if (typeof value === 'string') {
    // ISO date pattern
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      return 'date'
    }
  }

  return 'string'
}

/**
 * Format field name to human-readable label
 */
function formatFieldLabel(field: string): string {
  // Handle common abbreviations and virtual fields
  const abbreviations: Record<string, string> = {
    dn: 'DN',
    descr: 'Description',
    adminSt: 'Admin State',
    operSt: 'Operational State',
    _className: 'Class',
  }

  if (abbreviations[field]) {
    return abbreviations[field]
  }

  // Convert camelCase to Title Case
  return field
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim()
}

/**
 * Extract table data from JSON based on detected structure
 */
export function extractTableData(data: any, structure: TableStructure): any[] {
  if (!structure || !data) return []

  switch (structure.type) {
    case 'apic': {
      if (!structure.className) return []
      // Tolerate both shapes: full APIC envelope ({imdata: [...]}) and the
      // unwrapped array that post-processors produce. detectTableStructure()
      // promotes an unwrapped array to APIC structure; the extractor needs
      // to mirror that or it would return [] and the table would render as
      // empty even though the structure says otherwise.
      const items: any[] = Array.isArray(data?.imdata)
        ? data.imdata
        : Array.isArray(data)
          ? data
          : []
      return items.map((item: any) => item[structure.className!]?.attributes || {})
    }

    case 'array':
      return Array.isArray(data) ? data : []

    case 'object':
      return [data]

    default:
      return []
  }
}

/**
 * Filter empty columns from data
 */
export function filterEmptyColumns(
  columns: ColumnDefinition[],
  data: any[]
): ColumnDefinition[] {
  return columns.map((col) => {
    const isEmpty = data.every(
      (row) => row[col.field] === null || row[col.field] === undefined || row[col.field] === ''
    )

    return {
      ...col,
      visible: isEmpty ? false : col.visible,
    }
  })
}
