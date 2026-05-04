// hooks/useIdleTimeout.ts
//
// Idle detection hook that triggers a session warning before auto-logout.
// Resets on any mouse, keyboard, touch, or scroll event. When the idle
// threshold is reached it calls onWarning() first, then onTimeout() after
// the grace period. The warning dialog calls resetTimer() to extend the session.

import { useEffect, useRef, useCallback, useState } from 'react'

interface UseIdleTimeoutOptions {
  timeoutMinutes: number   // Total idle minutes before logout
  warningMinutes?: number  // Show warning this many minutes before logout (default 2)
  onTimeout: () => void
  enabled?: boolean
}

interface UseIdleTimeoutReturn {
  isWarning: boolean
  remainingSeconds: number
  resetTimer: () => void
}

const EVENTS: (keyof WindowEventMap)[] = [
  'mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click',
]

export function useIdleTimeout({
  timeoutMinutes,
  warningMinutes = 2,
  onTimeout,
  enabled = true,
}: UseIdleTimeoutOptions): UseIdleTimeoutReturn {
  const [isWarning, setIsWarning] = useState(false)
  const [remainingSeconds, setRemainingSeconds] = useState(warningMinutes * 60)

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onTimeoutRef = useRef(onTimeout)
  onTimeoutRef.current = onTimeout

  const clearAllTimers = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current)
    if (countdownRef.current) clearInterval(countdownRef.current)
  }, [])

  const startCountdown = useCallback((seconds: number) => {
    setRemainingSeconds(seconds)
    if (countdownRef.current) clearInterval(countdownRef.current)
    countdownRef.current = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(countdownRef.current!)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }, [])

  const resetTimer = useCallback(() => {
    if (!enabled || timeoutMinutes === 0) return

    clearAllTimers()
    setIsWarning(false)
    setRemainingSeconds(warningMinutes * 60)

    const warningMs = (timeoutMinutes - warningMinutes) * 60 * 1000
    const timeoutMs = timeoutMinutes * 60 * 1000

    // Warning fires before final timeout
    warningTimerRef.current = setTimeout(() => {
      setIsWarning(true)
      startCountdown(warningMinutes * 60)
    }, Math.max(warningMs, 0))

    // Final timeout
    idleTimerRef.current = setTimeout(() => {
      onTimeoutRef.current()
    }, timeoutMs)
  }, [enabled, timeoutMinutes, warningMinutes, clearAllTimers, startCountdown])

  // Register event listeners
  useEffect(() => {
    if (!enabled || timeoutMinutes === 0) return

    resetTimer()

    const handleActivity = () => {
      if (!isWarning) resetTimer()
    }

    EVENTS.forEach((event) => window.addEventListener(event, handleActivity, { passive: true }))

    return () => {
      clearAllTimers()
      EVENTS.forEach((event) => window.removeEventListener(event, handleActivity))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, timeoutMinutes])

  return { isWarning, remainingSeconds, resetTimer }
}
