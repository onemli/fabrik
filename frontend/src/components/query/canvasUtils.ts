// canvasUtils.ts
//
// Shared helpers for the query builder canvas. Extracted here so both
// QueryBuilderCanvas and the connection hook can reference them without
// circular imports.

import { NodeType } from '@/types'

export function getDefaultNodeData(type: string, className?: string) {
  switch (type) {
    case NodeType.START:
      return {
        label: 'Start',
      }
    case NodeType.CLASS:
      return {
        label: className ? `Class: ${className}` : 'Class Query',
        className: className || '',
        propertyInclude: 'all',
        scope: 'self',
      }
    case NodeType.FILTER:
      return {
        label: 'Filter',
        filterType: 'property',
        operator: 'eq',
        property: 'name',
        value: undefined,
      }
    case NodeType.POST_PROCESSOR:
      return {
        label: 'Post Processor',
        processorType: 'dn-extract',
        config: {},
      }
    case NodeType.OUTPUT:
      return {
        label: 'Output',
      }
    default:
      return { label: 'Unknown' }
  }
}
