// VerifyEmail.tsx — Landing page for email verification links.
// Reads ?token= from URL, calls backend, shows result in split layout.

import { useState, useEffect } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { authService } from '@/services/auth'
import FabrikDark from '@/assets/fabrik_dark.svg'

export default function VerifyEmail() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    document.title = 'Fabrik — Verify Email'
    return () => { document.title = 'Fabrik' }
  }, [])

  useEffect(() => {
    if (!token) {
      setStatus('error')
      setMessage('No verification token provided.')
      return
    }
    authService.verifyEmail(token)
      .then(() => {
        setStatus('success')
        setMessage('Your email has been verified successfully.')
      })
      .catch((err) => {
        setStatus('error')
        setMessage(err.message || 'Verification failed. The link may have expired.')
      })
  }, [token])

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

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center px-6 sm:px-12">
        <div className="w-full max-w-sm text-center">
          {/* Mobile logo */}
          <div className="lg:hidden mb-10">
            <img src={FabrikDark} alt="Fabrik" className="h-10 w-auto mx-auto" />
          </div>

          {status === 'loading' && (
            <>
              <Loader2 className="w-10 h-10 text-zinc-400 animate-spin mx-auto mb-4" />
              <p className="text-zinc-500">Verifying your email...</p>
            </>
          )}

          {status === 'success' && (
            <>
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-4" />
              <h2 className="text-xl font-medium text-white mb-2">Email verified</h2>
              <p className="text-zinc-500 text-sm mb-8">{message}</p>
              <Link to="/">
                <Button className="w-full h-11 bg-white text-black font-medium hover:bg-zinc-200">
                  Continue to Fabrik
                </Button>
              </Link>
            </>
          )}

          {status === 'error' && (
            <>
              <XCircle className="w-10 h-10 text-red-500 mx-auto mb-4" />
              <h2 className="text-xl font-medium text-white mb-2">Verification failed</h2>
              <p className="text-zinc-500 text-sm mb-8">{message}</p>
              <Link to="/">
                <Button variant="outline" className="w-full h-11 bg-zinc-900 border-zinc-800 text-white hover:bg-zinc-800">
                  Back to home
                </Button>
              </Link>
            </>
          )}

          <p className="mt-10 text-xs text-zinc-700 text-center">
            &copy; 2025-2026 Fabrik Project
          </p>
        </div>
      </div>
    </div>
  )
}
