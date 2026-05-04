// store/__tests__/themeStore.test.ts
//
// Tests for useThemeStore: mode switching, toggleMode, initializeTheme.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from '@testing-library/react'

describe('useThemeStore', () => {
  let useThemeStore: typeof import('../themeStore').useThemeStore
  let initializeTheme: typeof import('../themeStore').initializeTheme

  beforeEach(async () => {
    localStorage.clear()
    document.documentElement.classList.remove('light', 'dark')
    document.documentElement.removeAttribute('data-mode')

    vi.resetModules()
    const mod = await import('../themeStore')
    useThemeStore = mod.useThemeStore
    initializeTheme = mod.initializeTheme
  })

  describe('setMode', () => {
    it('updates mode to light', () => {
      act(() => {
        useThemeStore.getState().setMode('light')
      })

      expect(useThemeStore.getState().mode).toBe('light')
      expect(document.documentElement.classList.contains('light')).toBe(true)
      expect(document.documentElement.classList.contains('dark')).toBe(false)
    })

    it('updates mode to dark', () => {
      act(() => {
        useThemeStore.getState().setMode('dark')
      })

      expect(useThemeStore.getState().mode).toBe('dark')
      expect(document.documentElement.getAttribute('data-mode')).toBe('dark')
    })
  })

  describe('toggleMode', () => {
    it('toggles from dark to light', () => {
      act(() => {
        useThemeStore.getState().setMode('dark')
      })
      act(() => {
        useThemeStore.getState().toggleMode()
      })

      expect(useThemeStore.getState().mode).toBe('light')
    })

    it('toggles from light to dark', () => {
      act(() => {
        useThemeStore.getState().setMode('light')
      })
      act(() => {
        useThemeStore.getState().toggleMode()
      })

      expect(useThemeStore.getState().mode).toBe('dark')
    })
  })

  describe('initializeTheme', () => {
    it('applies stored mode from localStorage', () => {
      localStorage.setItem('fabrik-theme', JSON.stringify({
        state: { mode: 'light' },
      }))

      initializeTheme()

      expect(document.documentElement.classList.contains('light')).toBe(true)
    })

    it('falls back to dark when no stored theme', () => {
      initializeTheme()

      expect(document.documentElement.classList.contains('dark')).toBe(true)
    })

    it('falls back to defaults on invalid stored data', () => {
      localStorage.setItem('fabrik-theme', 'invalid-json')

      initializeTheme()

      expect(document.documentElement.classList.contains('dark')).toBe(true)
    })
  })
})
