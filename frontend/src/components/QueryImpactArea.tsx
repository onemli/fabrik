// QueryImpactArea.tsx
//
// Expandable section at the bottom of each canvas node that shows the generated
// APIC query URL for that node. Hidden by default — the user can expand it to
// verify exactly what query will be sent to the APIC for this step in the chain.

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { NodeType, type QueryNodeData } from '@/types'
import type { ClassNodeData, FilterNodeData, PostProcessorNodeData } from '@/types'

interface QueryImpactAreaProps {
  nodeType: NodeType
  nodeData: QueryNodeData
}

export function QueryImpactArea({ nodeType, nodeData }: QueryImpactAreaProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const getImpactText = (): string => {
    switch (nodeType) {
      case NodeType.START:
        return 'Flow start point'

      case NodeType.CLASS: {
        const data = nodeData as ClassNodeData
        if (!data.className) return 'Class not configured'
        const scope = data.scope || 'self'
        const propInclude = data.propertyInclude || 'all'
        return `/api/class/${data.className}.json?query-target=${scope}&rsp-prop-include=${propInclude}`
      }

      case NodeType.FILTER: {
        const data = nodeData as FilterNodeData
        if (data.filterType === 'property' && data.property && data.operator && data.value) {
          return `&query-target-filter=${data.operator}(${data.property},"${data.value}")`
        } else if (data.filterType === 'query-target-filter' && data.wildcardPatterns && data.wildcardPatterns.length > 0) {
          const patterns = data.wildcardPatterns.map(p => `wcard(${p.property},"${p.pattern}*")`)
          const op = data.logicalOperator || 'and'
          return `&query-target-filter=${patterns.length > 1 ? `${op}(${patterns.join(',')})` : patterns[0]}`
        } else if (data.filterType === 'subscription') {
          return `&subscription=yes&subscription-type=${data.subscriptionType || 'audit'}`
        }
        return 'Filter not configured'
      }

      case NodeType.POST_PROCESSOR: {
        const data = nodeData as PostProcessorNodeData
        return `Post-process: ${data.processorType || 'not configured'}`
      }

      case NodeType.OUTPUT:
        return 'Final output node'

      default:
        return 'Unknown node type'
    }
  }

  const impactText = getImpactText()

  return (
    <div className="absolute -bottom-8 left-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto">
      <div className="bg-background border border-border rounded-md shadow-lg overflow-hidden">
        <button
          onClick={(e) => {
            e.stopPropagation()
            setIsExpanded(!isExpanded)
          }}
          className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-accent transition-colors text-xs"
        >
          <span className="font-mono text-muted-foreground truncate">
            {isExpanded ? impactText : impactText.substring(0, 40) + (impactText.length > 40 ? '...' : '')}
          </span>
          {isExpanded ? (
            <ChevronUp className="w-3 h-3 flex-shrink-0 ml-2" />
          ) : (
            <ChevronDown className="w-3 h-3 flex-shrink-0 ml-2" />
          )}
        </button>
        {isExpanded && (
          <div className="px-3 py-2 border-t border-border bg-muted/30">
            <code className="text-xs font-mono text-foreground break-all">
              {impactText}
            </code>
          </div>
        )}
      </div>
    </div>
  )
}
