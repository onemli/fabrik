// pages/Notifications.tsx
//
// Full-page notification inbox. Grouped by date (Today / Yesterday / This week /
// Older), tab-filtered by read status, type-filtered by chip, and searchable.
// All mutations push a WebSocket count update so the header badge stays in sync.

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { formatDistanceToNow } from 'date-fns'
import {
  Bell,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Info,
  Trash2,
  Check,
  Search,
  Inbox,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { api } from '@/services/api'

interface Notification {
  id: string
  type: 'info' | 'success' | 'warning' | 'error'
  title: string
  message: string
  is_read: boolean
  created_at: string
  related_task_id?: string
  related_execution_id?: string
}

const TYPE_CONFIG = {
  info:    { icon: Info,         color: 'text-blue-500',   bg: 'bg-blue-500/10',   label: 'Info' },
  success: { icon: CheckCircle2, color: 'text-green-500',  bg: 'bg-green-500/10',  label: 'Success' },
  warning: { icon: AlertCircle,  color: 'text-orange-500', bg: 'bg-orange-500/10', label: 'Warning' },
  error:   { icon: XCircle,      color: 'text-red-500',    bg: 'bg-red-500/10',    label: 'Error' },
} as const

const TYPE_FILTERS = ['all', 'success', 'info', 'warning', 'error'] as const

// Group notifications into buckets based on their timestamp.
function groupByDate(items: Notification[]): { label: string; items: Notification[] }[] {
  const now = new Date()
  const startOfToday    = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfYesterday = new Date(startOfToday.getTime() - 86_400_000)
  const startOfWeek      = new Date(startOfToday.getTime() - 6 * 86_400_000)

  const buckets: Record<string, Notification[]> = {
    Today:     [],
    Yesterday: [],
    'Last 7 days': [],
    Older:     [],
  }

  for (const n of items) {
    const d = new Date(n.created_at)
    if (d >= startOfToday)    buckets['Today'].push(n)
    else if (d >= startOfYesterday) buckets['Yesterday'].push(n)
    else if (d >= startOfWeek)      buckets['Last 7 days'].push(n)
    else                            buckets['Older'].push(n)
  }

  return Object.entries(buckets)
    .filter(([, v]) => v.length > 0)
    .map(([label, items]) => ({ label, items }))
}

// Single skeleton row placeholder shown while loading.
function NotificationSkeleton() {
  return (
    <div className="flex items-start gap-4 px-5 py-4 border-b border-border last:border-0">
      <Skeleton className="w-8 h-8 rounded-full flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-80" />
      </div>
      <Skeleton className="h-3 w-16" />
    </div>
  )
}

// Empty state shown when the filtered list is empty.
function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <Inbox className="w-8 h-8 text-muted-foreground" />
      </div>
      <h3 className="text-base font-semibold mb-1">
        {hasFilters ? 'No matching notifications' : 'All caught up'}
      </h3>
      <p className="text-sm text-muted-foreground max-w-xs">
        {hasFilters
          ? 'Try adjusting your search or filters.'
          : 'New notifications will appear here when tasks run or automations complete.'}
      </p>
    </div>
  )
}

