// lib/performanceMonitor.ts
//
// Development-only performance and memory monitor. Checks browser memory usage
// every minute and logs a warning if it crosses 500 MB. Not bundled in production
// builds. Useful for catching memory leaks in the React Flow canvas during development.

class PerformanceMonitor {
  private memoryWarningThreshold = 500 // MB
  private memoryCheckInterval = 60000 // 1 minute

  /**
   * Start monitoring memory usage
   */
  startMonitoring() {
    if (!('memory' in performance)) {
      // Memory API is only available in Chromium-based browsers
      // Silently skip monitoring in other browsers (Firefox, Safari)
      return
    }

    // Check memory every minute
    setInterval(() => {
      this.checkMemory()
    }, this.memoryCheckInterval)

    console.log('[PerformanceMonitor] Memory monitoring started')
  }

  /**
   * Check current memory usage
   */
  checkMemory() {
    if (!('memory' in performance)) return

    const memory = (performance as any).memory
    const usedMemoryMB = Math.round(memory.usedJSHeapSize / 1048576)
    const totalMemoryMB = Math.round(memory.totalJSHeapSize / 1048576)
    const limitMemoryMB = Math.round(memory.jsHeapSizeLimit / 1048576)

    // Log memory stats
    console.log(
      `[PerformanceMonitor] Memory: ${usedMemoryMB}MB / ${totalMemoryMB}MB (Limit: ${limitMemoryMB}MB)`
    )

    // Warn if memory usage is high
    if (usedMemoryMB > this.memoryWarningThreshold) {
      console.warn(
        `[PerformanceMonitor] High memory usage detected: ${usedMemoryMB}MB`
      )
      console.warn('[PerformanceMonitor] Consider closing unused tabs or refreshing the page')
    }

    // Suggest garbage collection if available (Chrome DevTools)
    if (usedMemoryMB > this.memoryWarningThreshold * 1.5 && (window as any).gc) {
      console.log('[PerformanceMonitor] Triggering manual garbage collection...')
      ;(window as any).gc()
    }
  }

  /**
   * Get current memory stats
   */
  getMemoryStats() {
    if (!('memory' in performance)) return null

    const memory = (performance as any).memory
    return {
      usedMB: Math.round(memory.usedJSHeapSize / 1048576),
      totalMB: Math.round(memory.totalJSHeapSize / 1048576),
      limitMB: Math.round(memory.jsHeapSizeLimit / 1048576),
    }
  }

  /**
   * Log component mount/unmount for debugging
   */
  logComponentLifecycle(componentName: string, event: 'mount' | 'unmount') {
    if (import.meta.env.DEV) {
      console.log(`[PerformanceMonitor] ${componentName} - ${event}`)
    }
  }

  /**
   * Clean up resources
   */
  cleanup() {
    console.log('[PerformanceMonitor] Cleanup called')
    // Force cleanup in stores/services if needed
  }

  /**
   * Force garbage collection (Chrome only, requires --js-flags="--expose-gc")
   */
  forceGC() {
    if ((window as any).gc) {
      console.log('[PerformanceMonitor] Forcing garbage collection...')
      ;(window as any).gc()
      console.log('[PerformanceMonitor] GC completed')
    } else {
      console.warn('[PerformanceMonitor] GC not available. Run Chrome with --js-flags="--expose-gc"')
    }
  }
}

export const performanceMonitor = new PerformanceMonitor()

// Auto-start in development mode
if (import.meta.env.DEV) {
  performanceMonitor.startMonitoring()

  // Expose to window for manual debugging
  ;(window as any).performanceMonitor = performanceMonitor
  console.log('[PerformanceMonitor] Available in console as window.performanceMonitor')
  console.log('[PerformanceMonitor] Commands:')
  console.log('  - window.performanceMonitor.checkMemory()')
  console.log('  - window.performanceMonitor.getMemoryStats()')
  console.log('  - window.performanceMonitor.forceGC()')
}
