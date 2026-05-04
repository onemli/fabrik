// JsonViewer.tsx
//
// Lightweight JSON syntax highlighter using regex-based token coloring. Used in
// places where Monaco is too heavy (small modals, inline previews). The output
// is a pre-formatted block with colored tokens — keys, strings, numbers, booleans.

import { useMemo } from 'react'

interface JsonViewerProps {
  data: unknown
  className?: string
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function JsonViewer({ data, className = '' }: JsonViewerProps) {
  const colorizedJson = useMemo(() => {
    const jsonString = escapeHtml(JSON.stringify(data, null, 2))

    // Regex patterns for different JSON elements
    return jsonString
      .replace(
        /("(?:\\.|[^"\\])*")(\s*:)?/g,
        (_match, p1, p2) => {
          // Keys (when followed by colon)
          if (p2) {
            return `<span class="json-key">${p1}</span>${p2}`
          }
          // String values
          return `<span class="json-string">${p1}</span>`
        }
      )
      .replace(
        /\b(true|false)\b/g,
        '<span class="json-boolean">$1</span>'
      )
      .replace(
        /\bnull\b/g,
        '<span class="json-null">null</span>'
      )
      .replace(
        /\b(-?\d+\.?\d*)\b/g,
        '<span class="json-number">$1</span>'
      )
  }, [data])

  return (
    <>
      <style>{`
        .json-key {
          color: #60a5fa;
          font-weight: 500;
        }
        .json-string {
          color: #34d399;
        }
        .json-number {
          color: #f472b6;
        }
        .json-boolean {
          color: #a78bfa;
          font-weight: 600;
        }
        .json-null {
          color: #94a3b8;
          font-style: italic;
        }
      `}</style>
      <pre
        className={`text-xs font-mono ${className}`}
        dangerouslySetInnerHTML={{ __html: colorizedJson }}
      />
    </>
  )
}
