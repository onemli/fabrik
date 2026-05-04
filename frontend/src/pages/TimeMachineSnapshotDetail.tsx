// TimeMachineSnapshotDetail.tsx
//
// Full detail view for a single execution snapshot — shows the raw APIC result
// JSON with syntax highlighting, plus metadata (executed by, connection, timing).
// A Copy button copies the raw JSON to clipboard for debugging or piping to jq.

import { useQuery } from '@tanstack/react-query'
import { timeMachineService } from '@/services/timeMachine'
import { useAuthStore } from '@/store/authStore'
import { useNavigate, useParams } from 'react-router-dom'
import { Calendar, Database, Clock, Copy, Check, PlayCircle, CalendarClock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { format } from 'date-fns'
import { useState } from 'react'
import { JSONViewer } from '@/components/time-machine'

export default function TimeMachineSnapshotDetail() {
  const navigate = useNavigate()
  const { snapshotId } = useParams<{ snapshotId: string }>()
  const { user } = useAuthStore()
  const [copied, setCopied] = useState(false)

  // Fetch snapshot detail
  const { data: snapshot, isLoading } = useQuery({
    queryKey: ['time-machine-snapshot', snapshotId],
    queryFn: () => timeMachineService.getSnapshotDetail(snapshotId!),
    enabled: !!user && !!snapshotId,
  })

  const handleCopy = async () => {
    if (snapshot?.result_data) {
      await navigator.clipboard.writeText(JSON.stringify(snapshot.result_data, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-4">Authentication Required</h2>
          <p className="text-muted-foreground mb-6">Please log in to view snapshot</p>
          <button
            onClick={() => navigate('/login')}
            className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            Go to Login
          </button>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-sm text-muted-foreground">Loading snapshot...</p>
        </div>
      </div>
    )
  }

  if (!snapshot) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Database className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">Snapshot Not Found</h3>
          <p className="text-sm text-muted-foreground mb-4">
            The requested snapshot does not exist or has been deleted
          </p>
          <Button onClick={() => navigate('/time-machine')}>
            Back to Time Machine
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card">
        <div className="px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-primary/10 rounded-lg">
                <Database className="w-6 h-6 text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h1 className="text-2xl font-bold text-foreground">
                    {snapshot.query_name}
                  </h1>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={
                        snapshot.execution_type === 'scheduled'
                          ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30'
                          : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30'
                      }
                    >
                      {snapshot.execution_type === 'scheduled' ? (
                        <>
                          <CalendarClock className="w-3 h-3 mr-1" />
                          Scheduled
                        </>
                      ) : (
                        <>
                          <PlayCircle className="w-3 h-3 mr-1" />
                          Manual
                        </>
                      )}
                    </Badge>
                    {snapshot.is_duplicate && (
                      <Badge
                        variant="outline"
                        className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
                      >
                        Duplicate Result
                      </Badge>
                    )}
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  Snapshot from {format(new Date(snapshot.executed_at), 'PPpp')}
                </p>
              </div>
            </div>

            <Button onClick={handleCopy} variant="outline">
              {copied ? (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-2" />
                  Copy JSON
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {/* Stat Cards */}
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <Database className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Result Count</p>
                <p className="text-2xl font-bold">{snapshot.result_count}</p>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-500/10 rounded-lg">
                <Database className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Size</p>
                <p className="text-2xl font-bold">{formatBytes(snapshot.result_size_bytes)}</p>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/10 rounded-lg">
                <Clock className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Execution Time</p>
                <p className="text-2xl font-bold">
                  {snapshot.execution_time_ms ? `${snapshot.execution_time_ms}ms` : 'N/A'}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-500/10 rounded-lg">
                <Calendar className="w-5 h-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Executed By</p>
                <p className="text-lg font-bold truncate">
                  {snapshot.executed_by || 'Unknown'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Metadata */}
        <div className="bg-card border border-border rounded-lg p-6 mb-6">
          <h3 className="font-semibold mb-4">Snapshot Metadata</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Snapshot ID:</span>
              <p className="font-mono mt-1">{snapshot.id}</p>
            </div>
            <div>
              <span className="text-muted-foreground">APIC Connection:</span>
              <p className="mt-1">{snapshot.apic_connection_name}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Class Name:</span>
              <p className="mt-1">{snapshot.class_name || 'N/A'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Result Hash:</span>
              <p className="font-mono text-xs mt-1 truncate">{snapshot.result_hash}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Query Version:</span>
              <p className="mt-1 font-mono text-emerald-600 dark:text-emerald-400">v{snapshot.query_version}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Duplicate Detection:</span>
              <p className="mt-1">
                {snapshot.is_duplicate ? (
                  <span className="text-amber-600 dark:text-amber-400">Identical to previous execution</span>
                ) : (
                  <span className="text-emerald-600 dark:text-emerald-400">Unique result</span>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Duplicate Explanation */}
        {snapshot.is_duplicate && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 mb-6">
            <h4 className="font-semibold text-amber-600 dark:text-amber-400 mb-2 flex items-center gap-2">
              <Database className="w-4 h-4" />
              About Duplicate Results
            </h4>
            <div className="text-sm text-muted-foreground space-y-2">
              <p>
                This snapshot has been marked as a <strong className="text-amber-600 dark:text-amber-400">duplicate</strong> because the query result is identical to the previous execution on the same APIC connection.
              </p>
              <p>
                Time Machine uses SHA256 hashing to detect when query results haven't changed. This helps save storage space by avoiding redundant snapshots of identical data.
              </p>
              <p className="text-xs">
                <strong>Result Hash:</strong> <code className="font-mono bg-background/20 px-1 rounded">{snapshot.result_hash}</code>
              </p>
            </div>
          </div>
        )}

        {/* Result Data */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="border-b border-border p-4 flex items-center justify-between bg-muted/30">
            <h3 className="font-semibold">Result Data</h3>
            <span className="text-sm text-muted-foreground">
              {snapshot.result_count} object{snapshot.result_count !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="p-0">
            <div className="max-h-[calc(100vh-500px)] min-h-[400px] overflow-auto">
              <JSONViewer data={snapshot.result_data} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
