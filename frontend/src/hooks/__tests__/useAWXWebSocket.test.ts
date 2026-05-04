/**
 * useAWXWebSocket Hook Tests
 *
 * Tests WebSocket connection, reconnection, heartbeat,
 * and message handling for the AWX execution monitor hook.
 *
 * Timer strategy:
 *   vi.useFakeTimers() globally to prevent cross-test real-timer leakage.
 *   connect() is async (calls getWsTicket()) — we must drain microtasks
 *   BEFORE advancing timers. Helper: connectAndFlush().
 *
 *   CRITICAL: Use vi.advanceTimersByTime(1) NOT vi.runAllTimers().
 *   vi.runAllTimers() fires the heartbeat setInterval → pong timeout → close →
 *   reconnect → repeat → "Aborting after 10000 timers" infinite loop.
 *   advanceTimersByTime(1) fires ONLY the setTimeout(triggerOpen, 0) without
 *   reaching the 30000ms heartbeat interval.
 *
 *   waitFor() hangs with fake timers (its internal setTimeout never fires).
 *   Use await act(async () => { ... }) + synchronous assertions instead.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useAWXWebSocket } from '../useAWXWebSocket'

// ── WebSocket Mock ─────────────────────────────────────────────────────────────

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.CONNECTING
  onopen: ((e: Event) => void) | null = null
  onclose: ((e: CloseEvent) => void) | null = null
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null

  private static instances: MockWebSocket[] = []

  constructor(public url: string) {
    MockWebSocket.instances.push(this)
    setTimeout(() => this.triggerOpen(), 0)
  }

  send = vi.fn()
  close = vi.fn().mockImplementation(() => {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ code: 1000, reason: 'Normal closure' } as CloseEvent)
  })

  triggerOpen() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.(new Event('open'))
  }

  triggerMessage(data: object) {
    this.onmessage?.(
      new MessageEvent('message', { data: JSON.stringify(data) })
    )
  }

  triggerClose(code = 1000, reason = '') {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ code, reason } as CloseEvent)
  }

  triggerError() {
    this.onerror?.(new Event('error'))
  }

  static getLatest(): MockWebSocket {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1]
  }

  static getCount() {
    return MockWebSocket.instances.length
  }

  static reset() {
    MockWebSocket.instances = []
  }
}

// ── getWsTicket Mock ───────────────────────────────────────────────────────────

vi.mock('../../lib/wsTicket', () => ({
  getWsTicket: vi.fn().mockResolvedValue('test-ticket'),
}))

// ── sonner Mock ────────────────────────────────────────────────────────────────

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}))

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  MockWebSocket.reset()
  vi.useFakeTimers()
  Object.defineProperty(window, 'WebSocket', {
    value: MockWebSocket,
    writable: true,
    configurable: true,
  })
})

afterEach(async () => {
  // Flush all pending microtasks (e.g. getWsTicket Promise chain from connect())
  // BEFORE cleanup(). Otherwise the .then callback creates a WebSocket AFTER
  // vi.useRealTimers() runs, which schedules a real setTimeout(triggerOpen, 0)
  // that leaks into the next test and causes spurious reconnect cycles.
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
  // cleanup() must run BEFORE vi.useRealTimers() so that any reconnect timers
  // triggered by hook unmounting are fake timers (discarded by vi.useRealTimers).
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

// ── Helper: establish connection with fake timers ─────────────────────────────
//
// connect() calls getWebSocketUrl() which is async (awaits getWsTicket()).
// Promise chain: getWsTicket → getWebSocketUrl → connect's .then
// Each `await Promise.resolve()` drains one microtask tick.
// After the .then fires, MockWebSocket is created and setTimeout(triggerOpen, 0)
// is scheduled. vi.advanceTimersByTime(1) fires that setTimeout without
// advancing past the 30000ms heartbeat interval (which would cause a chain
// of heartbeat → pong timeout → close → reconnect → ... = infinite loop).

async function connectAndFlush() {
  // Phase 1: Drain the async Promise chain from connect() so the WebSocket is
  // created. getWsTicket → getWebSocketUrl → connect's .then runs as microtasks;
  // await act flushes them all without touching fake timers.
  await act(async () => {
    await Promise.resolve() // getWsTicket resolves
    await Promise.resolve() // getWebSocketUrl resolves
    await Promise.resolve() // connect's .then fires → WebSocket created → setTimeout(triggerOpen, 0) queued
    await Promise.resolve() // extra safety tick
  })
  // Phase 2: Fire triggerOpen in its own sync act so there's no interference
  // from React's async scheduler touching fake timers.
  // vi.advanceTimersByTime(1) fires setTimeout(triggerOpen, 0) only — it does NOT
  // reach the 30000ms heartbeat interval.
  await act(async () => {
    vi.advanceTimersByTime(1)
    await Promise.resolve() // React processes setConnected(true)
  })
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('useAWXWebSocket', () => {

  // ── Connection ─────────────────────────────────────────────────────────────

  it('starts disconnected', () => {
    const { result } = renderHook(() =>
      useAWXWebSocket({ requestId: 'req-1' })
    )
    expect(result.current.connected).toBe(false)
  })

  it('becomes connected after WebSocket opens', async () => {
    const { result } = renderHook(() =>
      useAWXWebSocket({ requestId: 'req-1' })
    )

    await connectAndFlush()

    expect(result.current.connected).toBe(true)
  })

  it('connects to request WebSocket URL when requestId is provided', async () => {
    renderHook(() => useAWXWebSocket({ requestId: 'req-123' }))

    await connectAndFlush()

    const ws = MockWebSocket.getLatest()
    expect(ws.url).toContain('req-123')
  })

  it('connects to execution WebSocket URL when executionId is provided', async () => {
    renderHook(() => useAWXWebSocket({ executionId: 'exec-456' }))

    await connectAndFlush()

    const ws = MockWebSocket.getLatest()
    expect(ws.url).toContain('exec-456')
  })

  // ── Message Handling ──────────────────────────────────────────────────────
  //
  // triggerMessage() fires onmessage synchronously → setExecutions() is called.
  // Wrap in await act(async () => {...}) to flush React state updates.
  // Do NOT use waitFor — it hangs with fake timers because its internal
  // setInterval/setTimeout never advance.

  it('processes initial_status message and stores executions', async () => {
    const { result } = renderHook(() =>
      useAWXWebSocket({ requestId: 'req-1' })
    )

    await connectAndFlush()
    const ws = MockWebSocket.getLatest()

    await act(async () => {
      ws.triggerMessage({
        type: 'initial_status',
        data: {
          executions: [{
            id: 'exec-1',
            status: 'running',
            progress_percentage: 30,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          }]
        }
      })
    })

    expect(result.current.executions).toHaveLength(1)
    expect(result.current.executions[0].id).toBe('exec-1')
  })

  it('calls onExecutionUpdate callback on execution_update message', async () => {
    const onExecutionUpdate = vi.fn()
    renderHook(() =>
      useAWXWebSocket({ requestId: 'req-1', onExecutionUpdate })
    )

    await connectAndFlush()
    const ws = MockWebSocket.getLatest()
    const execData = {
      id: 'exec-1',
      status: 'successful',
      progress_percentage: 100,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    }

    await act(async () => {
      ws.triggerMessage({ type: 'execution_update', data: execData })
    })

    expect(onExecutionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'exec-1', status: 'successful' })
    )
  })

  it('calls onProgressUpdate callback on progress_update message', async () => {
    const onProgressUpdate = vi.fn()
    renderHook(() =>
      useAWXWebSocket({ executionId: 'exec-1', onProgressUpdate })
    )

    await connectAndFlush()
    const ws = MockWebSocket.getLatest()

    await act(async () => {
      ws.triggerMessage({
        type: 'progress_update',
        data: { execution_id: 'exec-1', progress: 75, message: 'Running tasks' }
      })
    })

    expect(onProgressUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ progress: 75 })
    )
  })

  it('calls onStatusChange callback on status_change message', async () => {
    const onStatusChange = vi.fn()
    renderHook(() =>
      useAWXWebSocket({ executionId: 'exec-1', onStatusChange })
    )

    await connectAndFlush()
    const ws = MockWebSocket.getLatest()

    await act(async () => {
      ws.triggerMessage({
        type: 'status_change',
        data: {
          execution_id: 'exec-1',
          old_status: 'running',
          new_status: 'successful',
        }
      })
    })

    expect(onStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({ new_status: 'successful' })
    )
  })

  it('ignores unknown message types without throwing', async () => {
    renderHook(() => useAWXWebSocket({ requestId: 'req-1' }))

    await connectAndFlush()
    const ws = MockWebSocket.getLatest()

    await expect(act(async () => {
      ws.triggerMessage({ type: 'unknown_type', data: {} })
    })).resolves.not.toThrow()
  })

  // ── Heartbeat ─────────────────────────────────────────────────────────────

  it('sends ping messages at regular intervals', async () => {
    renderHook(() => useAWXWebSocket({ requestId: 'req-1' }))

    await connectAndFlush()
    const ws = MockWebSocket.getLatest()

    // Advance time past heartbeat interval (30s) but before pong timeout (40s)
    act(() => { vi.advanceTimersByTime(31_000) })

    expect(ws.send).toHaveBeenCalledWith(
      expect.stringContaining('"type":"ping"')
    )
  })

  // ── Reconnection ──────────────────────────────────────────────────────────

  it('attempts reconnect after unexpected close', async () => {
    const { result } = renderHook(() =>
      useAWXWebSocket({ requestId: 'req-1', autoReconnect: true })
    )

    await connectAndFlush()
    const ws = MockWebSocket.getLatest()

    act(() => { ws.triggerClose(1006, 'Abnormal') })
    expect(result.current.connected).toBe(false)

    // Advance past reconnect delay (~1000ms+jitter), drain promises for new
    // WS creation, then advance 1ms to fire the new WS's triggerOpen.
    await act(async () => {
      vi.advanceTimersByTime(2_000)   // fires reconnect setTimeout → connect()
      await Promise.resolve()          // getWsTicket resolves
      await Promise.resolve()          // getWebSocketUrl resolves
      await Promise.resolve()          // connect's .then: new WebSocket created
      vi.advanceTimersByTime(1)        // fires triggerOpen on new WS
      await Promise.resolve()          // React processes setConnected(true)
    })

    // Should have created a new WebSocket
    const newWs = MockWebSocket.getLatest()
    expect(newWs).not.toBe(ws)
  })

  it('does not reconnect when autoReconnect is false', async () => {
    renderHook(() =>
      useAWXWebSocket({ requestId: 'req-1', autoReconnect: false })
    )

    await connectAndFlush()
    const countBefore = MockWebSocket.getCount()
    const ws = MockWebSocket.getLatest()

    act(() => { ws.triggerClose(1006) })

    // Advance time — no reconnect should happen since autoReconnect=false
    act(() => { vi.advanceTimersByTime(5_000) })

    expect(MockWebSocket.getCount()).toBe(countBefore)
  })

  // ── Manual Controls ───────────────────────────────────────────────────────

  it('disconnect() closes WebSocket and sets connected=false', async () => {
    const { result } = renderHook(() =>
      useAWXWebSocket({ requestId: 'req-1' })
    )

    await connectAndFlush()

    act(() => { result.current.disconnect() })

    expect(result.current.connected).toBe(false)
  })

  it('reconnect() resets attempt counter and reopens connection', async () => {
    const { result } = renderHook(() =>
      useAWXWebSocket({ requestId: 'req-1' })
    )

    await connectAndFlush()

    // reconnect() calls disconnect() then connect() directly (no setTimeout).
    // connect() is async — call reconnect() AND drain the async Promise chain
    // together in one async act so there's no gap between the call and the drain.
    await act(async () => {
      result.current.reconnect()
      // Drain: getWsTicket → getWebSocketUrl → connect's .then → new WS created
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve() // extra safety tick
    })

    // Fire triggerOpen in its own act to avoid React scheduler interference
    await act(async () => {
      vi.advanceTimersByTime(1)  // fires triggerOpen → onopen → setConnected(true)
      await Promise.resolve()    // React processes state update
    })

    expect(result.current.connected).toBe(true)
  })

  // ── Cleanup ───────────────────────────────────────────────────────────────

  it('closes WebSocket on unmount', async () => {
    const { result, unmount } = renderHook(() =>
      useAWXWebSocket({ requestId: 'req-1' })
    )

    await connectAndFlush()
    expect(result.current.connected).toBe(true)

    const ws = MockWebSocket.getLatest()
    unmount()

    expect(ws.close).toHaveBeenCalled()
  })
})
