// settings/MIMManagement.tsx — admin UI for managing the active MIM version.

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  CheckCircle2,
  Cloud,
  Database,
  FileCode2,
  History,
  Loader2,
  Package,
  Square,
  User as UserIcon,
} from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { cn } from '@/lib/utils'
import { useFormatters } from '@/contexts/TimezoneContext'
import { useMIMImportWebSocket } from '@/hooks/useMIMImportWebSocket'
import {
  DevNetVersion,
  MIMStatusResponse,
  mimRegistryService,
} from '@/services/mimRegistry'

const STATUS_KEY = ['mim-registry', 'status']
const DEVNET_VERSIONS_KEY = ['mim-registry', 'devnet-versions']

/**
 * Backend stores `apic_version` as the compact DevNet key (e.g. '611'), but
 * operators recognise versions by their dotted form ('6.1.X'). DevNet keys
 * are always major+minor+release-family digits — display as "X.Y.X".
 */
function formatApicVersion(raw: string | null | undefined): string {
  if (!raw) return ''
  if (!/^\d{3,}$/.test(raw)) return raw
  return `${raw[0]}.${raw[1]}.X`
}

export default function MIMManagement() {
  const queryClient = useQueryClient()
  const { formatDateTime } = useFormatters()

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'devnet'>('overview')

  const statusQuery = useQuery<MIMStatusResponse>({
    queryKey: STATUS_KEY,
    queryFn: () => mimRegistryService.getStatus(),
    refetchInterval: (q) => (q.state.data?.active_import ? 5000 : false),
  })

  // While attached to a running run, poll the REST run detail every 2s as a
  // safety-net seed so the progress card never sits empty waiting for the
  // next WebSocket frame (especially right after a page refresh).
  const runQuery = useQuery({
    queryKey: ['mim-registry', 'devnet-run', activeRunId],
    queryFn: () => mimRegistryService.getDevNetRun(activeRunId!),
    enabled: !!activeRunId,
    refetchInterval: 2000,
  })

  const importWs = useMIMImportWebSocket({
    taskId: activeTaskId,
    onSuccess: () => {
      toast.success('MIM import completed')
      setActiveTaskId(null)
      setActiveRunId(null)
      queryClient.invalidateQueries({ queryKey: STATUS_KEY })
    },
    onFailure: (err) => {
      toast.error(`MIM import failed: ${err}`)
      setActiveTaskId(null)
      setActiveRunId(null)
    },
    onCancelled: () => {
      toast.info('Import cancelled')
      setActiveTaskId(null)
      setActiveRunId(null)
      queryClient.invalidateQueries({ queryKey: STATUS_KEY })
    },
  })

  const status = statusQuery.data
  const active = status?.active ?? null

  // Refresh-proof: if the backend reports a running import, attach to it.
  const serverTaskId = status?.active_import?.task_id ?? null
  const serverDevNetRunId = status?.active_import?.devnet_run_id ?? null
  useEffect(() => {
    if (serverTaskId && !activeTaskId) {
      setActiveTaskId(serverTaskId)
      if (serverDevNetRunId) setActiveRunId(serverDevNetRunId)
    }
  }, [serverTaskId, serverDevNetRunId, activeTaskId])

  const loading = statusQuery.isLoading

  return (
    <div className="space-y-6 w-full">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Database className="w-5 h-5" />
          MIM Management
        </h2>
        <p className="text-sm text-muted-foreground">
          Manage the Cisco ACI Managed Information Model (MIM) version Fabrik uses to
          validate queries, build topology maps, and power the Class Browser.
        </p>
      </div>

      {activeTaskId && (() => {
        // WebSocket fields take priority once they've populated; REST seed fills
        // the gap right after attach (page refresh) or between throttled frames.
        const seedRun = runQuery.data?.run
        const wsActive = importWs.done > 0 || importWs.total > 0 || importWs.phase !== null
        const phase = importWs.phase ?? (seedRun?.phase ?? null)
        const done = wsActive ? importWs.done : (seedRun?.completed_count ?? 0)
        const total = wsActive ? importWs.total : (seedRun?.total_classes ?? 0)
        const fallbackCount = wsActive ? importWs.fallbackCount : (seedRun?.fallback_count ?? 0)
        const notFoundCount = wsActive ? importWs.notFoundCount : (seedRun?.not_found_count ?? 0)
        const failedCount = wsActive ? importWs.failedCount : (seedRun?.failed_count ?? 0)
        const progress = total > 0 ? Math.min(99, Math.floor((done / total) * 100)) : importWs.progress
        const cancelRequested = !!seedRun?.cancel_requested
        // Default phase-aware status text so the card never reads "Starting…"
        // forever after a refresh while the WebSocket is reconnecting.
        const fallbackMessage =
          phase === 'init'        ? 'Preparing…' :
          phase === 'downloading' ? 'Downloading classes from Cisco DevNet…' :
          phase === 'importing'   ? 'Writing to Neo4j…' :
          phase === 'finalizing'  ? 'Building search indexes…' :
          phase === 'done'        ? 'Finished.' : 'Starting…'
        return (
          <ImportProgressCard
            progress={progress}
            message={importWs.message || fallbackMessage}
            taskId={activeTaskId}
            phase={phase}
            done={done}
            total={total}
            fallbackCount={fallbackCount}
            notFoundCount={notFoundCount}
            failedCount={failedCount}
            cancelRequested={cancelRequested}
            runId={activeRunId}
            onCancel={async () => {
              if (!activeRunId) return
              try {
                await mimRegistryService.cancelDevNetRun(activeRunId)
                toast.info('Cancellation requested — finishing current chunk')
                queryClient.invalidateQueries({ queryKey: ['mim-registry', 'devnet-run', activeRunId] })
              } catch (e: any) {
                toast.error(e?.message || 'Cancel failed')
              }
            }}
          />
        )
      })()}

      <div className="flex items-center gap-8 border-b border-border/20">
        {([
          { id: 'overview', label: 'Overview',     Icon: Package, color: 'primary', count: active ? 1 : 0 },
          { id: 'devnet',   label: 'Cisco DevNet', Icon: Cloud,   color: 'sky',     count: null as number | null },
        ] as const).map((tab) => {
          const isActive = activeTab === tab.id
          const borderCls =
            tab.color === 'primary' ? 'border-primary' : 'border-sky-500'
          const iconCls =
            tab.color === 'primary' ? 'text-primary' : 'text-sky-500'
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'group flex items-center gap-2 px-2 py-4 border-b-2 transition-all duration-200 font-semibold',
                isActive
                  ? `${borderCls} text-foreground`
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
              )}
            >
              <tab.Icon className={cn('w-4 h-4 transition-colors', isActive ? iconCls : 'text-muted-foreground group-hover:text-foreground')} />
              <span className="text-sm">{tab.label}</span>
              {tab.count !== null && (
                <Badge variant={isActive ? 'default' : 'secondary'} className="ml-1 text-xs px-2 py-0.5 transition-none">
                  {tab.count}
                </Badge>
              )}
            </button>
          )
        })}
      </div>

      {activeTab === 'overview' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="w-5 h-5" />
                Currently Installed
              </CardTitle>
              <CardDescription>
                Version loaded in Neo4j and served to every Fabrik feature.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {loading ? (
                <div className="h-28 bg-muted animate-pulse rounded-lg" />
              ) : active ? (
                <>
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-2xl font-semibold font-mono">
                          {formatApicVersion(active.apic_version)}
                        </span>
                        <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                          Active
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        Imported {formatDateTime(active.imported_at)}
                        {active.imported_by_username
                          ? ` by ${active.imported_by_username}`
                          : ''}
                      </p>
                    </div>
                  </div>

                  <Separator />

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <Stat
                      icon={Database}
                      label="Classes"
                      value={active.class_count.toLocaleString()}
                    />
                    <Stat
                      icon={FileCode2}
                      label="Properties"
                      value={active.property_count.toLocaleString()}
                    />
                    <Stat
                      icon={Package}
                      label="Relationships"
                      value={active.rel_count.toLocaleString()}
                    />
                  </div>
                </>
              ) : (
                <div className="text-center py-8">
                  <Database className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground">
                    No MIM version loaded. Install one from the{' '}
                    <button
                      type="button"
                      className="text-sky-600 hover:underline font-medium"
                      onClick={() => setActiveTab('devnet')}
                    >
                      Cisco DevNet
                    </button>{' '}
                    tab.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {status && status.history.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <History className="w-5 h-5" />
                  Import History
                </CardTitle>
                <CardDescription>Recent MIM imports (last 20).</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Version</TableHead>
                      <TableHead>Imported</TableHead>
                      <TableHead>By</TableHead>
                      <TableHead className="text-right">Classes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {status.history.map((row) => (
                      <TableRow key={row.apic_version + row.imported_at}>
                        <TableCell className="font-mono text-sm">
                          {formatApicVersion(row.apic_version)}
                          {row.is_active && (
                            <Badge className="ml-2 bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                              <CheckCircle2 className="w-3 h-3 mr-1" />
                              active
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {formatDateTime(row.imported_at)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {row.imported_by_username ? (
                            <span className="flex items-center gap-1">
                              <UserIcon className="w-3 h-3" />
                              {row.imported_by_username}
                            </span>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {row.class_count.toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {activeTab === 'devnet' && (
        <DevNetTab
          disabled={!!activeTaskId}
          loadedVersion={status?.loaded_version ?? null}
          onStarted={(runId) => {
            setActiveTaskId(runId)
            setActiveRunId(runId)
          }}
        />
      )}
    </div>
  )
}

// --------------------------------------------------------------------------
// Sub-components
// --------------------------------------------------------------------------

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="p-3 rounded-lg bg-muted/50">
      <Icon className="w-4 h-4 text-muted-foreground mb-1" />
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold mt-0.5 truncate">{value}</p>
    </div>
  )
}

function ImportProgressCard({
  progress,
  message,
  taskId,
  phase,
  done,
  total,
  fallbackCount,
  notFoundCount,
  failedCount,
  cancelRequested,
  runId,
  onCancel,
}: {
  progress: number
  message: string
  taskId: string
  phase: 'init' | 'downloading' | 'importing' | 'finalizing' | 'done' | null
  done: number
  total: number
  fallbackCount: number
  notFoundCount: number
  failedCount: number
  cancelRequested: boolean
  runId: string | null
  onCancel: () => void
}) {
  const phaseLabel: Record<string, string> = {
    init: 'Preparing',
    downloading: 'Downloading',
    importing: 'Importing',
    finalizing: 'Finalizing',
    done: 'Done',
  }
  const cancelable = !!runId && phase !== 'finalizing' && phase !== 'done'

  return (
    <Card className="border-primary/30 bg-primary/[0.02]">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              Cisco DevNet import in progress
            </CardTitle>
            <CardDescription>
              <span className="font-mono text-xs">Run {taskId.slice(0, 8)}…</span>
              {phase && (
                <Badge variant="outline" className="ml-2 text-[10px]">
                  {phaseLabel[phase] || phase}
                </Badge>
              )}
            </CardDescription>
          </div>
          {cancelable && (
            <Button size="sm" variant="outline" onClick={onCancel} disabled={cancelRequested}>
              <Square className="w-3.5 h-3.5 mr-1.5" />
              {cancelRequested ? 'Cancelling…' : 'Cancel'}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Progress value={progress} />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{message}</span>
          <span className="font-mono">
            {total > 0
              ? `${done.toLocaleString()} / ${total.toLocaleString()} classes`
              : `${progress}%`}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          You can leave this page — the import keeps running in the background and
          will resume here when you come back.
        </p>
        {(fallbackCount > 0 || notFoundCount > 0 || failedCount > 0) && (
          <div className="flex flex-wrap gap-2 text-[11px]">
            {fallbackCount > 0 && (
              <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/30">
                {fallbackCount} from fallback
              </Badge>
            )}
            {notFoundCount > 0 && (
              <Badge variant="outline" className="bg-muted-foreground/10">
                {notFoundCount} not found
              </Badge>
            )}
            {failedCount > 0 && (
              <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
                {failedCount} failed
              </Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function DevNetTab({
  disabled,
  loadedVersion,
  onStarted,
}: {
  disabled: boolean
  loadedVersion: string | null
  onStarted: (runId: string) => void
}) {
  const versionsQuery = useQuery({
    queryKey: DEVNET_VERSIONS_KEY,
    queryFn: () => mimRegistryService.listDevNetVersions(),
  })
  const versions: DevNetVersion[] = versionsQuery.data ?? []

  const [selectedKey, setSelectedKey] = useState<string>('')
  const [concurrency, setConcurrency] = useState<number>(10)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    if (!selectedKey && versions.length > 0) {
      setSelectedKey(versions[0].version_key)
    }
  }, [versions, selectedKey])

  const selected = versions.find((v) => v.version_key === selectedKey)

  // Rough ETA: total * delay / concurrency / 1000 / 60 (delay default 350ms).
  const etaMin = useMemo(() => {
    if (!selected) return null
    const totalMs = selected.class_count_seed * 350
    return Math.max(1, Math.ceil(totalMs / concurrency / 60000))
  }, [selected, concurrency])

  const handleStart = async () => {
    if (!selectedKey) return
    if (loadedVersion && loadedVersion !== selectedKey) {
      const ok = window.confirm(
        `This will wipe the currently loaded MIM (${loadedVersion}) and stream ${selectedKey} from Cisco DevNet. Continue?`,
      )
      if (!ok) return
    }
    setStarting(true)
    try {
      const resp = await mimRegistryService.startDevNetImport(selectedKey, concurrency)
      onStarted(resp.run_id)
      toast.success('Import started', {
        description: `${resp.total_classes.toLocaleString()} classes queued at concurrency ${resp.concurrency}.`,
      })
    } catch (e: any) {
      const status = e?.response?.status
      const detail = e?.response?.data?.detail
      if (status === 409) {
        toast.info('An import is already running')
      } else {
        toast.error(detail || e?.message || 'Could not start import')
      }
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-sky-500" />
            Install from Cisco DevNet
          </CardTitle>
          <CardDescription>
            Stream the MIM straight from <code className="font-mono">pubhub.devnetcloud.com</code> into Neo4j.
            No bundle is shipped with Fabrik — your container fetches the data from Cisco directly,
            class by class. Core classes (~120) are loaded first so the query builder becomes usable
            within ~30 seconds; the rest continues in the background.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {versionsQuery.isLoading ? (
            <div className="h-32 bg-muted animate-pulse rounded" />
          ) : versions.length === 0 ? (
            <Alert className="border-destructive/30 bg-destructive/5">
              <AlertDescription>
                No supported versions. The DevNetVersion table is empty — run the data migration{' '}
                <code className="font-mono">0006_seed_devnet_versions</code>.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 gap-6 items-start">
                <div className="space-y-1.5">
                  <Label className="text-xs">APIC version</Label>
                  <Select value={selectedKey} onValueChange={setSelectedKey} disabled={disabled || starting}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a version" />
                    </SelectTrigger>
                    <SelectContent>
                      {versions.map((v) => (
                        <SelectItem key={v.version_key} value={v.version_key}>
                          {v.label}{' '}
                          <span className="text-muted-foreground text-xs">
                            ({v.class_count_seed.toLocaleString()} classes)
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">
                      Parallel downloads <span className="font-mono text-muted-foreground">({concurrency})</span>
                    </Label>
                    {etaMin !== null && (
                      <span className="text-[11px] text-muted-foreground">est. ~{etaMin} min</span>
                    )}
                  </div>
                  <div className="flex items-center h-9">
                    <Slider
                      value={[concurrency]}
                      min={1}
                      max={10}
                      step={1}
                      onValueChange={([v]) => setConcurrency(v)}
                      disabled={disabled || starting}
                      className="w-full"
                    />
                  </div>
                </div>
              </div>

              {/* Ghost progress strip — visible when idle so layout stays balanced */}
              {!disabled && (
                <div className="rounded-md border border-dashed border-border/60 bg-muted/20 px-3 py-2.5">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1.5">
                    <span>Progress will appear here once the import starts.</span>
                    <span className="font-mono">0 / {selected?.class_count_seed.toLocaleString() ?? '—'}</span>
                  </div>
                  <Progress value={0} className="h-1.5 opacity-50" />
                </div>
              )}

              <div className="flex items-center justify-end pt-1">
                <Button
                  onClick={handleStart}
                  disabled={disabled || starting || !selectedKey}
                  className="min-w-[160px]"
                >
                  {starting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Starting…
                    </>
                  ) : (
                    <>
                      <Cloud className="w-4 h-4 mr-2" />
                      Start import
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
