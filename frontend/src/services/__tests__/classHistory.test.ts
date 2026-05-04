// services/__tests__/classHistory.test.ts
//
// Tests for ClassHistoryService: addRecent, getRecent, clearRecent, getStats.
// This service uses localStorage — no network calls.

import { describe, it, expect, beforeEach } from 'vitest'

describe('ClassHistoryService', () => {
  let classHistory: typeof import('../classHistory').classHistory

  beforeEach(async () => {
    localStorage.clear()
    // Fresh import each time so the singleton re-reads from localStorage.
    const mod = await import('../classHistory')
    classHistory = mod.classHistory
  })

  describe('getRecent', () => {
    it('returns empty array when no history', () => {
      expect(classHistory.getRecent()).toEqual([])
    })

    it('returns items from localStorage', () => {
      const items = [
        { className: 'fvTenant', label: 'Tenant', classPkg: 'fv', lastUsed: 1000 },
      ]
      localStorage.setItem('fabrik_recent_classes', JSON.stringify(items))

      const result = classHistory.getRecent()
      expect(result).toHaveLength(1)
      expect(result[0].className).toBe('fvTenant')
    })

    it('respects limit parameter', () => {
      const items = [
        { className: 'fvTenant', label: 'Tenant', classPkg: 'fv', lastUsed: 3000 },
        { className: 'fvBD', label: 'Bridge Domain', classPkg: 'fv', lastUsed: 2000 },
        { className: 'fvCtx', label: 'VRF', classPkg: 'fv', lastUsed: 1000 },
      ]
      localStorage.setItem('fabrik_recent_classes', JSON.stringify(items))

      const result = classHistory.getRecent(2)
      expect(result).toHaveLength(2)
    })

    it('sorts by lastUsed descending', () => {
      const items = [
        { className: 'fvBD', label: 'BD', classPkg: 'fv', lastUsed: 1000 },
        { className: 'fvTenant', label: 'Tenant', classPkg: 'fv', lastUsed: 3000 },
      ]
      localStorage.setItem('fabrik_recent_classes', JSON.stringify(items))

      const result = classHistory.getRecent()
      expect(result[0].className).toBe('fvTenant')
      expect(result[1].className).toBe('fvBD')
    })
  })

  describe('addRecent', () => {
    it('adds item to history', () => {
      classHistory.addRecent('fvTenant', { label: 'Tenant', classPkg: 'fv' } as any)

      const result = classHistory.getRecent()
      expect(result).toHaveLength(1)
      expect(result[0].className).toBe('fvTenant')
    })

    it('moves existing item to front', () => {
      classHistory.addRecent('fvTenant', { label: 'Tenant', classPkg: 'fv' } as any)
      classHistory.addRecent('fvBD', { label: 'BD', classPkg: 'fv' } as any)
      classHistory.addRecent('fvTenant', { label: 'Tenant', classPkg: 'fv' } as any)

      const result = classHistory.getRecent()
      expect(result).toHaveLength(2)
      // fvTenant should be first (most recent)
      expect(result[0].className).toBe('fvTenant')
    })

    it('enforces max 20 items', () => {
      for (let i = 0; i < 25; i++) {
        classHistory.addRecent(`class${i}`)
      }

      const result = classHistory.getRecent()
      expect(result.length).toBeLessThanOrEqual(20)
    })

    it('uses className as label fallback', () => {
      classHistory.addRecent('fvTenant')

      const result = classHistory.getRecent()
      expect(result[0].label).toBe('fvTenant')
    })
  })

  describe('clearRecent', () => {
    it('removes all history', () => {
      classHistory.addRecent('fvTenant')
      classHistory.addRecent('fvBD')

      classHistory.clearRecent()

      expect(classHistory.getRecent()).toEqual([])
    })
  })

  describe('getStats', () => {
    it('returns count and oldest timestamp', () => {
      classHistory.addRecent('fvTenant')
      classHistory.addRecent('fvBD')

      const stats = classHistory.getStats()
      expect(stats.recentCount).toBe(2)
      expect(stats.oldestRecent).toBeDefined()
    })

    it('returns zero count when empty', () => {
      const stats = classHistory.getStats()
      expect(stats.recentCount).toBe(0)
      expect(stats.oldestRecent).toBeUndefined()
    })
  })
})
