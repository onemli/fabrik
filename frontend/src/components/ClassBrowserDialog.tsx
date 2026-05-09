// ClassBrowserDialog.tsx
//
// Modal dialog for browsing and picking ACI classes from the MIM graph.
// Shows a searchable tree on the left, class details (properties + relationships)
// on the right, and a confirm button that drops the chosen class onto the canvas.

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  Search, Star, X, ChevronRight, BookOpen,
  Sparkles, Loader2, MessageSquare, Check, Eye, EyeOff,
  Anchor, TrendingUp, History, Compass,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PackageCombobox } from '@/components/ui/PackageCombobox'
import { mimApi } from '@/lib/api'
import { classHistory } from '@/services/classHistory'
import { useFavorites } from '@/hooks/useFavorites'
import { useRecent } from '@/hooks/useRecent'
import {
  loadFilterFlags,
  saveFilterFlags,
  type ClassFilterFlags,
} from '@/lib/classFilters'
import { cn } from '@/lib/utils'
import type { MIMClass, MIMClassFullDetail, EnhancedMIMClass } from '@/types'
import { ClassDetailPanel } from './class-browser/ClassDetailPanel'

// ─── Helper UI components ──────────────────────────────────────────────────

const SEARCH_METHOD_LABELS: Record<string, string> = {
  exact: 'exact',
  prefix: 'prefix',
  contains: 'sub',
  label: 'label',
  description: 'desc',
  fulltext: 'fuzzy',
  note: 'note',
  dn: 'dn',
  property: 'prop',
}

function SearchMethodChip({ method }: { method?: EnhancedMIMClass['searchMethod'] }) {
  if (!method || method === 'exact' || method === 'prefix') return null
  const label = SEARCH_METHOD_LABELS[method] || method
  return (
    <span className="text-[10px] font-mono px-1.5 py-0 rounded bg-muted text-muted-foreground shrink-0 uppercase tracking-wide">
      {label}
    </span>
  )
}

function ClassMetaBadges({ cls }: { cls: MIMClass & Partial<EnhancedMIMClass> }) {
  const badges: React.ReactNode[] = []
  if (cls.isDeprecated) badges.push(<MetaBadge key="dep" tone="red" label="deprecated" />)
  if (cls.isAbstract) badges.push(<MetaBadge key="abs" tone="amber" label="abstract" />)
  // Root context anchors get an icon-only badge — "ROOT" text is too loud
  // next to compact class names. Anchor evokes "the fixed point everything
  // descends from", which matches the MIM containment semantics.
  if (cls.isContextRoot) badges.push(
    <MetaBadge key="root" tone="blue" icon={<Anchor className="w-3 h-3" />} title="Context root" />
  )
  if (cls.isHidden) badges.push(<MetaBadge key="hid" tone="gray" label="hidden" />)
  if (badges.length === 0) return null
  return <span className="flex items-center gap-1 shrink-0">{badges}</span>
}

function RefTargetItem({ ref, isSelected, onHover, onClick }: {
  ref: { className: string; label: string; classPkg: string; via: string }
  isSelected: boolean
  onHover: (cls: MIMClass | null) => void
  onClick: (cls: MIMClass) => void
}) {
  const cls: MIMClass = {
    className: ref.className,
    label: ref.label,
    classPkg: ref.classPkg,
    rnFormat: '',
    isContextRoot: false,
    isConfigurable: true,
  }
  return (
    <div
      className={cn(
        'flex items-start gap-2 px-3 py-2 cursor-pointer transition-colors group',
        'border-l-2 border-amber-400/40',
        isSelected ? 'bg-amber-500/10' : 'hover:bg-amber-500/5',
      )}
      onMouseEnter={() => onHover(cls)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onClick(cls)}
      title={`Referenced via ${ref.via} — not a direct child`}
    >
      <div className="flex-1 min-w-0">
        <div className="font-mono text-sm font-medium truncate">{ref.className}</div>
        {ref.label && ref.label !== ref.className && (
          <div className="text-xs text-muted-foreground truncate">{ref.label}</div>
        )}
        <div className="text-[10px] text-amber-600/80 font-mono mt-0.5">via {ref.via}</div>
      </div>
      {ref.classPkg && (
        <Badge variant="outline" className="text-xs px-1.5 py-0 h-4 shrink-0 font-mono">
          {ref.classPkg}
        </Badge>
      )}
    </div>
  )
}

function FilterChip({ active, label, onToggle, hint, variant = 'check' }: {
  active: boolean
  label: string
  onToggle: () => void
  hint?: string
  /** 'eye' uses Eye/EyeOff to mean "category visible / hidden". 'check' uses
   * a checkmark to mean "rule applied / not applied". Hide-rule chips use
   * 'eye' so the icon mirrors the user's intuition: closed eye = hidden,
   * open eye = visible. Visual brightness follows the eye, not the rule:
   * open eye = bright (category alive), closed eye = dim (category hidden). */
  variant?: 'check' | 'eye'
}) {
  const Icon = variant === 'eye'
    ? (active ? EyeOff : Eye)
    : null
  // For eye-variant chips, brightness tracks visibility, not rule-active.
  // For check-variant chips, brightness tracks rule-active (legacy behavior).
  const showAsBright = variant === 'eye' ? !active : active
  return (
    <button
      type="button"
      onClick={onToggle}
      title={hint}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] transition-colors',
        showAsBright
          ? 'bg-primary/10 border-primary/30 text-primary'
          : 'bg-transparent border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground/80',
      )}
    >
      {variant === 'eye' && Icon && <Icon className="w-3 h-3" />}
      {variant === 'check' && active && <span aria-hidden>✓</span>}
      <span>{label}</span>
    </button>
  )
}

/** Pill-style metadata badge. Renders either a text label or an icon —
 * icon mode is preferred for high-frequency badges (root) where the
 * label would visually crowd the class name; text mode is used for
 * states (deprecated/abstract/hidden) that need a literal word. */
function MetaBadge({
  tone,
  label,
  icon,
  title,
}: {
  tone: 'red' | 'amber' | 'blue' | 'gray'
  label?: string
  icon?: React.ReactNode
  title?: string
}) {
  const toneClass = {
    red: 'bg-red-500/12 text-red-500',
    amber: 'bg-amber-500/12 text-amber-500',
    blue: 'bg-blue-500/12 text-blue-500',
    gray: 'bg-muted text-muted-foreground',
  }[tone]
  const iconOnly = !!icon && !label
  return (
    <span
      title={title ?? label}
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium tracking-wide leading-none',
        iconOnly ? 'h-4 w-4 justify-center' : 'text-[9px] uppercase px-1.5 h-4',
        toneClass,
      )}
    >
      {icon}
      {label}
    </span>
  )
}


