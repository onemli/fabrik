// lib/statusColors.ts
//
// Central map of Tailwind class strings for status colors (success, error, warning,
// info, running, pending, etc.). Importing from here keeps status badge colors
// consistent across all pages instead of each file hardcoding its own variants.

export const STATUS_COLORS = {
  success: { bg: 'bg-green-500/10', text: 'text-green-600 dark:text-green-400', border: 'border-green-500/20', icon: 'text-green-500' },
  error: { bg: 'bg-red-500/10', text: 'text-red-600 dark:text-red-400', border: 'border-red-500/20', icon: 'text-red-500' },
  warning: { bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-500/20', icon: 'text-amber-500' },
  info: { bg: 'bg-blue-500/10', text: 'text-blue-600 dark:text-blue-400', border: 'border-blue-500/20', icon: 'text-blue-500' },
  pending: { bg: 'bg-muted/50', text: 'text-muted-foreground', border: 'border-border', icon: 'text-muted-foreground' },
  running: { bg: 'bg-blue-500/10', text: 'text-blue-600 dark:text-blue-400', border: 'border-blue-500/20', icon: 'text-blue-500' },
  cancelled: { bg: 'bg-muted/50', text: 'text-muted-foreground', border: 'border-border', icon: 'text-muted-foreground' },
} as const
