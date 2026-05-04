// DnSection — DN templates, a friendly live example, and APIC REST URLs
// the user can copy straight into curl/Postman.
//
// Three blocks:
//   • DN template (preferring ``dnFormats[0]`` over a synthesised RN chain)
//   • Live example with placeholders substituted
//   • REST URLs in both modes (``/api/mo/<dn>.json`` and ``/api/class/<n>.json``)

import { useMemo } from 'react'
import { ExternalLink } from 'lucide-react'
import {
  buildDevNetUrl,
  buildDnTemplate,
  buildLiveExample,
  buildRestUrl,
} from '@/utils/aciDnBuilder'
import type { MIMClassFullDetail } from '@/types/mim'
import { CopyButton, EmptyHint, SectionLabel } from './_shared'

export function DnSection({
  cls,
  versionKey,
}: {
  cls: MIMClassFullDetail
  versionKey?: string
}) {
  const template = useMemo(
    () =>
      buildDnTemplate({
        className: cls.className,
        rnFormat: cls.rnFormat,
        dnFormats: cls.dnFormats,
        parents: cls.parents,
      }),
    [cls.className, cls.rnFormat, cls.dnFormats, cls.parents],
  )
  const liveExample = useMemo(() => buildLiveExample(template), [template])
  const restMo = useMemo(() => buildRestUrl(cls.className, template, 'mo'), [cls.className, template])
  const restClass = useMemo(() => buildRestUrl(cls.className, template, 'class'), [cls.className, template])
  const docsUrl = versionKey ? buildDevNetUrl(versionKey, cls.classPkg, cls.className) : null

  return (
    <div className="space-y-4">
      <DnRow
        label="DN template"
        value={template || ''}
        empty="No DN template — abstract or root class."
      />
      {template && liveExample !== template && (
        <DnRow label="Example" value={liveExample} muted />
      )}
      <DnRow label="REST · managed object" value={restMo} />
      <DnRow label="REST · class query" value={restClass} />
      {cls.rnFormat && cls.rnFormat !== template && (
        <DnRow label="RN format (this class only)" value={cls.rnFormat} muted />
      )}
      {cls.identifiedBy && cls.identifiedBy.length > 0 && (
        <div>
          <SectionLabel>Identified by</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {cls.identifiedBy.map((id) => (
              <code key={id} className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                {id}
              </code>
            ))}
          </div>
        </div>
      )}
      {docsUrl && (
        <a
          href={docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
        >
          Open in Cisco DevNet docs <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  )
}

function DnRow({
  label,
  value,
  empty,
  muted,
}: {
  label: string
  value: string
  empty?: string
  muted?: boolean
}) {
  if (!value) {
    return (
      <div>
        <SectionLabel>{label}</SectionLabel>
        {empty ? <EmptyHint>{empty}</EmptyHint> : null}
      </div>
    )
  }
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <div className="flex items-center gap-2">
        <code
          className={
            'font-mono text-xs flex-1 min-w-0 truncate px-2 py-1.5 rounded ' +
            (muted ? 'text-muted-foreground bg-muted/40' : 'bg-muted')
          }
          title={value}
        >
          {value}
        </code>
        <CopyButton value={value} ariaLabel={`Copy ${label}`} />
      </div>
    </div>
  )
}
