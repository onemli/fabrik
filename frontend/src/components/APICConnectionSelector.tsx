// APICConnectionSelector.tsx
//
// Professional APIC connection picker with health monitoring, inline testing,
// and rich status feedback. Supports single and multi-select modes.

import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Search,
  Server,
  CheckCircle2,
  XCircle,
  Loader2,
  Globe,
  Lock,
  RefreshCw,
  Clock,
  ShieldCheck,
  ShieldOff,
  User,
  ArrowUpDown,
  X,
  Circle,
  Activity,
} from 'lucide-react'
import { apicService, APICConnection } from '@/services/apic'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import { cn } from '@/lib/utils'
import { formatDate } from '@/contexts/TimezoneContext'

interface APICConnectionSelectorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// How long ago a test was run, in human-friendly form
function timeAgo(dateStr?: string): string {
  if (!dateStr) return 'Never tested'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return formatDate(dateStr)
}

type SortField = 'name' | 'status' | 'tested'

export function APICConnectionSelector({ open, onOpenChange }: APICConnectionSelectorProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [localSelectedIds, setLocalSelectedIds] = useState<number[]>([])
  const [testingIds, setTestingIds] = useState<Set<number>>(new Set())
  const abortControllersRef = useRef<Map<number, AbortController>>(new Map())
  const [sortBy, setSortBy] = useState<SortField>('name')
  const queryClient = useQueryClient()

  const {
    selectedConnectionIds,
    setSelectedConnectionIds,
  } = useQueryBuilderStore()

  const { data: connections = [], isLoading, refetch } = useQuery({
    queryKey: ['apic-connections'],
    queryFn: () => apicService.getConnections(),
    staleTime: 30000,
  })

  // Sync local state when modal opens
  useEffect(() => {
    if (open) {
      setLocalSelectedIds([...selectedConnectionIds])
      setSearchTerm('')
    }
  }, [open, selectedConnectionIds])

  // Filter
  const filteredConnections = useMemo(() => {
    if (!searchTerm.trim()) return connections
    const term = searchTerm.toLowerCase()
    return connections.filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        c.url.toLowerCase().includes(term) ||
        c.description?.toLowerCase().includes(term) ||
        c.username.toLowerCase().includes(term)
    )
  }, [connections, searchTerm])

  // Sort — stable order, never reorder on selection change
  const sortedConnections = useMemo(() => {
    return [...filteredConnections].sort((a, b) => {
      if (sortBy === 'status') {
        const statusOrder = (s?: boolean | null) => s === true ? 0 : s === false ? 2 : 1
        const diff = statusOrder(a.last_test_status) - statusOrder(b.last_test_status)
        if (diff !== 0) return diff
      }
      if (sortBy === 'tested') {
        const aTime = a.last_tested_at ? new Date(a.last_tested_at).getTime() : 0
        const bTime = b.last_tested_at ? new Date(b.last_tested_at).getTime() : 0
        if (aTime !== bTime) return bTime - aTime
      }
      // Stable base: active first, then name
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }, [filteredConnections, sortBy])

  const handleToggleConnection = useCallback((id: number) => {
    setLocalSelectedIds([id])
  }, [])

  const handleTestConnection = useCallback(async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()

    // If already testing this connection, cancel it
    const existing = abortControllersRef.current.get(id)
    if (existing) {
      existing.abort()
      abortControllersRef.current.delete(id)
      setTestingIds(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      return
    }

    const controller = new AbortController()
    abortControllersRef.current.set(id, controller)
    setTestingIds(prev => new Set(prev).add(id))
    try {
      await apicService.testConnection(id, controller.signal)
      await queryClient.invalidateQueries({ queryKey: ['apic-connections'] })
    } catch {
      if (!controller.signal.aborted) {
        await queryClient.invalidateQueries({ queryKey: ['apic-connections'] })
      }
    } finally {
      abortControllersRef.current.delete(id)
      setTestingIds(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }, [queryClient])

  const handleConfirm = () => {
    setSelectedConnectionIds(localSelectedIds)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[680px] max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 space-y-3">
          <DialogHeader className="space-y-1">
            <DialogTitle className="text-base font-semibold">
              APIC Connection
            </DialogTitle>
            <DialogDescription className="text-xs">
              Select the target APIC controller
            </DialogDescription>
          </DialogHeader>

          {/* Toolbar: search + actions */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Search connections..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 h-8 text-sm"
                autoFocus
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Sort toggle */}
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 text-xs gap-1"
                    onClick={() => setSortBy(prev =>
                      prev === 'name' ? 'status' : prev === 'status' ? 'tested' : 'name'
                    )}
                  >
                    <ArrowUpDown className="w-3 h-3" />
                    {sortBy === 'name' ? 'Name' : sortBy === 'status' ? 'Status' : 'Tested'}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Sort by</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Refresh */}
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => refetch()}
                    disabled={isLoading}
                  >
                    <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Refresh list</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

        </div>

        <Separator />

        {/* Connection List */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-3 py-2 space-y-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : sortedConnections.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
                <Server className="w-8 h-8 opacity-30" />
                <span className="text-sm">
                  {searchTerm ? 'No connections match your search' : 'No APIC connections configured'}
                </span>
                {searchTerm && (
                  <Button variant="ghost" size="sm" className="text-xs" onClick={() => setSearchTerm('')}>
                    Clear search
                  </Button>
                )}
              </div>
            ) : (
              sortedConnections.map((conn) => (
                <ConnectionCard
                  key={conn.id}
                  connection={conn}
                  isSelected={localSelectedIds.includes(conn.id)}
                  isTesting={testingIds.has(conn.id)}
                  onToggle={() => handleToggleConnection(conn.id)}
                  onTest={(e) => handleTestConnection(conn.id, e)}
                />
              ))
            )}
          </div>
        </ScrollArea>

        <Separator />

        {/* Footer */}
        <div className="px-6 py-3 flex items-center gap-3">
          <div className="flex-1">
            <span className="text-[11px] text-muted-foreground">
              {filteredConnections.length} connection{filteredConnections.length !== 1 ? 's' : ''}
              {searchTerm && ` matching "${searchTerm}"`}
            </span>
          </div>

          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={localSelectedIds.length === 0}
          >
            {localSelectedIds.length === 0 ? 'Select' : 'Confirm'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Connection Card — the main list item
// ---------------------------------------------------------------------------

interface ConnectionCardProps {
  connection: APICConnection
  isSelected: boolean
  isTesting: boolean
  onToggle: () => void
  onTest: (e: React.MouseEvent) => void
}

function ConnectionCard({ connection, isSelected, isTesting, onToggle, onTest }: ConnectionCardProps) {
  const isHealthy = connection.last_test_status === true
  const isError = connection.last_test_status === false
  const isUnknown = connection.last_test_status == null
  const isStale = connection.last_tested_at
    ? (Date.now() - new Date(connection.last_tested_at).getTime()) > 3600000 // >1h
    : true

  return (
    <div
      className={cn(
        'group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-150',
        isSelected
          ? 'bg-primary/[0.06] ring-1 ring-primary/30'
          : 'hover:bg-muted/60',
        !connection.is_active && 'opacity-50'
      )}
      onClick={onToggle}
    >
      {/* Selection indicator */}
      <div className="flex-shrink-0">
        <div className={cn(
          'w-4 h-4 rounded-full border-[1.5px] flex items-center justify-center transition-colors',
          isSelected
            ? 'border-primary'
            : 'border-zinc-400 dark:border-zinc-600'
        )}>
          {isSelected && <div className="w-2 h-2 rounded-full bg-primary" />}
        </div>
      </div>

      {/* Status dot */}
      <div className="flex-shrink-0 relative">
        <div className={cn(
          'w-8 h-8 rounded-lg flex items-center justify-center',
          isSelected ? 'bg-primary/10' : 'bg-muted/80'
        )}>
          <Server className={cn(
            'w-4 h-4',
            isSelected ? 'text-primary' : 'text-muted-foreground'
          )} />
        </div>
        {/* Health indicator dot */}
        <div className={cn(
          'absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-background',
          isHealthy && 'bg-emerald-500',
          isError && 'bg-red-500',
          isUnknown && 'bg-zinc-400',
        )} />
      </div>

      {/* Connection info */}
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-sm truncate">{connection.name}</span>
          {connection.is_public ? (
            <Globe className="w-3 h-3 text-muted-foreground flex-shrink-0" />
          ) : (
            <Lock className="w-3 h-3 text-muted-foreground flex-shrink-0" />
          )}
          {!connection.is_active && (
            <Badge variant="outline" className="text-[10px] h-4 px-1 py-0">Inactive</Badge>
          )}
        </div>

        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="truncate">{connection.url}</span>
          <span className="text-zinc-600">·</span>
          <span className="flex items-center gap-0.5 flex-shrink-0">
            <User className="w-2.5 h-2.5" />
            {connection.username}
          </span>
        </div>

        {/* Status row */}
        <div className="flex items-center gap-2 text-[11px]">
          {isHealthy && (
            <span className="flex items-center gap-0.5 text-emerald-500">
              <CheckCircle2 className="w-3 h-3" />
              Healthy
            </span>
          )}
          {isError && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center gap-0.5 text-red-500 cursor-help">
                    <XCircle className="w-3 h-3" />
                    Error
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-xs">
                  {connection.last_test_message || 'Connection test failed'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {isUnknown && (
            <span className="flex items-center gap-0.5 text-zinc-500">
              <Circle className="w-3 h-3" />
              Not tested
            </span>
          )}

          {connection.last_tested_at && (
            <>
              <span className="text-zinc-600">·</span>
              <span className={cn(
                'flex items-center gap-0.5',
                isStale ? 'text-amber-500' : 'text-muted-foreground'
              )}>
                <Clock className="w-2.5 h-2.5" />
                {timeAgo(connection.last_tested_at)}
              </span>
            </>
          )}

          {connection.verify_ssl ? (
            <span className="flex items-center gap-0.5 text-muted-foreground">
              <ShieldCheck className="w-2.5 h-2.5" />
              TLS
            </span>
          ) : (
            <span className="flex items-center gap-0.5 text-amber-500">
              <ShieldOff className="w-2.5 h-2.5" />
              No TLS
            </span>
          )}
        </div>
      </div>

      {/* Test button — visible on hover or when testing */}
      <div className="flex-shrink-0">
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={isTesting ? 'destructive' : 'ghost'}
                size="sm"
                className={cn(
                  'h-7 w-7 p-0 transition-opacity',
                  !isTesting && 'opacity-0 group-hover:opacity-100'
                )}
                onClick={onTest}
              >
                {isTesting ? (
                  <X className="w-3.5 h-3.5" />
                ) : (
                  <Activity className="w-3.5 h-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">{isTesting ? 'Cancel test' : 'Test connection'}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  )
}

export default APICConnectionSelector
