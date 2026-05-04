// Reusable clipboard hook with a transient "copied" indicator.
//
// Copying a value to the OS clipboard is deceptively hard. Browsers mix
// three different APIs, ship them under different security policies, and
// silently lie about success when blocked by privacy shields. This hook
// tries each known-good strategy in order, only declares victory when
// it can verify that a write actually happened, and exposes a "failed"
// state so the UI can offer a manual fallback (select-and-Ctrl+C).

import { useCallback, useEffect, useRef, useState } from 'react'

export type CopyStatus = 'idle' | 'copied' | 'failed'

export interface UseCopyToClipboardOptions {
  /** Auto-reset duration in ms. Default 2000. */
  resetMs?: number
}

export interface UseCopyToClipboardReturn {
  copy: (text: string) => Promise<boolean>
  copied: boolean
  failed: boolean
  status: CopyStatus
  reset: () => void
}

export function useCopyToClipboard(
  options: UseCopyToClipboardOptions = {},
): UseCopyToClipboardReturn {
  const { resetMs = 2000 } = options
  const [status, setStatus] = useState<CopyStatus>('idle')
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [])

  const reset = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setStatus('idle')
  }, [])

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      reset()
      const ok = await writeWithFallback(text)
      setStatus(ok ? 'copied' : 'failed')
      timerRef.current = window.setTimeout(() => setStatus('idle'), resetMs)
      return ok
    },
    [reset, resetMs],
  )

  return {
    copy,
    copied: status === 'copied',
    failed: status === 'failed',
    status,
    reset,
  }
}

/**
 * Write to the clipboard with three layered strategies. Each strategy is
 * verified before we declare success — Brave Shields and similar privacy
 * features make older paths return ``true`` while silently doing nothing,
 * so we cannot trust a ``true`` from ``execCommand`` alone.
 *
 *   1. ``navigator.clipboard.writeText`` — secure-context only. The
 *      Promise rejecting is a real signal of failure, so a clean resolve
 *      is treated as authoritative success.
 *   2. ``ClipboardEvent`` hijack — register a one-shot ``copy`` listener
 *      that explicitly calls ``setData`` + ``preventDefault``. If the
 *      listener fires we know the browser dispatched a real copy event
 *      and accepted our payload — this is the path that survives Brave
 *      Shields on plain HTTP, where the modern API is unavailable.
 *   3. Hidden ``<textarea>`` + ``execCommand('copy')`` — last resort.
 *      Less reliable (returns ``true`` even when blocked) but still
 *      necessary for old WebKit and some embedded WebViews.
 *
 * When all three fail the caller gets ``false`` and can show a manual
 * "press Ctrl+C" fallback UI.
 */
async function writeWithFallback(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall through
    }
  }

  if (copyViaClipboardEvent(text)) return true

  return copyViaTextarea(text)
}

/**
 * One-shot copy-event hijack. ``execCommand('copy')`` only fires a real
 * ``copy`` event when the document has an active text selection — on
 * Chrome 120+ a bare call without selection silently no-ops and our
 * listener never runs. We work around this by mounting a hidden
 * textarea, focusing it, selecting its contents, then calling
 * ``execCommand``. The listener intercepts the event before the
 * textarea's own copy fires and rewrites ``clipboardData`` to the
 * value we actually want — so the textarea content is irrelevant.
 *
 * Returns ``true`` only when the listener actually ran AND received a
 * usable ``clipboardData`` object — a "green tick" from this branch
 * therefore guarantees the OS clipboard now holds ``text``.
 */
function copyViaClipboardEvent(text: string): boolean {
  const previouslyFocused = document.activeElement as HTMLElement | null
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.cssText = (
    'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;'
    + 'border:none;outline:none;box-shadow:none;background:transparent;'
    + 'opacity:0;pointer-events:none;'
  )
  document.body.appendChild(ta)

  let wrote = false
  const handler = (event: ClipboardEvent) => {
    if (!event.clipboardData) return
    event.clipboardData.setData('text/plain', text)
    event.preventDefault()
    wrote = true
  }
  document.addEventListener('copy', handler, { capture: true, once: true })

  try {
    ta.focus({ preventScroll: true })
    ta.select()
    ta.setSelectionRange(0, text.length)
    document.execCommand('copy')
  } catch {
    // wrote stays false → caller reports failure
  } finally {
    document.removeEventListener('copy', handler, { capture: true })
    document.body.removeChild(ta)
    previouslyFocused?.focus?.({ preventScroll: true } as FocusOptions)
  }
  return wrote
}

/**
 * Hidden-textarea legacy path. Kept as last resort; the focus dance is
 * required by iOS Safari and old Firefox.
 */
function copyViaTextarea(text: string): boolean {
  const previouslyFocused = document.activeElement as HTMLElement | null
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.top = '0'
  ta.style.left = '0'
  ta.style.width = '1px'
  ta.style.height = '1px'
  ta.style.padding = '0'
  ta.style.border = 'none'
  ta.style.outline = 'none'
  ta.style.boxShadow = 'none'
  ta.style.background = 'transparent'
  ta.style.opacity = '0'
  ta.style.pointerEvents = 'none'
  document.body.appendChild(ta)

  let copied = false
  try {
    ta.focus({ preventScroll: true })
    ta.select()
    ta.setSelectionRange(0, text.length)
    copied = document.execCommand('copy')
  } catch {
    copied = false
  } finally {
    document.body.removeChild(ta)
    previouslyFocused?.focus?.({ preventScroll: true } as FocusOptions)
  }
  return copied
}
