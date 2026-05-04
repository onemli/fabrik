// services/classHistory.ts
//
// Recently used ACI class tracker. Source of truth is backend (RecentClass
// model, per user, syncs across devices). localStorage mirror is kept as an
// offline fallback so the dialog still shows recents when the API is down.
//
// addRecent() fires-and-forgets the backend POST (idempotent upsert) and
// updates the local mirror synchronously so the UI reflects the change
// immediately even if the network request is in flight.

import type { MIMClass, RecentClassEntry } from '@/types'

const RECENT_CLASSES_KEY = 'fabrik_recent_classes'
const MAX_RECENT_ITEMS = 20

export interface ClassHistoryItem {
  className: string
  label: string
  classPkg: string
  lastUsed: number
}

class ClassHistoryService {
  /** Track an in-flight backend recorder so we can lazily inject it. The
   * services layer cannot import lib/api at module load time without a
   * circular dep through types, so we resolve it on first use. */
  private recorder: ((entry: { class_name: string; label?: string; class_pkg?: string }) => Promise<unknown>) | null = null

  setRecorder(fn: (entry: { class_name: string; label?: string; class_pkg?: string }) => Promise<unknown>) {
    this.recorder = fn
  }

  addRecent(className: string, classInfo?: Partial<MIMClass>): void {
    this.writeLocal(className, classInfo)
    if (this.recorder) {
      this.recorder({
        class_name: className,
        label: classInfo?.label || className,
        class_pkg: classInfo?.classPkg || '',
      }).catch(() => { /* offline / 401 — local mirror still holds */ })
    }
  }

  /** Read from local mirror only. Components that want fresh backend data
   * should use the useRecent() hook (React Query) instead — this method
   * exists for legacy synchronous callers. */
  getRecent(limit?: number): ClassHistoryItem[] {
    try {
      const stored = localStorage.getItem(RECENT_CLASSES_KEY)
      if (!stored) return []
      const recent = JSON.parse(stored) as ClassHistoryItem[]
      recent.sort((a, b) => b.lastUsed - a.lastUsed)
      return limit ? recent.slice(0, limit) : recent
    } catch {
      return []
    }
  }

  /** Hydrate the local mirror from a backend payload. Called once after
   * useRecent() fetches; keeps the offline fallback warm. */
  hydrateFromBackend(entries: RecentClassEntry[]): void {
    try {
      const items: ClassHistoryItem[] = entries.map((e) => ({
        className: e.class_name,
        label: e.label || e.class_name,
        classPkg: e.class_pkg || '',
        lastUsed: new Date(e.last_used_at).getTime(),
      }))
      localStorage.setItem(RECENT_CLASSES_KEY, JSON.stringify(items.slice(0, MAX_RECENT_ITEMS)))
    } catch {
      /* ignore */
    }
  }

  clearRecent(): void {
    try {
      localStorage.removeItem(RECENT_CLASSES_KEY)
    } catch {
      /* ignore */
    }
  }

  /** One-time migration: push localStorage entries the user accumulated before
   * backend persistence was introduced. Idempotent — backend POST upserts. */
  async migrateLocalToBackend(): Promise<void> {
    if (!this.recorder) return
    const existing = this.getRecent()
    if (existing.length === 0) return
    const flag = `${RECENT_CLASSES_KEY}_migrated_v1`
    if (localStorage.getItem(flag)) return
    for (const item of existing) {
      try {
        await this.recorder({
          class_name: item.className,
          label: item.label,
          class_pkg: item.classPkg,
        })
      } catch {
        return // backend down — try again next session
      }
    }
    try { localStorage.setItem(flag, String(Date.now())) } catch { /* ignore */ }
  }

  private writeLocal(className: string, classInfo?: Partial<MIMClass>): void {
    try {
      const recent = this.getRecent()
      const filtered = recent.filter((item) => item.className !== className)
      filtered.unshift({
        className,
        label: classInfo?.label || className,
        classPkg: classInfo?.classPkg || '',
        lastUsed: Date.now(),
      })
      localStorage.setItem(
        RECENT_CLASSES_KEY,
        JSON.stringify(filtered.slice(0, MAX_RECENT_ITEMS)),
      )
    } catch {
      /* ignore */
    }
  }

  getStats() {
    return {
      recentCount: this.getRecent().length,
      oldestRecent: this.getRecent().slice(-1)[0]?.lastUsed,
    }
  }
}

export const classHistory = new ClassHistoryService()
