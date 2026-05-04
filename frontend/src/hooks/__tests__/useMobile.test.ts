// hooks/__tests__/useMobile.test.ts
//
// Tests for the useIsMobile hook: viewport width detection via matchMedia.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Store the change handler so we can trigger it manually
let mediaChangeHandler: (() => void) | null = null

beforeEach(() => {
  mediaChangeHandler = null

  // Mock matchMedia
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn((event: string, handler: () => void) => {
        if (event === 'change') mediaChangeHandler = handler
      }),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

describe('useIsMobile', () => {
  it('returns false for desktop viewport', async () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, value: 1024 })

    const { useIsMobile } = await import('../use-mobile')
    const { result } = renderHook(() => useIsMobile())

    expect(result.current).toBe(false)
  })

  it('returns true for mobile viewport', async () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, value: 400 })

    const { useIsMobile } = await import('../use-mobile')
    const { result } = renderHook(() => useIsMobile())

    expect(result.current).toBe(true)
  })

  it('returns true at exactly 767px (below breakpoint)', async () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, value: 767 })

    const { useIsMobile } = await import('../use-mobile')
    const { result } = renderHook(() => useIsMobile())

    expect(result.current).toBe(true)
  })

  it('returns false at exactly 768px (at breakpoint)', async () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, value: 768 })

    const { useIsMobile } = await import('../use-mobile')
    const { result } = renderHook(() => useIsMobile())

    expect(result.current).toBe(false)
  })

  it('updates when viewport changes via matchMedia listener', async () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, value: 1024 })

    const { useIsMobile } = await import('../use-mobile')
    const { result } = renderHook(() => useIsMobile())

    expect(result.current).toBe(false)

    // Simulate resize to mobile
    Object.defineProperty(window, 'innerWidth', { writable: true, value: 400 })

    act(() => {
      if (mediaChangeHandler) mediaChangeHandler()
    })

    expect(result.current).toBe(true)
  })
})
