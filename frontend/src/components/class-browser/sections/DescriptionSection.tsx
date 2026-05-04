// DescriptionSection — the comment string (Cisco's own prose). Long
// descriptions collapse to three lines with a Show more / less toggle to
// keep the panel compact.

import { useState } from 'react'
import { SectionLabel } from './_shared'
import { cn } from '@/lib/utils'

export function DescriptionSection({ comment }: { comment?: string[] }) {
  const text = comment?.[0]?.trim()
  const [expanded, setExpanded] = useState(false)
  if (!text) return null
  const long = text.length > 180

  return (
    <div>
      <SectionLabel>Description</SectionLabel>
      <p
        className={cn(
          'text-sm text-foreground leading-relaxed whitespace-pre-line',
          long && !expanded && 'line-clamp-3',
        )}
      >
        {text}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-primary mt-1 hover:underline"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}
