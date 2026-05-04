// lib/toast.ts
//
// Wrapper around Sonner toast with automatic error formatting. Instead of calling
// sonner.error(error.message) directly everywhere, components call toast.error(error, 'apic')
// and the error handler formats the message appropriately for that domain.
// toast.promise() wraps async operations with loading → success/error states.

import { toast as sonner } from 'sonner'
import { formatErrorForToast } from './errorHandler'

type ErrorContext = 'apic' | 'awx' | 'neo4j' | 'query' | 'validation' | 'upload' | 'ai' | 'pipeline'

type ToastOptions = {
  description?: string
  duration?: number
  id?: string | number
  [key: string]: unknown
}

/**
 * Show success toast notification
 */
export function success(title: string, options?: string | ToastOptions): void {
  if (typeof options === 'string') {
    sonner.success(title, { description: options })
  } else {
    sonner.success(title, options as any)
  }
}

/**
 * Show error toast with automatic formatting
 *
 * Accepts either an Error object (will be formatted) or a string message.
 *
 * @param errorOrMessage - Error object from API or string message
 * @param context - Optional context for specialized error handling
 */
export function error(
  errorOrMessage: any,
  context?: ErrorContext
): void {
  // If it's a simple string, show directly
  if (typeof errorOrMessage === 'string') {
    sonner.error(errorOrMessage)
    return
  }

  // Check if it's our APIError with formatted properties
  if (errorOrMessage.title) {
    const description = errorOrMessage.suggestedAction
      ? `${errorOrMessage.description}\n\n${errorOrMessage.suggestedAction}`
      : errorOrMessage.description

    sonner.error(errorOrMessage.title, { description })
    return
  }

  // Format unknown error
  const formatted = formatErrorForToast(errorOrMessage, context)
  sonner.error(formatted.title, { description: formatted.description })
}

/**
 * Show warning toast notification
 */
export function warning(title: string, options?: string | ToastOptions): void {
  if (typeof options === 'string') {
    sonner.warning(title, { description: options })
  } else {
    sonner.warning(title, options as any)
  }
}

/**
 * Show info toast notification
 */
export function info(title: string, options?: string | ToastOptions): void {
  if (typeof options === 'string') {
    sonner.info(title, { description: options })
  } else {
    sonner.info(title, options as any)
  }
}

/**
 * Show loading toast (returns ID for dismissal)
 */
export function loading(title: string, options?: string | ToastOptions): string | number {
  if (typeof options === 'string') {
    return sonner.loading(title, { description: options })
  }
  return sonner.loading(title, options as any)
}

/**
 * Dismiss a specific toast by ID
 */
export function dismiss(toastId: string | number): void {
  sonner.dismiss(toastId)
}

/**
 * Promise toast - automatically handles loading/success/error states
 *
 * @param promise - Promise to track
 * @param messages - Messages for each state
 * @param context - Optional error context
 */
export function promise<T>(
  promiseToTrack: Promise<T>,
  messages: {
    loading: string
    success: string
    error: string
  },
  context?: ErrorContext
): Promise<T> {
  // Fire-and-forget the sonner toast — we keep tracking the original promise
  // so callers can await the underlying result without leaking sonner's
  // internal return type into the rest of the app.
  sonner.promise(promiseToTrack, {
    loading: messages.loading,
    success: () => messages.success,
    error: (err: any) => {
      if (err?.title) {
        return `${err.title}${err.description ? `: ${err.description}` : ''}`
      }
      const formatted = formatErrorForToast(err, context)
      return `${formatted.title}${formatted.description ? `: ${formatted.description}` : ''}`
    },
  })
  return promiseToTrack
}

/**
 * Toast utilities - exported for convenience
 */
export const toast = {
  success,
  error,
  warning,
  info,
  loading,
  dismiss,
  promise,
}
