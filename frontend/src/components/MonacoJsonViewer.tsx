// MonacoJsonViewer.tsx
//
// Read-only Monaco editor configured as a JSON viewer. Used when the JSON is
// large enough to need Monaco's virtual rendering and code folding. Lighter
// cases use JsonViewer (regex-based) to avoid loading the Monaco bundle.

import { useMemo, useCallback } from 'react'
import Editor, { loader } from '@monaco-editor/react'

// Configure Monaco to use local assets (optional, speeds up loading)
loader.config({
  paths: {
    vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs'
  }
})

interface MonacoJsonViewerProps {
  data: unknown
  height?: string | number
  className?: string
}

/**
 * Professional JSON Viewer using Monaco Editor (VS Code's editor)
 *
 * Features:
 * - Syntax highlighting
 * - Search (Ctrl+F / Cmd+F)
 * - Code folding
 * - Line numbers
 * - Minimap
 * - Copy selection
 * - Go to line (Ctrl+G)
 */
// Resolve a CSS variable (any format the browser understands) to a hex string.
// Uses a canvas pixel read so it works with OKLCH, HSL, RGB, etc.
function cssVarToHex(varName: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  if (!raw) return fallback
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d')
  if (!ctx) return fallback
  ctx.fillStyle = raw
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

export function MonacoJsonViewer({ data, height = '100%', className = '' }: MonacoJsonViewerProps) {
  const jsonString = useMemo(() => {
    try {
      return JSON.stringify(data, null, 2)
    } catch (e) {
      return String(data)
    }
  }, [data])

  // Resolve theme colors from CSS variables so Monaco follows the active theme
  const resolveThemeColors = useCallback(() => {
    const bg = cssVarToHex('--background', '#0a0a0f')
    const fg = cssVarToHex('--foreground', '#e5e7eb')
    const muted = cssVarToHex('--muted', '#1f2937')
    const accent = cssVarToHex('--accent', '#374151')
    const mutedFg = cssVarToHex('--muted-foreground', '#9ca3af')
    const border = cssVarToHex('--border', '#374151')
    return { bg, fg, muted, accent, mutedFg, border }
  }, [])

  // Ensure height is valid - convert number to px, keep string as-is
  const editorHeight = typeof height === 'number' ? `${height}px` : height
  const isFullHeight = height === '100%'

  return (
    <div
      className={`rounded-lg overflow-hidden border border-border ${isFullHeight ? 'h-full' : ''} ${className}`}
      style={isFullHeight ? undefined : { height: editorHeight }}
    >
      <Editor
        height="100%"
        defaultLanguage="json"
        value={jsonString}
        theme="vs-dark"
        options={{
          readOnly: true,
          minimap: {
            enabled: true,
            scale: 1,
            showSlider: 'mouseover'
          },
          scrollBeyondLastLine: false,
          fontSize: 13,
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Monaco', 'Menlo', monospace",
          lineNumbers: 'on',
          renderLineHighlight: 'line',
          folding: true,
          foldingStrategy: 'indentation',
          showFoldingControls: 'always',
          bracketPairColorization: {
            enabled: true
          },
          guides: {
            bracketPairs: true,
            indentation: true
          },
          scrollbar: {
            vertical: 'auto',
            horizontal: 'auto',
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10
          },
          wordWrap: 'on',
          contextmenu: true,
          selectOnLineNumbers: true,
          roundedSelection: true,
          cursorStyle: 'line',
          automaticLayout: true,
          padding: {
            top: 12,
            bottom: 12
          },
          // Custom colors for dark theme
          colorDecorators: true,
        }}
        onMount={(editor, monaco) => {
          // Build theme from live CSS variables so it follows the active mode
          const c = resolveThemeColors()
          monaco.editor.defineTheme('fabrik-dark', {
            base: 'vs-dark',
            inherit: true,
            rules: [
              { token: 'string.key.json', foreground: '60a5fa' },
              { token: 'string.value.json', foreground: '34d399' },
              { token: 'number', foreground: 'f472b6' },
              { token: 'keyword', foreground: 'a78bfa' },
              { token: 'comment', foreground: '6b7280' },
            ],
            colors: {
              'editor.background': c.bg,
              'editor.foreground': c.fg,
              'editor.lineHighlightBackground': c.muted,
              'editor.selectionBackground': c.accent,
              'editorLineNumber.foreground': c.mutedFg,
              'editorLineNumber.activeForeground': c.fg,
              'editorIndentGuide.background': c.muted,
              'editorIndentGuide.activeBackground': c.accent,
              'minimap.background': c.bg,
              'scrollbarSlider.background': c.accent,
              'scrollbarSlider.hoverBackground': c.mutedFg,
              'scrollbarSlider.activeBackground': c.border,
            }
          })
          monaco.editor.setTheme('fabrik-dark')

          // Add keyboard shortcuts info
          editor.addAction({
            id: 'search-help',
            label: 'Search Help',
            keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH],
            run: () => {
              // Show search help
            }
          })
        }}
        loading={
          <div className="flex items-center justify-center h-full bg-background">
            <div className="text-center">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
              <p className="text-xs text-muted-foreground">Loading editor...</p>
            </div>
          </div>
        }
      />
    </div>
  )
}
