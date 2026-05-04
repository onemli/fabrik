// IdleWarningDialog.tsx
//
// Warning dialog triggered by useIdleTimeout when the session is about to expire.
// Shows a countdown timer and two buttons: extend session (resets the idle timer)
// or log out immediately. Auto-logs out when the countdown hits zero.

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useIdleTimeout } from '@/hooks/useIdleTimeout'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m > 0) return `${m}:${s.toString().padStart(2, '0')}`
  return `${s}s`
}

interface IdleWarningDialogProps {
  timeoutMinutes: number // 0 = disabled
}

export function IdleWarningDialog({ timeoutMinutes }: IdleWarningDialogProps) {
  const navigate = useNavigate()
  const { logout } = useAuthStore()

  const handleTimeout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  const { isWarning, remainingSeconds, resetTimer } = useIdleTimeout({
    timeoutMinutes,
    warningMinutes: Math.min(2, Math.floor(timeoutMinutes / 2)),
    onTimeout: handleTimeout,
    enabled: timeoutMinutes > 0,
  })

  // When time hits 0 inside the dialog, logout immediately
  useEffect(() => {
    if (isWarning && remainingSeconds === 0) {
      handleTimeout()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWarning, remainingSeconds])

  if (!isWarning) return null

  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <span className="text-2xl">⏱</span>
            Session Expiring Soon
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                You've been inactive. Your session will expire automatically.
              </p>
              <div className="flex items-center justify-center py-4">
                <span className="text-4xl font-mono font-bold tabular-nums text-destructive">
                  {formatTime(remainingSeconds)}
                </span>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleTimeout} className="text-muted-foreground">
            Log out now
          </AlertDialogCancel>
          <AlertDialogAction onClick={resetTimer}>
            Stay logged in
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
