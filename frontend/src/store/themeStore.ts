// Theme Store — light/dark mode only.
// Applied to <html> as a class so Tailwind's dark: variant works.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Mode = 'light' | 'dark'

interface ThemeStore {
  mode: Mode
  setMode: (mode: Mode) => void
  toggleMode: () => void
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      mode: 'dark',

      setMode: (mode: Mode) => {
        set({ mode })
        applyTheme(mode)
      },

      toggleMode: () => {
        set((state) => {
          const newMode = state.mode === 'dark' ? 'light' : 'dark'
          applyTheme(newMode)
          return { mode: newMode }
        })
      }
    }),
    {
      name: 'fabrik-theme',
      onRehydrateStorage: () => (state) => {
        if (state) {
          applyTheme(state.mode)
        }
      }
    }
  )
)

function applyTheme(mode: Mode) {
  const root = document.documentElement
  root.classList.remove('light', 'dark')
  root.classList.add(mode)
  root.setAttribute('data-mode', mode)
}

// Call in main.tsx before React renders to prevent flash
export function initializeTheme() {
  const stored = localStorage.getItem('fabrik-theme')

  if (stored) {
    try {
      const { state } = JSON.parse(stored)
      const mode = state?.mode || 'dark'
      applyTheme(mode)
      return
    } catch {
      // Invalid stored data, fall through to default
    }
  }

  applyTheme('dark')
}
