// KeyboardShortcutsDialog.tsx — reference dialog listing all canvas keyboard shortcuts.

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Command, Keyboard } from 'lucide-react'
import { cn } from '@/lib/utils'

interface KeyboardShortcut {
  key: string
  description: string
  category: string
}

const shortcuts: KeyboardShortcut[] = [
  // Navigation
  { key: '⌘K / Ctrl+K', description: 'Open command palette', category: 'Navigation' },
  { key: '⌘/', description: 'Show keyboard shortcuts', category: 'Navigation' },
  { key: 'Esc', description: 'Close dialogs/panels', category: 'Navigation' },

  // Canvas
  { key: '⌘+', description: 'Zoom in', category: 'Canvas' },
  { key: '⌘-', description: 'Zoom out', category: 'Canvas' },
  { key: '⌘0', description: 'Reset zoom', category: 'Canvas' },
  { key: 'Space + Drag', description: 'Pan canvas', category: 'Canvas' },
  { key: 'Del / Backspace', description: 'Delete selected nodes', category: 'Canvas' },
  { key: '⌘A', description: 'Select all nodes', category: 'Canvas' },

  // Query Building
  { key: '⌘Enter', description: 'Execute query', category: 'Query' },
  { key: '⌘S', description: 'Save query', category: 'Query' },
  { key: '⌘Shift+S', description: 'Save as template', category: 'Query' },
  { key: '⌘R', description: 'Clear canvas', category: 'Query' },

  // Results
  { key: '⌘C', description: 'Copy results', category: 'Results' },
  { key: '⌘E', description: 'Export results', category: 'Results' },
]

const categories = Array.from(new Set(shortcuts.map((s) => s.category)))

export function KeyboardShortcutsDialog() {
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ⌘/ or Ctrl+/
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault()
        setIsOpen((prev) => !prev)
      }
      // Escape to close
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Keyboard className="w-5 h-5" />
            Keyboard Shortcuts
          </DialogTitle>
          <DialogDescription>
            Master these shortcuts to boost your productivity
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {categories.map((category) => (
            <div key={category}>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                {category}
              </h3>
              <div className="space-y-2">
                {shortcuts
                  .filter((s) => s.category === category)
                  .map((shortcut, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted/50 transition-colors"
                    >
                      <span className="text-sm text-foreground">{shortcut.description}</span>
                      <KeyboardKey keys={shortcut.key} />
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 pt-4 border-t border-border">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Command className="w-3 h-3" />
            <span>Press ⌘/ (Ctrl+/) anytime to toggle this dialog</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Key Display Component
function KeyboardKey({ keys }: { keys: string }) {
  const parts = keys.split(' ')

  return (
    <div className="flex items-center gap-1">
      {parts.map((part, idx) => {
        if (part === '+') {
          return (
            <span key={idx} className="text-muted-foreground text-xs">
              +
            </span>
          )
        }
        if (part === '/') {
          return (
            <span key={idx} className="text-muted-foreground text-xs mx-1">
              or
            </span>
          )
        }
        return (
          <kbd
            key={idx}
            className={cn(
              'px-2 py-1 text-xs font-mono rounded border border-border bg-muted shadow-sm',
              'min-w-[2rem] text-center'
            )}
          >
            {part}
          </kbd>
        )
      })}
    </div>
  )
}
