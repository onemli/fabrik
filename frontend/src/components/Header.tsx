// Header.tsx
//
// Top navigation bar. Contains the logo, global search trigger, notification bell,
// theme toggle, and user menu. Stays fixed at the top of the viewport so it's
// always accessible without scrolling.

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import { CommandPalette } from './CommandPalette'
import { UserMenu } from './UserMenu'
import { AlertNotification } from './AlertNotification'
import { Button } from './ui/button'
import { Command, Menu } from 'lucide-react'

export function Header() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { setIsSidebarHovered } = useQueryBuilderStore()
  const [showCommandPalette, setShowCommandPalette] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setShowCommandPalette(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <>
      <CommandPalette
        open={showCommandPalette}
        onOpenChange={setShowCommandPalette}
      />

      {/* Premium Glassmorphism Header */}
      <header className="h-16 sticky top-0 z-50 animate-fade-in">
        {/* Glass Background */}
        <div className="absolute inset-0 header-bar border-b border-border/50" />

        {/* Content */}
        <div className="relative h-full px-6 flex items-center gap-4">
          {/* Left Section - Menu + Logo */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <button
              onClick={() => setIsSidebarHovered(true)}
              className="group h-9 w-9 flex items-center justify-center rounded-lg transition-all duration-200 hover:bg-muted/50 hover:scale-105"
              title="Open menu"
            >
              <Menu className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
            </button>

            <button
              onClick={() => navigate('/')}
              className="flex items-center transition-all duration-200 p-2 rounded-xl"
              style={{ minWidth: '160px' }}
            >
              <span
                className="text-xl text-foreground select-none"
                style={{ fontFamily: "'Inter', 'DM Sans', sans-serif", fontWeight: 600 }}
              >
                Fabrik
              </span>
            </button>
          </div>

          {/* Center - Command Palette */}
          <div className="absolute left-1/2 -translate-x-1/2 hidden lg:block">
            <Button
              variant="ghost"
              onClick={() => setShowCommandPalette(true)}
              className="group h-10 px-6 gap-3 glass-strong border border-border hover:border-border hover:bg-muted/50 transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:shadow-primary/10 min-w-[360px]"
            >
              <Command className="w-4 h-4 text-primary" />
              <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors font-medium">
                Quick actions...
              </span>
              <kbd className="ml-auto h-6 px-2 gap-1 flex items-center rounded-md bg-muted/50 border border-border font-mono text-[11px] text-muted-foreground shadow-sm">
                <span className="text-xs">⌘</span>K
              </kbd>
            </Button>
          </div>

          {/* Right Section - Alerts + User */}
          <div className="flex items-center gap-3 flex-shrink-0 ml-auto">
            {user && <AlertNotification />}
            {user && <UserMenu />}
          </div>
        </div>
      </header>
    </>
  )
}
