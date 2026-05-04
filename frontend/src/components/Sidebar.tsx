// Sidebar.tsx
//
// Left sidebar for the Query Builder — shows available ACI class nodes grouped
// by package, with search and a toggle to show/hide rarely used classes.
// Dragging a class from the sidebar onto the canvas creates a ClassNode.

import { useState, useCallback, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, Database, Filter, Code2, FileJson, Loader2, Package, Eye, EyeOff } from 'lucide-react'
import { NodeType, EnhancedMIMClass } from '@/types'
import { mimApi } from '@/lib/api'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import { cn } from '@/lib/utils'

const utilityNodes = [
  {
    type: NodeType.FILTER,
    label: 'Filter',
    icon: Filter,
    description: 'Filter query results',
  },
  {
    type: NodeType.POST_PROCESSOR,
    label: 'Post Processor',
    icon: Code2,
    description: 'Process and transform',
  },
  {
    type: NodeType.OUTPUT,
    label: 'Output',
    icon: FileJson,
    description: 'Define output format',
  },
]

const PACKAGE_CHIPS = ['fv', 'vz', 'l3ext', 'infra', 'fabric', 'phys']

export function Sidebar() {
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [packageFilter, setPackageFilter] = useState<string | null>(null)
  // Subscribe to a derived boolean rather than the full nodes array — that way
  // Sidebar doesn't re-render on every drag-position update (60Hz), only when
  // a class node is actually added or removed.
  const hasClassNode = useQueryBuilderStore(
    (s) => s.nodes.some((node) => node.type === NodeType.CLASS)
  )

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Reset package filter when search is cleared
  useEffect(() => {
    if (!debouncedQuery || debouncedQuery.length < 2) {
      setPackageFilter(null)
    }
  }, [debouncedQuery])

  const { data: classes, isLoading } = useQuery({
    queryKey: ['mim-classes-search', debouncedQuery, packageFilter],
    queryFn: () => debouncedQuery.length >= 2
      ? mimApi.enhancedSearchClasses(debouncedQuery, 50, packageFilter || undefined)
      : mimApi.getClasses(50),
    enabled: true,
  })

  const onDragStart = useCallback((event: React.DragEvent, nodeType: string, className?: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType)
    if (className) {
      event.dataTransfer.setData('className', className)
    }
    event.dataTransfer.effectAllowed = 'move'
  }, [])

  const getMatchLabel = (method?: string) => {
    switch (method) {
      case 'exact': return 'exact'
      case 'prefix': return 'prefix'
      case 'label': return 'label'
      case 'fulltext': return 'fuzzy'
      case 'description': return 'desc'
      default: return null
    }
  }

  if (isCollapsed) {
    return (
      <div className="w-12 border-r border-border/50 glass-strong flex flex-col items-center py-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsCollapsed(false)}
          title="Show Sidebar"
          className="text-foreground hover:bg-muted/50 transition-all"
        >
          <Eye className="w-5 h-5" />
        </Button>
      </div>
    )
  }

  return (
    <div className="w-72 border-r border-border/50 glass-strong overflow-y-auto flex flex-col">
      <div className="p-4 border-b border-border/50 flex-shrink-0 flex items-center justify-between">
        <div className="flex-1">
          <h2 className="font-bold text-lg text-foreground">Query Builder</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Search and drag to canvas
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsCollapsed(true)}
          className="h-7 w-7 text-foreground hover:bg-muted/50 transition-all"
          title="Hide Sidebar"
        >
          <EyeOff className="w-4 h-4" />
        </Button>
      </div>

      {/* Class Search Section */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-3">
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              ACI Classes
            </h3>
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
              <Input
                type="text"
                placeholder="Search classes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 text-sm glass border-border text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all"
              />
            </div>

            {/* Result count */}
            {debouncedQuery.length >= 2 && !isLoading && classes && (
              <p className="text-xs text-muted-foreground mt-1.5 px-0.5">
                {classes.length >= 50 ? '50+ results' : `${classes.length} result${classes.length !== 1 ? 's' : ''}`}
              </p>
            )}

            {/* Package filter chips */}
            {debouncedQuery.length >= 2 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {PACKAGE_CHIPS.map((pkg) => (
                  <button
                    key={pkg}
                    onClick={() => setPackageFilter(packageFilter === pkg ? null : pkg)}
                    className={cn(
                      'px-2 py-0.5 rounded-full text-xs font-medium transition-colors border',
                      packageFilter === pkg
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted/50 text-muted-foreground border-transparent hover:bg-muted'
                    )}
                  >
                    {pkg}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Class Results - Premium Glass Cards */}
          <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
              </div>
            ) : classes && classes.length > 0 ? (
              classes.map((cls) => {
                const enhanced = cls as EnhancedMIMClass
                const matchLabel = debouncedQuery.length >= 2 ? getMatchLabel(enhanced.searchMethod) : null

                return (
                  <div
                    key={cls.className}
                    draggable
                    onDragStart={(e) => onDragStart(e, NodeType.CLASS, cls.className)}
                    className="group p-3 rounded-xl border border-border glass hover:bg-muted/30 hover:border-primary/50 cursor-move transition-all duration-200 hover-lift"
                  >
                    <div className="flex items-start gap-2.5">
                      <Database className="w-4 h-4 text-primary flex-shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-foreground leading-tight">
                          {cls.label || cls.className}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-muted-foreground font-mono">
                            {cls.className}
                          </span>
                          {matchLabel && (
                            <span className="text-[10px] text-primary/60 font-medium">
                              {matchLabel}
                            </span>
                          )}
                        </div>
                        {cls.classPkg && (
                          <div className="flex items-center gap-1 mt-1">
                            <Package className="w-3 h-3 text-muted-foreground" />
                            <span className="text-[10px] text-muted-foreground">{cls.classPkg}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })
            ) : searchQuery.length >= 2 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                No classes found
              </div>
            ) : (
              <div className="text-center py-8 text-sm text-muted-foreground">
                Type to search classes
              </div>
            )}
          </div>
        </div>

        {/* Utility Nodes - Premium Glass with Dashed Borders */}
        <div className="p-4 border-t border-border/50 space-y-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Utilities
          </h3>
          <div className="space-y-1.5">
            {utilityNodes.map((node) => {
              const Icon = node.icon
              // Filter and PostProcessor require a Class node
              const requiresClass = node.type === NodeType.FILTER || node.type === NodeType.POST_PROCESSOR
              const isDisabled = requiresClass && !hasClassNode

              return (
                <div
                  key={node.type}
                  draggable={!isDisabled}
                  onDragStart={(e) => !isDisabled && onDragStart(e, node.type)}
                  className={`group p-3 rounded-xl border border-dashed transition-all duration-200 ${
                    isDisabled
                      ? 'border-border/50 glass opacity-40 cursor-not-allowed'
                      : 'border-border glass hover:bg-muted/30 hover:border-primary/50 cursor-move hover-lift'
                  }`}
                  title={isDisabled ? 'Add a Class node first' : undefined}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className={`w-4 h-4 flex-shrink-0 transition-all ${
                      isDisabled ? 'text-muted-foreground' : 'text-muted-foreground group-hover:text-primary group-hover:scale-110'
                    }`} />
                    <div className="flex-1">
                      <div className={`font-medium text-sm ${isDisabled ? 'text-muted-foreground' : 'text-foreground'}`}>
                        {node.label}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {isDisabled ? 'Requires Class node' : node.description}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
