// validation/createErrorCellRenderer.ts
//
// Utility for highlighting validation errors in a Tabulator grid. Applies red
// background + border + warning icon to cells that have associated errors.
// Clicking an error cell fires an optional callback for the detail panel.

import { ValidationError } from '@/services/validation'

// Apply error highlights to a Tabulator table instance. Call this after the
// table is built and data is loaded. Returns a cleanup function.
export function applyErrorHighlights(
  table: any,
  errors: ValidationError[],
  onCellClick?: (error: ValidationError) => void
): () => void {
  if (!table || errors.length === 0) return () => {}

  const errorMap = new Map<string, ValidationError>()
  errors.forEach(err => errorMap.set(`${err.row}-${err.column}`, err))

  const clickHandlers: Array<{ el: HTMLElement; handler: (e: MouseEvent) => void }> = []

  table.getRows().forEach((row: any, rowIndex: number) => {
    row.getCells().forEach((cell: any) => {
      const field = cell.getColumn().getField()
      const key = `${rowIndex}-${field}`
      const error = errorMap.get(key)

      if (error) {
        const el = cell.getElement() as HTMLElement
        el.classList.add('tabulator-validation-error')
        el.setAttribute('title', error.error_title)
        el.style.cursor = onCellClick ? 'pointer' : 'default'

        if (onCellClick) {
          const handler = (e: MouseEvent) => {
            e.stopPropagation()
            onCellClick(error)
          }
          el.addEventListener('click', handler)
          clickHandlers.push({ el, handler })
        }
      }
    })
  })

  // Return cleanup function
  return () => {
    clickHandlers.forEach(({ el, handler }) => {
      el.removeEventListener('click', handler)
    })
  }
}
