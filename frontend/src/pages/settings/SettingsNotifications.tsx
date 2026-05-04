// settings/SettingsNotifications.tsx
//
// Notification preferences — email notification types and in-app notification
// behavior. Stored in localStorage as UI preferences.

import { useState, useEffect } from 'react'
import { Mail, Monitor, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'

const STORAGE_KEY = 'fabrik_notification_preferences'

interface NotificationPreferences {
  // Email notifications
  emailTaskCompletion: boolean
  emailTaskFailure: boolean
  emailAwxResults: boolean
  emailSecurityAlerts: boolean
  emailSystemUpdates: boolean
  // In-app notifications
  desktopNotifications: boolean
  notificationSound: boolean
  autoDismissSeconds: string
  digestMode: boolean
  digestIntervalMinutes: string
}

const DEFAULTS: NotificationPreferences = {
  emailTaskCompletion: false,
  emailTaskFailure: true,
  emailAwxResults: false,
  emailSecurityAlerts: true,
  emailSystemUpdates: false,
  desktopNotifications: false,
  notificationSound: true,
  autoDismissSeconds: '10',
  digestMode: false,
  digestIntervalMinutes: '15',
}

function loadPreferences(): NotificationPreferences {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return { ...DEFAULTS, ...JSON.parse(stored) }
  } catch { /* ignore parse errors */ }
  return DEFAULTS
}

interface ToggleRowProps {
  id: string
  label: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

function ToggleRow({ id, label, description, checked, onCheckedChange }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between py-1">
      <div className="space-y-0.5 pr-4">
        <Label htmlFor={id} className="text-sm font-medium cursor-pointer">{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

export default function SettingsNotifications() {
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULTS)

  useEffect(() => {
    setPrefs(loadPreferences())
  }, [])

  const toggle = (key: keyof NotificationPreferences) =>
    setPrefs(p => ({ ...p, [key]: !p[key] }))

  const handleSave = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
    toast.success('Notification preferences saved')
  }

  return (
    <div className="space-y-6 w-full">
      <div>
        <h2 className="text-lg font-semibold">Notifications</h2>
        <p className="text-sm text-muted-foreground">
          Choose how and when you receive notifications.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Email Notifications */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5" />
              Email Notifications
            </CardTitle>
            <CardDescription>Events that trigger an email to your inbox</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ToggleRow
              id="emailTaskCompletion"
              label="Task Completion"
              description="Scheduled tasks that complete successfully"
              checked={prefs.emailTaskCompletion}
              onCheckedChange={() => toggle('emailTaskCompletion')}
            />
            <Separator />
            <ToggleRow
              id="emailTaskFailure"
              label="Task Failure"
              description="Scheduled tasks that fail or exceed retry limit"
              checked={prefs.emailTaskFailure}
              onCheckedChange={() => toggle('emailTaskFailure')}
            />
            <Separator />
            <ToggleRow
              id="emailAwxResults"
              label="AWX Execution Results"
              description="Automation requests that complete or fail"
              checked={prefs.emailAwxResults}
              onCheckedChange={() => toggle('emailAwxResults')}
            />
            <Separator />
            <ToggleRow
              id="emailSecurityAlerts"
              label="Security Alerts"
              description="Login from new device, password changes"
              checked={prefs.emailSecurityAlerts}
              onCheckedChange={() => toggle('emailSecurityAlerts')}
            />
            <Separator />
            <ToggleRow
              id="emailSystemUpdates"
              label="System Updates"
              description="Platform maintenance and version updates"
              checked={prefs.emailSystemUpdates}
              onCheckedChange={() => toggle('emailSystemUpdates')}
            />
          </CardContent>
        </Card>

        {/* In-App Notifications */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Monitor className="w-5 h-5" />
              In-App Notifications
            </CardTitle>
            <CardDescription>Browser and UI notification behavior</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ToggleRow
              id="desktopNotifications"
              label="Desktop Notifications"
              description="Show browser push notifications"
              checked={prefs.desktopNotifications}
              onCheckedChange={() => toggle('desktopNotifications')}
            />
            <Separator />
            <ToggleRow
              id="notificationSound"
              label="Notification Sound"
              description="Play a sound when new notifications arrive"
              checked={prefs.notificationSound}
              onCheckedChange={() => toggle('notificationSound')}
            />
            <Separator />

            {/* Auto-dismiss */}
            <div className="flex items-center justify-between py-1">
              <div className="space-y-0.5 pr-4">
                <Label htmlFor="autoDismiss" className="text-sm font-medium">Auto-dismiss</Label>
                <p className="text-xs text-muted-foreground">
                  Automatically hide toast notifications after
                </p>
              </div>
              <Select
                value={prefs.autoDismissSeconds}
                onValueChange={v => setPrefs(p => ({ ...p, autoDismissSeconds: v }))}
              >
                <SelectTrigger id="autoDismiss" className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5 sec</SelectItem>
                  <SelectItem value="10">10 sec</SelectItem>
                  <SelectItem value="30">30 sec</SelectItem>
                  <SelectItem value="0">Never</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <ToggleRow
              id="digestMode"
              label="Digest Mode"
              description="Batch notifications instead of showing individually"
              checked={prefs.digestMode}
              onCheckedChange={() => toggle('digestMode')}
            />

            {prefs.digestMode && (
              <div className="flex items-center justify-between py-1 pl-4 border-l-2 border-primary/20">
                <div className="space-y-0.5 pr-4">
                  <Label htmlFor="digestInterval" className="text-sm font-medium">Digest Interval</Label>
                  <p className="text-xs text-muted-foreground">
                    How often to flush batched notifications
                  </p>
                </div>
                <Select
                  value={prefs.digestIntervalMinutes}
                  onValueChange={v => setPrefs(p => ({ ...p, digestIntervalMinutes: v }))}
                >
                  <SelectTrigger id="digestInterval" className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5 min</SelectItem>
                    <SelectItem value="15">15 min</SelectItem>
                    <SelectItem value="30">30 min</SelectItem>
                    <SelectItem value="60">1 hour</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave}>
          <Save className="w-4 h-4 mr-2" />
          Save Preferences
        </Button>
      </div>
    </div>
  )
}
