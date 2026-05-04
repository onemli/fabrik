// lib/__tests__/queryHistory.test.ts
//
// Tests for localStorage-based query execution history.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  getQueryHistory,
  addQueryHistoryEntry,
  deleteQueryHistoryEntry,
  clearQueryHistory,
  getRecentQueries,
  searchQueryHistory,
  getHistoryStats,
} from '../queryHistory'

function makeEntry(overrides: Partial<any> = {}) {
  return {
    name: 'Test Query',
    nodes: [],
    edges: [],
    query: null,
    resultCount: 10,
    executionTime: 150,
    success: true,
    ...overrides,
  }
}

describe('queryHistory', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('getQueryHistory', () => {
    it('returns empty array when no history', () => {
      expect(getQueryHistory()).toEqual([])
    })

    it('returns stored entries', () => {
      const entries = [
        { id: '1', timestamp: Date.now(), name: 'Q1', nodes: [], edges: [], query: null, resultCount: 5, executionTime: 100, success: true },
      ]
      localStorage.setItem('fabrik_query_history', JSON.stringify(entries))

      expect(getQueryHistory()).toHaveLength(1)
      expect(getQueryHistory()[0].name).toBe('Q1')
    })

    it('returns empty array on corrupt data', () => {
      localStorage.setItem('fabrik_query_history', 'not json')

      expect(getQueryHistory()).toEqual([])
    })
  })

  describe('addQueryHistoryEntry', () => {
    it('adds entry with auto-generated id and timestamp', () => {
      addQueryHistoryEntry(makeEntry())

      const history = getQueryHistory()
      expect(history).toHaveLength(1)
      expect(history[0].id).toContain('history_')
      expect(history[0].timestamp).toBeGreaterThan(0)
      expect(history[0].name).toBe('Test Query')
    })

    it('prepends new entries (most recent first)', () => {
      addQueryHistoryEntry(makeEntry({ name: 'First' }))
      addQueryHistoryEntry(makeEntry({ name: 'Second' }))

      const history = getQueryHistory()
      expect(history[0].name).toBe('Second')
      expect(history[1].name).toBe('First')
    })

    it('limits to 20 entries', () => {
      for (let i = 0; i < 25; i++) {
        addQueryHistoryEntry(makeEntry({ name: `Query ${i}` }))
      }

      expect(getQueryHistory()).toHaveLength(20)
    })
  })

  describe('deleteQueryHistoryEntry', () => {
    it('removes entry by id', () => {
      addQueryHistoryEntry(makeEntry({ name: 'Keep' }))
      addQueryHistoryEntry(makeEntry({ name: 'Delete' }))

      const history = getQueryHistory()
      const deleteId = history.find((e) => e.name === 'Delete')!.id

      deleteQueryHistoryEntry(deleteId)

      const updated = getQueryHistory()
      expect(updated).toHaveLength(1)
      expect(updated[0].name).toBe('Keep')
    })
  })

  describe('clearQueryHistory', () => {
    it('removes all history', () => {
      addQueryHistoryEntry(makeEntry())
      addQueryHistoryEntry(makeEntry())

      clearQueryHistory()

      expect(getQueryHistory()).toEqual([])
    })
  })

  describe('getRecentQueries', () => {
    it('returns last N entries', () => {
      for (let i = 0; i < 5; i++) {
        addQueryHistoryEntry(makeEntry({ name: `Q${i}` }))
      }

      const recent = getRecentQueries(3)
      expect(recent).toHaveLength(3)
    })

    it('defaults to 10', () => {
      for (let i = 0; i < 15; i++) {
        addQueryHistoryEntry(makeEntry())
      }

      expect(getRecentQueries()).toHaveLength(10)
    })
  })

  describe('searchQueryHistory', () => {
    it('searches by name (case-insensitive)', () => {
      addQueryHistoryEntry(makeEntry({ name: 'Tenant Query' }))
      addQueryHistoryEntry(makeEntry({ name: 'BD Query' }))
      addQueryHistoryEntry(makeEntry({ name: 'EPG Query' }))

      const results = searchQueryHistory('tenant')

      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Tenant Query')
    })

    it('returns empty for no matches', () => {
      addQueryHistoryEntry(makeEntry({ name: 'Test' }))

      expect(searchQueryHistory('nonexistent')).toEqual([])
    })
  })

  describe('getHistoryStats', () => {
    it('returns zeros for empty history', () => {
      const stats = getHistoryStats()

      expect(stats.total).toBe(0)
      expect(stats.successful).toBe(0)
      expect(stats.failed).toBe(0)
      expect(stats.successRate).toBe(0)
    })

    it('calculates stats correctly', () => {
      addQueryHistoryEntry(makeEntry({ success: true, executionTime: 100 }))
      addQueryHistoryEntry(makeEntry({ success: true, executionTime: 200 }))
      addQueryHistoryEntry(makeEntry({ success: false, executionTime: 50 }))

      const stats = getHistoryStats()

      expect(stats.total).toBe(3)
      expect(stats.successful).toBe(2)
      expect(stats.failed).toBe(1)
      expect(stats.successRate).toBeCloseTo(66.67, 1)
      expect(stats.avgExecutionTime).toBeCloseTo(116.67, 1)
    })
  })
})
