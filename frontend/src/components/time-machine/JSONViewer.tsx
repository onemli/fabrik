// JSONViewer.tsx
//
// Syntax-highlighted JSON display for the snapshot detail view.
// Uses regex replacements on the formatted string instead of a full AST
// walk — good enough for read-only display and much simpler to maintain.
// Keys are blue, string values green, booleans purple, nulls red, numbers amber.

import { useMemo } from 'react'

interface JSONViewerProps {
  data: any
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export default function JSONViewer({ data }: JSONViewerProps) {
  const formattedJSON = useMemo(() => {
    const json = escapeHtml(JSON.stringify(data, null, 2))

    // Syntax highlighting with colors
    return json
      .replace(/("([^"\\]|\\.)*")\s*:/g, '<span class="text-blue-400">$1</span>:') // Keys
      .replace(/:\s*("([^"\\]|\\.)*")/g, ': <span class="text-emerald-400">$1</span>') // String values
      .replace(/:\s*(true|false)/g, ': <span class="text-purple-400">$1</span>') // Booleans
      .replace(/:\s*(null)/g, ': <span class="text-red-400">$1</span>') // Null
      .replace(/:\s*(-?\d+\.?\d*)/g, ': <span class="text-amber-400">$1</span>') // Numbers
  }, [data])

  return (
    <pre className="text-xs p-6 m-0 bg-background/40 font-mono">
      {/* eslint-disable no-restricted-syntax -- SECURITY: formattedJSON starts from escapeHtml(JSON.stringify(...)), so any &<> in the data are neutralized before the regex steps add their own <span> wrappers. */}
      <code
        className="text-foreground 70"
        dangerouslySetInnerHTML={{ __html: formattedJSON }}
      />
      {/* eslint-enable no-restricted-syntax */}
    </pre>
  )
}
