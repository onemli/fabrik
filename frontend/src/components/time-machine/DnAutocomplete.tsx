// DnAutocomplete — typeahead picker for DNs present in the latest snapshot
// of a saved query. Replaces the bare ``<Input>`` previously used in the
// Track DN flow so operators don't need to remember exact paths.
//
// The dropdown opens on focus or first keystroke, throttles its server
// calls (debounced 200ms), and falls back gracefully when the latest
// snapshot has no matching DNs — the user can still type freely and run
// the timeline against an arbitrary DN they paste from elsewhere.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, TrendingUp, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { timeMachineService } from '@/services/timeMachine'

export interface DnAutocompleteProps {
  savedQueryId: number
  /** Initial value (e.g. when restoring from URL state). */
  defaultValue?: string
  /** Fired when the user commits — picks an option or hits Enter. */
  onSubmit: (dn: string) => void
  /** Fired on Esc/clear so the parent can collapse the timeline panel. */
  onCancel?: () => void
}

const DEBOUNCE_MS = 350
const MIN_CHARS = 2

export function DnAutocomplete({
  savedQueryId,
  defaultValue = '',
  onSubmit,
  onCancel,
}: DnAutocompleteProps) {
  const [input, setInput] = useState(defaultValue)
  const [debounced, setDebounced] = useState(defaultValue)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Debounce the search term so we don't hammer the API on every keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(input.trim()), DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [input])

  // Skip the very first "" call when opening — wait until the user types at
  // least MIN_CHARS or pauses with an empty box (initial population case).
  const shouldFetch = open && (debounced.length === 0 || debounced.length >= MIN_CHARS)
  const { data, isFetching } = useQuery({
    queryKey: ['tm-dn-list', savedQueryId, debounced],
    queryFn: () => timeMachineService.listDnsInQuery(savedQueryId, debounced, 50),
    enabled: shouldFetch,
    staleTime: 30_000,
  })
  const options = useMemo(() => data?.dns ?? [], [data])

  // Close on outside-click so the dropdown doesn't trap focus.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current) return
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  // Reset highlight when the option list shrinks/grows.
  useEffect(() => setActiveIndex(-1), [options.length])

  const commit = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    setOpen(false)
    setInput(trimmed)
    onSubmit(trimmed)
  }

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActiveIndex((i) => Math.min(i + 1, options.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (activeIndex >= 0 && options[activeIndex]) {
        commit(options[activeIndex].dn)
      } else {
        commit(input)
      }
    } else if (e.key === 'Escape') {
      if (open) {
        setOpen(false)
      } else {
        onCancel?.()
      }
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKey}
            placeholder="Search DNs (e.g. uni/tn-prod/BD-web)…"
            className="pl-8 pr-8 font-mono text-sm"
          />
          {input && (
            <button
              type="button"
              onClick={() => {
                setInput('')
                setOpen(true)
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Button
          onClick={() => commit(input)}
          disabled={!input.trim()}
          className="bg-violet-600 hover:bg-violet-700 text-white"
        >
          <TrendingUp className="w-4 h-4 mr-2" />
          Track
        </Button>
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-auto rounded-md border border-border bg-popover shadow-lg">
          {isFetching && options.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>
          )}
          {!isFetching && options.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              No matching DNs in the latest snapshot.
              {input.trim() && (
                <>
                  {' '}Press <kbd className="px-1 py-0.5 text-[10px] bg-muted rounded">Enter</kbd>{' '}
                  to track this exact DN anyway.
                </>
              )}
            </div>
          )}
          <ul role="listbox">
            {options.map((opt, idx) => (
              <li key={opt.dn}>
                <button
                  type="button"
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => commit(opt.dn)}
                  className={cn(
                    'w-full text-left px-3 py-1.5 flex items-center gap-2',
                    'hover:bg-accent transition-colors',
                    activeIndex === idx && 'bg-accent',
                  )}
                >
                  <code className="font-mono text-xs flex-1 truncate">{opt.dn}</code>
                  {opt.className && (
                    <Badge variant="outline" className="text-[10px] font-mono shrink-0">
                      {opt.className}
                    </Badge>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
