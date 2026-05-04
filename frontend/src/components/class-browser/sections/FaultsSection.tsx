// FaultsSection — fault codes raised on / about this class. Each entry is
// a short tuple (id, type, target). The id is what an operator sees in
// ``faultInst`` records and the AAS console (``F0467`` etc.).

import { CopyButton, EmptyHint, SectionLabel } from './_shared'
import type { FaultEventEntry } from '@/types/mim'

export function FaultsSection({ faults }: { faults: FaultEventEntry[] }) {
  if (!faults || faults.length === 0) {
    return (
      <div>
        <SectionLabel>Faults</SectionLabel>
        <EmptyHint>No fault codes are emitted for this class.</EmptyHint>
      </div>
    )
  }
  return (
    <div>
      <SectionLabel>Faults · {faults.length}</SectionLabel>
      <ul className="rounded-md border border-border/40 divide-y divide-border/40">
        {faults.map((f) => (
          <li key={f.id} className="px-3 py-2 flex items-center gap-3 group">
            <code className="font-mono text-xs font-semibold text-rose-600 shrink-0 w-20">
              F{f.id}
            </code>
            <span className="text-[11px] text-muted-foreground shrink-0 w-28 truncate" title={f.type}>
              {f.type || '—'}
            </span>
            {f.target && (
              <code className="font-mono text-[11px] text-muted-foreground truncate flex-1 min-w-0" title={f.target}>
                {f.target}
              </code>
            )}
            <span className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
              <CopyButton value={`F${f.id}`} ariaLabel={`Copy F${f.id}`} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
