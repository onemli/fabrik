// awx/job-output/EventDetailDialog.tsx
//
// Mirrors AWX UI's event-detail behaviour. When an Ansible event has a module
// result (event_data.res), the Result tab shows `current`, `mo`, `proposed`,
// etc. as a JSON tree — not as a wall of stringified text. Failure-diagnostic
// fields (msg, module_stderr, exception) are surfaced in Summary.

import { useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Copy, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import type { JobEvent, AnsibleModuleResult } from './types'
import { eventBadgeClass } from './types'
import { JsonTree } from './JsonTree'
import { ansiToHtml } from './ansi'

interface EventDetailDialogProps {
  event: JobEvent | null
  onClose: () => void
}

export function EventDetailDialog({ event, onClose }: EventDetailDialogProps) {
  const open = event !== null
  const res = event?.event_data?.res as AnsibleModuleResult | undefined
  const invocationArgs = res?.invocation?.module_args

  // Default tab: Result if we have one, else Stdout, else Raw
  const defaultTab = useMemo<'result' | 'stdout' | 'raw'>(() => {
    if (!event) return 'raw'
    if (res && Object.keys(res).length > 0) return 'result'
    if (event.stdout) return 'stdout'
    return 'raw'
  }, [event, res])

  const [tab, setTab] = useState<string>(defaultTab)

  // Reset tab whenever a new event opens
  const eventKey = event?.counter ?? 0
  const lastKeyRef = useLastKey(eventKey, () => setTab(defaultTab))
  void lastKeyRef

  if (!event) return null

  const failed = event.event_type === 'runner_on_failed' || event.event_type === 'runner_on_unreachable'
  const changed = res?.changed === true
  const msg = typeof res?.msg === 'string' ? res.msg : Array.isArray(res?.msg) ? res.msg.join('\n') : ''

  const stdoutHtml = ansiToHtml(event.stdout || '')
  const hasRes = res && Object.keys(res).length > 0
  const hasInvocation = invocationArgs && Object.keys(invocationArgs).length > 0

  const copyJson = (payload: unknown, label: string) => {
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
    toast.success(`${label} copied`)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Badge variant="outline" className={`border-0 ${eventBadgeClass(event.event_type)}`}>
              {event.event_type}
            </Badge>
            <span className="font-mono text-muted-foreground text-xs">#{event.counter}</span>
            {event.task && (
              <span className="text-foreground truncate">{event.task}</span>
            )}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex-1 min-h-0 flex flex-col">
          <TabsList className="flex-shrink-0 justify-start">
            <TabsTrigger value="summary">Summary</TabsTrigger>
            {hasRes && <TabsTrigger value="result">Result</TabsTrigger>}
            {hasInvocation && <TabsTrigger value="invocation">Invocation</TabsTrigger>}
            <TabsTrigger value="stdout">Stdout</TabsTrigger>
            <TabsTrigger value="raw">Raw</TabsTrigger>
          </TabsList>

          <TabsContent value="summary" className="flex-1 min-h-0 overflow-auto mt-3 space-y-3">
            {failed && msg && (
              <div className="flex items-start gap-2 p-3 rounded border border-red-500/30 bg-red-500/10 text-xs">
                <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <div className="space-y-1 min-w-0">
                  <div className="font-semibold text-red-600 dark:text-red-400">Failed</div>
                  <pre className="whitespace-pre-wrap break-words font-mono text-foreground/90">{msg}</pre>
                </div>
              </div>
            )}

            {!failed && changed && msg && (
              <div className="p-3 rounded border border-amber-500/30 bg-amber-500/10 text-xs">
                <div className="font-semibold text-amber-600 dark:text-amber-400 mb-1">Changed</div>
                <pre className="whitespace-pre-wrap break-words font-mono text-foreground/90">{msg}</pre>
              </div>
            )}

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
              <SummaryField label="Play" value={event.play} />
              <SummaryField label="Task" value={event.task} />
              <SummaryField label="Role" value={event.role} />
              <SummaryField label="Host" value={event.host_name} />
              <SummaryField label="Module" value={event.event_data?.task_action as string} />
              <SummaryField label="Duration" value={
                typeof event.event_data?.duration === 'number'
                  ? `${(event.event_data.duration as number).toFixed(3)}s` : undefined
              } />
              <SummaryField label="Started" value={event.event_data?.start as string} />
              <SummaryField label="Ended" value={event.event_data?.end as string} />
              <SummaryField label="Timestamp" value={event.timestamp} />
              <SummaryField label="AWX Job" value={event.awx_job_id ? `#${event.awx_job_id}` : undefined} />
            </dl>

            {failed && res?.module_stderr && (
              <div className="space-y-1">
                <div className="text-xs font-semibold text-foreground/80">module_stderr</div>
                <pre className="text-xs font-mono whitespace-pre-wrap break-words p-2 rounded bg-muted/50 max-h-40 overflow-auto">{res.module_stderr}</pre>
              </div>
            )}
            {failed && res?.exception && (
              <div className="space-y-1">
                <div className="text-xs font-semibold text-foreground/80">exception</div>
                <pre className="text-xs font-mono whitespace-pre-wrap break-words p-2 rounded bg-muted/50 max-h-40 overflow-auto">{res.exception}</pre>
              </div>
            )}
          </TabsContent>

          {hasRes && (
            <TabsContent value="result" className="flex-1 min-h-0 overflow-auto mt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">Module return value (event_data.res)</span>
                <Button size="sm" variant="outline" onClick={() => copyJson(res, 'Result JSON')}>
                  <Copy className="w-3.5 h-3.5 mr-1.5" /> Copy
                </Button>
              </div>
              <div className="rounded border bg-muted/20 p-3 overflow-auto">
                <JsonTree data={res} defaultExpandDepth={2} />
              </div>
            </TabsContent>
          )}

          {hasInvocation && (
            <TabsContent value="invocation" className="flex-1 min-h-0 overflow-auto mt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">Arguments passed to the module</span>
                <Button size="sm" variant="outline" onClick={() => copyJson(invocationArgs, 'Invocation JSON')}>
                  <Copy className="w-3.5 h-3.5 mr-1.5" /> Copy
                </Button>
              </div>
              <div className="rounded border bg-muted/20 p-3 overflow-auto">
                <JsonTree data={invocationArgs} defaultExpandDepth={3} />
              </div>
            </TabsContent>
          )}

          <TabsContent value="stdout" className="flex-1 min-h-0 overflow-auto mt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">Rendered ANSI output</span>
              <Button size="sm" variant="outline" onClick={() => {
                navigator.clipboard.writeText(event.stdout || '')
                toast.success('Stdout copied')
              }}>
                <Copy className="w-3.5 h-3.5 mr-1.5" /> Copy
              </Button>
            </div>
            {/* eslint-disable no-restricted-syntax -- SECURITY: stdoutHtml is the output of ansiToHtml (Anser with use_classes:true, XML escape on); the fallback is a hand-written constant with no interpolation. */}
            <pre
              className="text-xs font-mono whitespace-pre-wrap break-all p-3 rounded border bg-muted/20"
              dangerouslySetInnerHTML={{ __html: stdoutHtml || '<span class="text-muted-foreground italic">(no stdout)</span>' }}
            />
            {/* eslint-enable no-restricted-syntax */}
          </TabsContent>

          <TabsContent value="raw" className="flex-1 min-h-0 overflow-auto mt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">Full event payload</span>
              <Button size="sm" variant="outline" onClick={() => copyJson(event, 'Event JSON')}>
                <Copy className="w-3.5 h-3.5 mr-1.5" /> Copy
              </Button>
            </div>
            <pre className="text-xs font-mono whitespace-pre-wrap break-all p-3 rounded border bg-muted/20">
              {JSON.stringify(event, null, 2)}
            </pre>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

function SummaryField({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono text-foreground/90 break-all">{value}</dd>
    </>
  )
}

// useLastKey: re-run cb once per change to `key`. Lightweight useEffect
// alternative to avoid pulling React's import just for this hook; but React is
// already imported, so this is just a minimal helper for readability.
import { useEffect, useRef } from 'react'
function useLastKey(key: number, cb: () => void) {
  const ref = useRef(key)
  useEffect(() => {
    if (ref.current !== key) {
      ref.current = key
      cb()
    }
  }, [key, cb])
  return ref
}