export default function Notifications() {
  const queryClient = useQueryClient()
  const [tab, setTab]               = useState<'all' | 'unread' | 'read'>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [search, setSearch]         = useState('')

  // Fetch all notifications for the current user (no server-side tab filtering —
  // we do that client-side so the unread count is always accurate).
  const { data: notifications = [], isLoading } = useQuery<Notification[]>({
    queryKey: ['notifications', 'page'],
    queryFn: async () => {
      const res = await api.get('/api/notifications/notifications/?ordering=-created_at')
      return Array.isArray(res.data) ? res.data : (res.data?.results ?? [])
    },
  })

  const unreadCount = useMemo(() => notifications.filter(n => !n.is_read).length, [notifications])
  const readCount   = useMemo(() => notifications.filter(n =>  n.is_read).length,  [notifications])

  // Apply tab + type + search filters client-side.
  const visible = useMemo(() => {
    let items = notifications
    if (tab === 'unread') items = items.filter(n => !n.is_read)
    if (tab === 'read')   items = items.filter(n =>  n.is_read)
    if (typeFilter !== 'all') items = items.filter(n => n.type === typeFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter(n =>
        n.title.toLowerCase().includes(q) || n.message.toLowerCase().includes(q)
      )
    }
    return items
  }, [notifications, tab, typeFilter, search])

  const grouped = useMemo(() => groupByDate(visible), [visible])
  const hasFilters = tab !== 'all' || typeFilter !== 'all' || search.trim() !== ''

  // ── Mutations ──────────────────────────────────────────────────────────────

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['notifications'] })

  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/notifications/notifications/${id}/mark_read/`),
    onSuccess: () => invalidate(),
    onError: () => toast.error('Could not mark notification as read'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/notifications/notifications/${id}/`),
    onSuccess: () => invalidate(),
    onError: () => toast.error('Could not delete notification'),
  })

  const markAllReadMutation = useMutation({
    mutationFn: () => api.post('/api/notifications/notifications/mark_all_read/'),
    onSuccess: () => {
      invalidate()
      toast.success('All notifications marked as read')
    },
    onError: () => toast.error('Could not mark all as read'),
  })

  const deleteReadMutation = useMutation({
    mutationFn: () => api.delete('/api/notifications/notifications/delete_read/'),
    onSuccess: (res) => {
      invalidate()
      const count = (res.data as any)?.deleted ?? 0
      toast.success(`${count} read notification${count !== 1 ? 's' : ''} deleted`)
    },
    onError: () => toast.error('Could not delete read notifications'),
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col min-h-full bg-background">
      <div className="w-full px-6 py-8 flex flex-col gap-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-3">
              <Bell className="w-6 h-6 text-primary" />
              Notifications
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {notifications.length} total
              {unreadCount > 0 && <> · <span className="text-primary font-medium">{unreadCount} unread</span></>}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {readCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => deleteReadMutation.mutate()}
                disabled={deleteReadMutation.isPending}
              >
                <Trash2 className="w-4 h-4 mr-1.5" />
                Delete read
              </Button>
            )}
            {unreadCount > 0 && (
              <Button
                size="sm"
                onClick={() => markAllReadMutation.mutate()}
                disabled={markAllReadMutation.isPending}
              >
                <Check className="w-4 h-4 mr-1.5" />
                Mark all read
              </Button>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Tab filter */}
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList>
              <TabsTrigger value="all">
                All
                {notifications.length > 0 && (
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                    {notifications.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="unread">
                Unread
                {unreadCount > 0 && (
                  <Badge className="ml-1.5 h-4 px-1 text-[10px]">
                    {unreadCount}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="read">
                Read
                {readCount > 0 && (
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                    {readCount}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Type chips */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {TYPE_FILTERS.map((t) => {
              const active = typeFilter === t
              if (t === 'all') {
                return (
                  <button
                    key={t}
                    onClick={() => setTypeFilter('all')}
                    className={cn(
                      'px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors',
                      active
                        ? 'bg-foreground text-background border-foreground'
                        : 'border-border text-muted-foreground hover:border-foreground/50'
                    )}
                  >
                    All types
                  </button>
                )
              }
              const cfg = TYPE_CONFIG[t as keyof typeof TYPE_CONFIG]
              return (
                <button
                  key={t}
                  onClick={() => setTypeFilter(active ? 'all' : t)}
                  className={cn(
                    'px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors',
                    active
                      ? `${cfg.bg} ${cfg.color} border-current`
                      : 'border-border text-muted-foreground hover:border-foreground/50'
                  )}
                >
                  {cfg.label}
                </button>
              )
            })}
          </div>

          {/* Search */}
          <div className="relative sm:ml-auto sm:w-56">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9 text-sm"
            />
          </div>
        </div>

        {/* List */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => <NotificationSkeleton key={i} />)
          ) : grouped.length === 0 ? (
            <EmptyState hasFilters={hasFilters} />
          ) : (
            grouped.map(({ label, items }) => (
              <div key={label}>
                {/* Date group header */}
                <div className="px-5 py-2 bg-muted/40 border-b border-border">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {label}
                  </span>
                </div>

                {/* Notification rows */}
                {items.map((n) => {
                  const cfg = TYPE_CONFIG[n.type]
                  const Icon = cfg.icon
                  return (
                    <div
                      key={n.id}
                      className={cn(
                        'flex items-start gap-4 px-5 py-4 border-b border-border last:border-0 transition-colors',
                        !n.is_read && 'bg-primary/[0.03]'
                      )}
                    >
                      {/* Unread dot + icon */}
                      <div className="flex items-center gap-2 pt-0.5 flex-shrink-0">
                        <div className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', !n.is_read ? 'bg-primary' : 'bg-transparent')} />
                        <div className={cn('w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0', cfg.bg)}>
                          <Icon className={cn('w-4 h-4', cfg.color)} />
                        </div>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <p className={cn('text-sm leading-snug truncate', !n.is_read ? 'font-semibold text-foreground' : 'font-medium text-foreground/80')}>
                          {n.title}
                        </p>
                        <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
                          {n.message}
                        </p>
                      </div>

                      {/* Time + actions */}
                      <div className="flex flex-col items-end gap-2 flex-shrink-0 ml-2">
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                        </span>
                        <div className="flex items-center gap-1">
                          {!n.is_read && (
                            <button
                              onClick={() => markReadMutation.mutate(n.id)}
                              disabled={markReadMutation.isPending}
                              title="Mark as read"
                              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => deleteMutation.mutate(n.id)}
                            disabled={deleteMutation.isPending}
                            title="Delete"
                            className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
