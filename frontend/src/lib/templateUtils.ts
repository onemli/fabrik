// lib/templateUtils.ts
//
// Utilities for working with query templates — extracting variable placeholders
// from node filter values, substituting runtime values before execution, and
// validating that all required variables have been provided.

import type { Node, Edge } from '@xyflow/react'
import { TemplateVariable } from '@/types'

/**
 * Replace template variables in flow data with actual values
 */
export function replaceTemplateVariables(
  nodes: Node[],
  edges: Edge[],
  variables: Record<string, any>
): { nodes: Node[]; edges: Edge[] } {
  const replacedNodes = nodes.map((node) => ({
    ...node,
    data: replaceInObject(node.data, variables),
  }))

  return {
    nodes: replacedNodes,
    edges: [...edges], // Edges typically don't have variables
  }
}

/**
 * Recursively replace ${variable_id} patterns in an object
 */
function replaceInObject(obj: any, values: Record<string, any>): any {
  if (typeof obj === 'string') {
    // Replace ${variable_id} with actual value
    return obj.replace(/\$\{(\w+)\}/g, (match, varId) => {
      return values[varId] !== undefined ? values[varId] : match
    })
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => replaceInObject(item, values))
  }

  if (obj && typeof obj === 'object') {
    const replaced: any = {}
    for (const [key, value] of Object.entries(obj)) {
      // Skip internal fields like _variable
      if (key.startsWith('_')) {
        continue
      }
      replaced[key] = replaceInObject(value, values)
    }
    return replaced
  }

  return obj
}

/**
 * Extract all variables from flow data nodes
 * Scans for ${...} patterns and _variable/_variables metadata
 */
export function extractVariablesFromNodes(nodes: Node[]): TemplateVariable[] {
  const variables: TemplateVariable[] = []
  const seenIds = new Set<string>()

  for (const node of nodes) {
    // Skip nodes without data
    if (!node.data) continue

    // Check for new _variables object (multiple variables)
    if (node.data._variables) {
      for (const [varId, varMetadata] of Object.entries(node.data._variables)) {
        if (!seenIds.has(varId)) {
          const fieldPath = inferFieldPath(node.data, varId)
          variables.push({
            ...(varMetadata as any),
            binding: {
              nodeId: node.id,
              fieldPath: fieldPath || 'data.value',
            },
          })
          seenIds.add(varId)
        }
      }
    }

    // Check for legacy _variable metadata (backward compatibility).
    // node.data is loosely typed as Record<string, unknown> in React Flow, so
    // cast the variable metadata to the expected shape before reading it.
    const legacyVariable = node.data._variable as Omit<TemplateVariable, 'binding'> | undefined
    if (legacyVariable) {
      const fieldPath = inferFieldPath(node.data, legacyVariable.id)
      const variable: TemplateVariable = {
        ...legacyVariable,
        binding: {
          nodeId: node.id,
          fieldPath: fieldPath || 'data.value',
        },
      }

      if (!seenIds.has(variable.id)) {
        variables.push(variable)
        seenIds.add(variable.id)
      }
    }

    // Also scan for ${...} patterns (in case metadata is missing)
    // Safety check: only scan if data exists
    if (node.data) {
      scanForVariablePatterns(node.data, node.id, variables, seenIds)
    }
  }

  return variables
}

/**
 * Infer field paths where a variable is used
 */
function inferFieldPath(obj: any, varId: string, path: string = 'data'): string | string[] | null {
  const varPattern = `\${${varId}}`
  const foundPaths: string[] = []

  function search(current: any, currentPath: string) {
    if (typeof current === 'string' && current.includes(varPattern)) {
      foundPaths.push(currentPath)
    } else if (Array.isArray(current)) {
      current.forEach((item, idx) => search(item, `${currentPath}[${idx}]`))
    } else if (current && typeof current === 'object') {
      for (const [key, value] of Object.entries(current)) {
        if (!key.startsWith('_')) {
          search(value, `${currentPath}.${key}`)
        }
      }
    }
  }

  search(obj, path)

  if (foundPaths.length === 0) return null
  if (foundPaths.length === 1) return foundPaths[0]
  return foundPaths
}

/**
 * Recursively scan object for ${variable_id} patterns
 */
function scanForVariablePatterns(
  obj: any,
  nodeId: string,
  variables: TemplateVariable[],
  seenIds: Set<string>,
  path: string = 'data'
) {
  if (typeof obj === 'string') {
    const matches = obj.matchAll(/\$\{(\w+)\}/g)
    for (const match of matches) {
      const varId = match[1]
      if (!seenIds.has(varId)) {
        // Create a basic variable definition
        variables.push({
          id: varId,
          label: varId.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
          type: 'text',
          required: true,
          binding: {
            nodeId,
            fieldPath: path,
          },
        })
        seenIds.add(varId)
      }
    }
  } else if (obj && typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      if (!key.startsWith('_')) {
        scanForVariablePatterns(value, nodeId, variables, seenIds, `${path}.${key}`)
      }
    }
  }
}

/**
 * Validate that all required variables have values
 */
export function validateTemplateVariables(
  variables: TemplateVariable[],
  values: Record<string, any>
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  for (const variable of variables) {
    if (variable.required && !values[variable.id]) {
      errors.push(`${variable.label} is required`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Get default values for all variables
 */
export function getDefaultVariableValues(variables: TemplateVariable[]): Record<string, any> {
  const defaults: Record<string, any> = {}

  for (const variable of variables) {
    if (variable.defaultValue !== undefined) {
      defaults[variable.id] = variable.defaultValue
    }
  }

  return defaults
}

/**
 * Generate smart defaults for variable metadata from variable ID
 */
export function generateVariableDefaults(
  variableId: string,
  currentValue?: string,
  fieldContext?: 'text' | 'number'
): Omit<TemplateVariable, 'binding'> {
  // Generate label from ID: tenant_name -> Tenant Name
  const label = variableId
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase())

  // Infer type from context or current value
  let type: 'text' | 'number' | 'select' = fieldContext || 'text'
  if (!fieldContext && currentValue) {
    const numValue = Number(currentValue)
    if (!isNaN(numValue) && currentValue.trim() !== '') {
      type = 'number'
    }
  }

  return {
    id: variableId,
    label,
    type,
    required: true,
    defaultValue: currentValue || '',
    placeholder: `Enter ${label.toLowerCase()}`,
  }
}

/**
 * Extract variable ID from ${variable_id} syntax
 */
export function extractVariableId(value: string): string | null {
  const match = value.match(/\$\{(\w+)\}/)
  return match ? match[1] : null
}
