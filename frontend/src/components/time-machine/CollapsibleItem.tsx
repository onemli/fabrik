// CollapsibleItem.tsx
//
// An expandable row in the Time Machine comparison diff view. Shows a single
// ACI managed object that was added, modified, or deleted between two snapshots.
// The DN is always visible; the full attribute diff is toggled on click to keep
// the list scannable when there are many changes.

import { useState } from 'react'
import { Plus, Minus, Edit, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CollapsibleItemProps {
  type: 'added' | 'modified' | 'deleted'
  dn: string
  content: React.ReactNode
  index: number
  className?: string
}

export default function CollapsibleItem({
  type,
  dn,
  content,
  index: _index,
  className: itemClassName,
}: CollapsibleItemProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const colorConfig = {
    added: {
      bg: 'bg-green-500/5',
      border: 'border-green-500/20',
      text: 'text-green-600 dark:text-green-400',
      icon: Plus,
      label: 'Added'
    },
    modified: {
      bg: 'bg-orange-500/5',
      border: 'border-orange-500/20',
      text: 'text-orange-600 dark:text-orange-400',
      icon: Edit,
      label: 'Modified'
    },
    deleted: {
      bg: 'bg-red-500/5',
      border: 'border-red-500/20',
      text: 'text-red-600 dark:text-red-400',
      icon: Minus,
      label: 'Deleted'
    }
  }

  const config = colorConfig[type]
  const Icon = config.icon
  const ChevronIcon = isExpanded ? ChevronDown : ChevronRight

  return (
    <div className={cn('border rounded-lg', config.bg, config.border)}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-4 flex items-center justify-between hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <Icon className={cn('w-4 h-4 flex-shrink-0', config.text)} />
          <span className={cn('font-medium text-sm', config.text)}>{config.label}</span>
          {itemClassName && (
            <span className="text-xs px-1.5 py-0.5 bg-muted rounded font-mono text-muted-foreground">
              {itemClassName}
            </span>
          )}
          <span className="text-sm font-mono text-muted-foreground truncate">{dn}</span>
        </div>
        <ChevronIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 pt-0">
          {content}
        </div>
      )}
    </div>
  )
}
