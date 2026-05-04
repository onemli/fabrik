// components/EmailVerificationBanner.tsx
//
// Soft banner shown when the user hasn't verified their email.
// Non-blocking — dismissible, and the user can continue using the app.

import { useState } from 'react'
import { Mail, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/store/authStore'
import { toast } from 'sonner'

export function EmailVerificationBanner() {
  const { user } = useAuthStore()
  const [dismissed, setDismissed] = useState(false)
  const [sending, setSending] = useState(false)

  // Don't show for: no user, already verified, no email, dismissed
  if (!user || user.email_verified || !user.email || dismissed) return null

  const handleSend = async () => {
    setSending(true)
    try {
      const { authService } = await import('@/services/auth')
      const result = await authService.sendVerificationEmail()
      if (result.fallback) {
        toast.info('Email service is currently unavailable. Try again later.')
      } else {
        toast.success('Verification email sent. Check your inbox.')
      }
    } catch (err: unknown) {
      toast.error((err as Error)?.message || 'Failed to send')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-2 text-amber-400">
        <Mail className="w-4 h-4 shrink-0" />
        <span>Please verify your email address to unlock all features.</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-amber-400 hover:text-amber-300"
          onClick={handleSend}
          disabled={sending}
        >
          {sending ? 'Sending...' : 'Resend Email'}
        </Button>
        <button
          onClick={() => setDismissed(true)}
          className="text-amber-400/60 hover:text-amber-400 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
