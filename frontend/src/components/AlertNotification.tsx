// AlertNotification.tsx
//
// Toast-style notification component for inline alerts triggered by backend events.
// Separate from the standard Sonner toasts — these are rendered inside the page
// layout for longer-lived status messages like execution results and errors.

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell, CheckCircle2, XCircle, AlertCircle, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { api } from '@/services/api'
import { useNotificationWebSocket } from '@/hooks/useNotificationWebSocket'
import { useFormatters } from '@/contexts/TimezoneContext'

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

// Type to color mapping
const typeConfig = {
  info: {
    color: 'text-blue-500',
    bg: 'bg-blue-500/10',
    icon: Info,
  },
  success: {
    color: 'text-green-500',
    bg: 'bg-green-500/10',
    icon: CheckCircle2,
  },
  warning: {
    color: 'text-orange-500',
    bg: 'bg-orange-500/10',
    icon: AlertCircle,
  },
  error: {
    color: 'text-red-500',
    bg: 'bg-red-500/10',
    icon: XCircle,
  },
}

// Bell icon color based on highest priority unread notification
function getBellColor(notifications: Notification[]): string {
  const unread = notifications.filter(n => !n.is_read)
  if (unread.length === 0) return 'text-muted-foreground'

  if (unread.some(n => n.type === 'error')) return 'text-red-500'
  if (unread.some(n => n.type === 'warning')) return 'text-orange-500'
  if (unread.some(n => n.type === 'success')) return 'text-green-500'
  return 'text-blue-500'
}

export function AlertNotification() {
  const { formatDateTime } = useFormatters()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  // Use WebSocket for real-time notifications (replaces polling)
  const {
    isConnected,
    unreadCount,
    recentNotifications,
    markAsRead: wsMarkAsRead,
    requestRecent,
  } = useNotificationWebSocket()

  // Request recent notifications when dropdown opens
  useEffect(() => {
    if (open && isConnected) {
      requestRecent(10)
    }
  }, [open, isConnected, requestRecent])

  const notifications = recentNotifications

  // Mark notification as read mutation
  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      // Mark via API for persistence
      await api.post(`/api/notifications/notifications/${id}/mark_read/`)
      // Also notify WebSocket for instant UI update
      wsMarkAsRead(id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  // Mark all as read mutation
  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      await api.post('/api/notifications/notifications/mark_all_read/')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      // Refresh WS-driven notification list so bell color updates instantly
      if (isConnected) requestRecent(10)
    },
  })

  const handleNotificationClick = (notification: Notification) => {
    // Mark as read if unread
    if (!notification.is_read) {
      markReadMutation.mutate(notification.id)
    }

    // Navigate to related page if applicable
    if (notification.related_task_id) {
      navigate('/tasks')
      setOpen(false)
    }
  }

  const handleViewAll = () => {
    navigate('/notifications')
    setOpen(false)
  }

  const handleMarkAllRead = () => {
    markAllReadMutation.mutate()
  }

  const bellColor = getBellColor(notifications)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
        >
          <Bell className={cn('w-5 h-5', bellColor)} />
          {unreadCount > 0 && (
            <Badge
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
              variant="destructive"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold text-sm">Notifications</h3>
          {notifications.some(n => !n.is_read) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleMarkAllRead}
              className="h-7 text-xs"
            >
              Mark all read
            </Button>
          )}
        </div>

        {/* Notification List */}
        <div className="max-h-96 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              <Bell className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No notifications</p>
            </div>
          ) : (
            notifications.map((notification) => {
              const config = typeConfig[notification.type]
              const Icon = config.icon

              return (
                <DropdownMenuItem
                  key={notification.id}
                  onClick={() => handleNotificationClick(notification)}
                  className={cn(
                    'flex items-start gap-3 px-4 py-3 cursor-pointer',
                    !notification.is_read && 'bg-accent/50'
                  )}
                >
                  <div className={cn('mt-0.5 flex-shrink-0 rounded-full p-1.5', config.bg)}>
                    <Icon className={cn('w-4 h-4', config.color)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium truncate">
                        {notification.title}
                      </p>
                      {!notification.is_read && (
                        <div className="flex-shrink-0 w-2 h-2 rounded-full bg-blue-500" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                      {notification.message}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDateTime(notification.created_at)}
                    </p>
                  </div>
                </DropdownMenuItem>
              )
            })
          )}
        </div>

        {/* Footer */}
        {notifications.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-2">
              <Button
                variant="ghost"
                className="w-full text-xs"
                onClick={handleViewAll}
              >
                View all notifications
              </Button>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
