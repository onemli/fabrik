// Register.tsx — New user registration in split layout.
// Redirects to /login after successful registration.

import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle, Eye, EyeOff } from 'lucide-react'
import FabrikDark from '@/assets/fabrik_dark.svg'
import { BRAND_TAGLINE, BRAND_SUBTAGLINE } from '@/lib/brand'

export default function Register() {
  const navigate = useNavigate()
  const { register, user, isLoading, error, clearError } = useAuthStore()
  const [showPassword, setShowPassword] = useState(false)
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false)

  const [formData, setFormData] = useState({
    username: '',
    email: '',
    first_name: '',
    last_name: '',
    password: '',
    password_confirm: '',
  })

  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (user) {
      navigate('/')
    }
  }, [user, navigate])

  useEffect(() => {
    document.title = 'Fabrik — Create Account'
    return () => {
      clearError()
      document.title = 'Fabrik'
    }
  }, [clearError])

  const validateForm = () => {
    const errors: Record<string, string> = {}

    if (!formData.username.trim()) {
      errors.username = 'Username is required'
    }

    if (!formData.email.trim()) {
      errors.email = 'Email is required'
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      errors.email = 'Email is invalid'
    }

    if (!formData.password) {
      errors.password = 'Password is required'
    } else if (formData.password.length < 8) {
      errors.password = 'Password must be at least 8 characters'
    }

    if (formData.password !== formData.password_confirm) {
      errors.password_confirm = 'Passwords do not match'
    }

    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) {
      return
    }

    try {
      await register({
        username: formData.username,
        email: formData.email,
        first_name: formData.first_name,
        last_name: formData.last_name,
        password: formData.password,
        password_confirm: formData.password_confirm,
      })
      navigate('/')
    } catch {
      // Error is handled by the store
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }))
    if (formErrors[e.target.name]) {
      setFormErrors(prev => {
        const newErrors = { ...prev }
        delete newErrors[e.target.name]
        return newErrors
      })
    }
  }

  const inputClass = 'h-11 bg-zinc-900 border-zinc-800 text-white placeholder:text-zinc-600 focus:border-zinc-600 focus:ring-1 focus:ring-zinc-700'

  return (
    <div className="min-h-screen flex bg-black">
      {/* Left panel — brand */}
      <div className="hidden lg:flex lg:w-[55%] relative items-center justify-center">
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

        <div className="absolute right-0 top-[15%] bottom-[15%] w-px bg-zinc-800" />
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center px-6 sm:px-12 py-12">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden mb-10">
            <img src={FabrikDark} alt="Fabrik" className="h-10 w-auto" />
          </div>

          {/* Header */}
          <div className="mb-8">
            <h2 className="text-xl font-medium text-white mb-1">Create account</h2>
            <p className="text-sm text-zinc-500">Fill in your details to get started</p>
          </div>

          {/* Error */}
          {error && (
            <Alert variant="destructive" className="mb-6 border-red-500/20 bg-red-500/5">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-red-300 text-sm">{error}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name fields */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="first_name" className="text-sm text-zinc-400">First name</Label>
                <Input
                  id="first_name"
                  name="first_name"
                  type="text"
                  value={formData.first_name}
                  onChange={handleChange}
                  placeholder="John"
                  className={inputClass}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="last_name" className="text-sm text-zinc-400">Last name</Label>
                <Input
                  id="last_name"
                  name="last_name"
                  type="text"
                  value={formData.last_name}
                  onChange={handleChange}
                  placeholder="Doe"
                  className={inputClass}
                />
              </div>
            </div>

            {/* Username */}
            <div className="space-y-2">
              <Label htmlFor="username" className="text-sm text-zinc-400">
                Username <span className="text-red-500">*</span>
              </Label>
              <Input
                id="username"
                name="username"
                type="text"
                required
                value={formData.username}
                onChange={handleChange}
                placeholder="johndoe"
                className={inputClass}
                autoComplete="username"
              />
              {formErrors.username && (
                <p className="text-xs text-red-400">{formErrors.username}</p>
              )}
            </div>

            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm text-zinc-400">
                Email <span className="text-red-500">*</span>
              </Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                value={formData.email}
                onChange={handleChange}
                placeholder="john@example.com"
                className={inputClass}
                autoComplete="email"
              />
              {formErrors.email && (
                <p className="text-xs text-red-400">{formErrors.email}</p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm text-zinc-400">
                Password <span className="text-red-500">*</span>
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="Min. 8 characters"
                  className={`${inputClass} pr-11`}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {formErrors.password && (
                <p className="text-xs text-red-400">{formErrors.password}</p>
              )}
            </div>

            {/* Confirm password */}
            <div className="space-y-2">
              <Label htmlFor="password_confirm" className="text-sm text-zinc-400">
                Confirm password <span className="text-red-500">*</span>
              </Label>
              <div className="relative">
                <Input
                  id="password_confirm"
                  name="password_confirm"
                  type={showPasswordConfirm ? 'text' : 'password'}
                  required
                  value={formData.password_confirm}
                  onChange={handleChange}
                  placeholder="Confirm your password"
                  className={`${inputClass} pr-11`}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPasswordConfirm(!showPasswordConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {showPasswordConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {formErrors.password_confirm && (
                <p className="text-xs text-red-400">{formErrors.password_confirm}</p>
              )}
            </div>

            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-11 bg-white text-black font-medium hover:bg-zinc-200 disabled:opacity-40"
            >
              {isLoading ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-zinc-400 border-t-black rounded-full animate-spin" />
                  Creating account...
                </div>
              ) : 'Create account'}
            </Button>
          </form>

          {/* Login link */}
          <div className="mt-8 pt-6 border-t border-zinc-800">
            <p className="text-sm text-zinc-500 text-center">
              Already have an account?{' '}
              <Link to="/login" className="text-white hover:text-zinc-300 transition-colors">
                Sign in
              </Link>
            </p>
          </div>

          <p className="mt-10 text-xs text-zinc-700 text-center">
            &copy; 2025-2026 Fabrik Project
          </p>
        </div>
      </div>
    </div>
  )
}
