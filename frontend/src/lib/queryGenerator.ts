// lib/queryGenerator.ts
//
// Frontend query generator — constructs the APIC REST URL from the current canvas
// state (nodes + edges) without hitting the backend. Acts as a fast fallback when
// the backend optimizer is unavailable and as a preview for the query impact area.
// For complex multi-node chains the backend optimizer takes over at execution time.

import type { Node, Edge } from '@xyflow/react'
import {
  NodeType,
  ClassNodeData,
  FilterNodeData,
  PostProcessorNodeData,
  QueryNodeData,
  APICQuery,
  PostProcessorConfig,
} from '@/types'

/**
 * Generate APIC REST API query from React Flow nodes and edges
 */
export function generateAPICQuery(
  nodes: Node<QueryNodeData>[],
  edges: Edge[]
): APICQuery | null {
  // Find the root class node
  const rootNode = findRootClassNode(nodes, edges)
  if (!rootNode) {
    throw new Error('No root Class node found. Please add a node to start.')
  }

  const classData = rootNode.data as ClassNodeData
  if (!classData.className) {
    throw new Error('Please configure the Class node with a class name.')
  }

  // Build query URL
  const url = buildQueryURL(classData)

  // Build query parameters from filters
  const params = buildQueryParams(rootNode, nodes, edges)

  // Collect post-processors
  const postProcessors = collectPostProcessors(rootNode, nodes, edges)

  return {
    url,
    method: 'GET',
    params,
    queryType: 'class',
    postProcessors: postProcessors.length > 0 ? postProcessors : undefined,
  }
}

/**
 * Find root Class node (no incoming target edges)
 */
function findRootClassNode(nodes: Node<QueryNodeData>[], edges: Edge[]): Node<QueryNodeData> | null {
  const classNodes = nodes.filter((n) => n.type === NodeType.CLASS)

  // Skip pipeline edges when determining root — pipeline edges connect separate stages
  const containmentEdges = edges.filter((e) => e.data?.edgeType !== 'pipeline')

  for (const node of classNodes) {
    const hasIncomingEdge = containmentEdges.some((e) => e.target === node.id)
    if (!hasIncomingEdge) {
      return node
    }
  }

  return classNodes[0] || null
}

/**
 * Build APIC query URL from class data
 * Note: Scope is handled via rsp-subtree parameter in buildQueryParams, NOT in URL
 */
function buildQueryURL(classData: ClassNodeData): string {
  const { className } = classData

  // Base URL only - scope is added as rsp-subtree parameter
  return `/api/class/${className}.json`
}

/**
 * Build query parameters from connected filter nodes
 */
function buildQueryParams(
  rootNode: Node<QueryNodeData>,
  nodes: Node<QueryNodeData>[],
  edges: Edge[]
): Record<string, string> {
  const params: Record<string, string> = {}

  // Get class name from root node
  const classData = rootNode.data as ClassNodeData
  const className = classData.className

  // Add scope using rsp-subtree (NOT query-target!)
  // For class queries, use rsp-subtree parameter
  // query-target is only for MO queries (/api/mo/DN.json)
  if (classData.scope === 'children') {
    params['rsp-subtree'] = 'children'
  } else if (classData.scope === 'subtree') {
    params['rsp-subtree'] = 'full'
  }

  // Find connected filter nodes
  const filterNodes = findConnectedNodes(rootNode, nodes, edges, NodeType.FILTER)

  // Collect all filter expressions to combine them
  const filterExpressions: string[] = []
  let hasSubscription = false

  for (const filterNode of filterNodes) {
    const filterData = filterNode.data as FilterNodeData

    if (filterData.filterType === 'property') {
      // Property filter: query-target-filter
      // Allow value to be empty string (for empty value checks)
      if (filterData.property && filterData.operator && filterData.value !== undefined) {
        const filterExpression = buildFilterExpression(
          className,
          filterData.property,
          filterData.operator,
          filterData.value
        )
        filterExpressions.push(filterExpression)
      }
    } else if (filterData.filterType === 'query-target-filter') {
      // Wildcard query target filter
      const filterExpression = buildWildcardFilterExpression(className, filterData)
      if (filterExpression) {
        filterExpressions.push(filterExpression)
      }
    } else if (filterData.filterType === 'subscription') {
      // Subscription
      if (filterData.subscriptionType) {
        hasSubscription = true
      }
    }
  }

  // Combine multiple filter expressions with 'and'
  if (filterExpressions.length === 1) {
    params['query-target-filter'] = filterExpressions[0]
  } else if (filterExpressions.length > 1) {
    params['query-target-filter'] = `and(${filterExpressions.join(',')})`
  }

  if (hasSubscription) {
    params['subscription'] = 'yes'
  }

  // Add rsp-prop-include parameter (all, naming-only, config-only)
  // Only add if not 'all' (default behavior)
  if (classData.propertyInclude && classData.propertyInclude !== 'all') {
    params['rsp-prop-include'] = classData.propertyInclude
  }

  return params
}

/**
 * Build APIC filter expression
 */
function buildFilterExpression(className: string, property: string, operator: string, value: string): string {
  const operatorMap: Record<string, string> = {
    eq: 'eq',
    ne: 'ne',
    gt: 'gt',
    lt: 'lt',
    ge: 'ge',
    le: 'le',
    wcard: 'wcard',
    contains: 'wcard',
  }

  const apicOperator = operatorMap[operator] || 'eq'

  // IMPORTANT: APIC query-target-filter REQUIRES class prefix
  const fullProperty = `${className}.${property}`

  // Handle wildcard operators - APIC uses regex syntax (.*) not glob syntax (*)
  if (operator === 'contains') {
    return `${apicOperator}(${fullProperty},".*${value}.*")`
  } else if (operator === 'wcard') {
    // If user already provided regex pattern, use as-is; otherwise treat as starts-with
    const isRegexPattern = value.includes('.*') || value.startsWith('^') || value.endsWith('$')
    return `${apicOperator}(${fullProperty},"${isRegexPattern ? value : value + '.*'}")`
  }

  return `${apicOperator}(${fullProperty},"${value}")`
}

