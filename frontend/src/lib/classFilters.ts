// classFilters.ts
//
// Single source of truth for "is this class noisy / monitoring / stats" — used
// by ClassBrowserDialog default filters and ChildrenSection's split rendering.
// Two regexes are intentionally combined here: the broader MIM-wide pattern
// (covers ag15min/trend/threshold etc.) and the prefix pattern that
// ChildrenSection used historically. Keep both so existing UX is preserved.

/** Broad pattern matching anywhere in the class name. Catches aggregation
 * windows (Ag15min, Ag1h, Ag5min), faults, health, stats, trends, thresholds,
 * events, and audit records — classes that almost never make sense as the
 * subject of a query. */
export const MONITORING_REGEX = /stats|ag15min|ag1h|ag5min|fault|health|trend|threshold|event|record/i

/** Prefix pattern, kept for backwards compatibility with ChildrenSection. */
export const MONITORING_PREFIX_REGEX = /^(stats|fault|health|mon|count)/i

export function isMonitoringClass(className: string | null | undefined): boolean {
  if (!className) return false
  return MONITORING_REGEX.test(className) || MONITORING_PREFIX_REGEX.test(className)
}

// ─── Default filter chip state ─────────────────────────────────────────────

export interface ClassFilterFlags {
  hideDeprecated: boolean
  hideAbstract: boolean
  hideHidden: boolean
  hideMonitoring: boolean
}

const STORAGE_KEY = 'fabrik_class_filter_flags_v1'

export const DEFAULT_FILTER_FLAGS: ClassFilterFlags = {
  hideDeprecated: true,
  hideAbstract: true,
  hideHidden: true,
  hideMonitoring: true,
}

export function loadFilterFlags(): ClassFilterFlags {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_FILTER_FLAGS }
    const parsed = JSON.parse(raw) as Partial<ClassFilterFlags>
    return { ...DEFAULT_FILTER_FLAGS, ...parsed }
  } catch {
    return { ...DEFAULT_FILTER_FLAGS }
  }
}

export function saveFilterFlags(flags: ClassFilterFlags): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(flags))
  } catch {
    /* ignore */
  }
}

/** Apply filter flags client-side. Backend also accepts query params for the
 * same flags so server-side filtering keeps payloads lean — this helper is the
 * fallback for endpoints that don't yet honor the params. */
export function applyClientFilters<T extends {
  className: string
  isDeprecated?: boolean
  isAbstract?: boolean
  isHidden?: boolean
}>(items: T[], flags: ClassFilterFlags): T[] {
  return items.filter((item) => {
    if (flags.hideDeprecated && item.isDeprecated) return false
    if (flags.hideAbstract && item.isAbstract) return false
    if (flags.hideHidden && item.isHidden) return false
    if (flags.hideMonitoring && isMonitoringClass(item.className)) return false
    return true
  })
}
