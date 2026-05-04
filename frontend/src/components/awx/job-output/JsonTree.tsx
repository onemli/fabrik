// awx/job-output/JsonTree.tsx
//
// Collapsible JSON tree viewer. No external dependency — react-json-view and
// friends have React 19 compatibility gaps. ~80 lines of recursive rendering
// is cheaper than owning that surface area.

import { useState, memo } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'

interface JsonTreeProps {
  data: unknown
  defaultExpandDepth?: number
  rootLabel?: string
}

export function JsonTree({ data, defaultExpandDepth = 2, rootLabel }: JsonTreeProps) {
  return (
    <div className="font-mono text-xs leading-relaxed">
      <Node value={data} depth={0} expandDepth={defaultExpandDepth} label={rootLabel} />
    </div>
  )
}

interface NodeProps {
  value: unknown
  depth: number
  expandDepth: number
  label?: string
}

const Node = memo(function Node({ value, depth, expandDepth, label }: NodeProps) {
  const isObject = value !== null && typeof value === 'object'
  const [expanded, setExpanded] = useState(depth < expandDepth)

  if (!isObject) {
    return (
      <div className="flex items-start gap-2 pl-4">
        {label !== undefined && <span className="text-blue-600 dark:text-blue-400">{label}:</span>}
        <Primitive value={value} />
      </div>
    )
  }

  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>)
  const isEmpty = entries.length === 0
  const openBracket = Array.isArray(value) ? '[' : '{'
  const closeBracket = Array.isArray(value) ? ']' : '}'

  return (
    <div>
      <button
        type="button"
        onClick={() => !isEmpty && setExpanded(e => !e)}
        className="flex items-start gap-1 w-full text-left hover:bg-muted/40 rounded"
        disabled={isEmpty}
      >
        <span className="pt-0.5 w-3 flex-shrink-0">
          {isEmpty ? null : expanded
            ? <ChevronDown className="w-3 h-3 text-muted-foreground" />
            : <ChevronRight className="w-3 h-3 text-muted-foreground" />
          }
        </span>
        {label !== undefined && <span className="text-blue-600 dark:text-blue-400">{label}:</span>}
        <span className="text-muted-foreground">
          {openBracket}
          {!expanded && (
            <span className="italic">
              {' '}{entries.length} {Array.isArray(value) ? 'item' : 'key'}{entries.length === 1 ? '' : 's'}{' '}
            </span>
          )}
          {!expanded && closeBracket}
        </span>
      </button>

      {expanded && !isEmpty && (
        <div className="border-l border-border/60 ml-1.5 pl-2">
          {entries.map(([key, child]) => (
            <Node
              key={key}
              value={child}
              depth={depth + 1}
              expandDepth={expandDepth}
              label={key}
            />
          ))}
          <div className="pl-4 text-muted-foreground">{closeBracket}</div>
        </div>
      )}
    </div>
  )
})

function Primitive({ value }: { value: unknown }) {
  if (value === null) return <span className="text-muted-foreground italic">null</span>
  if (value === undefined) return <span className="text-muted-foreground italic">undefined</span>
  if (typeof value === 'boolean')
    return <span className="text-purple-600 dark:text-purple-400">{String(value)}</span>
  if (typeof value === 'number')
    return <span className="text-amber-600 dark:text-amber-400">{value}</span>
  if (typeof value === 'string') {
    const display = value.length > 500 ? value.slice(0, 500) + '…' : value
    return (
      <span className="text-emerald-700 dark:text-emerald-400 break-all whitespace-pre-wrap">
        "{display}"
      </span>
    )
  }
  return <span>{String(value)}</span>
}
