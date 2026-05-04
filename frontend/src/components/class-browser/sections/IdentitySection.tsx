// IdentitySection — header (className + label) + flag badges.

import { Badge } from '@/components/ui/badge'
import type { MIMClassFullDetail } from '@/types/mim'
import { CopyButton } from './_shared'

export function IdentitySection({ cls }: { cls: MIMClassFullDetail }) {
  const showLabel = cls.label && cls.label !== cls.className
  return (
    <div>
      <div className="flex items-center gap-2">
        <h2 className="font-mono text-xl font-bold text-foreground leading-tight truncate">
          {cls.className}
        </h2>
        <CopyButton value={cls.className} ariaLabel={`Copy ${cls.className}`} />
      </div>
      {showLabel && (
        <p className="text-sm text-muted-foreground mt-0.5">{cls.label}</p>
      )}
      <div className="flex flex-wrap gap-2 mt-3">
        {cls.classPkg && (
          <Badge variant="outline" className="font-mono">
            {cls.classPkg}
          </Badge>
        )}
        {cls.isConfigurable ? (
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">
            Configurable
          </Badge>
        ) : (
          <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/30">
            Operational
          </Badge>
        )}
        {cls.isContextRoot && (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">
            Context Root
          </Badge>
        )}
        {cls.isAbstract && (
          <Badge variant="outline" className="bg-orange-500/10 text-orange-600 border-orange-500/30">
            Abstract
          </Badge>
        )}
        {cls.isDeprecated && (
          <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/30">
            Deprecated
          </Badge>
        )}
        {cls.moCategory && (
          <Badge variant="outline" className="text-[10px]">
            {cls.moCategory}
          </Badge>
        )}
      </div>
    </div>
  )
}
