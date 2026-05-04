// Tiny presentational helpers shared by every section in the class detail
// panel. Kept here (not in components/ui) because they're one-purpose and
// only make sense in the detail-panel context.

import { AlertTriangle, Check, Copy } from 'lucide-react'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { cn } from '@/lib/utils'

/** Tone palette aligned with the shadcn neutral + accent colours used
 * elsewhere in the app. Keys are intentionally a closed set so callers
 * pick from a curated list — adding a new tone is a deliberate edit. */
type SectionTone =
  | 'default'
  | 'blue'    // structural / containment
  | 'emerald' // data / properties
  | 'violet'  // identity / addressing
  | 'rose'    // faults / errors
  | 'amber'   // events / warnings
  | 'sky'     // statistics / metrics

const TONE_CLASSES: Record<SectionTone, string> = {
  default: 'text-muted-foreground',
  blue: 'text-blue-600 dark:text-blue-400',
  emerald: 'text-emerald-600 dark:text-emerald-400',
  violet: 'text-violet-600 dark:text-violet-400',
  rose: 'text-rose-600 dark:text-rose-400',
  amber: 'text-amber-600 dark:text-amber-400',
  sky: 'text-sky-600 dark:text-sky-400',
}

/** Auto-detected tone for known section titles. Anything not in the
 * map falls back to ``default`` (muted) so unfamiliar section names
 * stay neutral instead of guessing wrong. Keys must match the title
 * AFTER stripping count suffixes (``Properties · 4`` → ``Properties``).
 */
const TITLE_TONE_MAP: Record<string, SectionTone> = {
  Description: 'default',

  Containment: 'blue',
  'Contained by': 'blue',
  'Child classes': 'blue',
  Relationships: 'blue',
  'Inherits from': 'blue',
  'Points to': 'blue',
  'Referenced by': 'blue',

  Properties: 'emerald',

  'Identified by': 'violet',
  'DN template': 'violet',
  Example: 'violet',
  REST: 'violet',
  'RN format': 'violet',

  Faults: 'rose',
  Events: 'amber',
  Statistics: 'sky',
}

function toneFor(children: React.ReactNode): SectionTone {
  if (typeof children !== 'string') return 'default'
  // Strip parenthesised hints, count suffixes (``· 12``), and the second
  // half of ``Foo · Bar`` style headings so the canonical key is what
  // matches the tone map.
  const head = children
    .split('·')[0]
    .split('(')[0]
    .trim()
  return TITLE_TONE_MAP[head] ?? 'default'
}

export function SectionLabel({
  children,
  tone,
}: {
  children: React.ReactNode
  /** Override the auto-detected tone. Rarely needed. */
  tone?: SectionTone
}) {
  const resolvedTone = tone ?? toneFor(children)
  return (
    <div
      className={cn(
        'text-[10px] font-semibold uppercase tracking-wider mb-1.5',
        TONE_CLASSES[resolvedTone],
      )}
    >
      {children}
    </div>
  )
}

export function ClassChip({
  className,
  label,
  classPkg,
  onClick,
}: {
  className: string
  label?: string
  classPkg?: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group inline-flex items-center gap-1.5 max-w-full text-left',
        'px-2 py-1 rounded-md border border-border/50 bg-muted/40',
        'hover:bg-muted hover:border-border transition-colors',
      )}
    >
      <code className="font-mono text-xs font-medium truncate">{className}</code>
      {label && (
        <span className="text-[11px] text-muted-foreground truncate">{label}</span>
      )}
      {classPkg && (
        <span className="text-[10px] font-mono text-muted-foreground/70 ml-auto">
          {classPkg}
        </span>
      )}
    </button>
  )
}

export function CopyButton({
  value,
  ariaLabel,
  size = 'sm',
}: {
  value: string
  ariaLabel: string
  size?: 'sm' | 'md'
}) {
  const { copy, copied, failed } = useCopyToClipboard()
  const dims = size === 'md' ? 'h-8 w-8' : 'h-6 w-6'
  const icon = size === 'md' ? 'w-3.5 h-3.5' : 'w-3 h-3'

  // If every clipboard path fails (rare — only blocked by aggressive
  // privacy shields on plain HTTP), fall back to selecting the text
  // in-place so the user can still hit Ctrl+C themselves. The select
  // happens on the click that produced the failure, so the keystroke
  // window stays open.
  const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    const ok = await copy(value)
    if (!ok) selectInlineFallback(e.currentTarget, value)
  }

  const tooltip = failed
    ? 'Copy blocked — value is selected, press Ctrl+C'
    : copied
      ? 'Copied!'
      : ariaLabel

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={ariaLabel}
      title={tooltip}
      className={cn(
        'inline-flex items-center justify-center rounded',
        'border border-border/50 bg-background',
        'text-muted-foreground hover:text-foreground hover:border-border',
        'transition-colors',
        dims,
        failed && 'border-amber-500/50 text-amber-600',
        copied && 'border-emerald-500/50',
      )}
    >
      {failed ? (
        <AlertTriangle className={icon} />
      ) : copied ? (
        <Check className={cn(icon, 'text-emerald-500')} />
      ) : (
        <Copy className={icon} />
      )}
    </button>
  )
}

/** When all programmatic copy paths fail, surface the value as a real
 * DOM selection so the user can copy it manually with Ctrl/Cmd+C. The
 * selection sticks to the closest readable text node next to the
 * button — usually the class name or DN it sits beside. */
function selectInlineFallback(button: HTMLElement, fallbackText: string) {
  const container = button.parentElement
  if (!container) return
  const codeOrText = container.querySelector('code, .font-mono')
  const target = codeOrText ?? createEphemeralSpan(container, fallbackText)
  const range = document.createRange()
  range.selectNodeContents(target)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function createEphemeralSpan(parent: HTMLElement, text: string): HTMLSpanElement {
  const span = document.createElement('span')
  span.textContent = text
  span.style.cssText = 'position:absolute;left:-9999px;top:auto;'
  parent.appendChild(span)
  // Schedule cleanup after the user has had a chance to copy.
  window.setTimeout(() => span.remove(), 5000)
  return span
}

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-muted-foreground italic">{children}</p>
  )
}
