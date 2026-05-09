// ForgotPassword.tsx — Split layout password reset.
// Primary: email reset. Fallback: admin-generated reset code.

import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle, ArrowLeft, Mail, KeyRound, CheckCircle2 } from 'lucide-react'
import { authService } from '@/services/auth'
import FabrikDark from '@/assets/fabrik_dark.svg'

type ResetMethod = 'email' | 'code'

export default function ForgotPassword() {
  const [method, setMethod] = useState<ResetMethod>('email')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showFallback, setShowFallback] = useState(false)

  const [username, setUsername] = useState('')
  const [codeUsername, setCodeUsername] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  useEffect(() => {
    document.title = 'Fabrik — Reset Password'
    return () => { document.title = 'Fabrik — The fabric, finally legible.' }
  }, [])

  const handleEmailReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')
    setSuccess('')

    try {
      const result = await authService.requestPasswordReset(username)
      if (result.fallback) {
        setShowFallback(true)
        setError(result.message)
      } else {
        setSuccess(result.message)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCodeReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')
    setSuccess('')

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      setIsLoading(false)
      return
    }

    try {
      await authService.confirmPasswordResetCode(
        codeUsername, code, newPassword, confirmPassword
      )
      setSuccess('Password has been reset successfully. You can now sign in.')
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
            <h2 className="text-xl font-medium text-white mb-1">Reset password</h2>
            <p className="text-sm text-zinc-500">
              {method === 'email'
                ? 'Enter your username to receive a reset link'
                : 'Enter the reset code from your administrator'}
            </p>
          </div>

          {/* Method toggle */}
          <div className="flex gap-1 mb-6 p-1 rounded-lg bg-zinc-900 border border-zinc-800">
            <button
              onClick={() => { setMethod('email'); setError(''); setSuccess('') }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                method === 'email'
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <Mail className="w-4 h-4" />
              Email
            </button>
            <button
              onClick={() => { setMethod('code'); setError(''); setSuccess('') }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                method === 'code'
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <KeyRound className="w-4 h-4" />
              Admin Code
            </button>
          </div>

          {/* Alerts */}
          {error && (
            <Alert variant="destructive" className="mb-4 border-red-500/20 bg-red-500/5">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-red-300 text-sm">{error}</AlertDescription>
            </Alert>
          )}
          {success && (
            <Alert className="mb-4 border-green-500/20 bg-green-500/5">
              <CheckCircle2 className="h-4 w-4 text-green-400" />
              <AlertDescription className="text-green-300 text-sm">{success}</AlertDescription>
            </Alert>
          )}

          {showFallback && method === 'email' && (
            <div className="mb-4 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
              <p className="text-amber-300 text-sm">
                Email is unavailable. Switch to <strong>Admin Code</strong> — ask your admin to generate a reset code.
              </p>
            </div>
          )}

          {/* Email Reset Form */}
          {method === 'email' && !success && (
            <form onSubmit={handleEmailReset} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="username" className="text-sm text-zinc-400">Username</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your username"
                  required
                  className="h-11 bg-zinc-900 border-zinc-800 text-white placeholder:text-zinc-600 focus:border-zinc-600 focus:ring-1 focus:ring-zinc-700"
                  autoComplete="username"
                />
              </div>
              <Button
                type="submit"
                disabled={isLoading}
                className="w-full h-11 bg-white text-black font-medium hover:bg-zinc-200 disabled:opacity-40"
              >
                {isLoading ? 'Sending...' : 'Send reset link'}
              </Button>
            </form>
          )}

          {/* Code Reset Form */}
          {method === 'code' && !success && (
            <form onSubmit={handleCodeReset} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="code-username" className="text-sm text-zinc-400">Username</Label>
                <Input
                  id="code-username"
                  value={codeUsername}
                  onChange={(e) => setCodeUsername(e.target.value)}
                  placeholder="Your username"
                  required
                  className="h-11 bg-zinc-900 border-zinc-800 text-white placeholder:text-zinc-600 focus:border-zinc-600 focus:ring-1 focus:ring-zinc-700"
                  autoComplete="username"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reset-code" className="text-sm text-zinc-400">Reset code</Label>
                <Input
                  id="reset-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="8-character code"
                  required
                  maxLength={8}
                  className="h-11 bg-zinc-900 border-zinc-800 text-white placeholder:text-zinc-600 focus:border-zinc-600 focus:ring-1 focus:ring-zinc-700 font-mono tracking-widest text-center text-lg"
                />
              </div>
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
