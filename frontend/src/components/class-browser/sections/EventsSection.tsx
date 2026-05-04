// EventsSection — same shape as FaultsSection but emits as ``eventRecord``
// items in the audit trail. Useful for "did this object actually change?"
// investigations.

import { CopyButton, EmptyHint, SectionLabel } from './_shared'
import type { FaultEventEntry } from '@/types/mim'

export function EventsSection({ events }: { events: FaultEventEntry[] }) {
  if (!events || events.length === 0) {
    return (
      <div>
        <SectionLabel>Events</SectionLabel>
        <EmptyHint>No event records are emitted for this class.</EmptyHint>
      </div>
    )
  }
  return (
    <div>
      <SectionLabel>Events · {events.length}</SectionLabel>
      <ul className="rounded-md border border-border/40 divide-y divide-border/40">
        {events.map((e) => (
          <li key={e.id} className="px-3 py-2 flex items-center gap-3 group">
            <code className="font-mono text-xs font-semibold text-amber-600 dark:text-amber-400 shrink-0 w-20">
              E{e.id}
            </code>
            <span className="text-[11px] text-muted-foreground shrink-0 w-28 truncate" title={e.type}>
              {e.type || '—'}
            </span>
            {e.target && (
              <code className="font-mono text-[11px] text-muted-foreground truncate flex-1 min-w-0" title={e.target}>
                {e.target}
              </code>
            )}
            <span className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
              <CopyButton value={`E${e.id}`} ariaLabel={`Copy E${e.id}`} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
