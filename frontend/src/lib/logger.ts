// lib/logger.ts
//
// Production-safe wrapper around console. All calls are no-ops in production
// builds (import.meta.env.DEV is false) so debug logs don't leak to the browser
// console for end users. Use logger.* instead of console.* throughout the codebase.

const isDevelopment = import.meta.env.DEV

export const logger = {
  log: (...args: any[]) => {
    if (isDevelopment) {
      console.log(...args)
    }
  },

  warn: (...args: any[]) => {
    if (isDevelopment) {
      console.warn(...args)
    }
  },

  error: (...args: any[]) => {
    // Always log errors, even in production
    console.error(...args)
  },

  debug: (...args: any[]) => {
    if (isDevelopment) {
      console.debug(...args)
    }
  },

  info: (...args: any[]) => {
    if (isDevelopment) {
      console.info(...args)
    }
  }
}
