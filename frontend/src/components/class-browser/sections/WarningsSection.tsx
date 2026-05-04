// WarningsSection — surfaced banners for abstract / deprecated classes so
// the user notices before they start designing a query.

import { AlertCircle, AlertTriangle } from 'lucide-react'
import type { MIMClassFullDetail } from '@/types/mim'

export function WarningsSection({ cls }: { cls: MIMClassFullDetail }) {
  if (!cls.isAbstract && !cls.isDeprecated) return null
  return (
    <div className="space-y-2">
      {cls.isAbstract && (
        <div className="flex gap-2 items-start p-2.5 rounded-md border border-orange-500/30 bg-orange-500/5 text-xs text-orange-700 dark:text-orange-400">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Abstract class — querying it returns instances of every concrete
            subclass across the hierarchy.
          </span>
        </div>
      )}
      {cls.isDeprecated && (
        <div className="flex gap-2 items-start p-2.5 rounded-md border border-red-500/30 bg-red-500/5 text-xs text-red-700 dark:text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Deprecated — may be removed in a future ACI release.</span>
        </div>
      )}
    </div>
  )
}
