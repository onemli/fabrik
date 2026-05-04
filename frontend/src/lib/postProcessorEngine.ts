// lib/postProcessorEngine.ts
//
// Client-side post-processor pipeline that mirrors the backend's postprocessor_engine.py.
// Runs locally on cached results so processors can be tweaked and previewed without
// re-executing the APIC query. If the backend returns processed data, this is bypassed.

import type {
  PostProcessorConfig,
  DNExtractConfig,
  RegexTransformConfig,
  ArraySortConfig,
  PatternFilterConfig,
  FieldExtractConfig,
  FlattenConfig,
  MapTransformConfig,
  TextOperationsConfig,
  JavaScriptConfig,
  AggregateConfig,
} from '@/types'

/**
 * Post-Processor Execution Engine
 * Transforms APIC query results through a pipeline of operations
 */

export class PostProcessorEngine {
  /**
   * Execute a chain of post-processors on data
   */
  static execute(data: unknown, processors: PostProcessorConfig[]): unknown {
    // Mirror backend: unwrap APIC envelope so the chain sees a flat list
    // from the start. Without this every processor except dn-extract would
    // silently no-op on raw {totalCount, imdata: [...]} input.
    let result: unknown = data
    if (
      result !== null &&
      typeof result === 'object' &&
      !Array.isArray(result) &&
      'imdata' in (result as Record<string, unknown>)
    ) {
      result = (result as Record<string, unknown>).imdata
    }

    for (const processor of processors) {
      try {
        result = this.executeProcessor(result, processor)
      } catch (error) {
        throw new Error(
          `Post-processor "${processor.type}" failed: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        )
      }
    }

    return result
  }

  /**
   * Execute a single post-processor
   */
  private static executeProcessor(
    data: unknown,
    processor: PostProcessorConfig
  ): unknown {
    switch (processor.type) {
      case 'dn-extract':
        return this.executeDNExtract(data, processor.config as DNExtractConfig)
      case 'regex-transform':
        return this.executeRegexTransform(
          data,
          processor.config as RegexTransformConfig
        )
      case 'array-sort':
        return this.executeArraySort(data, processor.config as ArraySortConfig)
      case 'pattern-filter':
        return this.executePatternFilter(
          data,
          processor.config as PatternFilterConfig
        )
      case 'field-extract':
        return this.executeFieldExtract(
          data,
          processor.config as FieldExtractConfig
        )
      case 'flatten':
        return this.executeFlatten(data, processor.config as FlattenConfig)
      case 'map-transform':
        return this.executeMapTransform(
          data,
          processor.config as MapTransformConfig
        )
      case 'text-operations':
        return this.executeTextOperations(
          data,
          processor.config as TextOperationsConfig
        )
      case 'javascript':
        return this.executeJavaScript(data, processor.config as JavaScriptConfig)
      case 'aggregate':
        return this.executeAggregate(data, processor.config as AggregateConfig)
      default:
        throw new Error(`Unknown processor type: ${processor.type}`)
    }
  }

  /**
   * DN Extract: Extract DN paths from APIC response
   * Example APIC response: { imdata: [{ fvTenant: { attributes: { dn: "uni/tn-Production" } } }] }
   */
  private static executeDNExtract(
    data: unknown,
    config: DNExtractConfig
  ): unknown {
    const field = config.extractField || 'dn'
    const dns: string[] = []

    // Accept both the raw APIC envelope ({imdata: [...]}) and the
    // already-unwrapped list. The top-level execute() flattens to a list
    // before the chain runs, so most calls land here with a plain array;
    // the dict branch is kept for direct invocations and for parity with
    // the backend behaviour.
    let items: unknown[] = []
    if (this.isObject(data) && 'imdata' in data && Array.isArray(data.imdata)) {
      items = data.imdata as unknown[]
    } else if (Array.isArray(data)) {
      items = data
    }

    if (items.length > 0) {
      for (const item of items) {
        if (this.isObject(item)) {
          // APIC format: { className: { attributes: { dn: "..." } } }
          for (const key in item) {
            const obj = item[key]
            if (
              this.isObject(obj) &&
              'attributes' in obj &&
              this.isObject(obj.attributes)
            ) {
              const attrs = obj.attributes
              if (field in attrs && typeof attrs[field] === 'string') {
                let dn = attrs[field] as string

                // Apply prefix removal
                if (config.removePrefix) {
                  dn = dn.replace(new RegExp(config.removePrefix, 'g'), '')
                }

                // Apply extraction pattern
                if (config.extractPattern) {
                  const match = dn.match(new RegExp(config.extractPattern))
                  if (match) {
                    // Use first capture group if exists, otherwise full match
                    dn = match[1] || match[0]
                  }
                }

                dns.push(dn)
              }
            }
          }
        }
      }
    }

    return dns
  }

  /**
   * Regex Transform: Apply regex replacement (like sed)
   */
  private static executeRegexTransform(
    data: unknown,
    config: RegexTransformConfig
  ): unknown {
    const regex = new RegExp(config.pattern, config.flags || 'g')
    const field = config.applyTo

    const transformValue = (value: string): string => value.replace(regex, config.replacement)

    if (Array.isArray(data)) {
      return data.map((item) => {
        if (typeof item === 'string') return transformValue(item)
        if (field && item && typeof item === 'object') {
          const next = { ...(item as Record<string, unknown>) }
          const current = this.getNestedValue(next, field)
          if (typeof current === 'string') {
            this.setNestedValue(next, field, transformValue(current))
          }
          return next
        }
        return item
      })
    }

    if (typeof data === 'string') return transformValue(data)

    if (field && data && typeof data === 'object') {
      const next = { ...(data as Record<string, unknown>) }
      const current = this.getNestedValue(next, field)
      if (typeof current === 'string') {
        this.setNestedValue(next, field, transformValue(current))
      }
      return next
    }

    return data
  }

  /**
   * Array Sort: Sort with options (unique, numeric, reverse)
   */
  private static executeArraySort(
    data: unknown,
    config: ArraySortConfig
  ): unknown {
    if (!Array.isArray(data)) {
      throw new Error('Array Sort requires array input')
    }

    let result = [...data]

    // Sort
    result.sort((a, b) => {
      const valA = config.field ? this.getNestedValue(a, config.field) : a
      const valB = config.field ? this.getNestedValue(b, config.field) : b

      // Convert to string for comparison
      const strA = String(valA)
      const strB = String(valB)

      if (config.numeric) {
        const numA = parseFloat(strA)
        const numB = parseFloat(strB)
        return numA - numB
      }

      return strA.localeCompare(strB)
    })

    // Remove duplicates
    if (config.unique) {
      if (config.field) {
        // For objects, unique by field
        const seen = new Set()
        result = result.filter((item) => {
          const val = this.getNestedValue(item, config.field!)
          const key = String(val)
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
      } else {
        // For primitives
        result = [...new Set(result)]
      }
    }

    // Reverse
    if (config.reverse) {
      result.reverse()
    }

    return result
  }

  /**
   * Pattern Filter: Filter by include/exclude patterns (like grep)
   */
  private static executePatternFilter(
    data: unknown,
    config: PatternFilterConfig
  ): unknown {
    if (!Array.isArray(data)) {
      throw new Error('Pattern Filter requires array input')
    }

    return data.filter((item) => {
      const value = config.field
        ? String(this.getNestedValue(item, config.field))
        : String(item)

      const flags = config.caseSensitive ? '' : 'i'

      // Check include patterns (OR logic)
      if (config.includePatterns && config.includePatterns.length > 0) {
        const matchesInclude = config.includePatterns.some((pattern) => {
          const regex = new RegExp(pattern, flags)
          return regex.test(value)
        })
        if (!matchesInclude) return false
      }

      // Check exclude patterns
      if (config.excludePatterns && config.excludePatterns.length > 0) {
        const matchesExclude = config.excludePatterns.some((pattern) => {
          const regex = new RegExp(pattern, flags)
          return regex.test(value)
        })
        if (matchesExclude) return false
      }

      return true
    })
  }

  /**
   * Field Extract: Extract specific fields from objects in array
   */
  private static executeFieldExtract(
    data: unknown,
    config: FieldExtractConfig
  ): unknown {
    if (!Array.isArray(data)) {
      throw new Error('Field Extract requires array input')
    }

    if (!config.fields || config.fields.length === 0) {
      throw new Error('Field Extract requires at least one field')
    }

    return data.map((item) => {
      if (config.keepStructure) {
        // Keep original structure, extract only specified fields
        const result: Record<string, unknown> = {}
        for (const field of config.fields) {
          const value = this.getNestedValue(item, field)
          if (value !== undefined) {
            // Reconstruct nested path
            const keys = field.split('.')
            let current = result
            for (let i = 0; i < keys.length - 1; i++) {
              if (!current[keys[i]]) {
                current[keys[i]] = {}
              }
              current = current[keys[i]] as Record<string, unknown>
            }
            current[keys[keys.length - 1]] = value
          }
        }
        return result
      } else {
        // Flatten to simple object
        const result: Record<string, unknown> = {}
        for (const field of config.fields) {
          const value = this.getNestedValue(item, field)
          if (value !== undefined) {
            // Use last key as field name
            const keys = field.split('.')
            result[keys[keys.length - 1]] = value
          }
        }
        return result
      }
    })
  }

  /**
   * Flatten: Flatten nested arrays/objects
   */
  private static executeFlatten(
    data: unknown,
    config: FlattenConfig
  ): unknown {
    if (Array.isArray(data)) {
      // Flatten array
      const depth = config.depth ?? Infinity
      return data.flat(depth)
    }

    if (this.isObject(data)) {
      // Flatten object keys
      const result: Record<string, unknown> = {}
      const separator = config.separator || '.'

      const flatten = (obj: Record<string, unknown>, prefix = '') => {
        for (const key in obj) {
          const value = obj[key]
          const newKey = prefix ? `${prefix}${separator}${key}` : key

          if (this.isObject(value)) {
            flatten(value as Record<string, unknown>, newKey)
          } else {
            result[newKey] = value
          }
        }
      }

      flatten(data)
      return result
    }

    return data
  }

  /**
   * Map Transform: Transform each item with expression
   */
  private static executeMapTransform(
    data: unknown,
    config: MapTransformConfig
  ): unknown {
    if (!Array.isArray(data)) {
      throw new Error('Map Transform requires array input')
    }

    const itemVar = config.itemVar || 'item'

    try {
      // Create safe function for each item
      return data.map((item) => {
        // Simple expression evaluation (safer than full JS)
        const func = new Function(
          itemVar,
          `'use strict'; return (${config.expression})`
        )
        return func(item)
      })
    } catch (error) {
      throw new Error(
        `Map Transform failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      )
    }
  }

  /**
   * Text Operations: String operations
   */
  private static executeTextOperations(
    data: unknown,
    config: TextOperationsConfig
  ): unknown {
    const process = (text: string): unknown => {
      switch (config.operation) {
        case 'split':
          return text.split(config.separator || ',', config.limit)

        case 'join':
          // If data is array of strings, join them
          if (Array.isArray(data)) {
            return data.join(config.delimiter || ',')
          }
          return text

        case 'trim':
          return text.trim()

        case 'upper':
          return text.toUpperCase()

        case 'lower':
          return text.toLowerCase()

        case 'replace':
          return text.replace(
            new RegExp(config.find || '', 'g'),
            config.replaceWith || ''
          )

        case 'substring':
          return text.substring(config.start || 0, config.end)

        default:
          return text
      }
    }

    if (Array.isArray(data)) {
      // Special case for join
      if (config.operation === 'join') {
        return data.join(config.delimiter || ',')
      }
      // Apply to each string in array
      return data.map((item) => process(String(item)))
    }

    return process(String(data))
  }

  /**
   * Decide how to invoke the user's snippet. Three accepted forms:
   *   1. Arrow function expression:   (data) => ...    or   data => ...
   *   2. Function expression:         function (data) { ... }
   *   3. Plain function body:         const x = data; ... return x;
   * Forms 1–2 are called with `data`; form 3 is wrapped in an arrow body so
   * lab-guide-style snippets work without manual wrapping.
   */
  private static wrapUserCode(code: string): string {
    const trimmed = (code || '').trim()
    if (!trimmed) return 'data'

    const isArrowWithParens = /^\(/.test(trimmed)
    const isFunctionExpr = /^function\b/.test(trimmed)
    const isAsyncExpr = /^async\s+(function\b|\()/.test(trimmed)
    const isBareArrow = /^[a-zA-Z_$][\w$]*\s*=>/.test(trimmed)

    if (isArrowWithParens || isFunctionExpr || isAsyncExpr || isBareArrow) {
      return `(${trimmed})(data)`
    }

    // Raw function body — wrap as an arrow body so users can paste plain
    // statements with a `return` at the end (matches the lab guide examples).
    return `((data) => { ${trimmed} })(data)`
  }

  /**
   * JavaScript: Execute custom JavaScript code (SANDBOXED & TIMEOUT)
   */
  private static executeJavaScript(
    data: unknown,
    config: JavaScriptConfig
  ): unknown {
    const timeout = config.timeout || 5000 // Default 5 second timeout

    try {
      // Create sandboxed execution context
      // SECURITY: No access to window, document, fetch, etc.
      const invocation = this.wrapUserCode(config.code)
      const sandboxedFunction = new Function(
        'data',
        `
        'use strict';
        // Disable dangerous globals
        const window = undefined;
        const document = undefined;
        const fetch = undefined;
        const XMLHttpRequest = undefined;
        const WebSocket = undefined;

        // Execute user code
        return ${invocation};
        `
      )

      // Execute with timeout
      let completed = false
      let result: unknown
      let error: Error | null = null

      const timeoutId = setTimeout(() => {
        if (!completed) {
          error = new Error(
            `JavaScript execution timeout (${timeout}ms exceeded)`
          )
        }
      }, timeout)

      try {
        result = sandboxedFunction(data)
        completed = true
        clearTimeout(timeoutId)
      } catch (err) {
        completed = true
        clearTimeout(timeoutId)
        throw err
      }

      if (error) throw error
      return result
    } catch (error) {
      throw new Error(
        `JavaScript execution failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      )
    }
  }

  /**
   * Aggregate: Perform aggregation operations
   */
  private static executeAggregate(
    data: unknown,
    config: AggregateConfig
  ): unknown {
    if (!Array.isArray(data)) {
      throw new Error('Aggregate requires array input')
    }

    switch (config.operation) {
      case 'count':
        return data.length

      case 'sum':
        if (!config.field) throw new Error('Sum requires a field')
        return data.reduce((sum, item) => {
          const val = this.getNestedValue(item, config.field!)
          return sum + (typeof val === 'number' ? val : parseFloat(String(val)) || 0)
        }, 0)

      case 'avg': {
        if (!config.field) throw new Error('Average requires a field')
        const sum = data.reduce((s, item) => {
          const val = this.getNestedValue(item, config.field!)
          return s + (typeof val === 'number' ? val : parseFloat(String(val)) || 0)
        }, 0)
        return sum / data.length
      }

      case 'min':
        if (!config.field) throw new Error('Min requires a field')
        return Math.min(
          ...data.map((item) => {
            const val = this.getNestedValue(item, config.field!)
            return typeof val === 'number' ? val : parseFloat(String(val)) || 0
          })
        )

      case 'max':
        if (!config.field) throw new Error('Max requires a field')
        return Math.max(
          ...data.map((item) => {
            const val = this.getNestedValue(item, config.field!)
            return typeof val === 'number' ? val : parseFloat(String(val)) || 0
          })
        )

      case 'group': {
        if (!config.groupBy) throw new Error('Group requires groupBy field')
        const groups = new Map<string, unknown[]>()
        for (const item of data) {
          const key = String(this.getNestedValue(item, config.groupBy))
          if (!groups.has(key)) {
            groups.set(key, [])
          }
          groups.get(key)!.push(item)
        }
        return Object.fromEntries(groups)
      }

      default:
        throw new Error(`Unknown aggregate operation: ${config.operation}`)
    }
  }

  /**
   * Helper: Get nested value from object by path
   */
  private static getNestedValue(obj: unknown, path: string): unknown {
    if (!this.isObject(obj)) return undefined

    const direct = this.walkPath(obj, path)
    if (direct !== undefined) return direct

    // APIC envelope unwrap: a single-key dict like {fvTenant: {...}} —
    // try walking inside the inner object so callers can use
    // 'attributes.dn' instead of 'fvTenant.attributes.dn'.
    const keys = Object.keys(obj)
    if (keys.length === 1) {
      const inner = obj[keys[0]]
      if (this.isObject(inner)) return this.walkPath(inner, path)
    }
    return undefined
  }

  private static walkPath(obj: Record<string, unknown>, path: string): unknown {
    let current: unknown = obj
    for (const key of path.split('.')) {
      if (!this.isObject(current) || !(key in current)) return undefined
      current = current[key]
    }
    return current
  }

  /**
   * Helper: in-place write of a dot-separated path. Mirrors getNestedValue
   * by unwrapping a single-key APIC envelope when the first segment of the
   * path doesn't match at the root.
   */
  private static setNestedValue(obj: unknown, path: string, value: unknown): void {
    if (!this.isObject(obj)) return

    const keys = path.split('.')
    let target: Record<string, unknown> = obj

    // APIC envelope unwrap: if first segment isn't at the root and we have
    // a single-key wrapper, descend into it.
    if (!(keys[0] in target)) {
      const rootKeys = Object.keys(target)
      if (rootKeys.length === 1) {
        const inner = target[rootKeys[0]]
        if (this.isObject(inner)) target = inner
      }
    }

    for (let i = 0; i < keys.length - 1; i += 1) {
      const next = target[keys[i]]
      if (!this.isObject(next)) return
      target = next
    }
    target[keys[keys.length - 1]] = value
  }

  /**
   * Type guard for objects
   */
  private static isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }
}
