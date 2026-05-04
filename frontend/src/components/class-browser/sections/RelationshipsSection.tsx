// RelationshipsSection — three sub-blocks:
//   • Super-classes (inheritance)
//   • Outbound references — this class points at others via Rs* relationships
//   • Inbound references — other classes point at this one
//
// The inbound list is the highest-leverage view for ACI engineers because it
// answers "what wires up to my object?" without scanning the whole MIM.

import { ArrowDown, ArrowUp, GitBranch } from 'lucide-react'
import { ClassChip, EmptyHint, SectionLabel } from './_shared'
import type { ClassRef, RelationRef } from '@/types/mim'

export function RelationshipsSection({
  superClasses,
  relationsTo,
  relationsFrom,
  onPickClass,
}: {
  superClasses: ClassRef[]
  relationsTo: RelationRef[]
  relationsFrom: RelationRef[]
  onPickClass?: (className: string) => void
}) {
  const noneRendered =
    superClasses.length === 0 && relationsTo.length === 0 && relationsFrom.length === 0
  if (noneRendered) {
    return (
      <div>
        <SectionLabel>Relationships</SectionLabel>
        <EmptyHint>This class has no super-classes or relationships.</EmptyHint>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {superClasses.length > 0 && (
        <SubBlock
          icon={<GitBranch className="w-3.5 h-3.5" />}
          title="Inherits from"
          hint="Properties and relationships also live on these parent classes."
        >
          <div className="flex flex-wrap gap-1.5">
            {superClasses.map((c) => (
              <ClassChip
                key={c.className}
                className={c.className}
                label={c.label}
                classPkg={c.classPkg}
                onClick={onPickClass ? () => onPickClass(c.className) : undefined}
              />
            ))}
          </div>
        </SubBlock>
      )}

      {relationsTo.length > 0 && (
        <SubBlock
          icon={<ArrowUp className="w-3.5 h-3.5 rotate-45" />}
          title={`Points to (${relationsTo.length})`}
          hint="This class references other objects through these Rs* helpers."
        >
          <RelationList rows={relationsTo} onPickClass={onPickClass} />
        </SubBlock>
      )}

      {relationsFrom.length > 0 && (
        <SubBlock
          icon={<ArrowDown className="w-3.5 h-3.5 -rotate-45" />}
          title={`Referenced by (${relationsFrom.length})`}
          hint="Other classes that wire up to this one through these Rs* helpers."
        >
          <RelationList rows={relationsFrom} onPickClass={onPickClass} />
        </SubBlock>
      )}
    </div>
  )
}

function SubBlock({
  icon,
  title,
  hint,
  children,
}: {
  icon: React.ReactNode
  title: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-muted-foreground">{icon}</span>
        <SectionLabel>{title}</SectionLabel>
      </div>
      <p className="text-[11px] text-muted-foreground -mt-1 mb-2">{hint}</p>
      {children}
    </div>
  )
}

function RelationList({
  rows,
  onPickClass,
}: {
  rows: RelationRef[]
  onPickClass?: (className: string) => void
}) {
  return (
    <ul className="rounded-md border border-border/40 divide-y divide-border/40">
      {rows.map((row) => (
        <li key={`${row.via}-${row.className}`} className="px-2.5 py-1.5 flex items-center gap-2 hover:bg-muted/30">
          <code className="font-mono text-[10px] text-muted-foreground shrink-0 w-32 truncate" title={row.via}>
            {row.via}
          </code>
          <ClassChip
            className={row.className}
            label={row.label}
            classPkg={row.classPkg}
            onClick={onPickClass ? () => onPickClass(row.className) : undefined}
          />
        </li>
      ))}
    </ul>
  )
}
