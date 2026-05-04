// lib/utils.ts
//
// General-purpose helpers. Currently just cn() — the standard shadcn/ui
// utility for merging Tailwind class strings without conflicts. Keeping it
// here means all components import from @/lib/utils rather than duplicating
// the clsx + tailwind-merge pattern everywhere.

import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatClassName(className: string): string {
  // Remove 'fv' prefix if exists
  return className.replace(/^fv/, '')
}

export function getClassIcon(className: string): string {
  const lower = className.toLowerCase()
  if (lower.includes('epg')) return '🔷'
  if (lower.includes('bd')) return '🌉'
  if (lower.includes('vrf')) return '🔀'
  if (lower.includes('tenant')) return '🏢'
  if (lower.includes('ap')) return '📦'
  if (lower.includes('contract')) return '📜'
  if (lower.includes('filter')) return '🔍'
  if (lower.includes('node')) return '🖥️'
  if (lower.includes('interface')) return '🔌'
  return '📄'
}

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  if (diffSec < 60) return 'just now'
  if (diffMin < 60) return `${diffMin} minute${diffMin > 1 ? 's' : ''} ago`
  if (diffHour < 24) return `${diffHour} hour${diffHour > 1 ? 's' : ''} ago`
  if (diffDay < 7) return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`
  if (diffDay < 30) return `${Math.floor(diffDay / 7)} week${Math.floor(diffDay / 7) > 1 ? 's' : ''} ago`
  if (diffDay < 365) return `${Math.floor(diffDay / 30)} month${Math.floor(diffDay / 30) > 1 ? 's' : ''} ago`
  return `${Math.floor(diffDay / 365)} year${Math.floor(diffDay / 365) > 1 ? 's' : ''} ago`
}

export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes'

  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
}
