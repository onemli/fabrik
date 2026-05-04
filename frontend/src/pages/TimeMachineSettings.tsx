// TimeMachineSettings.tsx
//
// Per-user settings for snapshot retention. Users choose whether to keep
// snapshots forever, by age (days), or by count. The auto-cleanup task respects
// these settings when it runs at 3:30 AM server time.

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { timeMachineService, TimeMachineSettings as TSettings } from '@/services/timeMachine'
import { useAuthStore } from '@/store/authStore'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export default function TimeMachineSettings() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  const [settings, setSettings] = useState<Partial<TSettings>>({
    retention_policy: 'days',
    retention_days: 90,
    retention_count: 100,
    max_snapshot_size_mb: 10,
    warn_large_snapshots: true,
    auto_cleanup_enabled: true,
    store_duplicates: false,
  })

  // Fetch settings
  const { isLoading } = useQuery({
    queryKey: ['time-machine-settings'],
    queryFn: async () => {
      const data = await timeMachineService.getSettings()
      setSettings(data)
      return data
    },
    enabled: !!user,
  })

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: () => timeMachineService.updateSettings(settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time-machine-settings'] })
      navigate('/time-machine')
    },
  })

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-4">Authentication Required</h2>
          <p className="text-muted-foreground mb-6">Please log in to access settings</p>
          <button
            onClick={() => navigate('/login')}
            className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            Go to Login
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Breadcrumbs */}

      {/* Header */}
      <div className="border-b border-border bg-card">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <div className="flex items-center gap-4 mb-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/time-machine')}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </div>
          <h1 className="text-2xl font-bold text-foreground">Time Machine Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure retention policies and storage options
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        {isLoading ? (
          <div className="text-center py-12">
            <div className="inline-block w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-sm text-muted-foreground">Loading settings...</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Retention Policy */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="font-semibold mb-4">Retention Policy</h3>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="retention-policy">Policy Type</Label>
                  <Select
                    value={settings.retention_policy}
                    onValueChange={(value) =>
                      setSettings({ ...settings, retention_policy: value as any })
                    }
                  >
                    <SelectTrigger id="retention-policy">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unlimited">Unlimited (Keep all snapshots)</SelectItem>
                      <SelectItem value="days">By Days (Delete older than)</SelectItem>
                      <SelectItem value="count">By Count (Keep latest N)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {settings.retention_policy === 'days' && (
                  <div>
                    <Label htmlFor="retention-days">Retention Days</Label>
                    <Input
                      id="retention-days"
                      type="number"
                      min="1"
                      value={settings.retention_days}
                      onChange={(e) =>
                        setSettings({ ...settings, retention_days: parseInt(e.target.value) })
                      }
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Snapshots older than this will be deleted
                    </p>
                  </div>
                )}

                {settings.retention_policy === 'count' && (
                  <div>
                    <Label htmlFor="retention-count">Maximum Snapshots</Label>
                    <Input
                      id="retention-count"
                      type="number"
                      min="1"
                      value={settings.retention_count}
                      onChange={(e) =>
                        setSettings({ ...settings, retention_count: parseInt(e.target.value) })
                      }
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Keep only the latest N snapshots per query
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Storage Options */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="font-semibold mb-4">Storage Options</h3>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="max-size">Maximum Snapshot Size (MB)</Label>
                  <Input
                    id="max-size"
                    type="number"
                    min="0"
                    value={settings.max_snapshot_size_mb}
                    onChange={(e) =>
                      setSettings({ ...settings, max_snapshot_size_mb: parseInt(e.target.value) })
                    }
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    0 = no limit, snapshots larger than this will be rejected
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="warn-large">Warn for Large Snapshots</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Show warnings when snapshots exceed size limit
                    </p>
                  </div>
                  <Switch
                    id="warn-large"
                    checked={settings.warn_large_snapshots}
                    onCheckedChange={(checked) =>
                      setSettings({ ...settings, warn_large_snapshots: checked })
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="store-duplicates">Store Duplicate Results</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Save snapshots even if result is identical to previous
                    </p>
                  </div>
                  <Switch
                    id="store-duplicates"
                    checked={settings.store_duplicates}
                    onCheckedChange={(checked) =>
                      setSettings({ ...settings, store_duplicates: checked })
                    }
                  />
                </div>
              </div>
            </div>

            {/* Cleanup Options */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="font-semibold mb-4">Cleanup Options</h3>

              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="auto-cleanup">Auto Cleanup</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Automatically cleanup old snapshots based on retention policy
                  </p>
                </div>
                <Switch
                  id="auto-cleanup"
                  checked={settings.auto_cleanup_enabled}
                  onCheckedChange={(checked) =>
                    setSettings({ ...settings, auto_cleanup_enabled: checked })
                  }
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => navigate('/time-machine')}
              >
                Cancel
              </Button>
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
              >
                <Save className="w-4 h-4 mr-2" />
                {saveMutation.isPending ? 'Saving...' : 'Save Settings'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
