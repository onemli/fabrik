// NodeSelectionMenu.tsx
//
// Context menu that appears when the user right-clicks or uses the "+" button
// on the canvas to add a new node. Lists available node types with icons.

import { useEffect, useRef } from 'react'
import { Database, Filter, Code2, FileJson, Zap } from 'lucide-react'
import { NodeType } from '@/types'
import { cn } from '@/lib/utils'

interface NodeOption {
  type: NodeType
  label: string
  icon: React.ComponentType<{ className?: string }>
  description: string
  requiresSearch?: boolean
  isChildClass?: boolean
}

interface NodeSelectionMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  sourceNodeType: string | null
  sourceNodeId?: string | null
  onSelect: (nodeType: NodeType, data?: { className?: string; classInfo?: unknown }) => void
  onClose: () => void
  onRequestClassBrowser: (opts: { isChildClass: boolean }) => void
}

const getAvailableNodeTypes = (sourceNodeType: string | null): NodeOption[] => {
  if (!sourceNodeType) return []

  switch (sourceNodeType) {
    case NodeType.START:
      return [
        {
          type: NodeType.CLASS,
          label: 'Class Query',
          icon: Database,
          description: 'Query APIC class objects',
          requiresSearch: true,
        },
      ]
    case NodeType.CLASS:
      return [
        {
          type: NodeType.CLASS,
          label: 'Child Class',
          icon: Database,
          description: 'Query child class objects',
          requiresSearch: true,
          isChildClass: true,
        },
        {
          type: NodeType.FILTER,
          label: 'Filter',
          icon: Filter,
          description: 'Filter query results',
        },
        {
          type: NodeType.POST_PROCESSOR,
          label: 'Post-Processor',
          icon: Code2,
          description: 'Process and transform results',
        },
        {
          type: NodeType.OUTPUT,
          label: 'Output',
          icon: FileJson,
          description: 'Define output format (required for execution)',
        },
      ]
    case NodeType.FILTER:
    case NodeType.POST_PROCESSOR:
      return [
        {
          type: NodeType.CLASS,
          label: 'Child Class',
          icon: Database,
          description: 'Query child class objects',
          requiresSearch: true,
          isChildClass: true,
        },
        {
          type: NodeType.POST_PROCESSOR,
          label: 'Post-Processor',
          icon: Code2,
          description: 'Process and transform results',
        },
        {
          type: NodeType.OUTPUT,
          label: 'Output',
          icon: FileJson,
          description: 'Define output format (required for execution)',
        },
      ]
    case NodeType.OUTPUT:
      return [
        {
          type: NodeType.CLASS,
          label: 'Pipeline Stage',
          icon: Zap,
          description: 'Start a new query stage fed by this output',
          requiresSearch: true,
        },
      ]
    default:
      return []
  }
}

export function NodeSelectionMenu({
  isOpen,
  position,
  sourceNodeType,
  onSelect,
  onClose,
  onRequestClassBrowser,
}: NodeSelectionMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const availableOptions = getAvailableNodeTypes(sourceNodeType)

  // Close on outside click and ESC
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (menuRef.current && menuRef.current.contains(target)) return

      const isRadixPortal = (target as Element).closest('[data-radix-popper-content-wrapper]')
      const isSelectContent = (target as Element).closest('[role="listbox"]')
      const isTooltip = (target as Element).closest('[role="tooltip"]')
      if (isRadixPortal || isSelectContent || isTooltip) return

      onClose()
    }

    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleEscKey)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
        document.removeEventListener('keydown', handleEscKey)
      }
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const handleOptionClick = (option: NodeOption) => {
    if (option.requiresSearch) {
      onClose()
      onRequestClassBrowser({ isChildClass: option.isChildClass ?? false })
    } else {
      onSelect(option.type)
      onClose()
    }
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-card border border-border rounded-lg shadow-2xl w-72"
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
        <h3 className="text-sm font-semibold">Add Node</h3>
      </div>

      {/* Node type list */}
      <div className="p-2 space-y-1">
        {availableOptions.map((option) => {
          const Icon = option.icon
          return (
            <button
              key={option.type + (option.isChildClass ? '-child' : '')}
              onClick={() => handleOptionClick(option)}
              className={cn(
                'w-full text-left p-3 rounded-lg transition-colors',
                'hover:bg-accent group'
              )}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  <Icon className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
                <div className="flex-1">
                  <div className="font-medium text-sm">{option.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {option.description}
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
