// contexts/TimezoneContext.tsx
//
// Single source of truth for date/time rendering across the app. The context
// holds the logged-in user's display_timezone, date_format, and time_format
// preferences (loaded from /api/auth/preferences/) and exposes stable helpers
// that honor them. Formatting goes through date-fns so behavior is
// deterministic regardless of the browser's locale.
//
// Any component rendering a timestamp must go through useFormatters() (or the
// pure helpers with an explicit preferences object) — a lint rule blocks
// direct Date.toLocale* calls to prevent regressions.

import { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react'
import { format as formatDate_dateFns, isValid as isValidDate } from 'date-fns'
import { api } from '@/services/api'

export interface UserPreferences {
  display_timezone: string
  date_format: string
  time_format: string
  created_at?: string
  updated_at?: string
}

interface TimezoneContextType {
  preferences: UserPreferences | null
  isLoading: boolean
  error: string | null
  updatePreferences: (preferences: Partial<UserPreferences>) => Promise<void>
  refetchPreferences: () => Promise<void>
}

const DEFAULT_PREFERENCES: UserPreferences = {
  display_timezone: 'Europe/Istanbul',
  date_format: 'DD/MM/YYYY',
  time_format: '24h',
}

const TimezoneContext = createContext<TimezoneContextType | undefined>(undefined)

interface TimezoneProviderProps {
  children: ReactNode
}

// Provider: loads the preferences once on mount, re-loads when the auth
// token changes in another tab (so login/logout in another window carries
// over), and exposes an update mutation that writes through to the API.
export function TimezoneProvider({ children }: TimezoneProviderProps) {
  const [preferences, setPreferences] = useState<UserPreferences | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchPreferences = async () => {
    try {
      setIsLoading(true)
      setError(null)

      const token = localStorage.getItem('access_token')
      if (!token) {
        setPreferences(DEFAULT_PREFERENCES)
        setIsLoading(false)
        return
      }

      const response = await api.get('/api/auth/preferences/') as { data: UserPreferences }
      setPreferences(response.data)
    } catch (err: any) {
      setError(err.message || 'Failed to load preferences')
      setPreferences(DEFAULT_PREFERENCES)
    } finally {
      setIsLoading(false)
    }
  }

  const updatePreferences = async (updates: Partial<UserPreferences>) => {
    try {
      setError(null)
      const response = await api.patch('/api/auth/preferences/', updates) as { data: UserPreferences }
      setPreferences(response.data)
    } catch (err: any) {
      setError(err.message || 'Failed to update preferences')
      throw err
    }
  }

  const refetchPreferences = async () => {
    await fetchPreferences()
  }

  useEffect(() => {
    fetchPreferences()
  }, [])

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'access_token') {
        fetchPreferences()
      }
    }
    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [])

  return (
    <TimezoneContext.Provider
      value={{
        preferences,
        isLoading,
        error,
        updatePreferences,
        refetchPreferences,
      }}
    >
      {children}
    </TimezoneContext.Provider>
  )
}

export function useTimezone(): TimezoneContextType {
  const context = useContext(TimezoneContext)
  if (context === undefined) {
    throw new Error('useTimezone must be used within a TimezoneProvider')
  }
  return context
}

// ── Pure formatting primitives ────────────────────────────────────────────
//
// These run outside React and accept an explicit preferences argument, so
// they can be used in sort comparators, table cell renderers that receive
// raw data, and unit tests.

// Normalize any input into a Date. Strings go through the native parser —
// ISO 8601 input (what Django REST Framework emits) is safe.
function toDate(input: Date | string | number | null | undefined): Date | null {
  if (input == null || input === '') return null
  const date = input instanceof Date ? input : new Date(input)
  return isValidDate(date) ? date : null
}

// Shift a Date into a target IANA timezone by reading its components through
// Intl.DateTimeFormat, then rebuilding a new Date using those local values.
// The returned Date's UTC fields match the target zone's wall-clock, which
// is exactly what date-fns `format()` wants to print.
function toZonedDate(date: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const values: Record<string, number> = {}
  for (const p of parts) {
    if (p.type !== 'literal') {
      values[p.type] = parseInt(p.value, 10)
    }
  }

  const hour = values.hour === 24 ? 0 : values.hour
  return new Date(
    values.year,
    (values.month || 1) - 1,
    values.day || 1,
    hour || 0,
    values.minute || 0,
    values.second || 0,
  )
}

// Translate our user-facing format tokens (DD/MM/YYYY) into date-fns tokens
// (dd/MM/yyyy). Only the options offered on the preferences screen are
// mapped — anything else falls back to the European default so the UI never
// breaks on a stale or unknown preference value.
function datePattern(dateFormat: string): string {
  switch (dateFormat) {
    case 'MM/DD/YYYY':
      return 'MM/dd/yyyy'
    case 'YYYY-MM-DD':
      return 'yyyy-MM-dd'
    case 'DD/MM/YYYY':
    default:
      return 'dd/MM/yyyy'
  }
}

function timePattern(timeFormat: string): string {
  return timeFormat === '12h' ? 'h:mm a' : 'HH:mm'
}

function resolvePrefs(preferences?: UserPreferences): UserPreferences {
  return preferences ?? DEFAULT_PREFERENCES
}

export function formatDate(
  date: Date | string | number | null | undefined,
  preferences?: UserPreferences,
): string {
  const parsed = toDate(date)
  if (!parsed) return '—'
  const prefs = resolvePrefs(preferences)
  const zoned = toZonedDate(parsed, prefs.display_timezone)
  return formatDate_dateFns(zoned, datePattern(prefs.date_format))
}

// Returns a YYYY-MM-DD string in the user's display timezone — suitable for
// comparing against CalendarHeatmap's selectedDate which uses the same format.
export function toLocalDateString(
  date: Date | string | number | null | undefined,
  preferences?: UserPreferences,
): string {
  const parsed = toDate(date)
  if (!parsed) return ''
  const prefs = resolvePrefs(preferences)
  const zoned = toZonedDate(parsed, prefs.display_timezone)
  return formatDate_dateFns(zoned, 'yyyy-MM-dd')
}

export function formatTime(
  date: Date | string | number | null | undefined,
  preferences?: UserPreferences,
): string {
  const parsed = toDate(date)
  if (!parsed) return '—'
  const prefs = resolvePrefs(preferences)
  const zoned = toZonedDate(parsed, prefs.display_timezone)
  return formatDate_dateFns(zoned, timePattern(prefs.time_format))
}

export function formatDateTime(
  date: Date | string | number | null | undefined,
  preferences?: UserPreferences,
): string {
  const parsed = toDate(date)
  if (!parsed) return '—'
  const prefs = resolvePrefs(preferences)
  const zoned = toZonedDate(parsed, prefs.display_timezone)
  return formatDate_dateFns(
    zoned,
    `${datePattern(prefs.date_format)} ${timePattern(prefs.time_format)}`,
  )
}

// Hook alternative to the pure helpers. Memoized so components can pass the
// returned functions to effects/callbacks without tripping exhaustive-deps.
export function useFormatters() {
  const { preferences } = useTimezone()

  return useMemo(() => {
    const prefs = preferences ?? DEFAULT_PREFERENCES
    return {
      formatDate: (date: Date | string | number | null | undefined) =>
        formatDate(date, prefs),
      formatTime: (date: Date | string | number | null | undefined) =>
        formatTime(date, prefs),
      formatDateTime: (date: Date | string | number | null | undefined) =>
        formatDateTime(date, prefs),
    }
  }, [preferences])
}
