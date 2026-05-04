// SchemaDesigner/ValidationQuerySelector.tsx
//
// Modal for picking the APIC query that backs a column's allowed values.
// Shows available validation queries with search and a live preview of the
// values that query would return, so the user can confirm the right query
// before assigning it to the column.

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Database,
  Search,
  ExternalLink,
  RefreshCw,
  Tag,
  User,
  Calendar,
  ChevronRight,
  X,
} from 'lucide-react'
import { queriesService, SavedQueryListItem } from '@/services/queries'
import { cn } from '@/lib/utils'
import { formatDate as formatDatePref } from '@/contexts/TimezoneContext'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ValidationQuerySelectorProps {
  queryId?: number | null
  onChange: (queryId: number | null) => void
  errorMessage?: string
  onErrorMessageChange?: (message: string) => void
  errorTitle?: string
  onErrorTitleChange?: (title: string) => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function creatorName(q: SavedQueryListItem) {
  const u = q.created_by
  const full = [u.first_name, u.last_name].filter(Boolean).join(' ')
  return full || u.username
}

function formatDate(iso: string) {
  return formatDatePref(iso)
}

// ── Selector Modal ────────────────────────────────────────────────────────────

function SelectorModal({
  currentId,
  open,
  onClose,
  onSelect,
}: {
  currentId: number | null
  open: boolean
  onClose: () => void
  onSelect: (q: SavedQueryListItem) => void
}) {
  const [queries, setQueries] = useState<SavedQueryListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [selected, setSelected] = useState<SavedQueryListItem | null>(null)

  // Load queries
  useEffect(() => {
    if (!open) return
    setLoading(true)
    queriesService.getValidationQueries({ page_size: 200 })
      .then(qRes => {
        setQueries(qRes.results)
        // Pre-select current
        if (currentId) {
          const cur = qRes.results.find(q => q.id === currentId)
          if (cur) setSelected(cur)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open])

  // Unique categories from loaded queries
  const categories = Array.from(
    new Set(queries.map(q => q.category_name).filter(Boolean))
  ) as string[]

  const filtered = queries.filter(q => {
    const matchSearch = !search ||
      q.name.toLowerCase().includes(search.toLowerCase()) ||
      q.description?.toLowerCase().includes(search.toLowerCase()) ||
      q.validation_description?.toLowerCase().includes(search.toLowerCase()) ||
      q.tags_list.some(t => t.toLowerCase().includes(search.toLowerCase()))
    const matchCat = categoryFilter === 'all' || q.category_name === categoryFilter
    return matchSearch && matchCat
  })

  const handleConfirm = () => {
    if (selected) {
      onSelect(selected)
      onClose()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            Select Validation Query
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Left: list */}
          <div className="w-1/2 border-r flex flex-col">
            {/* Filters */}
            <div className="p-3 border-b space-y-2 shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search…"
                  className="pl-9 h-8 text-sm"
                />
              </div>
              {categories.length > 0 && (
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All categories</SelectItem>
                    {categories.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Query list */}
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
                  <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                  Loading…
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground text-sm px-4">
                  <Database className="h-8 w-8 mb-2 opacity-30" />
                  {search ? 'No results for your search.' : 'No validation queries found.'}
                </div>
              ) : (
                filtered.map(q => (
                  <button
                    key={q.id}
                    onClick={() => setSelected(q)}
                    className={cn(
                      'w-full text-left px-4 py-3 border-b last:border-b-0 hover:bg-muted/50 transition-colors',
                      selected?.id === q.id && 'bg-primary/5 border-l-2 border-l-primary'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <Database className="h-3.5 w-3.5 text-primary shrink-0" />
                          <span className="font-medium text-sm truncate">{q.name}</span>
                        </div>
                        {(q.validation_description || q.description) && (
                          <p className="text-xs text-muted-foreground line-clamp-1 mb-1">
                            {q.validation_description || q.description}
                          </p>
                        )}
                        {q.validation_usage_count !== undefined && q.validation_usage_count > 0 && (
                          <div className="text-xs text-muted-foreground">
                            {q.validation_usage_count} template{q.validation_usage_count !== 1 ? 's' : ''}
                          </div>
                        )}
                      </div>
                      <ChevronRight className={cn(
                        'h-4 w-4 shrink-0 mt-0.5 text-muted-foreground transition-opacity',
                        selected?.id === q.id ? 'opacity-100' : 'opacity-0'
                      )} />
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="px-4 py-2 border-t text-xs text-muted-foreground shrink-0">
              {filtered.length} of {queries.length} quer{queries.length !== 1 ? 'ies' : 'y'}
            </div>
          </div>

          {/* Right: detail + preview */}
          <div className="w-1/2 flex flex-col overflow-hidden">
            {selected ? (
              <>
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {/* Query info */}
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Database className="h-4 w-4 text-primary" />
                      <span className="font-medium">{selected.name}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 ml-auto"
                        onClick={() => window.open(`/builder/${selected.id}`, '_blank')}
                        title="Open in Query Builder"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {(selected.validation_description || selected.description) && (
                      <p className="text-sm text-muted-foreground">
                        {selected.validation_description || selected.description}
                      </p>
                    )}
                  </div>

                  {/* Metadata */}
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    {selected.category_name && (
                      <div className="flex items-center gap-1.5">
                        <Tag className="h-3.5 w-3.5" />
                        {selected.category_name}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5" />
                      {creatorName(selected)}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" />
                      {formatDate(selected.created_at)}
                    </div>
                    {selected.validation_usage_count !== undefined && (
                      <div className="flex items-center gap-1.5">
                        <Database className="h-3.5 w-3.5" />
                        Used in {selected.validation_usage_count} template{selected.validation_usage_count !== 1 ? 's' : ''}
                      </div>
                    )}
                  </div>

                  {selected.tags_list.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {selected.tags_list.map(tag => (
                        <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
                      ))}
                    </div>
                  )}

                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center flex-1 text-center text-muted-foreground p-6">
                <ChevronRight className="h-8 w-8 mb-3 opacity-20" />
                <p className="text-sm">Select a query from the list</p>
                <p className="text-xs mt-1">to see details and preview values</p>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t shrink-0">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={!selected}>
            {selected ? `Select "${selected.name}"` : 'Select'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main Export Component ─────────────────────────────────────────────────────

export function ValidationQuerySelector({
  queryId,
  onChange,
  errorMessage = 'Value not found in query results',
  onErrorMessageChange,
  errorTitle = 'Invalid Value',
  onErrorTitleChange,
}: ValidationQuerySelectorProps) {
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedQuery, setSelectedQuery] = useState<SavedQueryListItem | null>(null)
  const [loadingSelected, setLoadingSelected] = useState(false)

  // Load the currently-selected query's name for display
  useEffect(() => {
    if (!queryId) {
      setSelectedQuery(null)
      return
    }
    setLoadingSelected(true)
    queriesService.getSavedQuery(queryId)
      .then(q => setSelectedQuery(q as unknown as SavedQueryListItem))
      .catch(() => setSelectedQuery(null))
      .finally(() => setLoadingSelected(false))
  }, [queryId])

  const handleSelect = (q: SavedQueryListItem) => {
    setSelectedQuery(q)
    onChange(q.id)
    // Auto-fill error fields from query defaults if empty
    if (q.validation_error_title && !errorTitle) {
      onErrorTitleChange?.(q.validation_error_title)
    }
    if (q.validation_error_message && !errorMessage) {
      onErrorMessageChange?.(q.validation_error_message)
    }
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    setSelectedQuery(null)
    onChange(null)
  }

  return (
    <div className="space-y-3">
      {/* Query selection trigger — prominently at top */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            Validation Query
          </Label>
          {selectedQuery && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => window.open(`/builder/${selectedQuery.id}`, '_blank')}
            >
              <ExternalLink className="h-4 w-4 mr-1" />
              Open
            </Button>
          )}
        </div>

        <div
          className={cn(
            'w-full flex items-center gap-3 border rounded-lg px-3 py-3 transition-colors',
            selectedQuery ? 'border-primary/40 bg-primary/5' : 'border-dashed border-input bg-background'
          )}
        >
          {loadingSelected ? (
            <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : selectedQuery ? (
            <>
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="flex-1 flex items-center gap-3 min-w-0 text-left hover:opacity-80 transition-opacity"
              >
                <div className="p-1.5 rounded bg-primary/10">
                  <Database className="h-3.5 w-3.5 text-primary shrink-0" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{selectedQuery.name}</div>
                  {selectedQuery.validation_description && (
                    <div className="text-xs text-muted-foreground truncate">{selectedQuery.validation_description}</div>
                  )}
                </div>
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="shrink-0 rounded p-0.5 hover:bg-destructive/10 hover:text-destructive transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="flex-1 flex items-center gap-3 text-left hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            >
              <Search className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-sm text-muted-foreground">Click to search and select a validation query…</span>
            </button>
          )}
        </div>
      </div>

      {/* Error config — red section at bottom */}
      {(onErrorTitleChange || onErrorMessageChange) && (
        <div className="rounded-lg border border-red-200 bg-red-50/50 dark:border-red-900/50 dark:bg-red-950/20 p-3 space-y-3">
          <p className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase tracking-wide">
            Validation Failure Feedback
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="query-error-title" className="text-xs text-red-600 dark:text-red-400">
              Error Title <span className="text-muted-foreground font-normal">(shown on hover)</span>
            </Label>
            <Input
              id="query-error-title"
              value={errorTitle}
              onChange={e => onErrorTitleChange?.(e.target.value)}
              placeholder="e.g. Invalid Tenant"
              maxLength={100}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="query-error-message" className="text-xs text-red-600 dark:text-red-400">
              Error Message <span className="text-muted-foreground font-normal">(shown in detail panel)</span>
            </Label>
            <Textarea
              id="query-error-message"
              value={errorMessage}
              onChange={e => onErrorMessageChange?.(e.target.value)}
              placeholder="e.g. Tenant name not found in the system"
              maxLength={500}
              rows={2}
              className="text-sm resize-none"
            />
          </div>
        </div>
      )}

      <SelectorModal
        currentId={queryId ?? null}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSelect={handleSelect}
      />
    </div>
  )
}
