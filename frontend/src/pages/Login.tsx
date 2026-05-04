// Login.tsx — Split layout login with MFA support.
// Left panel: brand + slogan. Right panel: sign-in form.

import { useState, useEffect } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { useAuthStore, MFARequiredError } from '../store/authStore'
import { useDemoStore } from '../store/demoStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle, Eye, EyeOff } from 'lucide-react'
import FabrikDark from '@/assets/fabrik_dark.svg'
import { BRAND_TAGLINE, BRAND_SUBTAGLINE } from '@/lib/brand'

type LoginMode = 'local' | 'ldap'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, ldapLogin, mfaLogin, user, isLoading, error, clearError } = useAuthStore()
  const { isLoaded: platformLoaded, loadPlatformInfo } = useDemoStore()
  const [ldapEnabled, setLdapEnabled] = useState(false)
  const [loginMode, setLoginMode] = useState<LoginMode>('local')
  const [showPassword, setShowPassword] = useState(false)
  const [mfaStep, setMfaStep] = useState(false)
  const [mfaCode, setMfaCode] = useState('')
  const [useBackupCode, setUseBackupCode] = useState(false)

  const [formData, setFormData] = useState({
    username: '',
    password: '',
  })

  const from = (location.state as any)?.from?.pathname || '/'

  // Fetch platform info to know if LDAP is enabled
  useEffect(() => {
    if (!platformLoaded) {
      loadPlatformInfo()
    }
  }, [platformLoaded, loadPlatformInfo])

  // Check ldap_enabled from platform info
  useEffect(() => {
    const checkLdap = async () => {
      try {
        const res = await fetch('/api/dashboard/platform-info/')
        if (res.ok) {
          const data = await res.json()
          setLdapEnabled(data.ldap_enabled ?? false)
        }
      } catch {
        // Ignore — LDAP tab just won't show
      }
    }
    checkLdap()
  }, [])

  useEffect(() => {
    if (user) {
      navigate(from, { replace: true })
    }
  }, [user, navigate, from])

  useEffect(() => {
    document.title = 'Fabrik — Sign In'
    return () => {
      clearError()
      document.title = 'Fabrik'
    }
  }, [clearError])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      if (loginMode === 'ldap') {
        await ldapLogin(formData.username, formData.password)
      } else {
        await login(formData.username, formData.password)
      }
      navigate(from, { replace: true })
    } catch (err) {
      if (err instanceof MFARequiredError) {
        setMfaStep(true)
      }
    }
  }

  const handleMFASubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await mfaLogin(
        formData.username,
        formData.password,
        useBackupCode ? undefined : mfaCode,
        useBackupCode ? mfaCode : undefined,
      )
      navigate(from, { replace: true })
    } catch {
      // Error shown via store
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }))
  }

  return (
    <div className="min-h-screen flex bg-black">
      {/* Left panel — brand */}
      <div className="hidden lg:flex lg:w-[55%] relative items-center justify-center">
        {/* Subtle static gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-zinc-900 via-black to-zinc-900" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:48px_48px]" />

        <div className="relative z-10 max-w-md px-12">
          <img src={FabrikDark} alt="Fabrik" className="h-16 w-auto mb-8" />
          <h1 className="text-4xl font-semibold text-white tracking-tight leading-tight mb-4">
            {BRAND_TAGLINE}
          </h1>
          <p className="text-zinc-500 text-base leading-relaxed">
            {BRAND_SUBTAGLINE}
          </p>
        </div>

        {/* Divider line */}
        <div className="absolute right-0 top-[15%] bottom-[15%] w-px bg-zinc-800" />
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center px-6 sm:px-12">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden mb-10">
            <img src={FabrikDark} alt="Fabrik" className="h-10 w-auto" />
          </div>

          {/* Login mode tabs — only visible when LDAP is enabled */}
          {ldapEnabled && !mfaStep && (
            <div className="flex mb-6 bg-zinc-900 rounded-lg p-1">
              <button
                type="button"
                onClick={() => { setLoginMode('local'); clearError() }}
                className={`flex-1 py-2 px-3 text-sm rounded-md transition-colors ${
                  loginMode === 'local'
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                Local
              </button>
              <button
                type="button"
                onClick={() => { setLoginMode('ldap'); clearError() }}
                className={`flex-1 py-2 px-3 text-sm rounded-md transition-colors ${
                  loginMode === 'ldap'
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                LDAP
              </button>
            </div>
          )}

          {/* Header */}
          <div className="mb-8">
            <h2 className="text-xl font-medium text-white mb-1">
              {mfaStep ? 'Two-factor authentication' : 'Sign in'}
            </h2>
            <p className="text-sm text-zinc-500">
              {mfaStep
                ? 'Enter the code from your authenticator app'
                : loginMode === 'ldap'
                  ? 'Sign in with your corporate LDAP credentials'
                  : 'Enter your credentials to continue'}
            </p>
          </div>

          {/* Error */}
          {error && (
            <Alert variant="destructive" className="mb-6 border-red-500/20 bg-red-500/5">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-red-300 text-sm">{error}</AlertDescription>
            </Alert>
          )}

          {/* MFA Step */}
          {mfaStep ? (
            <form onSubmit={handleMFASubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="mfa-code" className="text-sm text-zinc-400">
                  {useBackupCode ? 'Backup code' : 'Verification code'}
                </Label>
                <Input
                  id="mfa-code"
                  type="text"
                  required
                  value={mfaCode}
                  onChange={e => setMfaCode(e.target.value)}
                  placeholder={useBackupCode ? 'ABCD1234' : '000000'}
                  className="h-11 bg-zinc-900 border-zinc-800 text-white text-center text-lg tracking-[0.3em] font-mono placeholder:text-zinc-600 focus:border-zinc-600 focus:ring-1 focus:ring-zinc-700"
                  autoFocus
                  autoComplete="one-time-code"
                  maxLength={useBackupCode ? 8 : 6}
                />
              </div>

              <Button
                type="submit"
                disabled={isLoading || !mfaCode}
                className="w-full h-11 bg-white text-black font-medium hover:bg-zinc-200 disabled:opacity-40"
              >
                {isLoading ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-zinc-400 border-t-black rounded-full animate-spin" />
                    Verifying...
                  </div>
                ) : 'Verify'}
              </Button>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => { setUseBackupCode(!useBackupCode); setMfaCode(''); clearError() }}
                  className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {useBackupCode ? 'Use authenticator app' : 'Use backup code'}
                </button>
                <button
                  type="button"
                  onClick={() => { setMfaStep(false); setMfaCode(''); clearError() }}
                  className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  Back
                </button>
              </div>
            </form>
          ) : (
            <>
              {/* Login Form */}
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="username" className="text-sm text-zinc-400">
                    Username
                  </Label>
                  <Input
                    id="username"
                    name="username"
                    type="text"
                    required
                    value={formData.username}
                    onChange={handleChange}
                    placeholder="Enter your username"
                    className="h-11 bg-zinc-900 border-zinc-800 text-white placeholder:text-zinc-600 focus:border-zinc-600 focus:ring-1 focus:ring-zinc-700"
                    autoComplete="username"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="text-sm text-zinc-400">
                      Password
                    </Label>
                    {loginMode !== 'ldap' && (
                      <Link
                        to="/forgot-password"
                        className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                      >
                        Forgot password?
                      </Link>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={formData.password}
                      onChange={handleChange}
                      placeholder="Enter your password"
                      className="h-11 bg-zinc-900 border-zinc-800 text-white placeholder:text-zinc-600 focus:border-zinc-600 focus:ring-1 focus:ring-zinc-700 pr-11"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-11 bg-white text-black font-medium hover:bg-zinc-200 disabled:opacity-40"
                >
                  {isLoading ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-zinc-400 border-t-black rounded-full animate-spin" />
                      Signing in...
                    </div>
                  ) : 'Sign in'}
                </Button>
              </form>

              {/* Register link — hidden for LDAP mode (accounts come from directory) */}
              {loginMode !== 'ldap' && (
              <div className="mt-8 pt-6 border-t border-zinc-800">
                <p className="text-sm text-zinc-500 text-center">
                  Don't have an account?{' '}
                  <Link to="/register" className="text-white hover:text-zinc-300 transition-colors">
                    Create one
                  </Link>
                </p>
              </div>
              )}
            </>
          )}

          {/* Footer */}
          <p className="mt-10 text-xs text-zinc-700 text-center">
            &copy; 2025-2026 Fabrik Project
          </p>
        </div>
      </div>
    </div>
  )
}
