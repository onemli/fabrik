// TimeMachineComparison.tsx
//
// Side-by-side diff view for two Time Machine snapshots. The backend returns
// a structured diff (added/modified/deleted items with per-attribute changes).

import { useQuery } from '@tanstack/react-query'
import { timeMachineService } from '@/services/timeMachine'
import { useAuthStore } from '@/store/authStore'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Plus, Minus, Edit, Calendar, Database } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { format } from 'date-fns'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  CollapsibleItem,
  AttributeChangesTable,
} from '@/components/time-machine'

// Extract the ACI class name from an imdata-style object wrapper.
// APIC objects look like {"fvTenant": {"attributes": {...}}} — the outer key is the class.
function extractClassName(obj: any): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  const keys = Object.keys(obj)
  return keys.length > 0 ? keys[0] : undefined
}

export default function TimeMachineComparison() {
  const navigate = useNavigate()
  const { fromId, toId } = useParams<{ fromId: string; toId: string }>()
  const { user } = useAuthStore()

  const { data: comparison, isLoading } = useQuery({
    queryKey: ['time-machine-compare', fromId, toId],
    queryFn: () => timeMachineService.compareSnapshots({
      snapshot_from_id: fromId!,
      snapshot_to_id: toId!,
    }),
    enabled: !!user && !!fromId && !!toId,
  })

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-4">Authentication Required</h2>
          <p className="text-muted-foreground mb-6">Please log in to view comparison</p>
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
          <p className="text-sm text-muted-foreground">Comparing snapshots...</p>
        </div>
      </div>
    )
  }

  if (!comparison) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Database className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">Comparison Failed</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Could not compare the selected snapshots
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
          <div className="flex items-center gap-4 mb-4">
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-4">
            Snapshot Comparison
          </h1>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <Minus className="w-4 h-4 text-red-600 dark:text-red-400" />
                <span className="font-semibold text-red-600 dark:text-red-400">From (Old)</span>
              </div>
              <div className="text-sm space-y-1">
                <div className="flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                  <span>{format(new Date(comparison.snapshot_from.executed_at), 'PPpp')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Database className="w-3.5 h-3.5 text-muted-foreground" />
                  <span>{comparison.snapshot_from.result_count} objects</span>
                </div>
              </div>
            </div>

            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <Plus className="w-4 h-4 text-green-600 dark:text-green-400" />
                <span className="font-semibold text-green-600 dark:text-green-400">To (New)</span>
              </div>
              <div className="text-sm space-y-1">
                <div className="flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                  <span>{format(new Date(comparison.snapshot_to.executed_at), 'PPpp')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Database className="w-3.5 h-3.5 text-muted-foreground" />
                  <span>{comparison.snapshot_to.result_count} objects</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-8 py-8">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <Database className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Changes</p>
                <p className="text-2xl font-bold">{comparison.diff.total_changes}</p>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/10 rounded-lg">
                <Plus className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Added</p>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {comparison.diff.added.length}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-500/10 rounded-lg">
                <Edit className="w-5 h-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Modified</p>
                <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                  {comparison.diff.modified.length}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-500/10 rounded-lg">
                <Minus className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Deleted</p>
                <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                  {comparison.diff.deleted.length}
                </p>
              </div>
            </div>
          </div>
        </div>

        {comparison.identical && (
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 mb-6 text-center">
            <p className="text-blue-600 dark:text-blue-400 font-medium">
              The snapshots are identical - no changes detected
            </p>
          </div>
        )}

        {!comparison.identical && (
          <Tabs defaultValue="modified" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="added">Added ({comparison.diff.added.length})</TabsTrigger>
              <TabsTrigger value="modified">Modified ({comparison.diff.modified.length})</TabsTrigger>
              <TabsTrigger value="deleted">Deleted ({comparison.diff.deleted.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="added" className="mt-4">
              <div className="max-h-[calc(100vh-500px)] overflow-y-auto pr-2 space-y-3">
                {comparison.diff.added.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No objects were added</div>
                ) : (
                  comparison.diff.added.map((item, index) => (
                    <CollapsibleItem
                      key={index}
                      type="added"
                      dn={item.dn}
                      index={index}
                      className={extractClassName(item.object)}
                      content={
                        <pre className="text-xs bg-background/40 p-4 rounded border border-border max-h-[400px] overflow-auto">
                          <code className="text-foreground/90 font-mono">
                            {JSON.stringify(item.object, null, 2)}
                          </code>
                        </pre>
                      }
                    />
                  ))
                )}
              </div>
            </TabsContent>

            <TabsContent value="modified" className="mt-4">
              <div className="max-h-[calc(100vh-500px)] overflow-y-auto pr-2 space-y-3">
                {comparison.diff.modified.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No objects were modified</div>
                ) : (
                  comparison.diff.modified.map((item, index) => (
                    <CollapsibleItem
                      key={index}
                      type="modified"
                      dn={item.dn}
                      index={index}
                      className={extractClassName(item.after)}
                      content={
                        <div>
                          <AttributeChangesTable changes={item.attribute_changes || []} />
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-3">
                            <div>
                              <div className="text-xs font-semibold mb-2 text-red-600 dark:text-red-400 flex items-center gap-2">
                                <Minus className="w-3 h-3" />Before
                              </div>
                              <pre className="text-xs bg-red-500/10 p-4 rounded border border-red-500/20 max-h-[400px] overflow-auto">
                                <code className="text-foreground/90 font-mono">
                                  {JSON.stringify(item.before, null, 2)}
                                </code>
                              </pre>
                            </div>
                            <div>
                              <div className="text-xs font-semibold mb-2 text-green-600 dark:text-green-400 flex items-center gap-2">
                                <Plus className="w-3 h-3" />After
                              </div>
                              <pre className="text-xs bg-green-500/10 p-4 rounded border border-green-500/20 max-h-[400px] overflow-auto">
                                <code className="text-foreground/90 font-mono">
                                  {JSON.stringify(item.after, null, 2)}
                                </code>
                              </pre>
                            </div>
                          </div>
                        </div>
                      }
                    />
                  ))
                )}
              </div>
            </TabsContent>

            <TabsContent value="deleted" className="mt-4">
              <div className="max-h-[calc(100vh-500px)] overflow-y-auto pr-2 space-y-3">
                {comparison.diff.deleted.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No objects were deleted</div>
                ) : (
                  comparison.diff.deleted.map((item, index) => (
                    <CollapsibleItem
                      key={index}
                      type="deleted"
                      dn={item.dn}
                      index={index}
                      className={extractClassName(item.object)}
                      content={
                        <pre className="text-xs bg-background/40 p-4 rounded border border-border max-h-[400px] overflow-auto">
                          <code className="text-foreground/90 font-mono">
                            {JSON.stringify(item.object, null, 2)}
                          </code>
                        </pre>
                      }
                    />
                  ))
                )}
              </div>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  )
}
