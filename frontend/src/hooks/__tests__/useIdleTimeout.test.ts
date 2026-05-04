// hooks/__tests__/useIdleTimeout.test.ts
//
// Tests for useIdleTimeout hook: idle detection, warning, countdown, reset.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useIdleTimeout } from '../useIdleTimeout'

describe('useIdleTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns initial state with no warning', () => {
    const onTimeout = vi.fn()
    const { result } = renderHook(() =>
      useIdleTimeout({ timeoutMinutes: 5, warningMinutes: 2, onTimeout })
    )

    expect(result.current.isWarning).toBe(false)
    expect(result.current.remainingSeconds).toBe(120) // 2 min
  })

  it('shows warning after idle period', () => {
    const onTimeout = vi.fn()
    const { result } = renderHook(() =>
      useIdleTimeout({ timeoutMinutes: 5, warningMinutes: 2, onTimeout })
    )

    // Advance to warning time (5 - 2 = 3 minutes)
    act(() => {
      vi.advanceTimersByTime(3 * 60 * 1000)
    })

    expect(result.current.isWarning).toBe(true)
  })

  it('calls onTimeout after full idle period', () => {
    const onTimeout = vi.fn()
    renderHook(() =>
      useIdleTimeout({ timeoutMinutes: 5, warningMinutes: 2, onTimeout })
    )

    // Advance past full timeout
    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000 + 1000)
    })

    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('does not trigger when disabled', () => {
    const onTimeout = vi.fn()
    renderHook(() =>
      useIdleTimeout({ timeoutMinutes: 1, onTimeout, enabled: false })
    )

    act(() => {
      vi.advanceTimersByTime(2 * 60 * 1000)
    })

    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('does not trigger when timeoutMinutes is 0', () => {
    const onTimeout = vi.fn()
    renderHook(() =>
      useIdleTimeout({ timeoutMinutes: 0, onTimeout })
    )

    act(() => {
      vi.advanceTimersByTime(60 * 1000)
    })

    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('resetTimer clears warning state', () => {
    const onTimeout = vi.fn()
    const { result } = renderHook(() =>
      useIdleTimeout({ timeoutMinutes: 5, warningMinutes: 2, onTimeout })
    )

    // Advance to warning
    act(() => {
      vi.advanceTimersByTime(3 * 60 * 1000)
    })

    expect(result.current.isWarning).toBe(true)

    // Reset timer
    act(() => {
      result.current.resetTimer()
    })

    expect(result.current.isWarning).toBe(false)
    expect(result.current.remainingSeconds).toBe(120)
  })

  it('countdown decrements remaining seconds', () => {
    const onTimeout = vi.fn()
    const { result } = renderHook(() =>
      useIdleTimeout({ timeoutMinutes: 5, warningMinutes: 2, onTimeout })
    )

    // Advance to warning
    act(() => {
      vi.advanceTimersByTime(3 * 60 * 1000)
    })

    // Advance 5 seconds into countdown
    act(() => {
      vi.advanceTimersByTime(5 * 1000)
    })

    expect(result.current.remainingSeconds).toBe(115) // 120 - 5
  })
})
