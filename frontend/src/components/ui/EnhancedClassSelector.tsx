// Enhanced Class Selector
//
// Package filter, AI suggestions, favorites with notes, recent classes.

import { useState, useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Star, X, Sparkles, Loader2, MessageSquare, Check } from 'lucide-react'
import { mimApi } from '@/lib/api'
import { classCache } from '@/services/classCache'
import { classHistory } from '@/services/classHistory'
import { useFavorites } from '@/hooks/useFavorites'
import { useRecent } from '@/hooks/useRecent'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PackageCombobox } from '@/components/ui/PackageCombobox'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { MIMClass, EnhancedMIMClass } from '@/types'

interface EnhancedClassSelectorProps {
  onSelect: (className: string, classInfo?: MIMClass) => void
  placeholder?: string
  excludeClasses?: string[]
  autoFocus?: boolean
  parentClass?: string // If provided, only show child classes of this parent
}

export function EnhancedClassSelector({
  onSelect,
  placeholder = 'Search classes...',
  excludeClasses = [],
  autoFocus = false,
  parentClass,
}: EnhancedClassSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  const [selectedPackage, setSelectedPackage] = useState<string>('__all__')
  const [focusedIndex, setFocusedIndex] = useState(-1)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchQuery(searchQuery), 250)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // AI suggestion state
  const [showAiInput, setShowAiInput] = useState(false)
  const [aiInput, setAiInput] = useState('')
  const [aiSuggestions, setAiSuggestions] = useState<MIMClass[]>([])
  const [isAiLoading, setIsAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const aiInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    classCache.init().catch(() => {})
  }, [])

  // Focus the AI input when it opens
  useEffect(() => {
    if (showAiInput) aiInputRef.current?.focus()
  }, [showAiInput])

  const {
    favorites, isFavorite,
    addFavorite: addFavoriteBackend,
    removeFavorite: removeFavoriteBackend,
    updateNote,
  } = useFavorites()
  const { recent: recentBackend, addRecent: addRecentBackend, isOffline: recentOffline } = useRecent(10)

  // Note input state — used both for adding new favorites and editing existing notes
  const [pendingFavorite, setPendingFavorite] = useState<{ className: string; classInfo?: MIMClass } | null>(null)
  const [editingNote, setEditingNote] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')
  const noteInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (pendingFavorite || editingNote) noteInputRef.current?.focus()
  }, [pendingFavorite, editingNote])

  // When star is clicked on a non-favorited class, open note input instead of adding immediately
  const startAddFavorite = (className: string, classInfo?: MIMClass, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setPendingFavorite({ className, classInfo })
    setNoteText('')
  }

  // Confirm adding the favorite (with optional note)
  const confirmAddFavorite = () => {
    if (!pendingFavorite) return
    addFavoriteBackend(pendingFavorite.className, pendingFavorite.classInfo, noteText.trim() || undefined)
    setPendingFavorite(null)
    setNoteText('')
  }

  const cancelPendingFavorite = () => {
    setPendingFavorite(null)
    setNoteText('')
  }

  // Edit note on an existing favorite
  const startEditNote = (className: string, currentNote: string | undefined, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingNote(className)
    setNoteText(currentNote || '')
  }

  const saveNote = (className: string) => {
    updateNote(className, noteText.trim())
    setEditingNote(null)
    setNoteText('')
  }

  const getNoteForClass = (className: string): string | undefined => {
    return favorites.find(f => f.class_name === className)?.note || undefined
  }

  // Toggle favorite — remove if exists, open note input if adding
  const toggleFavorite = (className: string, classInfo?: MIMClass, e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (isFavorite(className)) {
      removeFavoriteBackend(className)
    } else {
      startAddFavorite(className, classInfo, e)
    }
  }

  // Fetch child classes if parentClass is provided
  const { data: childClasses } = useQuery({
    queryKey: ['childClasses', parentClass],
    queryFn: async () => {
      if (!parentClass) return null
      const { queriesService } = await import('@/services/queries')
      return queriesService.getChildClasses(parentClass)
    },
    enabled: !!parentClass,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })

  // While the user is still typing (debounce hasn't settled), show the loading
  // state so we don't flash "No results" between the keystroke and the fetch.
  const isDebouncing = searchQuery !== debouncedSearchQuery

  // Enhanced search with backend + fallback
  const { data: searchResults, isLoading: isFetching } = useQuery({
    queryKey: ['enhancedClassSearch', debouncedSearchQuery, selectedPackage, parentClass],
    queryFn: async () => {
      const packageFilter = selectedPackage === '__all__' ? undefined : selectedPackage
      try {
        // If parentClass is provided, search within child classes
        if (parentClass) {
          const results = await mimApi.searchChildClasses(parentClass, debouncedSearchQuery, 100)
          return results as EnhancedMIMClass[]
        }
        // Otherwise, do general search
        const results = await mimApi.enhancedSearchClasses(debouncedSearchQuery, 50, packageFilter)
        return results
      } catch {
        if (classCache.isReady()) {
          return await classCache.search(debouncedSearchQuery, 50, packageFilter)
        }
        return []
      }
    },
    enabled: debouncedSearchQuery.length >= 2,
  })

  const isLoading = isFetching || (isDebouncing && searchQuery.length >= 2)

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
  }, [recentBackend, recentOffline, searchQuery])

  const favoriteClasses = useMemo(
    () =>
      favorites.map((f) => ({
        className: f.class_name,
        label: f.label,
        classPkg: f.class_pkg,
        note: f.note,
      })),
    [favorites]
  )

  // Split search results: favorited classes first, then the rest
  const { favoriteResults, otherResults } = useMemo(() => {
    if (!searchResults) return { favoriteResults: [] as EnhancedMIMClass[], otherResults: [] as EnhancedMIMClass[] }

    const results = searchResults.filter((cls) => !excludeClasses.includes(cls.className))
    const favSet = new Set(favorites.map(f => f.class_name))

    return {
      favoriteResults: results.filter(cls => favSet.has(cls.className)),
      otherResults: results.filter(cls => !favSet.has(cls.className)),
    }
  }, [searchResults, excludeClasses, favorites])

  const totalResults = favoriteResults.length + otherResults.length

  // Reset focus when results change shape so ↑↓ never points at a stale index.
  useEffect(() => {
    setFocusedIndex(-1)
  }, [debouncedSearchQuery, selectedPackage, parentClass])

  // Flat list mirrors render order so ↑/↓ nav matches what the user sees.
  // Search mode: favoriteResults → otherResults. Default mode: favoriteClasses → recentClasses.
  const flatList = useMemo<MIMClass[]>(() => {
    if (searchQuery.length >= 2) {
      return [...favoriteResults, ...otherResults] as MIMClass[]
    }
    const favs: MIMClass[] = favoriteClasses.map((f) => ({
      className: f.className,
      label: f.label,
      classPkg: f.classPkg,
      rnFormat: '',
      isContextRoot: false,
      isConfigurable: true,
    }))
    const recents: MIMClass[] = recentClasses.map((r) => ({
      className: r.className,
      label: r.label,
      classPkg: r.classPkg,
      rnFormat: '',
      isContextRoot: false,
      isConfigurable: true,
    }))
    return [...favs, ...recents]
  }, [searchQuery, favoriteResults, otherResults, favoriteClasses, recentClasses])

  const handleSelect = (className: string, classInfo?: MIMClass) => {
    addRecentBackend(className, classInfo)
    setSearchQuery('')
    onSelect(className, classInfo)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIndex((prev) => Math.min(prev + 1, flatList.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIndex((prev) => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (focusedIndex >= 0 && focusedIndex < flatList.length) {
        const cls = flatList[focusedIndex]
        handleSelect(cls.className, cls)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (searchQuery) setSearchQuery('')
      else setFocusedIndex(-1)
    }
  }

  const handleAiSuggest = async () => {
    const query = aiInput.trim()
    if (!query || isAiLoading) return
    setIsAiLoading(true)
    setAiError(null)
    setAiSuggestions([])
    try {
      const results = await mimApi.suggestClasses(query, parentClass)
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

  const hasActiveFilter = selectedPackage !== '__all__'

  // Reusable row for search results
  const SearchResultItem = ({ cls, idx, isFav, isFocused, note, onSelect: handleClick, onToggleFavorite: handleToggle, onEditNote }: {
    cls: EnhancedMIMClass
    idx: number
    isFav: boolean
    isFocused?: boolean
    note?: string
    onSelect: (className: string, classInfo?: MIMClass) => void
    onToggleFavorite: (className: string, classInfo?: MIMClass, e?: React.MouseEvent) => void
    onEditNote?: (className: string, currentNote: string | undefined, e: React.MouseEvent) => void
  }) => (
    <div
      className={`
        w-full text-left px-3 py-2.5 hover:bg-primary/5 transition-colors
        flex items-start justify-between gap-3 group cursor-pointer
        ${idx > 0 ? 'border-t border-border' : ''}
        ${isFocused ? 'bg-primary/10 border-l-2 border-primary -ml-0.5' : ''}
      `}
      onClick={() => handleClick(cls.className, cls)}
    >
      <div className="flex-1 min-w-0">
        <div className="font-mono text-sm font-semibold text-foreground">{cls.className}</div>
        {cls.label && (
          <div className="text-xs text-muted-foreground mt-0.5 truncate">{cls.label}</div>
        )}
        {note && (
          <div className="text-xs text-primary/70 mt-0.5 truncate italic">{note}</div>
        )}
      </div>
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {isFav && onEditNote && (
          <button
            onClick={(e) => onEditNote(cls.className, note, e)}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-muted-foreground hover:text-foreground"
          >
            <MessageSquare className="w-3 h-3" />
          </button>
        )}
        <button
          onClick={(e) => handleToggle(cls.className, cls, e)}
          className={`p-1 transition-opacity ${isFav ? '' : 'opacity-0 group-hover:opacity-100'}`}
        >
          <Star
            className={`w-3.5 h-3.5 ${
              isFav ? 'fill-primary text-primary' : 'text-muted-foreground'
            }`}
          />
        </button>
      </div>
    </div>
  )

  return (
    <div className="space-y-3">
      {/* Pending favorite — note input after clicking star on any non-favorited class */}
      {pendingFavorite && (
        <div className="border-2 border-primary/40 rounded px-3 py-2.5 bg-primary/5 flex gap-2 items-center">
          <Star className="w-3.5 h-3.5 fill-primary text-primary flex-shrink-0" />
          <span className="text-xs font-mono font-semibold text-foreground flex-shrink-0">
            {pendingFavorite.className}
          </span>
          <Input
            ref={noteInputRef}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmAddFavorite()
              if (e.key === 'Escape') cancelPendingFavorite()
            }}
            placeholder="Add a note (optional)… Enter to save"
            className="h-7 text-xs border flex-1"
          />
          <button
            onClick={confirmAddFavorite}
            className="h-7 w-7 flex items-center justify-center rounded border text-primary hover:bg-primary/10 flex-shrink-0"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={cancelPendingFavorite}
            className="h-7 w-7 flex items-center justify-center rounded border text-muted-foreground hover:text-foreground flex-shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Search Row */}
      <div className="flex gap-2">
        <Input
          placeholder={placeholder}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 h-9 font-mono text-sm border-2 focus:ring-0 focus:ring-offset-0"
          autoFocus={autoFocus}
        />
        {/* AI suggest toggle */}
        <button
          onClick={() => setShowAiInput(v => !v)}
          title="Describe what you're looking for"
          className={`h-9 w-9 flex items-center justify-center rounded border-2 transition-colors flex-shrink-0
            ${showAiInput
              ? 'border-violet-500 bg-violet-500/10 text-violet-500'
              : 'border-border text-muted-foreground hover:border-violet-400 hover:text-violet-400'
            }`}
        >
          <Sparkles className="w-4 h-4" />
        </button>
        <PackageCombobox
          value={selectedPackage}
          onValueChange={setSelectedPackage}
          triggerClassName="w-[180px] h-9 border-2 text-sm"
        />
      </div>

      {/* AI Input Row */}
      {showAiInput && (
        <div className="flex gap-2">
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

      {/* AI Suggestions Results */}
      {showAiInput && (aiSuggestions.length > 0 || aiError) && (
        <div className="border-2 border-violet-400/50">
          <div className="border-b-2 border-violet-400/50 px-3 py-2.5 bg-violet-500/5 flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-violet-500" />
            <span className="text-xs font-semibold text-violet-500 uppercase tracking-wide">
              AI Suggestions {aiSuggestions.length > 0 && `(${aiSuggestions.length})`}
            </span>
            <span className="text-xs text-violet-400/60 ml-1">— MIM validated</span>
          </div>
          {aiError && (
            <div className="px-3 py-4 text-sm text-muted-foreground text-center">{aiError}</div>
          )}
          {aiSuggestions.map((cls, idx) => (
            <div
              key={cls.className}
              onClick={() => { handleSelect(cls.className, cls); dismissAi() }}
              className={`w-full text-left px-3 py-2.5 hover:bg-violet-500/5 transition-colors
                flex items-start gap-3 cursor-pointer
                ${idx > 0 ? 'border-t border-violet-400/20' : ''}`}
            >
              <div className="flex-1 min-w-0">
                <div className="font-mono text-sm font-semibold text-foreground">{cls.className}</div>
                {cls.label && (
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">{cls.label}</div>
                )}
                {(cls as any).classPkg && (
                  <div className="text-xs text-violet-400/70 mt-0.5">pkg: {(cls as any).classPkg}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Active Filter Badge */}
      {hasActiveFilter && (
        <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 border border-primary/20 rounded">
          <span className="text-sm text-primary font-medium">
            Package: {selectedPackage}
          </span>
          <button
            onClick={() => setSelectedPackage('__all__')}
            className="hover:bg-primary/20 rounded p-0.5 transition-colors"
          >
            <X className="w-3.5 h-3.5 text-primary" />
          </button>
        </div>
      )}

      {/* Search Results — favorited matches on top */}
      {searchQuery.length >= 2 && (
        <div className="border-2 border-border">
          {isLoading && (
            <div className="p-8 text-center">
              <div className="text-sm text-muted-foreground">Searching...</div>
            </div>
          )}

          {!isLoading && totalResults > 0 && (
            <ScrollArea className="h-[320px]">
              {/* Favorited matches first */}
              {favoriteResults.length > 0 && (
                <>
                  <div className="border-b-2 border-border px-3 py-2 bg-primary/5 sticky top-0 z-10">
                    <div className="flex items-center gap-2">
                      <Star className="w-3 h-3 fill-primary text-primary" />
                      <span className="text-xs font-semibold text-primary uppercase tracking-wide">
                        Favorites ({favoriteResults.length})
                      </span>
                    </div>
                  </div>
                  {favoriteResults.map((cls, idx) => (
                    <SearchResultItem
                      key={cls.className}
                      cls={cls}
                      idx={idx}
                      isFav={true}
                      isFocused={focusedIndex === idx}
                      note={getNoteForClass(cls.className)}
                      onSelect={handleSelect}
                      onToggleFavorite={toggleFavorite}
                      onEditNote={startEditNote}
                    />
                  ))}
                </>
              )}

              {/* Other results */}
              <div className={`border-b-2 border-border px-3 py-2 bg-muted/30 sticky top-0 z-10 ${favoriteResults.length > 0 ? 'border-t-2' : ''}`}>
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {otherResults.length} Results
                </span>
              </div>
              {otherResults.map((cls, idx) => (
                <SearchResultItem
                  key={cls.className}
                  cls={cls}
                  idx={idx}
                  isFav={false}
                  isFocused={focusedIndex === favoriteResults.length + idx}
                  onSelect={handleSelect}
                  onToggleFavorite={toggleFavorite}
                />
              ))}
            </ScrollArea>
          )}

          {!isLoading && totalResults === 0 && (
            <div className="p-8 text-center">
              <div className="text-sm text-muted-foreground">
                No results for &ldquo;{searchQuery}&rdquo;
                {hasActiveFilter && (
                  <div className="mt-1">in package {selectedPackage}</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Child Classes (when parent is specified) */}
      {searchQuery.length < 2 && parentClass && childClasses && childClasses.length > 0 && (
        <div className="border-2 border-border">
          <div className="border-b-2 border-border px-3 py-2.5 bg-primary/5">
            <span className="text-xs font-semibold text-primary uppercase tracking-wide">
              Child Classes of {parentClass} ({childClasses.length})
            </span>
          </div>
          <ScrollArea className="h-[280px]">
            {childClasses.map((cls, idx) => (
              <div
                key={cls.className}
                onClick={() => handleSelect(cls.className, cls as any)}
                className={`
                  w-full text-left px-3 py-2.5 hover:bg-primary/5 transition-colors
                  flex items-center justify-between gap-3 cursor-pointer
                  ${idx > 0 ? 'border-t border-border' : ''}
                `}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-sm font-semibold">{cls.className}</div>
                  {cls.label && (
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">
                      {cls.label}
                    </div>
                  )}
                  {cls.description && (
                    <div className="text-xs text-muted-foreground/70 mt-0.5 truncate">
                      {cls.description}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </ScrollArea>
        </div>
      )}

      {/* Favorites & Recent */}
      {searchQuery.length < 2 && !parentClass && (
        <div className="space-y-3">
          {favoriteClasses.length > 0 && (
            <div className="border-2 border-border">
              <div className="border-b-2 border-border px-3 py-2.5 bg-primary/5">
                <div className="flex items-center gap-2">
                  <Star className="w-3.5 h-3.5 fill-primary text-primary" />
                  <span className="text-xs font-semibold text-primary uppercase tracking-wide">
                    Favorites ({favoriteClasses.length})
                  </span>
                </div>
              </div>
              <ScrollArea className={favoriteClasses.length > 6 ? 'h-[260px]' : undefined}>
                {favoriteClasses.map((item, idx) => (
                  <div
                    key={item.className}
                    className={`
                      w-full text-left px-3 py-2.5 hover:bg-primary/5 transition-colors
                      flex items-center justify-between gap-2 group cursor-pointer
                      ${idx > 0 ? 'border-t border-border' : ''}
                    `}
                  >
                    <div
                      className="flex-1 min-w-0"
                      onClick={() => handleSelect(item.className, item as any)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold">{item.className}</span>
                        {item.label && (
                          <span className="text-xs text-muted-foreground truncate">{item.label}</span>
                        )}
                      </div>
                      {item.note && (
                        <div className="text-xs text-primary/70 mt-0.5 truncate italic">
                          {item.note}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {/* Note button */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={(e) => startEditNote(item.className, item.note, e)}
                            className={`p-1 rounded transition-opacity ${
                              item.note
                                ? 'text-primary/60 hover:text-primary'
                                : 'opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            <MessageSquare className="w-3 h-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="text-xs max-w-[200px]">
                          {item.note || 'Add note'}
                        </TooltipContent>
                      </Tooltip>
                      <button
                        onClick={(e) => toggleFavorite(item.className, item as any, e)}
                        className="p-1"
                      >
                        <Star className="w-3.5 h-3.5 fill-primary text-primary" />
                      </button>
                    </div>
                  </div>
                ))}
              </ScrollArea>

              {/* Inline note editor */}
              {editingNote && favoriteClasses.some(f => f.className === editingNote) && (
                <div className="border-t-2 border-border px-3 py-2 bg-muted/20 flex gap-2 items-center">
                  <MessageSquare className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <Input
                    ref={noteInputRef}
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveNote(editingNote)
                      if (e.key === 'Escape') { setEditingNote(null); setNoteText('') }
                    }}
                    placeholder={`Note for ${editingNote}...`}
                    className="h-7 text-xs border flex-1"
                  />
                  <button
                    onClick={() => saveNote(editingNote)}
                    className="h-7 w-7 flex items-center justify-center rounded border text-primary hover:bg-primary/10 flex-shrink-0"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => { setEditingNote(null); setNoteText('') }}
                    className="h-7 w-7 flex items-center justify-center rounded border text-muted-foreground hover:text-foreground flex-shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}

          {recentClasses.length > 0 && (
            <div className="border-2 border-border">
              <div className="border-b-2 border-border px-3 py-2.5 bg-muted/30">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Recent
                </span>
              </div>
              <div>
                {recentClasses.map((item, idx) => (
                  <div
                    key={item.className}
                    onClick={() => handleSelect(item.className, item as any)}
                    className={`
                      w-full text-left px-3 py-2.5 hover:bg-primary/5 transition-colors cursor-pointer
                      ${idx > 0 ? 'border-t border-border' : ''}
                    `}
                  >
                    <div className="font-mono text-sm font-semibold">{item.className}</div>
                    {item.label && (
                      <div className="text-xs text-muted-foreground mt-0.5 truncate">
                        {item.label}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {recentClasses.length === 0 && favoriteClasses.length === 0 && (
            <div className="border-2 border-border p-8 text-center">
              <div className="text-sm text-muted-foreground">
                Type to search 17,500+ classes
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
