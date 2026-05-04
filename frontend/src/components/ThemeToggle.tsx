// ThemeToggle.tsx
//
// Icon button that cycles between light and dark mode. Reads from themeStore
// and writes back on click. Renders a sun icon in dark mode and a moon icon
// in light mode so the icon always shows what you'll switch TO.

import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useThemeStore } from '@/store/themeStore'

export function ThemeToggle() {
  const { mode, toggleMode } = useThemeStore()

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleMode}
      title={mode === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
      className="relative"
    >
      {/* Show icon for NEXT state (what you'll switch TO) */}
      {mode === 'light' ? (
        <Moon className="w-4 h-4" />
      ) : (
        <Sun className="w-4 h-4" />
      )}
    </Button>
  )
}
