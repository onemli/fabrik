// ResetPassword.tsx — Token-based password reset landing page.
// User arrives here from the email reset link with ?token= in the URL.

import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { authService } from '@/services/auth'
import FabrikDark from '@/assets/fabrik_dark.svg'

export default function ResetPassword() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    document.title = 'Fabrik — New Password'
    return () => { document.title = 'Fabrik — The fabric, finally legible.' }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    if (!token) {
      setError('Invalid reset link. No token found.')
      return
    }

    setIsLoading(true)
    try {
      await authService.confirmPasswordResetToken(token, newPassword, confirmPassword)
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex bg-black">
      {/* Left panel — brand */}
      <div className="hidden lg:flex lg:w-[55%] relative items-center justify-center">
        <div className="absolute inset-0 bg-gradient-to-br from-zinc-900 via-black to-zinc-900" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:48px_48px]" />

        <div className="relative z-10 max-w-md px-12">
          <img src={FabrikDark} alt="Fabrik" className="h-16 w-auto mb-8" />
          <h1 className="text-4xl font-semibold text-white tracking-tight leading-tight mb-4">
            Operate with clarity.
          </h1>
          <p className="text-zinc-500 text-base leading-relaxed">
            Fabric management, query building, and network automation — all in one place.
          </p>
        </div>

        <div className="absolute right-0 top-[15%] bottom-[15%] w-px bg-zinc-800" />
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center px-6 sm:px-12">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden mb-10">
            <img src={FabrikDark} alt="Fabrik" className="h-10 w-auto" />
          </div>

          {/* Header */}
          <div className="mb-8">
            <h2 className="text-xl font-medium text-white mb-1">Set new password</h2>
            <p className="text-sm text-zinc-500">Enter your new password below</p>
          </div>

          {/* Error */}
          {error && (
            <Alert variant="destructive" className="mb-6 border-red-500/20 bg-red-500/5">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-red-300 text-sm">{error}</AlertDescription>
            </Alert>
          )}

          {success ? (
            <div className="text-center space-y-6">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
              <div>
                <h3 className="text-lg font-medium text-white mb-1">Password reset</h3>
                <p className="text-sm text-zinc-500">Your password has been updated successfully.</p>
              </div>
              <Link to="/login">
                <Button className="w-full h-11 bg-white text-black font-medium hover:bg-zinc-200">
                  Sign in
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="new-password" className="text-sm text-zinc-400">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="New password"
                  required
                  className="h-11 bg-zinc-900 border-zinc-800 text-white placeholder:text-zinc-600 focus:border-zinc-600 focus:ring-1 focus:ring-zinc-700"
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password" className="text-sm text-zinc-400">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  required
                  className="h-11 bg-zinc-900 border-zinc-800 text-white placeholder:text-zinc-600 focus:border-zinc-600 focus:ring-1 focus:ring-zinc-700"
                  autoComplete="new-password"
                />
              </div>
              <Button
                type="submit"
                disabled={isLoading}
                className="w-full h-11 bg-white text-black font-medium hover:bg-zinc-200 disabled:opacity-40"
              >
                {isLoading ? 'Resetting...' : 'Reset password'}
              </Button>
            </form>
          )}

          {/* Back to login */}
          <div className="mt-8 pt-6 border-t border-zinc-800 text-center">
            <Link
              to="/login"
              className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to sign in
            </Link>
          </div>

          <p className="mt-10 text-xs text-zinc-700 text-center">
            &copy; 2025-2026 Fabrik Project
          </p>
        </div>
      </div>
    </div>
  )
}