/**
 * Build a single pattern's APIC filter expression
 */
function buildSinglePatternExpr(className: string, p: { property: string; pattern: string; operator?: string; type?: string; negate?: boolean }): string | null {
  if (!p.property || p.pattern === undefined) return null

  const operator = p.operator || 'wcard'
  let pattern = p.pattern

  // For wcard operator, apply regex patterns (APIC uses .* not glob *)
  if (operator === 'wcard') {
    if (p.type === 'starts') pattern = `${pattern}.*`
    else if (p.type === 'ends') pattern = `.*${pattern}`
    else if (p.type === 'contains') pattern = `.*${pattern}.*`
  }

  const fullProperty = `${className}.${p.property}`
  let expr = `${operator}(${fullProperty},"${pattern}")`

  if (p.negate) {
    expr = `not(${expr})`
  }

  return expr
}

/**
 * Build wildcard filter expression from pattern groups
 * Supports nested logical operators: and(or(eq(...),eq(...)),not(eq(...)))
 */
function buildWildcardFilterExpression(className: string, filterData: FilterNodeData): string {
  // Use patternGroups if available, fall back to legacy flat patterns
  if (filterData.patternGroups && filterData.patternGroups.length > 0) {
    const groupExprs = filterData.patternGroups
      .map((group) => {
        const exprs = group.patterns
          .map((p) => buildSinglePatternExpr(className, p))
          .filter(Boolean) as string[]

        if (exprs.length === 0) return null
        if (exprs.length === 1) return exprs[0]
        return `${group.logicalOperator}(${exprs.join(',')})`
      })
      .filter(Boolean) as string[]

    if (groupExprs.length === 0) return ''
    if (groupExprs.length === 1) return groupExprs[0]

    const combineOp = filterData.groupCombineOperator || 'and'
    return `${combineOp}(${groupExprs.join(',')})`
  }

  // Legacy flat patterns (backward compat)
  const patterns = filterData.wildcardPatterns || []
  if (patterns.length === 0) return ''

  const filterExpressions = patterns
    .map((p) => buildSinglePatternExpr(className, p))
    .filter(Boolean) as string[]

  if (filterExpressions.length === 0) return ''
  if (filterExpressions.length === 1) return filterExpressions[0]

  const op = filterData.logicalOperator || 'and'
  return `${op}(${filterExpressions.join(',')})`
}

/**
 * Collect post-processor configurations
 */
function collectPostProcessors(
  rootNode: Node<QueryNodeData>,
  nodes: Node<QueryNodeData>[],
  edges: Edge[]
): PostProcessorConfig[] {
  const processors: PostProcessorConfig[] = []

  const processorNodes = findConnectedNodes(rootNode, nodes, edges, NodeType.POST_PROCESSOR)

  for (const processorNode of processorNodes) {
    const processorData = processorNode.data as PostProcessorNodeData

    processors.push({
      type: processorData.processorType,
      config: processorData.config,
    })
  }

  return processors
}

/**
 * Find all nodes of specific type connected to root node (excluding paused nodes)
 */
function findConnectedNodes(
  rootNode: Node<QueryNodeData>,
  allNodes: Node<QueryNodeData>[],
  edges: Edge[],
  nodeType: NodeType
): Node<QueryNodeData>[] {
  const connected: Node<QueryNodeData>[] = []
  const visited = new Set<string>()

  function traverse(nodeId: string) {
    if (visited.has(nodeId)) return
    visited.add(nodeId)

    // Find edges from this node — skip pipeline edges (they cross stage boundaries)
    const outgoingEdges = edges.filter(
      (e) => e.source === nodeId && e.data?.edgeType !== 'pipeline'
    )

    for (const edge of outgoingEdges) {
      const targetNode = allNodes.find((n) => n.id === edge.target)
      if (!targetNode) continue

      // Paused post-processors still need to be traversed past so downstream
      // nodes of the same search type get collected; the backend engine is
      // what actually skips the paused PP during execution.
      const isPausedPP =
        targetNode.type === NodeType.POST_PROCESSOR &&
        (targetNode.data as { isPaused?: boolean }).isPaused

      if (!isPausedPP && targetNode.type === nodeType) {
        connected.push(targetNode)
      }

      // Continue traversing
      traverse(targetNode.id)
    }
  }

  traverse(rootNode.id)
  return connected
}

/**
 * Format APIC query for display
 */
export function formatQueryForDisplay(query: APICQuery): string {
  const params = new URLSearchParams(query.params).toString()
  // Decode URL for better readability
  const decodedParams = decodeURIComponent(params)
  const fullURL = decodedParams ? `${query.url}${query.url.includes('?') ? '&' : '?'}${decodedParams}` : query.url

  let display = `${query.method} ${fullURL}`

  if (query.postProcessors && query.postProcessors.length > 0) {
    display += '\n\nPost-Processors:\n'
    query.postProcessors.forEach((p, i) => {
      display += `${i + 1}. ${p.type}: ${JSON.stringify(p.config, null, 2)}\n`
    })
  }

  return display
}
