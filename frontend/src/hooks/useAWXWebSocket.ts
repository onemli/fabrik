// hooks/useAWXWebSocket.ts
//
// WebSocket hook for real-time AWX job status updates. Opens a connection to
// the execution-specific channel on mount and streams job progress events.
// Auto-reconnects on disconnect with exponential backoff so brief network
// hiccups don't leave the UI stuck on a stale status.

import { useEffect, useState, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import { getWsTicket } from '../lib/wsTicket'

interface ExecutionUpdate {
  id: string
  status: string
  progress_percentage: number
  current_task?: string
  awx_job_id?: number
  error_message?: string
  finished_at?: string
  created_at: string
  updated_at: string
}

interface ProgressUpdate {
  execution_id: string
  progress: number
  message: string
  current_task?: string
}

interface StatusChange {
  execution_id: string
  old_status: string
  new_status: string
  metadata?: any
}

interface WebSocketMessage {
  type: 'initial_status' | 'execution_update' | 'progress_update' | 'status_change'
  data: any
}

interface UseAWXWebSocketOptions {
  requestId?: string
  executionId?: string
  onExecutionUpdate?: (execution: ExecutionUpdate) => void
  onProgressUpdate?: (progress: ProgressUpdate) => void
  onStatusChange?: (change: StatusChange) => void
  showNotifications?: boolean
  autoReconnect?: boolean
}

interface UseAWXWebSocketReturn {
  connected: boolean
  executions: ExecutionUpdate[]
  latestExecution: ExecutionUpdate | null
  reconnect: () => void
  disconnect: () => void
}

/**
 * WebSocket hook for AWX automation execution monitoring
 *
 * @param options - Configuration options
 * @returns WebSocket connection state and data
 */
export function useAWXWebSocket(options: UseAWXWebSocketOptions): UseAWXWebSocketReturn {
  const {
    requestId,
    executionId,
    onExecutionUpdate,
    onProgressUpdate,
    onStatusChange,
    showNotifications = true,
    autoReconnect = true
  } = options

  const [connected, setConnected] = useState(false)
  const [executions, setExecutions] = useState<ExecutionUpdate[]>([])
  const [latestExecution, setLatestExecution] = useState<ExecutionUpdate | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const reconnectAttemptsRef = useRef(0)

  const MAX_RECONNECT_ATTEMPTS = 10
  const BASE_RECONNECT_DELAY_MS = 1000
  const MAX_RECONNECT_DELAY_MS = 30000
  const HEARTBEAT_INTERVAL_MS = 30000
  const HEARTBEAT_TIMEOUT_MS = 10000

  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const heartbeatTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  /**
   * Get WebSocket URL based on connection type
   */
  const getWebSocketUrl = useCallback(async () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = import.meta.env.DEV
      ? window.location.host
      : (import.meta.env.VITE_API_URL?.replace(/^https?:\/\//, '') || window.location.host)

    let ticket: string
    try {
      ticket = await getWsTicket()
    } catch {
      // fallback to direct token if ticket endpoint fails
      ticket = ''
    }
    const authParam = ticket ? `?ticket=${ticket}` : ''

    if (requestId) {
      return `${protocol}//${host}/ws/awx/request/${requestId}/${authParam}`
    } else if (executionId) {
      return `${protocol}//${host}/ws/awx/execution/${executionId}/${authParam}`
    }

    throw new Error('Either requestId or executionId must be provided')
  }, [requestId, executionId])

  /**
   * Handle incoming WebSocket messages
   */
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message: WebSocketMessage = JSON.parse(event.data)

      switch (message.type) {
        case 'initial_status':
          // Initial status on connection
          if (message.data.executions) {
            setExecutions(message.data.executions)
            if (message.data.executions.length > 0) {
              setLatestExecution(message.data.executions[0])
            }
          } else if (message.data.id) {
            // Single execution detail
            setLatestExecution(message.data)
            setExecutions([message.data])
          }
          break

        case 'execution_update':
          // Update execution in list
          setExecutions(prev => {
            const index = prev.findIndex(e => e.id === message.data.id)
            if (index >= 0) {
              const updated = [...prev]
              updated[index] = message.data
              return updated
            } else {
              return [message.data, ...prev]
            }
          })

          setLatestExecution(message.data)

          if (onExecutionUpdate) {
            onExecutionUpdate(message.data)
          }

          // Show notification for status changes
          if (showNotifications && message.data.status === 'successful') {
            toast.success('Execution completed successfully', {
              description: `Job ${message.data.awx_job_id || message.data.id} finished`
            })
          } else if (showNotifications && message.data.status === 'failed') {
            toast.error('Execution failed', {
              description: message.data.error_message || `Job ${message.data.awx_job_id || message.data.id} failed`
            })
          }
          break

        case 'progress_update':
          // Update progress
          if (onProgressUpdate) {
            onProgressUpdate(message.data)
          }

          // Update execution progress in list
          setExecutions(prev => {
            const index = prev.findIndex(e => e.id === message.data.execution_id)
            if (index >= 0) {
              const updated = [...prev]
              updated[index] = {
                ...updated[index],
                progress_percentage: message.data.progress,
                current_task: message.data.current_task
              }
              return updated
            }
            return prev
          })
          break

        case 'status_change':
          // Status change event
          if (onStatusChange) {
            onStatusChange(message.data)
          }
          break

        default:
          break
      }
    } catch {
      /* ignore */
    }
  }, [onExecutionUpdate, onProgressUpdate, onStatusChange, showNotifications])

  /**
   * Stop heartbeat timers
   */
  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current)
      heartbeatIntervalRef.current = null
    }
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current)
      heartbeatTimeoutRef.current = null
    }
  }, [])

  /**
   * Start heartbeat ping/pong to detect stale connections
   */
  const startHeartbeat = useCallback(() => {
    stopHeartbeat()

    heartbeatIntervalRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify({ type: 'ping' }))

          // Set timeout - if no pong received, connection is stale
          heartbeatTimeoutRef.current = setTimeout(() => {
            wsRef.current?.close(4000, 'Heartbeat timeout')
          }, HEARTBEAT_TIMEOUT_MS)
        } catch {
          // ping failed — connection will be detected as stale via timeout
        }
      }
    }, HEARTBEAT_INTERVAL_MS)
  }, [stopHeartbeat])

  /**
   * Handle incoming WebSocket messages (with heartbeat pong support)
   */
  const handleMessageWithHeartbeat = useCallback((event: MessageEvent) => {
    try {
      const message = JSON.parse(event.data)

      // Handle pong response - clear heartbeat timeout
      if (message.type === 'pong') {
        if (heartbeatTimeoutRef.current) {
          clearTimeout(heartbeatTimeoutRef.current)
          heartbeatTimeoutRef.current = null
        }
        return
      }

      // Delegate to main message handler
      handleMessage(event)
    } catch {
      // If JSON parse fails, still pass to handleMessage
      handleMessage(event)
    }
  }, [handleMessage])

  /**
   * Calculate reconnect delay with exponential backoff + jitter
   */
  const getReconnectDelay = useCallback(() => {
    const exponentialDelay = BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttemptsRef.current)
    const cappedDelay = Math.min(exponentialDelay, MAX_RECONNECT_DELAY_MS)
    // Add 0-25% jitter to prevent thundering herd
    const jitter = cappedDelay * 0.25 * Math.random()
    return cappedDelay + jitter
  }, [])

  /**
   * Connect to WebSocket
   */
  const connect = useCallback(() => {
    getWebSocketUrl().then((url) => {
      wsRef.current = new WebSocket(url)

      wsRef.current.onopen = () => {
        setConnected(true)
        reconnectAttemptsRef.current = 0
        startHeartbeat()

        // Reconnect is silent — no need to notify the user
      }

      wsRef.current.onmessage = handleMessageWithHeartbeat

      wsRef.current.onerror = () => {
        setConnected(false)
        stopHeartbeat()
      }

      wsRef.current.onclose = (_event) => {
        setConnected(false)
        stopHeartbeat()

        // Auto-reconnect with exponential backoff
        if (autoReconnect && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = getReconnectDelay()
          reconnectAttemptsRef.current++
          reconnectTimeoutRef.current = setTimeout(() => {
            connect()
          }, delay)
        } else if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
          if (showNotifications) {
            toast.error('Connection lost', {
              description: 'Unable to reconnect to live updates. Please refresh the page.'
            })
          }
        }
      }
    }).catch(() => {
      setConnected(false)
    })
  }, [getWebSocketUrl, handleMessageWithHeartbeat, autoReconnect, showNotifications, startHeartbeat, stopHeartbeat, getReconnectDelay])

  /**
   * Disconnect from WebSocket
   */
  const disconnect = useCallback(() => {
    stopHeartbeat()

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    setConnected(false)
  }, [stopHeartbeat])

  /**
   * Manual reconnect
   */
  const reconnect = useCallback(() => {
    disconnect()
    reconnectAttemptsRef.current = 0
    connect()
  }, [connect, disconnect])

  /**
   * Request status refresh
   */
  const requestRefresh = useCallback(() => {
    if (wsRef.current && connected) {
      wsRef.current.send(JSON.stringify({ type: 'refresh' }))
    }
  }, [connected])

  // Connect on mount
  useEffect(() => {
    if (requestId || executionId) {
      connect()
    }

    return () => {
      disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, executionId])

  // Refresh every 30 seconds for active executions
  useEffect(() => {
    const hasRunning = executions.some(e => e.status === 'running' || e.status === 'pending')

    if (connected && hasRunning) {
      const interval = setInterval(() => {
        requestRefresh()
      }, 30000) // 30 seconds

      return () => clearInterval(interval)
    }
  }, [connected, executions, requestRefresh])

  // Reconnect when tab becomes visible after being hidden
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Tab became visible - check if WebSocket is still connected
        if (wsRef.current?.readyState !== WebSocket.OPEN && (requestId || executionId)) {
          reconnectAttemptsRef.current = 0
          connect()
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, executionId])

  return {
    connected,
    executions,
    latestExecution,
    reconnect,
    disconnect
  }
}
