// hooks/useDebounce.ts
//
// Standard debounce hook. Returns a debounced copy of the value that only
// updates after the specified delay has elapsed without another change.
// Used mainly for search inputs to avoid firing API requests on every keystroke.

import { useState, useEffect } from 'react'

/**
 * Debounce hook - delays updating the value until after the specified delay
 * @param value - The value to debounce
 * @param delay - Delay in milliseconds
 * @returns Debounced value
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}
