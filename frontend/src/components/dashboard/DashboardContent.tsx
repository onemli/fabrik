// DashboardContent.tsx
//
// Landing page after login. Designed to answer one question in under 3
// seconds: "is everything okay, and if not, what needs my attention?"
//
// Layout: greeting → attention alerts → KPI strip → 2×2 detail cards
// → activity timeline. Each card links to the relevant detail page.

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { dashboardService, DashboardStats } from '@/services/dashboard'
import { cn } from '@/lib/utils'
import { useFormatters } from '@/contexts/TimezoneContext'
import {
  Area, AreaChart, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'
import {
  Database,
  ListChecks,
  Server,
  Radio,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  ArrowUpRight,
  ArrowUp,
  ArrowDown,
  Minus,
  AlertCircle,
  Info,
  ChevronRight,
} from 'lucide-react'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function deltaSign(current: number, previous: number): { icon: typeof ArrowUp; color: string; label: string } | null {
  if (previous === 0 && current === 0) return null
  if (previous === 0) return { icon: ArrowUp, color: 'text-emerald-400', label: 'new' }
  const pct = Math.round(((current - previous) / previous) * 100)
  if (pct === 0) return { icon: Minus, color: 'text-muted-foreground/70', label: '0%' }
  if (pct > 0) return { icon: ArrowUp, color: 'text-emerald-400', label: `${pct}%` }
  return { icon: ArrowDown, color: 'text-red-400', label: `${Math.abs(pct)}%` }
}

// ─── Greeting + Attention ─────────────────────────────────────────────────────

function GreetingBar({ stats, onRefresh, refreshedAt }: {
  stats: DashboardStats
  onRefresh: () => void
  refreshedAt: Date | null
}) {
  const { formatTime } = useFormatters()
  const { user } = useAuthStore()
  const name = user?.first_name || user?.username || ''
  const attentionCount = stats.attention?.length ?? 0

  return (
    <div className="px-6 pt-6 pb-2 flex items-start justify-between">
      <div>
        <h1 className="text-lg font-semibold text-foreground tracking-tight">
          {greeting()}{name ? `, ${name}` : ''}.
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {attentionCount === 0
            ? 'Everything looks good across your infrastructure.'
            : `${attentionCount} ${attentionCount === 1 ? 'item needs' : 'items need'} your attention.`
          }
        </p>
      </div>
      <button
        onClick={onRefresh}
        className="flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-muted-foreground/70 transition-colors mt-1"
        title="Refresh dashboard"
      >
        <RefreshCw className="w-3 h-3" />
        {refreshedAt ? formatTime(refreshedAt) : ''}
      </button>
    </div>
  )
}

function AttentionList({ items }: { items: DashboardStats['attention'] }) {
  const navigate = useNavigate()
  if (!items || items.length === 0) return null

  const severityConfig = {
    critical: { bg: 'bg-red-500/8 border-red-500/20', icon: AlertCircle, iconColor: 'text-red-400' },
    warning:  { bg: 'bg-amber-500/8 border-amber-500/20', icon: AlertTriangle, iconColor: 'text-amber-400' },
    info:     { bg: 'bg-blue-500/8 border-blue-500/20', icon: Info, iconColor: 'text-blue-400' },
  }

  return (
    <div className="px-6 pb-1 space-y-2">
      {items.map((item, i) => {
        const cfg = severityConfig[item.severity]
        const Icon = cfg.icon
        return (
          <button
            key={i}
            onClick={() => navigate(item.link)}
            className={cn(
              'w-full flex items-center gap-3 px-4 py-2.5 rounded-lg border text-left transition-colors hover:brightness-110',
              cfg.bg
            )}
          >
            <Icon className={cn('w-4 h-4 flex-shrink-0', cfg.iconColor)} />
            <span className="text-sm text-foreground flex-1">{item.message}</span>
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        )
      })}
    </div>
  )
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

function Sparkline({ data, color = 'hsl(var(--primary))' }: { data: number[]; color?: string }) {
  const chartData = data.map((v, i) => ({ i, v }))
  return (
    <ResponsiveContainer width="100%" height={32}>
      <AreaChart data={chartData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`spark-${color.replace(/[^a-z0-9]/gi, '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#spark-${color.replace(/[^a-z0-9]/gi, '')})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// ─── Success Rate Ring ────────────────────────────────────────────────────────

function SuccessRing({ rate, size = 56 }: { rate: number | null; size?: number }) {
  if (rate === null) {
    return (
      <div
        className="flex items-center justify-center rounded-full border border-border/30"
        style={{ width: size, height: size }}
      >
        <span className="text-xs text-muted-foreground/70">—</span>
      </div>
    )
  }

  const ringColor = rate >= 90 ? '#34d399' : rate >= 70 ? '#fbbf24' : '#f87171'
  const data = [
    { name: 'success', value: rate },
    { name: 'rest', value: 100 - rate },
  ]

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            cx="50%"
            cy="50%"
            innerRadius={size / 2 - 5}
            outerRadius={size / 2 - 1}
            startAngle={90}
            endAngle={-270}
            strokeWidth={0}
            isAnimationActive={false}
          >
            <Cell fill={ringColor} />
            <Cell fill="hsl(var(--muted) / 0.3)" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xs font-semibold tabular-nums" style={{ color: ringColor }}>
          {Math.round(rate)}%
        </span>
      </div>
    </div>
  )
}

// ─── KPI Strip ────────────────────────────────────────────────────────────────

interface KpiProps {
  label: string
  value: number | string
  sub?: string
  icon: React.ElementType
  accent?: 'neutral' | 'green' | 'amber' | 'red'
  to: string
  delta?: { current: number; previous: number }
  sparkline?: number[]
  sparkColor?: string
}

function KpiTile({ label, value, sub, icon: Icon, accent = 'neutral', to, delta, sparkline, sparkColor }: KpiProps) {
  const numColor = {
    neutral: 'text-foreground',
    green:   'text-emerald-400',
    amber:   'text-amber-400',
    red:     'text-red-400',
  }[accent]

  const d = delta ? deltaSign(delta.current, delta.previous) : null

  return (
    <Link
      to={to}
      className="group flex flex-col gap-2 px-6 py-5 hover:bg-muted/10 transition-colors cursor-pointer"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </span>
        <div className="flex items-center gap-1.5">
          <Icon className="w-3.5 h-3.5 text-muted-foreground/25" />
          <ArrowUpRight className="w-3 h-3 text-muted-foreground/0 group-hover:text-muted-foreground/70 transition-colors" />
        </div>
      </div>

      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="flex items-baseline gap-2">
            <span className={cn('text-[2.25rem] font-light tabular-nums leading-none tracking-tight', numColor)}>
              {value}
            </span>
            {d && (
              <span className={cn('flex items-center gap-0.5 text-xs font-medium', d.color)}>
                <d.icon className="w-3 h-3" />
                {d.label}
              </span>
            )}
          </div>
          {sub && (
            <p className="text-xs text-muted-foreground/70 mt-1">{sub}</p>
          )}
        </div>
        {sparkline && sparkline.length > 0 && sparkline.some(v => v > 0) && (
          <div className="w-20 flex-shrink-0 opacity-50 group-hover:opacity-80 transition-opacity">
            <Sparkline data={sparkline} color={sparkColor} />
          </div>
        )}
      </div>
    </Link>
  )
}

// ─── Section card ─────────────────────────────────────────────────────────────

function SectionCard({ title, dot, to, children, right }: {
  title: string
  dot: string
  to: string
  children: React.ReactNode
  right?: React.ReactNode
}) {
  return (
    <div className="bg-card/40 border border-border/25 rounded-xl overflow-hidden">
      <Link
        to={to}
        className="group flex items-center justify-between px-5 py-3.5 border-b border-border/20 hover:bg-muted/10 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', dot)} />
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {title}
          </span>
        </div>
        <ArrowUpRight className="w-3 h-3 text-muted-foreground/0 group-hover:text-muted-foreground/70 transition-colors" />
      </Link>
      <div className="p-5">
        {right ? (
          <div className="flex items-start gap-5">
            <div className="flex-1 min-w-0">{children}</div>
            <div className="flex-shrink-0">{right}</div>
          </div>
        ) : children}
      </div>
    </div>
  )
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

function MetricRow({ label, value, accent = 'neutral' }: {
  label: string
  value: number | string | null
  accent?: 'neutral' | 'green' | 'amber' | 'red'
}) {
  const numColor = {
    neutral: 'text-foreground',
    green:   'text-emerald-400',
    amber:   'text-amber-400',
    red:     'text-red-400',
  }[accent]

  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-muted-foreground truncate">{label}</span>
      <span className={cn('text-xl font-semibold tabular-nums flex-shrink-0', numColor)}>
        {value ?? '—'}
      </span>
    </div>
  )
}

function MetricGrid({ children }: { children: React.ReactNode }) {
  return <div className="space-y-3.5">{children}</div>
}

// ─── Activity Timeline ───────────────────────────────────────────────────────

// Group consecutive events with the same action into a single line
// so the feed doesn't read like a raw audit log dump.
function groupActivity(events: DashboardStats['activity']) {
  if (events.length === 0) return []

  const groups: Array<{
    action: string
    resource: string
    users: string[]
    count: number
    time: string | null
    allSuccess: boolean
  }> = []

  for (const evt of events) {
    const last = groups[groups.length - 1]
    if (last && last.action === evt.action && last.resource === evt.resource) {
      last.count++
      if (evt.user && !last.users.includes(evt.user)) last.users.push(evt.user)
      if (!evt.success) last.allSuccess = false
    } else {
      groups.push({
        action: evt.action,
        resource: evt.resource,
        users: evt.user ? [evt.user] : [],
        count: 1,
        time: evt.time,
        allSuccess: evt.success,
      })
    }
  }
  return groups
}

function ActivitySection({ activity }: { activity: DashboardStats['activity'] }) {
  const groups = useMemo(() => groupActivity(activity), [activity])

  return (
    <div className="bg-card/40 border border-border/25 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/20">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-500/50 flex-shrink-0" />
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Recent Activity
          </span>
        </div>
        <span className="text-xs text-muted-foreground">{activity.length} events</span>
      </div>

      <div className="px-5 pt-4 pb-5">
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground/70 text-center py-6">No recent activity</p>
        ) : (
          groups.map((g, i) => {
            const last = i === groups.length - 1
            const actionText = g.action.replace(/_/g, ' ')
            const userStr = g.users.length <= 2 ? g.users.join(', ') : `${g.users[0]} +${g.users.length - 1}`
            return (
              <div key={i} className="flex items-start gap-3">
                <div className="flex flex-col items-center flex-shrink-0 pt-1">
                  {g.allSuccess
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400/70" />
                    : <XCircle className="w-3.5 h-3.5 text-red-400/70" />
                  }
                  {!last && <div className="w-px flex-1 bg-border/20 mt-1.5 min-h-[20px]" />}
                </div>
                <div className={cn('flex-1 min-w-0', last ? 'pb-0' : 'pb-4')}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm text-foreground capitalize truncate leading-snug">
                        {g.count > 1 ? `${g.count}× ` : ''}{actionText}
                      </p>
                      {g.resource && (
                        <p className="text-xs text-muted-foreground/70 mt-0.5">{g.resource}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
                      {userStr && (
                        <span className="text-xs text-muted-foreground/70 font-medium">{userStr}</span>
                      )}
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {relativeTime(g.time)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ connections }: { connections: number }) {
  const navigate = useNavigate()

  if (connections > 0) return null

  return (
    <div className="mx-6 mb-4 p-6 rounded-xl border border-dashed border-primary/30 bg-primary/5 text-center">
      <Radio className="w-8 h-8 text-primary/50 mx-auto mb-3" />
      <h3 className="text-sm font-semibold text-foreground mb-1">Welcome to Fabrik</h3>
      <p className="text-xs text-muted-foreground max-w-sm mx-auto mb-4">
        Connect your first APIC to start building queries, scheduling tasks, and monitoring your ACI fabric.
      </p>
      <button
        onClick={() => navigate('/settings/connections')}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        <Radio className="w-4 h-4" />
        Add APIC Connection
      </button>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const REFRESH_MS = 60_000

export function DashboardContent() {
  const [stats, setStats]             = useState<DashboardStats | null>(null)
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState<string | null>(null)
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      const data = await dashboardService.fetchStats()
      setStats(data)
      setRefreshedAt(new Date())
    } catch (e: any) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => clearInterval(id)
  }, [load])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
      </div>
    )
  }

  if (error || !stats) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <AlertTriangle className="w-7 h-7 text-amber-400/60 mx-auto" />
          <p className="text-sm text-muted-foreground">{error ?? 'No data'}</p>
          <button onClick={load} className="text-xs text-primary/70 hover:text-primary transition-colors">
            Retry
          </button>
        </div>
      </div>
    )
  }

  const { queries: q, scheduled_tasks: st, awx, time_machine: tm, connections: conn, activity } = stats

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">

        {/* Greeting — replaces the old generic health banner */}
        <GreetingBar stats={stats} onRefresh={load} refreshedAt={refreshedAt} />

        {/* Attention items — actionable alerts front and center */}
        <AttentionList items={stats.attention} />

        {/* Onboarding nudge when no connections exist */}
        <EmptyState connections={conn.total} />

        {/* KPI strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-border/20 border-y border-border/20 mt-2">
          <KpiTile
            label="APIC Connections"
            value={conn.total}
            sub={`${conn.active} active`}
            icon={Radio}
            accent={conn.inactive > 0 ? 'amber' : 'neutral'}
            to="/settings/connections"
          />
          <KpiTile
            label="Query Executions"
            value={q.executions_24h}
            sub="last 24h"
            icon={Database}
            to="/saved"
            delta={{ current: q.executions_24h, previous: q.prev_24h }}
            sparkline={q.sparkline_7d}
            sparkColor="#60a5fa"
          />
          <KpiTile
            label="Scheduled Tasks"
            value={st.executions_24h}
            sub={st.overdue > 0 ? `${st.overdue} overdue` : `${st.active} active`}
            icon={ListChecks}
            accent={st.overdue > 0 ? 'red' : 'neutral'}
            to="/tasks"
            delta={{ current: st.executions_24h, previous: st.prev_24h }}
            sparkline={st.sparkline_7d}
            sparkColor="#a78bfa"
          />
          <KpiTile
            label="AWX Requests"
            value={awx.requests_7d}
            sub="last 7 days"
            icon={Server}
            to="/awx/executions"
            delta={{ current: awx.requests_7d, previous: awx.prev_7d }}
            sparkline={awx.sparkline_7d}
            sparkColor="#fb923c"
          />
        </div>

        {/* Detail cards */}
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

            {/* Query Execution */}
            <SectionCard
              title="Query Execution — last 24h"
              dot="bg-blue-500/60"
              to="/saved"
              right={<SuccessRing rate={q.success_rate_7d} />}
            >
              <MetricGrid>
                <MetricRow label="Total executions" value={q.executions_24h} />
                <MetricRow label="Successful" value={q.success_24h} accent={q.success_24h > 0 ? 'green' : 'neutral'} />
                <MetricRow label="Failed" value={q.failed_24h} accent={q.failed_24h > 0 ? 'red' : 'neutral'} />
                <MetricRow label="Running now" value={q.running_now} accent={q.running_now > 0 ? 'amber' : 'neutral'} />
              </MetricGrid>
            </SectionCard>

            {/* Scheduled Tasks */}
            <SectionCard title="Scheduled Tasks — last 24h" dot="bg-violet-500/60" to="/tasks">
              <MetricGrid>
                <MetricRow label="Total executions" value={st.executions_24h} />
                <MetricRow label="Successful" value={st.success_24h} accent={st.success_24h > 0 ? 'green' : 'neutral'} />
                <MetricRow label="Failed" value={st.failed_24h} accent={st.failed_24h > 0 ? 'red' : 'neutral'} />
                <MetricRow label="Running now" value={st.running_now} accent={st.running_now > 0 ? 'amber' : 'neutral'} />
                <MetricRow label="Overdue tasks" value={st.overdue} accent={st.overdue > 0 ? 'red' : 'neutral'} />
              </MetricGrid>
            </SectionCard>

            {/* AWX */}
            <SectionCard
              title="Ansible Automation — last 7 days"
              dot="bg-orange-500/60"
              to="/awx/executions"
              right={<SuccessRing rate={awx.success_rate_7d} />}
            >
              <MetricGrid>
                <MetricRow label="Requests" value={awx.requests_7d} />
                <MetricRow label="Successful" value={awx.successful_7d} accent={awx.successful_7d > 0 ? 'green' : 'neutral'} />
                <MetricRow label="Failed" value={awx.failed_7d} accent={awx.failed_7d > 0 ? 'red' : 'neutral'} />
                <MetricRow label="Running jobs" value={awx.running_jobs} accent={awx.running_jobs > 0 ? 'amber' : 'neutral'} />
              </MetricGrid>
            </SectionCard>

            {/* Time Machine */}
            <SectionCard title="Time Machine" dot="bg-emerald-500/60" to="/time-machine">
              <MetricGrid>
                <MetricRow label="Total snapshots" value={tm.total_snapshots} />
                <MetricRow label="New snapshots (24h)" value={tm.snapshots_24h} />
                <MetricRow label="Changes detected (24h)" value={tm.changes_detected_24h} accent={tm.changes_detected_24h > 0 ? 'amber' : 'neutral'} />
                <MetricRow label="Monitored queries (7d)" value={tm.monitored_queries} />
                <MetricRow label="Annotated snapshots" value={tm.annotated_snapshots} />
              </MetricGrid>
            </SectionCard>
          </div>

          {/* Activity feed */}
          <ActivitySection activity={activity} />
        </div>
      </div>
    </div>
  )
}
