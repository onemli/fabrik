// SeverityBadge.tsx
//
// Color-coded severity indicator used across the Time Machine comparison UI.
// Maps the five ACI impact levels to distinct colors so operators can instantly
// spot critical changes in a long list without reading every line.

import { cn } from '@/lib/utils'
import type { Severity } from '@/services/timeMachine'

const SEVERITY_CONFIG: Record<Severity, { bg: string; text: string; label: string }> = {
  critical: {
    bg: 'bg-red-500/15 border-red-500/30',
    text: 'text-red-700 dark:text-red-300',
    label: 'Critical',
  },
  high: {
    bg: 'bg-orange-500/15 border-orange-500/30',
    text: 'text-orange-700 dark:text-orange-300',
    label: 'High',
  },
  medium: {
    bg: 'bg-yellow-500/15 border-yellow-500/30',
    text: 'text-yellow-700 dark:text-yellow-300',
    label: 'Medium',
  },
  low: {
    bg: 'bg-blue-500/15 border-blue-500/30',
    text: 'text-blue-700 dark:text-blue-300',
    label: 'Low',
  },
  info: {
    bg: 'bg-slate-500/15 border-slate-500/30',
    text: 'text-slate-600 dark:text-slate-400',
    label: 'Info',
  },
}

interface SeverityBadgeProps {
  severity: Severity
  className?: string
  showLabel?: boolean
}

export default function SeverityBadge({
  severity,
  className,
  showLabel = true,
}: SeverityBadgeProps) {
  const config = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.medium

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium border',
        config.bg,
        config.text,
        className
      )}
    >
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full',
          severity === 'critical' && 'bg-red-500',
          severity === 'high' && 'bg-orange-500',
          severity === 'medium' && 'bg-yellow-500',
          severity === 'low' && 'bg-blue-500',
          severity === 'info' && 'bg-slate-500',
        )}
      />
      {showLabel && config.label}
    </span>
  )
}
