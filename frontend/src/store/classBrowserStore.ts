// Class Browser preferences — controls which detail sections are visible
// in the ClassBrowserDialog's right panel. Persisted to localStorage.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type DetailTabId = 'overview' | 'properties' | 'relationships' | 'dn' | 'faults'

export interface ClassBrowserPrefs {
  showDescription: boolean
  showDnReference: boolean
  showChildClasses: boolean
  showProperties: boolean
  /** Last detail tab the user opened. Restored on the next dialog open. */
  lastDetailTab: DetailTabId
}

interface ClassBrowserStore extends ClassBrowserPrefs {
  setPreference: <K extends keyof ClassBrowserPrefs>(key: K, value: ClassBrowserPrefs[K]) => void
}

export const useClassBrowserStore = create<ClassBrowserStore>()(
  persist(
    (set) => ({
      showDescription: true,
      showDnReference: true,
      showChildClasses: true,
      showProperties: true,
      lastDetailTab: 'overview',

      setPreference: (key, value) => set({ [key]: value }),
    }),
    { name: 'fabrik-class-browser' }
  )
)
