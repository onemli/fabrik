// settings/Preferences.tsx — UI appearance preferences (mode, locale).

import { Sun, Moon } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { useTimezone } from '@/contexts/TimezoneContext'
import { useThemeStore } from '@/store/themeStore'
import { useClassBrowserStore } from '@/store/classBrowserStore'

const COMMON_TIMEZONES = [
  { value: 'UTC',                  label: 'UTC (Coordinated Universal Time)' },
  { value: 'Europe/Istanbul',      label: 'Europe/Istanbul (UTC+3)' },
  { value: 'Europe/London',        label: 'Europe/London (UTC+0/+1)' },
  { value: 'Europe/Paris',         label: 'Europe/Paris (UTC+1/+2)' },
  { value: 'Europe/Berlin',        label: 'Europe/Berlin (UTC+1/+2)' },
  { value: 'America/New_York',     label: 'America/New York (UTC-5/-4)' },
  { value: 'America/Chicago',      label: 'America/Chicago (UTC-6/-5)' },
  { value: 'America/Los_Angeles',  label: 'America/Los Angeles (UTC-8/-7)' },
  { value: 'Asia/Tokyo',           label: 'Asia/Tokyo (UTC+9)' },
  { value: 'Asia/Dubai',           label: 'Asia/Dubai (UTC+4)' },
  { value: 'Asia/Singapore',       label: 'Asia/Singapore (UTC+8)' },
  { value: 'Australia/Sydney',     label: 'Australia/Sydney (UTC+10/+11)' },
]

const CLASS_BROWSER_SECTIONS = [
  { key: 'showDescription', label: 'Description', desc: 'Class description text' },
  { key: 'showDnReference', label: 'DN Reference', desc: 'RN Format, Context Root, Category' },
  { key: 'showChildClasses', label: 'Child Classes', desc: 'Containment hierarchy children' },
  { key: 'showProperties', label: 'Filterable Properties', desc: 'Naming and configurable properties' },
] as const

export default function Preferences() {
  const { mode, setMode } = useThemeStore()
  const { preferences, updatePreferences, isLoading } = useTimezone()
  const classBrowser = useClassBrowserStore()

  if (isLoading) {
    return (
      <div className="space-y-4 w-full">
        <div className="h-6 w-32 bg-muted animate-pulse rounded" />
        <div className="h-64 bg-muted animate-pulse rounded-lg" />
      </div>
    )
  }

  return (
    <div className="space-y-6 w-full">
      <div>
        <h2 className="text-lg font-semibold">Preferences</h2>
        <p className="text-sm text-muted-foreground">Display and locale preferences.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Display</CardTitle>
          <CardDescription>Theme and regional format settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Theme */}
          <div className="space-y-2">
            <Label htmlFor="mode">Theme</Label>
            <Select value={mode} onValueChange={v => setMode(v as 'light' | 'dark')}>
              <SelectTrigger id="mode" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">
                  <div className="flex items-center gap-2">
                    <Sun className="w-4 h-4" /> Light
                  </div>
                </SelectItem>
                <SelectItem value="dark">
                  <div className="flex items-center gap-2">
                    <Moon className="w-4 h-4" /> Dark
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* Timezone */}
          <div className="space-y-2">
            <Label htmlFor="timezone">Display Timezone</Label>
            <Select
              value={preferences?.display_timezone || 'Europe/Istanbul'}
              onValueChange={value => preferences && updatePreferences({ display_timezone: value })}
            >
              <SelectTrigger id="timezone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMMON_TIMEZONES.map(tz => (
                  <SelectItem key={tz.value} value={tz.value}>
                    {tz.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              All dates and times will be displayed in this timezone
            </p>
          </div>

          <Separator />

          <div className="grid gap-6 md:grid-cols-2">
            {/* Date Format */}
            <div className="space-y-2">
              <Label htmlFor="date_format">Date Format</Label>
              <Select
                value={preferences?.date_format || 'DD/MM/YYYY'}
                onValueChange={value => preferences && updatePreferences({ date_format: value })}
              >
                <SelectTrigger id="date_format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DD/MM/YYYY">DD/MM/YYYY (European)</SelectItem>
                  <SelectItem value="MM/DD/YYYY">MM/DD/YYYY (US)</SelectItem>
                  <SelectItem value="YYYY-MM-DD">YYYY-MM-DD (ISO)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Time Format */}
            <div className="space-y-2">
              <Label htmlFor="time_format">Time Format</Label>
              <Select
                value={preferences?.time_format || '24h'}
                onValueChange={value => preferences && updatePreferences({ time_format: value })}
              >
                <SelectTrigger id="time_format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24h">24-hour (14:30)</SelectItem>
                  <SelectItem value="12h">12-hour (2:30 PM)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Class Browser</CardTitle>
          <CardDescription>Choose which detail sections to show when inspecting a class</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {CLASS_BROWSER_SECTIONS.map(({ key, label, desc }) => (
            <div key={key} className="flex items-center justify-between">
              <div>
                <Label htmlFor={key}>{label}</Label>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
              <Switch
                id={key}
                checked={classBrowser[key]}
                onCheckedChange={(checked) => classBrowser.setPreference(key, checked)}
              />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
