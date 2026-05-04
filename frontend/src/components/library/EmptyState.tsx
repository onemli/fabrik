// library/EmptyState.tsx
//
// Generic empty-state placeholder used in the Library page when there are no
// queries (or no queries matching the current filter). Accepts a title,
// description, and an optional action button so each call site can customize.

import { FileQuestion } from 'lucide-react'

interface EmptyStateProps {
  title: string
  description: string
  action?: React.ReactNode
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
        <FileQuestion className="w-8 h-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground text-center mb-6 max-w-md">{description}</p>
      {action}
    </div>
  )
}