interface ClassBrowserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  parentClass?: string | null
  onSelect: (className: string, classInfo?: MIMClass) => void
}

export function ClassBrowserDialog({
  open,
  onOpenChange,
  parentClass,
  onSelect,
}: ClassBrowserDialogProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  const [packageFilter, setPackageFilter] = useState('__all__')
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)
  const [filterFlags, setFilterFlagsState] = useState<ClassFilterFlags>(() => loadFilterFlags())
  // Faz 2.2 — search target. 'class' (default) hits enhanced search;
  // 'property' hits classes-by-property. Disabled in parentClass (child) mode
  // because that flow already constrains by CONTAINS hierarchy.
  const [searchMode, setSearchMode] = useState<'class' | 'property'>('class')
  // Faz 3.1 — show classes referenced via Rs* relations (read-only).
  // Default OFF so the existing CONTAINS-only contract is preserved.
  const [showRefTargets, setShowRefTargets] = useState(false)

  const updateFilterFlag = useCallback((key: keyof ClassFilterFlags) => {
    setFilterFlagsState((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      saveFilterFlags(next)
      return next
    })
  }, [])
  const [hoveredClass, setHoveredClass] = useState<MIMClass | null>(null)
  const [selectedClass, setSelectedClass] = useState<MIMClass | null>(null)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  // Navigation stack for child class browsing in the detail panel
  const [detailNavStack, setDetailNavStack] = useState<MIMClass[]>([])

  // AI suggestion state
  const [showAiInput, setShowAiInput] = useState(false)
  const [aiInput, setAiInput] = useState('')
  const [aiSuggestions, setAiSuggestions] = useState<MIMClass[]>([])
  const [isAiLoading, setIsAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const aiInputRef = useRef<HTMLInputElement>(null)

  const searchInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const { favorites, isFavorite, addFavorite, removeFavorite, updateNote } = useFavorites()
  const { recent: recentBackend, addRecent: addRecentBackend, isOffline: recentOffline } = useRecent(10)

  // Pending favorite: star clicked on non-favorited class → show note input before confirming
  const [pendingFavorite, setPendingFavorite] = useState<{ className: string; classInfo?: MIMClass } | null>(null)
  const [pendingNoteText, setPendingNoteText] = useState('')
  // Inline note editor for existing favorites
  const [editingNoteClass, setEditingNoteClass] = useState<string | null>(null)
  const [editingNoteText, setEditingNoteText] = useState('')

  // Debounce search query to avoid hitting Neo4j on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchQuery(searchQuery), 250)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Reset all state when dialog opens
  useEffect(() => {
    if (open) {
      setSearchQuery('')
      setDebouncedSearchQuery('')
      setPackageFilter('__all__')
      setShowFavoritesOnly(false)
      setSearchMode('class')
      setShowRefTargets(false)
      setHoveredClass(null)
      setSelectedClass(null)
      setFocusedIndex(-1)
      setDetailNavStack([])
      setShowAiInput(false)
      setAiInput('')
      setAiSuggestions([])
      setAiError(null)
      setPendingFavorite(null)
      setPendingNoteText('')
      setEditingNoteClass(null)
      setEditingNoteText('')
      setTimeout(() => searchInputRef.current?.focus(), 50)
    }
  }, [open])

  // Focus the AI input when it opens
  useEffect(() => {
    if (showAiInput) setTimeout(() => aiInputRef.current?.focus(), 50)
  }, [showAiInput])

  // ─── Queries ──────────────────────────────────────────────────────────────

  // Treat the gap between a keystroke and the debounced query firing as loading,
  // so the search panel doesn't flash "No classes found" before the fetch starts.
  const isDebouncing = searchQuery !== debouncedSearchQuery

  // Faz 2.1 — allow searches when either:
  //   • the user typed at least 1 char (was 2; lowered for power-user discovery)
  //   • OR a non-default package filter is selected (browse mode — list pkg)
  const hasPackageScope = !parentClass && packageFilter !== '__all__'
  const searchEnabled =
    open && (debouncedSearchQuery.length >= 1 || hasPackageScope || !!parentClass)

  const effectiveSearchMode: 'class' | 'property' = parentClass ? 'class' : searchMode

  const { data: searchResults, isLoading: isFetching } = useQuery({
    queryKey: [
      'classBrowserSearch',
      debouncedSearchQuery,
      packageFilter,
      parentClass,
      filterFlags,
      effectiveSearchMode,
    ],
    queryFn: async () => {
      const pkgFilter = packageFilter === '__all__' ? undefined : packageFilter
      if (parentClass) {
        return mimApi.searchChildClasses(parentClass, debouncedSearchQuery, 100) as Promise<EnhancedMIMClass[]>
      }
      if (effectiveSearchMode === 'property' && debouncedSearchQuery.length >= 2) {
        return mimApi.searchByProperty(debouncedSearchQuery, 50, pkgFilter, {
          excludeDeprecated: filterFlags.hideDeprecated,
          excludeAbstract: filterFlags.hideAbstract,
          excludeHidden: filterFlags.hideHidden,
          excludeMonitoring: filterFlags.hideMonitoring,
        })
      }
      return mimApi.enhancedSearchClasses(
        debouncedSearchQuery,
        debouncedSearchQuery.length === 0 ? 200 : 50,
        pkgFilter,
        {
          excludeDeprecated: filterFlags.hideDeprecated,
          excludeAbstract: filterFlags.hideAbstract,
          excludeHidden: filterFlags.hideHidden,
          excludeMonitoring: filterFlags.hideMonitoring,
        },
      )
    },
    enabled:
      searchEnabled &&
      (effectiveSearchMode === 'class' || debouncedSearchQuery.length >= 2),
    staleTime: 30_000,
  })

  const isSearchLoading = isFetching || (isDebouncing && searchQuery.length >= 1)

  // Fetch full class detail when user clicks (not just hovers) a class
  const { data: classDetail, isLoading: isDetailLoading } = useQuery({
    queryKey: ['classBrowserDetail', selectedClass?.className],
    queryFn: () => mimApi.getClassDetail(selectedClass!.className),
    enabled: !!selectedClass,
    staleTime: 24 * 60 * 60 * 1000, // MIM is static — cache aggressively
    gcTime: 7 * 24 * 60 * 60 * 1000,
  })

  // Faz 3.2 — context roots for the empty default-mode landing.
  const { data: contextRoots = [] } = useQuery({
    queryKey: ['contextRoots'],
    queryFn: () => mimApi.getContextRoots(),
    staleTime: 60 * 60 * 1000, // MIM is static
    enabled: open && !parentClass,
  })

  // Faz 3.4 — org-wide trending classes (root mode landing).
  const { data: trendingClasses = [] } = useQuery({
    queryKey: ['trendingClasses'],
    queryFn: () => mimApi.getTrendingClasses(10, 30),
    staleTime: 60 * 60 * 1000, // 1 hour
    enabled: open && !parentClass,
  })

  // Faz 3.2 — smart children for parent mode landing (no search yet).
  const { data: smartChildrenData } = useQuery({
    queryKey: ['classInsights', parentClass],
    queryFn: () => (parentClass ? mimApi.getClassInsights(parentClass) : null),
    staleTime: 60 * 60 * 1000,
    enabled: open && !!parentClass,
  })

  // Faz 3.1 — fetch parent's full detail when reference-targets toggle is ON.
  // We reuse getClassDetail (already cached for selected classes elsewhere).
  const { data: parentDetail } = useQuery({
    queryKey: ['parentClassDetail', parentClass],
    queryFn: () => mimApi.getClassDetail(parentClass as string),
    enabled: open && !!parentClass && showRefTargets,
    staleTime: 24 * 60 * 60 * 1000,
  })

  // In child mode, fetch the full set of valid child classes for the parent
  // so we can filter the user's favorites/recent lists to only show entries
  // that actually are children of this parent. MIM is static — cache aggressively.
  const { data: validChildList } = useQuery({
    queryKey: ['validChildClasses', parentClass],
    queryFn: () => mimApi.searchChildClasses(parentClass as string, '', 500),
    enabled: open && !!parentClass,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 7 * 24 * 60 * 60 * 1000,
  })

  const validChildrenSet = useMemo<Set<string> | null>(() => {
    if (!parentClass) return null
    if (!validChildList) return null
    return new Set(validChildList.map((c: { className: string }) => c.className))
  }, [parentClass, validChildList])

  // ─── Derived data ─────────────────────────────────────────────────────────

  // Merge note-matched favorites into Neo4j search results.
  // Favorites are already cached client-side — no extra API call needed.
  const enrichedResults = useMemo<EnhancedMIMClass[]>(() => {
    if (!searchResults || searchQuery.length < 1) return searchResults || []

    const query = searchQuery.toLowerCase()

    // Find favorites whose notes match the search query but aren't already in Neo4j results
    const noteMatches = favorites
      .filter((f) => f.note && f.note.toLowerCase().includes(query))
      .filter((f) => !searchResults.some((r) => r.className === f.class_name))
      .map((f): EnhancedMIMClass => ({
        className: f.class_name,
        label: f.label,
        classPkg: f.class_pkg,
        rnFormat: '',
        isContextRoot: false,
        isConfigurable: true,
        relevance: 200,
        searchMethod: 'note',
      }))

    return [...noteMatches, ...searchResults]
  }, [searchResults, searchQuery, favorites])

  // Recent: prefer backend (cross-device), fall back to localStorage when
  // the recent endpoint is unreachable so the dialog stays useful offline.
  const recentClasses = useMemo(() => {
    if (recentBackend.length > 0 || !recentOffline) {
      return recentBackend.map((e) => ({
        className: e.class_name,
        label: e.label || e.class_name,
        classPkg: e.class_pkg || '',
      }))
    }
    return classHistory.getRecent(10).map((e) => ({
      className: e.className,
      label: e.label,
      classPkg: e.classPkg,
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentBackend, recentOffline, open, searchQuery])

  const favoriteClasses = useMemo<MIMClass[]>(
    () =>
      favorites.map((f) => ({
        className: f.class_name,
        label: f.label,
        classPkg: f.class_pkg,
        rnFormat: '',
        isContextRoot: false,
        isConfigurable: true,
      })),
    [favorites]
  )

  const recentAsMIM = useMemo<MIMClass[]>(
    () =>
      recentClasses.map((item) => ({
        className: item.className,
        label: item.label,
        classPkg: item.classPkg,
        rnFormat: '',
        isContextRoot: false,
        isConfigurable: true,
      })),
    [recentClasses]
  )

  // In child mode, filter favorites/recent to only entries that are actual
  // children of `parentClass`. Prevents invalid selections (e.g. adding the
  // parent class itself or an unrelated class as a child). Returns [] while
  // the child set is still loading so stale cross-parent matches never leak.
  const displayFavorites = useMemo<MIMClass[]>(() => {
    if (!parentClass) return favoriteClasses
    if (!validChildrenSet) return []
    return favoriteClasses.filter(
      (c) => c.className !== parentClass && validChildrenSet.has(c.className),
    )
  }, [favoriteClasses, parentClass, validChildrenSet])

  const displayRecent = useMemo<MIMClass[]>(() => {
    if (!parentClass) return recentAsMIM
    if (!validChildrenSet) return []
    return recentAsMIM.filter(
      (c) => c.className !== parentClass && validChildrenSet.has(c.className),
    )
  }, [recentAsMIM, parentClass, validChildrenSet])

  // 'search' covers both real text searches and pure package-browse mode
  // (empty query + selected package), so the right pane shows results
  // instead of the favorites/recent landing.
  const mode: 'favonly' | 'search' | 'default' = showFavoritesOnly
    ? 'favonly'
    : searchQuery.length >= 1 || hasPackageScope
    ? 'search'
    : 'default'

  // Flat list for keyboard navigation
  const flatList = useMemo<MIMClass[]>(() => {
    if (mode === 'favonly') return displayFavorites
    if (mode === 'search') return enrichedResults as MIMClass[]
    return [...displayFavorites, ...displayRecent]
  }, [mode, displayFavorites, enrichedResults, displayRecent])

  // Right panel shows hoveredClass (preview) or selectedClass (locked)
  const activeClass = hoveredClass || selectedClass

  // Faz 3.1 — set of class names that are reference targets only.
  // We block confirmation for these so the user is forced to use the
  // reference's source class instead (correct query semantics).
  const referenceTargetSet = useMemo<Set<string>>(() => {
    if (!parentClass || !showRefTargets || !parentDetail?.relationsTo) return new Set()
    return new Set(parentDetail.relationsTo.map((r) => r.className))
  }, [parentClass, showRefTargets, parentDetail])

  // Footer confirm target — exclude parentClass itself in child mode and
  // exclude reference-target-only classes (they cannot be added directly).
  const rawConfirm: MIMClass | null =
    selectedClass ||
    (focusedIndex >= 0 && focusedIndex < flatList.length ? flatList[focusedIndex] : null)
  const isReferenceTargetOnly =
    !!rawConfirm && referenceTargetSet.has(rawConfirm.className) &&
    !validChildrenSet?.has(rawConfirm.className)
  const confirmClass =
    rawConfirm?.className === parentClass || isReferenceTargetOnly ? null : rawConfirm

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleAiSuggest = async () => {
    const query = aiInput.trim()
    if (!query || isAiLoading) return
    setIsAiLoading(true)
    setAiError(null)
    setAiSuggestions([])
    try {
      const results = await mimApi.suggestClasses(query, parentClass || undefined)
      setAiSuggestions(results)
      if (results.length === 0) setAiError('No matching classes found. Try a different description.')
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'AI suggestion failed. Is AI configured?'
      setAiError(msg)
    } finally {
      setIsAiLoading(false)
    }
  }

  const dismissAi = () => {
    setShowAiInput(false)
    setAiInput('')
    setAiSuggestions([])
    setAiError(null)
  }

  // Handle star click: remove immediately, add with pending note input
  const handleStarClick = (className: string, classInfo?: MIMClass) => {
    if (isFavorite(className)) {
      removeFavorite(className)
    } else {
      setPendingFavorite({ className, classInfo })
      setPendingNoteText('')
    }
  }

  const confirmPendingFavorite = () => {
    if (!pendingFavorite) return
    addFavorite(pendingFavorite.className, pendingFavorite.classInfo, pendingNoteText.trim() || undefined)
    setPendingFavorite(null)
    setPendingNoteText('')
  }

  const cancelPendingFavorite = () => {
    setPendingFavorite(null)
    setPendingNoteText('')
  }

  const startEditingNote = (className: string) => {
    const fav = favorites.find((f) => f.class_name === className)
    setEditingNoteClass(className)
    setEditingNoteText(fav?.note || '')
  }

  const confirmEditNote = () => {
    if (editingNoteClass) {
      updateNote(editingNoteClass, editingNoteText.trim())
      setEditingNoteClass(null)
      setEditingNoteText('')
    }
  }

  const handleClassClick = (cls: MIMClass) => {
    setSelectedClass(cls)
    setHoveredClass(null)
    setDetailNavStack([]) // Reset navigation when picking from left panel
  }

  const handleClassDoubleClick = (cls: MIMClass) => {
    addRecentBackend(cls.className, cls)
    onSelect(cls.className, cls)
    onOpenChange(false)
  }

  const handleConfirmSelect = () => {
    if (!confirmClass) return
    addRecentBackend(confirmClass.className, confirmClass)
    onSelect(confirmClass.className, confirmClass)
    onOpenChange(false)
  }

  // Navigate to a child class from the detail panel
  const handleNavigateToChild = useCallback(
    (cls: MIMClass) => {
      if (selectedClass) {
        setDetailNavStack((prev) => [...prev, selectedClass])
      }
      setSelectedClass(cls)
      setHoveredClass(null)
    },
    [selectedClass]
  )

  const handleNavigateBack = useCallback(() => {
    const prev = detailNavStack[detailNavStack.length - 1]
    if (prev) {
      setDetailNavStack((stack) => stack.slice(0, -1))
      setSelectedClass(prev)
      setHoveredClass(null)
    }
  }, [detailNavStack])

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll<HTMLElement>('[data-list-item]')
      items[focusedIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [focusedIndex])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusedIndex((prev) => Math.min(prev + 1, flatList.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedIndex((prev) => Math.max(prev - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const cls =
          focusedIndex >= 0 && focusedIndex < flatList.length
            ? flatList[focusedIndex]
            : selectedClass
        if (cls) {
          addRecentBackend(cls.className, cls)
          onSelect(cls.className, cls)
          onOpenChange(false)
        }
      }
    },
    [flatList, focusedIndex, selectedClass, onSelect, onOpenChange, addRecentBackend]
  )

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-6xl h-[88vh] flex flex-col p-0 gap-0"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <DialogHeader className="flex-none px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <DialogTitle className="text-lg font-semibold">
              {parentClass ? 'Select Child Class' : 'Select Class'}
            </DialogTitle>
            {parentClass && (
              <Badge
                variant="outline"
                className="bg-amber-500/10 text-amber-600 border-amber-500/30 font-mono text-xs"
              >
                Child of: {parentClass}
              </Badge>
            )}
          </div>
        </DialogHeader>

        {/* Search Bar */}
        <div className="flex-none px-6 py-3 border-b border-border bg-muted/20 space-y-2">
          {/* Faz 2.2 — Class | Property tabs (hidden in child mode) */}
          {!parentClass && (
            <div className="flex gap-1 text-xs">
              <button
                onClick={() => setSearchMode('class')}
                className={cn(
                  'px-3 py-1 rounded-t border-b-2 transition-colors font-medium',
                  searchMode === 'class'
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                By class
              </button>
              <button
                onClick={() => setSearchMode('property')}
                className={cn(
                  'px-3 py-1 rounded-t border-b-2 transition-colors font-medium',
                  searchMode === 'property'
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
                title="Find classes that own a specific property (e.g. encap, mac, dn)"
              >
                By property
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                ref={searchInputRef}
                placeholder={
                  parentClass
                    ? `Search child classes of ${parentClass}...`
                    : effectiveSearchMode === 'property'
                    ? 'Property name… e.g. encap, mac, dn'
                    : 'Search 17,500+ classes...'
                }
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setFocusedIndex(-1)
                }}
                className="pl-9 h-9 font-mono text-sm"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* AI suggest toggle */}
            <button
              onClick={() => setShowAiInput(v => !v)}
              title="Describe what you're looking for (AI-powered)"
              className={cn(
                'h-9 w-9 flex items-center justify-center rounded border-2 transition-colors flex-shrink-0',
                showAiInput
                  ? 'border-violet-500 bg-violet-500/10 text-violet-500'
                  : 'border-border text-muted-foreground hover:border-violet-400 hover:text-violet-400'
              )}
            >
              <Sparkles className="w-4 h-4" />
            </button>

            <PackageCombobox
              value={packageFilter}
              onValueChange={setPackageFilter}
              triggerClassName="w-44 h-9 text-sm"
            />

            <Button
              variant={showFavoritesOnly ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setShowFavoritesOnly(!showFavoritesOnly)
                setFocusedIndex(-1)
              }}
              className="h-9 px-3 gap-1.5"
            >
              <Star className={cn('w-4 h-4', showFavoritesOnly && 'fill-current')} />
              <span className="text-xs">Favs</span>
              {favorites.length > 0 && (
                <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4">
                  {favorites.length}
                </Badge>
              )}
            </Button>
          </div>

          {/* AI Input Row */}
          {showAiInput && (
            <div className="flex gap-2 mt-2">
              <Input
                ref={aiInputRef}
                placeholder="Describe what you're looking for… e.g. BGP peers, bridge domains"
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAiSuggest() }}
                className="flex-1 h-9 text-sm border-2 border-violet-400/60 focus:ring-0 focus:ring-offset-0"
              />
              <button
                onClick={handleAiSuggest}
                disabled={isAiLoading || !aiInput.trim()}
                className="h-9 px-3 flex items-center gap-1.5 rounded border-2 border-violet-400/60 bg-violet-500/10
                  text-violet-500 text-sm font-medium disabled:opacity-40 hover:bg-violet-500/20 transition-colors flex-shrink-0"
              >
                {isAiLoading
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Sparkles className="w-3.5 h-3.5" />
                }
                Suggest
              </button>
              <button
                onClick={dismissAi}
                className="h-9 w-9 flex items-center justify-center rounded border-2 border-border text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Faz 3.1 — reference-targets toggle (parent/child mode only) */}
          {parentClass && (
            <div className="flex items-center gap-2 mt-2 text-xs">
              <FilterChip
                active={showRefTargets}
                label="reference targets (read-only)"
                onToggle={() => setShowRefTargets((v) => !v)}
                hint="Show classes referenced from the parent via Rs* relations. They cannot be added directly — use the source class with reference filters instead."
              />
            </div>
          )}

          {/* Filter chips — default ON; click to show that category.
              Eye icon mirrors state: closed (EyeOff) = hidden, open (Eye) = visible.
              Hidden in child mode since searchChildClasses doesn't honor them. */}
          {!parentClass && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2 text-xs">
              <FilterChip
                variant="eye"
                active={filterFlags.hideMonitoring}
                label="monitoring/stats"
                onToggle={() => updateFilterFlag('hideMonitoring')}
                hint="Click to show ag15min/fault/health/trend/threshold/event/record classes"
              />
              <FilterChip
                variant="eye"
                active={filterFlags.hideDeprecated}
                label="deprecated"
                onToggle={() => updateFilterFlag('hideDeprecated')}
                hint="Click to show classes marked deprecated in the MIM"
              />
              <FilterChip
                variant="eye"
                active={filterFlags.hideAbstract}
                label="abstract"
                onToggle={() => updateFilterFlag('hideAbstract')}
                hint="Click to show abstract classes (usually not queried directly)"
              />
              <FilterChip
                variant="eye"
                active={filterFlags.hideHidden}
                label="hidden"
                onToggle={() => updateFilterFlag('hideHidden')}
                hint="Click to show internal MIM classes flagged hidden"
              />
            </div>
          )}
        </div>

        {/* Pending favorite note input */}
        {pendingFavorite && (
          <div className="flex-none px-6 py-2 border-b border-border">
            <div className="border-2 border-primary/40 rounded px-3 py-2.5 bg-primary/5 flex gap-2 items-center">
              <Star className="w-4 h-4 text-amber-400 fill-amber-400 shrink-0" />
              <span className="font-mono text-sm font-medium shrink-0">
                {pendingFavorite.className}
              </span>
              <Input
                placeholder="Add a note (optional)… Enter to save"
                value={pendingNoteText}
                onChange={(e) => setPendingNoteText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.stopPropagation(); confirmPendingFavorite() }
                  if (e.key === 'Escape') cancelPendingFavorite()
                }}
                className="h-7 text-sm flex-1"
                autoFocus
              />
              <button
                onClick={confirmPendingFavorite}
                className="shrink-0 p-1 rounded text-emerald-500 hover:bg-emerald-500/10 transition-colors"
                title="Confirm"
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                onClick={cancelPendingFavorite}
                className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                title="Cancel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Two-panel body */}
        <div className="flex flex-1 overflow-hidden">
          {/* ── Left panel ── */}
          <div className="w-72 flex-none border-r border-border flex flex-col overflow-hidden">
            <ScrollArea className="flex-1">
              <div ref={listRef} className="py-1">
                {/* AI SUGGESTIONS — shown whenever suggestions exist */}
                {showAiInput && (aiSuggestions.length > 0 || aiError) && (
                  <>
                    <div className="px-3 py-2 bg-violet-500/5 border-b border-violet-400/30 flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
                      <span className="text-xs font-semibold text-violet-500 uppercase tracking-wide">
                        AI Suggestions {aiSuggestions.length > 0 && `(${aiSuggestions.length})`}
                      </span>
                      <span className="text-xs text-violet-400/60">— MIM validated</span>
                    </div>
                    {aiError && (
                      <div className="px-4 py-4 text-sm text-muted-foreground text-center">{aiError}</div>
                    )}
                    {aiSuggestions.map((cls) => (
                      <ClassListItem
                        key={`ai-${cls.className}`}
                        cls={cls}
                        isFavorite={isFavorite(cls.className)}
                        isFocused={false}
                        isSelected={selectedClass?.className === cls.className}
                        onHover={setHoveredClass}
                        onClick={handleClassClick}
                        onDoubleClick={handleClassDoubleClick}
                        onToggleFavorite={() => handleStarClick(cls.className, cls)}
                        dataIndex={-1}
                      />
                    ))}
                    <div className="border-b border-border my-1" />
                  </>
                )}

                {/* FAVORITES-ONLY mode */}
                {mode === 'favonly' && (
                  <>
                    <SectionHeader title="Favorites" count={displayFavorites.length} />
                    {displayFavorites.length === 0 && (
                      <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                        {parentClass
                          ? `No favorites are children of ${parentClass}`
                          : 'No favorites yet'}
                      </div>
                    )}
                    {displayFavorites.map((cls, idx) => {
                      const fav = favorites.find((f) => f.class_name === cls.className)
                      return editingNoteClass === cls.className ? (
                        <div key={`fav-edit-${cls.className}`} className="px-3 py-2 bg-primary/5 border-l-2 border-primary">
                          <div className="font-mono text-sm font-medium mb-1">{cls.className}</div>
                          <div className="flex gap-1.5 items-center">
                            <Input
                              value={editingNoteText}
                              onChange={(e) => setEditingNoteText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') { e.stopPropagation(); confirmEditNote() }
                                if (e.key === 'Escape') { setEditingNoteClass(null); setEditingNoteText('') }
                              }}
                              placeholder="Note…"
                              className="h-7 text-xs flex-1"
                              autoFocus
                            />
                            <button onClick={confirmEditNote} className="p-1 text-emerald-500 hover:bg-emerald-500/10 rounded"><Check className="w-3.5 h-3.5" /></button>
                            <button onClick={() => { setEditingNoteClass(null); setEditingNoteText('') }} className="p-1 text-muted-foreground hover:text-foreground rounded"><X className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                      ) : (
                        <ClassListItem
                          key={`fav-${cls.className}`}
                          cls={cls}
                          isFavorite={true}
                          isFocused={focusedIndex === idx}
                          isSelected={selectedClass?.className === cls.className}
                          note={fav?.note}
                          onHover={setHoveredClass}
                          onClick={handleClassClick}
                          onDoubleClick={handleClassDoubleClick}
                          onToggleFavorite={() => handleStarClick(cls.className, cls)}
                          onEditNote={() => startEditingNote(cls.className)}
                          dataIndex={idx}
                        />
                      )
                    })}
                  </>
                )}

                {/* SEARCH mode */}
                {mode === 'search' && (
                  <>
                    {isSearchLoading ? (
                      <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                        Searching...
                      </div>
                    ) : (
                      <>
                        <SectionHeader
                          title="Results"
                          count={enrichedResults.length}
                        />
                        {enrichedResults.length === 0 && (
                          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                            No classes found
                          </div>
                        )}
                        {enrichedResults.map((cls, idx) => (
                          <ClassListItem
                            key={`res-${cls.className}`}
                            cls={cls as MIMClass}
                            isFavorite={isFavorite(cls.className)}
                            isFocused={focusedIndex === idx}
                            isSelected={selectedClass?.className === cls.className}
                            note={favorites.find((f) => f.class_name === cls.className)?.note}
                            matchedByNote={cls.searchMethod === 'note'}
                            onHover={setHoveredClass}
                            onClick={handleClassClick}
                            onDoubleClick={handleClassDoubleClick}
                            onToggleFavorite={() =>
                              handleStarClick(cls.className, cls as MIMClass)
                            }
                            onEditNote={
                              isFavorite(cls.className)
                                ? () => startEditingNote(cls.className)
                                : undefined
                            }
                            dataIndex={idx}
                          />
                        ))}
                      </>
                    )}
                  </>
                )}

                {/* DEFAULT mode — favorites + recent (in child mode, filtered to valid children of parentClass) */}
                {mode === 'default' && (
                  <>
                    {/* Faz 3.1 — Reference Targets (read-only) when toggle is on */}
                    {parentClass && showRefTargets && parentDetail?.relationsTo && parentDetail.relationsTo.length > 0 && (
                      <>
                        <div className="px-3 pt-3 pb-1 text-[10px] text-muted-foreground border-b border-border/40">
                          <div className="flex items-center gap-1.5 uppercase tracking-wide font-semibold text-amber-600">
                            <span>Reference Targets · read-only</span>
                            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                              {parentDetail.relationsTo.length}
                            </Badge>
                          </div>
                          <div className="mt-1 normal-case text-muted-foreground/80 leading-relaxed">
                            These are referenced from <span className="font-mono">{parentClass}</span> via Rs* relations.
                            They are <span className="font-medium">not</span> direct children — shown for exploration. Click to view detail; cannot be added directly.
                          </div>
                        </div>
                        {parentDetail.relationsTo.slice(0, 30).map((r) => (
                          <RefTargetItem
                            key={`ref-${r.className}`}
                            ref={r}
                            isSelected={selectedClass?.className === r.className}
                            onHover={setHoveredClass}
                            onClick={(cls) => { setSelectedClass(cls); setHoveredClass(null); setDetailNavStack([]) }}
                          />
                        ))}
                      </>
                    )}

                    {/* Faz 3.2 — smart children (parent mode) or context roots (root mode) */}
                    {parentClass && smartChildrenData?.smartChildren?.common && smartChildrenData.smartChildren.common.length > 0 && (
                      <>
                        <SectionHeader title="Suggested" count={smartChildrenData.smartChildren.common.length} />
                        {smartChildrenData.smartChildren.common.slice(0, 12).map((c) => (
                          <ClassListItem
                            key={`sug-${c.className}`}
                            cls={{
                              className: c.className,
                              label: c.label,
                              classPkg: c.classPkg || '',
                              rnFormat: '',
                              isContextRoot: false,
                              isConfigurable: true,
                            }}
                            isFavorite={isFavorite(c.className)}
                            isFocused={false}
                            isSelected={selectedClass?.className === c.className}
                            onHover={setHoveredClass}
                            onClick={handleClassClick}
                            onDoubleClick={handleClassDoubleClick}
                            onToggleFavorite={() => handleStarClick(c.className, c as MIMClass)}
                            dataIndex={-1}
                          />
                        ))}
                      </>
                    )}

                    {!parentClass && trendingClasses.length > 0 && (
                      <>
                        <SectionHeader title="Trending in your org" count={trendingClasses.length} />
                        {trendingClasses.slice(0, 8).map((c) => (
                          <ClassListItem
                            key={`trend-${c.className}`}
                            cls={{
                              className: c.className,
                              label: c.label,
                              classPkg: c.classPkg,
                              rnFormat: '',
                              isContextRoot: false,
                              isConfigurable: true,
                            }}
                            isFavorite={isFavorite(c.className)}
                            isFocused={false}
                            isSelected={selectedClass?.className === c.className}
                            onHover={setHoveredClass}
                            onClick={handleClassClick}
                            onDoubleClick={handleClassDoubleClick}
                            onToggleFavorite={() => handleStarClick(c.className, c as unknown as MIMClass)}
                            dataIndex={-1}
                          />
                        ))}
                      </>
                    )}

                    {!parentClass && contextRoots.length > 0 && displayFavorites.length === 0 && displayRecent.length === 0 && trendingClasses.length === 0 && (
                      <>
                        <SectionHeader title="Common roots" count={contextRoots.length} />
                        {contextRoots.slice(0, 8).map((c) => (
                          <ClassListItem
                            key={`root-${c.className}`}
                            cls={c}
                            isFavorite={isFavorite(c.className)}
                            isFocused={false}
                            isSelected={selectedClass?.className === c.className}
                            onHover={setHoveredClass}
                            onClick={handleClassClick}
                            onDoubleClick={handleClassDoubleClick}
                            onToggleFavorite={() => handleStarClick(c.className, c)}
                            dataIndex={-1}
                          />
                        ))}
                      </>
                    )}

                    {displayFavorites.length > 0 && (
                      <>
                        <SectionHeader title="Favorites" count={displayFavorites.length} />
                        {displayFavorites.map((cls, idx) => {
                          const fav = favorites.find((f) => f.class_name === cls.className)
                          return editingNoteClass === cls.className ? (
                            <div key={`fav-edit-${cls.className}`} className="px-3 py-2 bg-primary/5 border-l-2 border-primary">
                              <div className="font-mono text-sm font-medium mb-1">{cls.className}</div>
                              <div className="flex gap-1.5 items-center">
                                <Input
                                  value={editingNoteText}
                                  onChange={(e) => setEditingNoteText(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') { e.stopPropagation(); confirmEditNote() }
                                    if (e.key === 'Escape') { setEditingNoteClass(null); setEditingNoteText('') }
                                  }}
                                  placeholder="Note…"
                                  className="h-7 text-xs flex-1"
                                  autoFocus
                                />
                                <button onClick={confirmEditNote} className="p-1 text-emerald-500 hover:bg-emerald-500/10 rounded"><Check className="w-3.5 h-3.5" /></button>
                                <button onClick={() => { setEditingNoteClass(null); setEditingNoteText('') }} className="p-1 text-muted-foreground hover:text-foreground rounded"><X className="w-3.5 h-3.5" /></button>
                              </div>
                            </div>
                          ) : (
                            <ClassListItem
                              key={`fav-${cls.className}`}
                              cls={cls}
                              isFavorite={true}
                              isFocused={focusedIndex === idx}
                              isSelected={selectedClass?.className === cls.className}
                              note={fav?.note}
                              onHover={setHoveredClass}
                              onClick={handleClassClick}
                              onDoubleClick={handleClassDoubleClick}
                              onToggleFavorite={() => handleStarClick(cls.className, cls)}
                              onEditNote={() => startEditingNote(cls.className)}
                              dataIndex={idx}
                            />
                          )
                        })}
                      </>
                    )}

                    {displayRecent.length > 0 && (
                      <>
                        <SectionHeader title="Recent" count={displayRecent.length} />
                        {displayRecent.map((cls, idx) => {
                          const globalIdx = displayFavorites.length + idx
                          return (
                            <ClassListItem
                              key={`rec-${cls.className}`}
                              cls={cls}
                              isFavorite={isFavorite(cls.className)}
                              isFocused={focusedIndex === globalIdx}
                              isSelected={selectedClass?.className === cls.className}
                              note={favorites.find((f) => f.class_name === cls.className)?.note}
                              onHover={setHoveredClass}
                              onClick={handleClassClick}
                              onDoubleClick={handleClassDoubleClick}
                              onToggleFavorite={() => handleStarClick(cls.className, cls)}
                              onEditNote={
                                isFavorite(cls.className)
                                  ? () => startEditingNote(cls.className)
                                  : undefined
                              }
                              dataIndex={globalIdx}
                            />
                          )
                        })}
                      </>
                    )}

                    {displayFavorites.length === 0 && displayRecent.length === 0 && (
                      <div className="px-4 py-8 text-center">
                        <Search className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
                        <p className="text-sm text-muted-foreground">
                          {parentClass ? (
                            <>
                              Search for child classes of{' '}
                              <span className="font-mono font-semibold">{parentClass}</span>
                            </>
                          ) : (
                            'Start typing to search classes'
                          )}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </ScrollArea>
          </div>

          {/* ── Right panel ── */}
          <div className="flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="p-6">
                {!activeClass ? (
                  <div className="flex flex-col items-center justify-center min-h-[300px] text-center">
                    <BookOpen className="w-12 h-12 text-muted-foreground/30 mb-4" />
                    <p className="text-sm text-muted-foreground">
                      Select a class to see details
                    </p>
                    {parentClass && (
                      <p className="text-xs text-amber-500 mt-2">
                        Showing child classes of{' '}
                        <span className="font-mono font-semibold">{parentClass}</span>
                      </p>
                    )}
                  </div>
                ) : (
                  <ClassDetailPanel
                    cls={activeClass}
                    // Pass full detail only when this class IS the selectedClass
                    // (not when just hovering — avoids detail of hovered class
                    // clashing with detail fetch for selectedClass)
                    detail={
                      activeClass.className === selectedClass?.className
                        ? ((classDetail as MIMClassFullDetail | undefined) ?? null)
                        : null
                    }
                    detailLoading={
                      activeClass.className === selectedClass?.className &&
                      isDetailLoading
                    }
                    onPickClass={(name) => {
                      // Drill-down: build a minimal MIMClass shell from the name and
                      // push it onto the nav stack. The detail query then refetches.
                      handleNavigateToChild({ className: name } as MIMClass)
                    }}
                    backParent={
                      detailNavStack.length > 0
                        ? detailNavStack[detailNavStack.length - 1]
                        : undefined
                    }
                    onBack={detailNavStack.length > 0 ? handleNavigateBack : undefined}
                  />
                )}
              </div>
            </ScrollArea>
          </div>
        </div>

        {/* Faz 3.1 — banner when a reference-only class is highlighted */}
        {isReferenceTargetOnly && rawConfirm && (
          <div className="flex-none px-6 py-2 border-t border-amber-500/30 bg-amber-500/5 text-xs text-amber-600 flex items-center gap-2">
            <span aria-hidden>↪</span>
            <span>
              <span className="font-mono font-semibold">{rawConfirm.className}</span> is referenced
              from <span className="font-mono">{parentClass}</span> — it isn't a direct child and
              can't be added directly. Add the source class and configure its reference filters
              instead.
            </span>
          </div>
        )}

        {/* Soft warning banner for deprecated selection */}
        {confirmClass && (confirmClass as Partial<EnhancedMIMClass>).isDeprecated && (
          <div className="flex-none px-6 py-2 border-t border-red-500/30 bg-red-500/5 text-xs text-red-500 flex items-center gap-2">
            <span aria-hidden>⚠</span>
            <span>
              <span className="font-mono font-semibold">{confirmClass.className}</span> is marked
              deprecated in the MIM. You can still add it, but consider whether a current class
              fits better.
            </span>
          </div>
        )}

        {/* Footer */}
        <div className="flex-none px-6 py-3 border-t border-border bg-muted/20 flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {mode === 'search' && !isSearchLoading && (
              <>
                {enrichedResults.length} result
                {enrichedResults.length !== 1 ? 's' : ''}
                {packageFilter !== '__all__' && ` · Package: ${packageFilter}`}
              </>
            )}
            {mode === 'default' && 'Type to search classes'}
            {mode === 'favonly' &&
              `${favoriteClasses.length} favorite${favoriteClasses.length !== 1 ? 's' : ''}`}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleConfirmSelect} disabled={!confirmClass}>
              {confirmClass ? (
                <>
                  Add {confirmClass.className}
                  <ChevronRight className="w-4 h-4 ml-1" />
                </>
              ) : (
                'Select a class'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

// Section accents — each landing-page section gets a distinct hue + icon
// so the user can tell Trending from Recent at a glance without reading
// the heading. Tones are subtle (text-only, no background) to keep the
// list scannable.
const SECTION_ACCENTS: Record<string, { icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  Favorites:           { icon: Star,        tone: 'text-amber-500' },
  Recent:              { icon: History,     tone: 'text-sky-500' },
  'Trending in your org': { icon: TrendingUp, tone: 'text-violet-500' },
  Suggested:           { icon: Sparkles,    tone: 'text-emerald-500' },
  'Common roots':      { icon: Compass,     tone: 'text-blue-500' },
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  const accent = SECTION_ACCENTS[title]
  const Icon = accent?.icon
  return (
    <div className="px-3 py-1.5 flex items-center gap-2 mt-1">
      {Icon && <Icon className={cn('w-3.5 h-3.5 shrink-0', accent.tone)} />}
      <span
        className={cn(
          'text-xs font-semibold uppercase tracking-wider',
          accent?.tone ?? 'text-muted-foreground',
        )}
      >
        {title}
      </span>
      <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4">
        {count}
      </Badge>
    </div>
  )
}

interface ClassListItemProps {
  /** Accepts MIMClass or EnhancedMIMClass — extra search metadata (description,
   * searchMethod, matchedProperties) is read off the object when present. */
  cls: MIMClass & Partial<EnhancedMIMClass>
  isFavorite: boolean
  isFocused: boolean
  isSelected: boolean
  note?: string
  matchedByNote?: boolean
  onHover: (cls: MIMClass | null) => void
  onClick: (cls: MIMClass) => void
  onDoubleClick: (cls: MIMClass) => void
  onToggleFavorite: () => void
  onEditNote?: () => void
  dataIndex: number
}

function ClassListItem({
  cls,
  isFavorite,
  isFocused,
  isSelected,
  note,
  matchedByNote,
  onHover,
  onClick,
  onDoubleClick,
  onToggleFavorite,
  onEditNote,
  dataIndex,
}: ClassListItemProps) {
  return (
    <div
      data-list-item
      data-index={dataIndex}
      className={cn(
        'flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors group',
        isFocused && 'bg-primary/10',
        isSelected && !isFocused && 'bg-primary/15 border-l-2 border-primary',
        !isFocused && !isSelected && 'hover:bg-accent'
      )}
      onMouseEnter={() => onHover(cls)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onClick(cls)}
      onDoubleClick={() => onDoubleClick(cls)}
    >
      <div className="flex-1 min-w-0">
        <div className="font-mono text-sm font-medium truncate flex items-center gap-1.5">
          <span className="truncate">{cls.className}</span>
          <ClassMetaBadges cls={cls} />
        </div>
        {cls.label && cls.label !== cls.className && (
          <div className="text-xs text-muted-foreground truncate">{cls.label}</div>
        )}
        {cls.description && cls.searchMethod === 'description' && (
          <div className="text-xs text-muted-foreground/80 truncate mt-0.5 italic">
            {cls.description.slice(0, 120)}{cls.description.length > 120 ? '…' : ''}
          </div>
        )}
        {cls.matchedProperties && cls.matchedProperties.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {cls.matchedProperties.slice(0, 4).map((p) => (
              <span key={p} className="text-[10px] font-mono px-1.5 py-0 rounded bg-blue-500/10 text-blue-500">
                {p}
              </span>
            ))}
          </div>
        )}
        {note && (
          <div className={cn(
            'text-xs italic truncate mt-0.5 flex items-center gap-1',
            matchedByNote ? 'text-amber-500' : 'text-muted-foreground'
          )}>
            {matchedByNote && <MessageSquare className="w-3 h-3 shrink-0" />}
            {note}
          </div>
        )}
      </div>
      <SearchMethodChip method={cls.searchMethod} />
      {cls.classPkg && (
        <Badge variant="outline" className="text-xs px-1.5 py-0 h-4 shrink-0 font-mono">
          {cls.classPkg}
        </Badge>
      )}
      {onEditNote && (
        <button
          className="shrink-0 p-0.5 rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground transition-all"
          onClick={(e) => {
            e.stopPropagation()
            onEditNote()
          }}
          title="Edit note"
        >
          <MessageSquare className="w-3.5 h-3.5" />
        </button>
      )}
      <button
        className={cn(
          'shrink-0 p-0.5 rounded transition-all opacity-0 group-hover:opacity-100',
          isFavorite && 'opacity-100 text-amber-400'
        )}
        onClick={(e) => {
          e.stopPropagation()
          onToggleFavorite()
        }}
      >
        <Star className={cn('w-3.5 h-3.5', isFavorite && 'fill-current')} />
      </button>
    </div>
  )
}
