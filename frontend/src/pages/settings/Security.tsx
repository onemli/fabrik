// settings/Security.tsx — password change, session timeout, and MFA setup.

import { useState, useEffect } from 'react'
import { Shield, ShieldCheck, ShieldOff, Copy, Check, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { useAuthStore } from '@/store/authStore'

const TIMEOUT_OPTIONS = [
  { label: 'Never',      value: 0 },
  { label: '15 minutes', value: 15 },
  { label: '30 minutes', value: 30 },
  { label: '1 hour',     value: 60 },
  { label: '2 hours',    value: 120 },
  { label: '4 hours',    value: 240 },
  { label: '8 hours',    value: 480 },
]

export default function Security() {
  const { user, loadUser } = useAuthStore()
  const [timeoutMinutes, setTimeoutMinutes] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [passwordData, setPasswordData] = useState({ old: '', new: '', confirm: '' })
  const [pwSaving, setPwSaving] = useState(false)

  // MFA state
  const [mfaEnabled, setMfaEnabled] = useState(false)
  const [backupCodesRemaining, setBackupCodesRemaining] = useState(0)
  const [setupStep, setSetupStep] = useState<'idle' | 'qr' | 'verify' | 'backup'>('idle')
  const [qrCode, setQrCode] = useState('')
  const [mfaSecret, setMfaSecret] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [mfaLoading, setMfaLoading] = useState(false)
  const [disablePassword, setDisablePassword] = useState('')
  const [copiedSecret, setCopiedSecret] = useState(false)

  useEffect(() => {
    import('@/services/auth').then(({ authService }) => {
      authService.getSessionTimeout().then(setTimeoutMinutes)
      authService.mfaStatus().then(data => {
        setMfaEnabled(data.mfa_enabled)
        setBackupCodesRemaining(data.backup_codes_remaining)
      }).catch(() => {})
    })
  }, [])

  const handleTimeoutSave = async (value: number) => {
    setSaving(true)
    try {
      const { authService } = await import('@/services/auth')
      await authService.setSessionTimeout(value)
      setTimeoutMinutes(value)
      toast.success('Session timeout updated')
    } catch {
      toast.error('Failed to update session timeout')
    } finally {
      setSaving(false)
    }
  }

  const handlePasswordChange = async () => {
    if (passwordData.new !== passwordData.confirm) {
      toast.error('New passwords do not match')
      return
    }
    if (passwordData.new.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    setPwSaving(true)
    try {
      const { authService } = await import('@/services/auth')
      await authService.changePassword(passwordData.old, passwordData.new, passwordData.confirm)
      toast.success('Password changed successfully')
      setPasswordData({ old: '', new: '', confirm: '' })
    } catch (err: unknown) {
      toast.error((err as Error)?.message || 'Failed to change password')
    } finally {
      setPwSaving(false)
    }
  }

  // MFA setup flow
  const startMfaSetup = async () => {
    setMfaLoading(true)
    try {
      const { authService } = await import('@/services/auth')
      const data = await authService.mfaSetup()
      setQrCode(data.qr_code)
      setMfaSecret(data.secret)
      setSetupStep('qr')
    } catch (err: unknown) {
      toast.error((err as Error)?.message || 'MFA setup failed')
    } finally {
      setMfaLoading(false)
    }
  }

  const verifyMfaCode = async () => {
    setMfaLoading(true)
    try {
      const { authService } = await import('@/services/auth')
      const data = await authService.mfaVerify(totpCode)
      setBackupCodes(data.backup_codes)
      setSetupStep('backup')
      setMfaEnabled(true)
      setBackupCodesRemaining(data.backup_codes.length)
      loadUser()
      toast.success('MFA enabled successfully')
    } catch (err: unknown) {
      toast.error((err as Error)?.message || 'Invalid code')
    } finally {
      setMfaLoading(false)
    }
  }

  const disableMfa = async () => {
    if (!disablePassword) {
      toast.error('Enter your password')
      return
    }
    setMfaLoading(true)
    try {
      const { authService } = await import('@/services/auth')
      await authService.mfaDisable(disablePassword)
      setMfaEnabled(false)
      setDisablePassword('')
      setSetupStep('idle')
      setBackupCodesRemaining(0)
      loadUser()
      toast.success('MFA disabled')
    } catch (err: unknown) {
      toast.error((err as Error)?.message || 'Failed to disable MFA')
    } finally {
      setMfaLoading(false)
    }
  }

  const regenerateBackupCodes = async () => {
    const pw = prompt('Enter your password to regenerate backup codes:')
    if (!pw) return
    try {
      const { authService } = await import('@/services/auth')
      const data = await authService.mfaRegenerateBackupCodes(pw)
      setBackupCodes(data.backup_codes)
      setBackupCodesRemaining(data.backup_codes.length)
      setSetupStep('backup')
      toast.success('New backup codes generated')
    } catch (err: unknown) {
      toast.error((err as Error)?.message || 'Failed to regenerate')
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedSecret(true)
    setTimeout(() => setCopiedSecret(false), 2000)
  }

  return (
    <div className="space-y-6 w-full">
      <div>
        <h2 className="text-lg font-semibold">Security</h2>
        <p className="text-sm text-muted-foreground">Session, password, and two-factor authentication settings.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Session Timeout */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Auto-Logout (Idle Timeout)
            </CardTitle>
            <CardDescription>
              Automatically log out after a period of inactivity.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {timeoutMinutes === null ? (
              <div className="h-10 bg-muted animate-pulse rounded" />
            ) : (
              <div className="flex items-center gap-3">
                <Select
                  value={String(timeoutMinutes)}
                  onValueChange={v => handleTimeoutSave(Number(v))}
                  disabled={saving}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEOUT_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={String(opt.value)}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {saving && <span className="text-sm text-muted-foreground">Saving...</span>}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Change Password — hidden for LDAP users whose password is managed externally */}
        {user?.auth_source !== 'ldap' ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5" />
                Change Password
              </CardTitle>
              <CardDescription>Update your account password. Minimum 8 characters.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label>Current password</Label>
                <Input
                  type="password"
                  value={passwordData.old}
                  onChange={e => setPasswordData(p => ({ ...p, old: e.target.value }))}
                  autoComplete="current-password"
                />
              </div>
              <div className="space-y-1">
                <Label>New password</Label>
                <Input
                  type="password"
                  value={passwordData.new}
                  onChange={e => setPasswordData(p => ({ ...p, new: e.target.value }))}
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-1">
                <Label>Confirm new password</Label>
                <Input
                  type="password"
                  value={passwordData.confirm}
                  onChange={e => setPasswordData(p => ({ ...p, confirm: e.target.value }))}
                  autoComplete="new-password"
                />
              </div>
              <Button
                onClick={handlePasswordChange}
                disabled={pwSaving || !passwordData.old || !passwordData.new || !passwordData.confirm}
                className="w-full mt-2"
              >
                {pwSaving ? 'Changing...' : 'Change Password'}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5" />
                Password
              </CardTitle>
              <CardDescription>Your password is managed by your LDAP directory.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Contact your system administrator to change your password.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Two-Factor Authentication */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {mfaEnabled ? (
                <ShieldCheck className="w-5 h-5 text-emerald-500" />
              ) : (
                <ShieldOff className="w-5 h-5 text-muted-foreground" />
              )}
              Two-Factor Authentication (TOTP)
            </CardTitle>
            <CardDescription>
              {mfaEnabled
                ? 'Your account is protected with two-factor authentication.'
                : 'Add an extra layer of security using an authenticator app (Google Authenticator, Authy, etc.).'
              }
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* MFA Enabled — show status and controls */}
            {mfaEnabled && setupStep === 'idle' && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <ShieldCheck className="w-5 h-5 text-emerald-500 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-emerald-400">MFA is active</p>
                    <p className="text-xs text-muted-foreground">{backupCodesRemaining} backup codes remaining</p>
                  </div>
                </div>

                {backupCodesRemaining <= 2 && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                    <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />
                    <p className="text-xs text-yellow-400">Low backup codes. Regenerate before you run out.</p>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={regenerateBackupCodes}>
                    Regenerate Backup Codes
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => setSetupStep('idle')}>
                    Disable MFA
                  </Button>
                </div>

                {/* Disable MFA form */}
                <div className="space-y-2 pt-2 border-t border-border/50">
                  <Label className="text-sm">Enter password to disable MFA</Label>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      value={disablePassword}
                      onChange={e => setDisablePassword(e.target.value)}
                      placeholder="Your password"
                      className="max-w-xs"
                    />
                    <Button
                      variant="destructive"
                      onClick={disableMfa}
                      disabled={mfaLoading || !disablePassword}
                    >
                      {mfaLoading ? 'Disabling...' : 'Confirm Disable'}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* MFA Not Enabled — show setup button */}
            {!mfaEnabled && setupStep === 'idle' && (
              <Button onClick={startMfaSetup} disabled={mfaLoading}>
                {mfaLoading ? 'Setting up...' : 'Enable Two-Factor Authentication'}
              </Button>
            )}

            {/* Step 1: QR Code */}
            {setupStep === 'qr' && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Scan this QR code with your authenticator app, then enter the 6-digit code below.
                </p>
                <div className="flex justify-center p-4 bg-white rounded-lg w-fit mx-auto">
                  <img src={qrCode} alt="TOTP QR Code" className="w-48 h-48" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Manual entry key:</Label>
                  <div className="flex items-center gap-2">
                    <code className="px-3 py-1.5 bg-muted rounded text-sm font-mono tracking-wider">
                      {mfaSecret}
                    </code>
                    <button onClick={() => copyToClipboard(mfaSecret)} className="text-muted-foreground hover:text-foreground">
                      {copiedSecret ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Verification code</Label>
                  <Input
                    type="text"
                    value={totpCode}
                    onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    className="max-w-xs text-center text-xl tracking-[0.3em] font-mono"
                    autoFocus
                    maxLength={6}
                  />
                </div>
                <div className="flex gap-2">
                  <Button onClick={verifyMfaCode} disabled={mfaLoading || totpCode.length !== 6}>
                    {mfaLoading ? 'Verifying...' : 'Verify & Enable'}
                  </Button>
                  <Button variant="ghost" onClick={() => { setSetupStep('idle'); setTotpCode('') }}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Step 2: Backup Codes */}
            {setupStep === 'backup' && backupCodes.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                  <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0" />
                  <p className="text-sm text-yellow-400">
                    Save these backup codes in a safe place. Each code can only be used once.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 p-4 bg-muted rounded-lg font-mono text-sm">
                  {backupCodes.map((code, i) => (
                    <div key={i} className="px-3 py-1.5 bg-background rounded border border-border/50 text-center tracking-wider">
                      {code}
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(backupCodes.join('\n'))}
                  >
                    <Copy className="w-4 h-4 mr-2" /> Copy All
                  </Button>
                  <Button size="sm" onClick={() => { setSetupStep('idle'); setBackupCodes([]) }}>
                    Done
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Session Info */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Active Session
            </CardTitle>
            <CardDescription>Information about your current session.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              JWT access tokens expire every <strong>15 minutes</strong> and are refreshed automatically.
            </p>
            <p>
              Refresh tokens expire after <strong>7 days</strong>. After that, you must log in again.
            </p>
            <p>All sessions are invalidated when you change your password.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
