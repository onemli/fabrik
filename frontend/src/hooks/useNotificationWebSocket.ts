// hooks/useNotificationWebSocket.ts
//
// WebSocket hook for receiving real-time notifications from the backend. Connects
// to the notifications channel after obtaining a short-lived ws-ticket, handles
// reconnection on disconnect, and updates the React Query cache so the notification
// badge in the header refreshes without polling.

import { useEffect, useRef, useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getWsTicket } from '../lib/wsTicket'

interface Notification {
  id: string
  type: 'info' | 'success' | 'warning' | 'error'
  title: string
  message: string
  is_read: boolean
  created_at: string
  related_task_id?: string
  related_execution_id?: string
}

interface UseNotificationWebSocketReturn {
  isConnected: boolean
  unreadCount: number
  recentNotifications: Notification[]
  markAsRead: (notificationId: string) => void
  requestRecent: (limit?: number) => void
}

export function useNotificationWebSocket(): UseNotificationWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  // Tracks whether disconnect() was called so the async ticket fetch can bail
  // out instead of opening a WebSocket that will be closed immediately.
  const disconnectedRef = useRef(false)
  const [isConnected, setIsConnected] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [recentNotifications, setRecentNotifications] = useState<Notification[]>([])
  const queryClient = useQueryClient()

  const connect = useCallback(() => {
    if (!localStorage.getItem('access_token')) {
      return
    }

    disconnectedRef.current = false

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = import.meta.env.DEV
      ? window.location.host
      : (import.meta.env.VITE_API_URL?.replace(/^https?:\/\//, '') || window.location.host)

    getWsTicket()
      .then((ticket) => {
        // Component unmounted while we were fetching the ticket — don't open
        // a WebSocket that will be closed immediately (avoids console noise).
        if (disconnectedRef.current) return

        const wsUrl = `${protocol}//${host}/ws/notifications/?ticket=${ticket}`
        const ws = new WebSocket(wsUrl)

        ws.onopen = () => {
          setIsConnected(true)
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current)
          }
        }

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)

            switch (data.type) {
              case 'notification_count':
                setUnreadCount(data.count)
                break

              case 'notification_new':
                setRecentNotifications((prev) => [data.notification, ...prev].slice(0, 10))
                queryClient.invalidateQueries({ queryKey: ['notifications'] })
                break

              case 'notification_read':
                setRecentNotifications((prev) =>
                  prev.map((n) =>
                    n.id === data.notification_id ? { ...n, is_read: true } : n
                  )
                )
                break

              case 'recent_notifications':
                setRecentNotifications(data.notifications)
                break

              case 'pong':
                break

              default:
                break
            }
          } catch {
            /* ignore */
          }
        }

        ws.onerror = () => {
        }

        ws.onclose = () => {
          setIsConnected(false)
          wsRef.current = null

          if (!disconnectedRef.current) {
            reconnectTimeoutRef.current = setTimeout(() => {
              connect()
            }, 5000)
          }
        }

        wsRef.current = ws
      })
      .catch(() => {
        if (!disconnectedRef.current) {
          reconnectTimeoutRef.current = setTimeout(() => {
            connect()
          }, 10000)
        }
      })
  }, [queryClient])

  const disconnect = useCallback(() => {
    disconnectedRef.current = true
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
    }
  }, [])

  const markAsRead = useCallback((notificationId: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'mark_read',
          notification_id: notificationId,
        })
      )
    }
  }, [])

  const requestRecent = useCallback((limit = 10) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'get_recent',
          limit,
        })
      )
    }
  }, [])

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    connect()

    // Keepalive ping every 30 seconds
    const pingInterval = setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }))
      }
    }, 30000)

    return () => {
      disconnect()
      clearInterval(pingInterval)
    }
  }, [connect, disconnect])

  return {
    isConnected,
    unreadCount,
    recentNotifications,
    markAsRead,
    requestRecent,
  }
}
