// hooks/useMIMImportWebSocket.ts
//
// WebSocket hook for live MIM import progress. Subscribes to
// /ws/mim-import/<task_id>/ which is driven by the Celery task's
// channel_layer.group_send calls in backend/mim_registry/tasks.py.
//
// Message types:
//   mim_progress    → {phase, done, total, fallback_count, not_found_count, failed_count, message}
//   mim_status      → {status: 'success'|'failed'|'cancelled', error?, summary?}

import { useEffect, useRef, useState, useCallback } from 'react'
import { getWsTicket } from '../lib/wsTicket'

export type MIMPhase = 'init' | 'downloading' | 'importing' | 'finalizing' | 'done'

export interface MIMProgressEvent {
  type: 'mim_progress'
  message?: string
  phase?: MIMPhase
  done?: number
  total?: number
  fallback_count?: number
  not_found_count?: number
  failed_count?: number
}

export interface MIMStatusEvent {
  type: 'mim_status'
  status: 'success' | 'failed' | 'cancelled'
  error?: string
  summary?: Record<string, number>
}

export type MIMImportState = 'idle' | 'running' | 'success' | 'failed' | 'cancelled'

interface UseMIMImportWebSocketOptions {
  taskId: string | null
  onSuccess?: () => void
  onFailure?: (error: string) => void
  onCancelled?: () => void
}

interface UseMIMImportWebSocketReturn {
  connected: boolean
  state: MIMImportState
  progress: number
  message: string
  error: string | null
  phase: MIMPhase | null
  done: number
  total: number
  fallbackCount: number
  notFoundCount: number
  failedCount: number
}

export function useMIMImportWebSocket(
  options: UseMIMImportWebSocketOptions,
): UseMIMImportWebSocketReturn {
  const { taskId, onSuccess, onFailure, onCancelled } = options
  const [connected, setConnected] = useState(false)
  const [state, setState] = useState<MIMImportState>('idle')
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<MIMPhase | null>(null)
  const [done, setDone] = useState(0)
  const [total, setTotal] = useState(0)
  const [fallbackCount, setFallbackCount] = useState(0)
  const [notFoundCount, setNotFoundCount] = useState(0)
  const [failedCount, setFailedCount] = useState(0)

  const wsRef = useRef<WebSocket | null>(null)
  const onSuccessRef = useRef(onSuccess)
  const onFailureRef = useRef(onFailure)
  const onCancelledRef = useRef(onCancelled)

  useEffect(() => {
    onSuccessRef.current = onSuccess
    onFailureRef.current = onFailure
    onCancelledRef.current = onCancelled
  }, [onSuccess, onFailure, onCancelled])

  const connect = useCallback(async () => {
    if (!taskId) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = import.meta.env.DEV
      ? window.location.host
      : (import.meta.env.VITE_API_URL?.replace(/^https?:\/\//, '') || window.location.host)

    let ticket = ''
    try {
      ticket = await getWsTicket()
    } catch {
      /* fall through — ws may still work if auth isn't required */
    }
    const authParam = ticket ? `?ticket=${ticket}` : ''
    const url = `${protocol}//${host}/ws/mim-import/${taskId}/${authParam}`

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      setState('running')
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as
          | MIMProgressEvent
          | MIMStatusEvent
          | { type: 'pong' }

        if (msg.type === 'mim_progress') {
          if (msg.message !== undefined) setMessage(msg.message)
          if (msg.phase) setPhase(msg.phase)
          if (typeof msg.done === 'number') setDone(msg.done)
          if (typeof msg.total === 'number') setTotal(msg.total)
          if (typeof msg.fallback_count === 'number') setFallbackCount(msg.fallback_count)
          if (typeof msg.not_found_count === 'number') setNotFoundCount(msg.not_found_count)
          if (typeof msg.failed_count === 'number') setFailedCount(msg.failed_count)
          if (typeof msg.done === 'number' && typeof msg.total === 'number' && msg.total > 0) {
            setProgress(Math.min(99, Math.floor((msg.done / msg.total) * 100)))
          }
        } else if (msg.type === 'mim_status') {
          if (msg.status === 'success') {
            setState('success')
            setProgress(100)
            onSuccessRef.current?.()
          } else if (msg.status === 'cancelled') {
            setState('cancelled')
            onCancelledRef.current?.()
          } else {
            setState('failed')
            setError(msg.error || 'Import failed')
            onFailureRef.current?.(msg.error || 'Import failed')
          }
          ws.close()
        }
      } catch {
        /* ignore malformed frames */
      }
    }

    ws.onerror = () => {
      setConnected(false)
    }

    ws.onclose = () => {
      setConnected(false)
    }
  }, [taskId])

  useEffect(() => {
    if (!taskId) {
      setState('idle')
      setProgress(0)
      setMessage('')
      setError(null)
      setPhase(null)
      setDone(0)
      setTotal(0)
      setFallbackCount(0)
      setNotFoundCount(0)
      setFailedCount(0)
      return
    }

    connect()

    return () => {
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [taskId, connect])

  return {
    connected,
    state,
    progress,
    message,
    error,
    phase,
    done,
    total,
    fallbackCount,
    notFoundCount,
    failedCount,
  }
}
