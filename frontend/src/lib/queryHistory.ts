// lib/queryHistory.ts
//
// LocalStorage-based query execution history. Records the last N queries the
// user ran so the Query Builder can show a history panel without API calls.
// Each entry stores the canvas state (nodes + edges) and the result metadata.

import type { Node, Edge } from '@xyflow/react'
import { QueryNodeData, APICQuery } from '@/types'

const HISTORY_KEY = 'fabrik_query_history'
const MAX_HISTORY = 20

export interface QueryHistoryEntry {
  id: string
  timestamp: number
  name: string | null
  nodes: Node<QueryNodeData>[]
  edges: Edge[]
  query: APICQuery | null
  resultCount: number
  executionTime: number
  success: boolean
}

/**
 * Get all query history entries
 */
export function getQueryHistory(): QueryHistoryEntry[] {
  try {
    const stored = localStorage.getItem(HISTORY_KEY)
    if (!stored) return []
    return JSON.parse(stored)
  } catch {
    return []
  }
}

/**
 * Add a new entry to query history
 */
export function addQueryHistoryEntry(entry: Omit<QueryHistoryEntry, 'id' | 'timestamp'>): void {
  try {
    const history = getQueryHistory()

    const newEntry: QueryHistoryEntry = {
      ...entry,
      id: `history_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
    }

    // Add to beginning and limit size
    const updatedHistory = [newEntry, ...history].slice(0, MAX_HISTORY)

    localStorage.setItem(HISTORY_KEY, JSON.stringify(updatedHistory))
  } catch {
    /* ignore */
  }
}

/**
 * Delete a history entry
 */
export function deleteQueryHistoryEntry(id: string): void {
  try {
    const history = getQueryHistory()
    const updated = history.filter((entry) => entry.id !== id)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated))
  } catch {
    /* ignore */
  }
}

/**
 * Clear all history
 */
export function clearQueryHistory(): void {
  try {
    localStorage.removeItem(HISTORY_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * Get recent queries (last N)
 */
export function getRecentQueries(count: number = 10): QueryHistoryEntry[] {
  return getQueryHistory().slice(0, count)
}

/**
 * Search history by query name
 */
export function searchQueryHistory(keyword: string): QueryHistoryEntry[] {
  const history = getQueryHistory()
  const lowerKeyword = keyword.toLowerCase()

  return history.filter(
    (entry) =>
      entry.name?.toLowerCase().includes(lowerKeyword) ||
      entry.query?.description?.toLowerCase().includes(lowerKeyword)
  )
}

/**
 * Get success rate statistics
 */
export function getHistoryStats(): {
  total: number
  successful: number
  failed: number
  successRate: number
  avgExecutionTime: number
} {
  const history = getQueryHistory()
  const successful = history.filter((e) => e.success).length
  const failed = history.length - successful
  const avgExecutionTime =
    history.reduce((sum, e) => sum + e.executionTime, 0) / (history.length || 1)

  return {
    total: history.length,
    successful,
    failed,
    successRate: history.length > 0 ? (successful / history.length) * 100 : 0,
    avgExecutionTime,
  }
}
