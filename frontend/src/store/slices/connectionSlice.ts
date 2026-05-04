// store/slices/connectionSlice.ts
//
// APIC connection selection for the query builder. Tracks the currently active
// connection so the execute button knows which APIC to hit.

import { StateCreator } from 'zustand'
import type { QueryBuilderState } from '../index'

export interface ConnectionSlice {
  // State
  selectedConnectionIds: number[]
  selectedConnectionId: number | null

  // Actions
  setSelectedConnectionIds: (ids: number[]) => void
  addConnectionId: (id: number) => void
  removeConnectionId: (id: number) => void
  toggleConnectionId: (id: number) => void
  clearConnectionIds: () => void
  setSelectedConnectionId: (id: number | null) => void
}

type ConnectionSliceCreator = StateCreator<QueryBuilderState, [], [], ConnectionSlice>

export const createConnectionSlice: ConnectionSliceCreator = (set, get) => ({
  // State - initialised from localStorage with migration from legacy single-id key
  selectedConnectionIds: (() => {
    try {
      const saved = localStorage.getItem('selectedConnectionIds')
      if (saved) {
        return JSON.parse(saved) as number[]
      }
      const oldSaved = localStorage.getItem('selectedConnectionId')
      if (oldSaved) {
        const id = parseInt(oldSaved, 10)
        localStorage.removeItem('selectedConnectionId')
        localStorage.setItem('selectedConnectionIds', JSON.stringify([id]))
        return [id]
      }
      return []
    } catch {
      return []
    }
  })(),

  selectedConnectionId: (() => {
    try {
      const saved = localStorage.getItem('selectedConnectionIds')
      if (saved) {
        const ids = JSON.parse(saved) as number[]
        return ids.length > 0 ? ids[0] : null
      }
      return null
    } catch {
      return null
    }
  })(),

  // Actions
  setSelectedConnectionIds: (ids) => {
    set({
      selectedConnectionIds: ids,
      selectedConnectionId: ids.length > 0 ? ids[0] : null,
    })
    localStorage.setItem('selectedConnectionIds', JSON.stringify(ids))
  },

  addConnectionId: (id) => {
    set({
      selectedConnectionIds: [id],
      selectedConnectionId: id,
    })
    localStorage.setItem('selectedConnectionIds', JSON.stringify([id]))
  },

  removeConnectionId: (id) => {
    const { selectedConnectionIds } = get()
    const newIds = selectedConnectionIds.filter((i) => i !== id)
    set({
      selectedConnectionIds: newIds,
      selectedConnectionId: newIds.length > 0 ? newIds[0] : null,
    })
    localStorage.setItem('selectedConnectionIds', JSON.stringify(newIds))
  },

  toggleConnectionId: (id) => {
    const { selectedConnectionIds } = get()
    if (selectedConnectionIds.includes(id)) {
      const newIds = selectedConnectionIds.filter((i) => i !== id)
      set({
        selectedConnectionIds: newIds,
        selectedConnectionId: newIds.length > 0 ? newIds[0] : null,
      })
      localStorage.setItem('selectedConnectionIds', JSON.stringify(newIds))
    } else {
      set({
        selectedConnectionIds: [id],
        selectedConnectionId: id,
      })
      localStorage.setItem('selectedConnectionIds', JSON.stringify([id]))
    }
  },

  clearConnectionIds: () => {
    set({
      selectedConnectionIds: [],
      selectedConnectionId: null,
    })
    localStorage.setItem('selectedConnectionIds', JSON.stringify([]))
  },

  setSelectedConnectionId: (id) => {
    if (id !== null) {
      set({
        selectedConnectionIds: [id],
        selectedConnectionId: id,
      })
      localStorage.setItem('selectedConnectionIds', JSON.stringify([id]))
    } else {
      set({
        selectedConnectionIds: [],
        selectedConnectionId: null,
      })
      localStorage.setItem('selectedConnectionIds', JSON.stringify([]))
    }
  },
})
