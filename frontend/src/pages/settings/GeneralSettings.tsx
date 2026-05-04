// settings/GeneralSettings.tsx
//
// User profile and account activity. Fetched from /api/auth/profile/.

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Save, User, Mail, Calendar, Shield,
  FileQuestion, Star, Users, Activity, Clock,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import { api } from '@/services/api'
import { useFormatters } from '@/contexts/TimezoneContext'

interface UserProfile {
  id: number
  username: string
  email: string
  first_name: string
  last_name: string
  date_joined: string
  last_login: string | null
  is_staff: boolean
  is_superuser: boolean
  is_admin: boolean
  query_count: number
  favorite_count: number
  group_names: string[]
  email_verified: boolean
  mfa_enabled: boolean
}

function getInitials(firstName: string, lastName: string, username: string): string {
  if (firstName && lastName) return `${firstName[0]}${lastName[0]}`.toUpperCase()
  return username.slice(0, 2).toUpperCase()
}

function ProfileCard({ profile, onSave, isSaving }: {
  profile: UserProfile
  onSave: (data: { first_name: string; last_name: string; email: string }) => void
  isSaving: boolean
}) {
  const [form, setForm] = useState({
    first_name: profile.first_name,
    last_name: profile.last_name,
    email: profile.email,
  })

  useEffect(() => {
    setForm({
      first_name: profile.first_name,
      last_name: profile.last_name,
      email: profile.email,
    })
  }, [profile])

  const initials = getInitials(profile.first_name, profile.last_name, profile.username)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="w-5 h-5" />
          Profile
        </CardTitle>
        <CardDescription>Your personal information</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Avatar + identity */}
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 border-2 border-primary/20 flex items-center justify-center shrink-0">
            <span className="text-xl font-semibold text-primary">{initials}</span>
          </div>
          <div className="min-w-0">
            <p className="font-medium text-lg truncate">
              {profile.first_name && profile.last_name
                ? `${profile.first_name} ${profile.last_name}`
                : profile.username}
            </p>
            <p className="text-sm text-muted-foreground">@{profile.username}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {profile.group_names.map(group => (
                <Badge key={group} variant="secondary" className="text-xs">{group}</Badge>
              ))}
              {profile.is_superuser && (
                <Badge variant="default" className="text-xs bg-amber-500/10 text-amber-600 border-amber-500/20">
                  Superuser
                </Badge>
              )}
            </div>
          </div>
        </div>

        <Separator />

        {/* Editable fields */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="first_name">First Name</Label>
            <Input
              id="first_name"
              value={form.first_name}
              onChange={e => setForm(p => ({ ...p, first_name: e.target.value }))}
              placeholder="Enter first name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="last_name">Last Name</Label>
            <Input
              id="last_name"
              value={form.last_name}
              onChange={e => setForm(p => ({ ...p, last_name: e.target.value }))}
              placeholder="Enter last name"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email Address</Label>
          <Input
            id="email"
            type="email"
            value={form.email}
            onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
            placeholder="your@email.com"
          />
          {profile.email_verified ? (
            <p className="text-xs text-emerald-600 flex items-center gap-1">
              <Shield className="w-3 h-3" /> Email verified
            </p>
          ) : (
            <p className="text-xs text-amber-600 flex items-center gap-1">
              <Mail className="w-3 h-3" /> Email not verified
            </p>
          )}
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={() => onSave(form)} disabled={isSaving}>
            <Save className="w-4 h-4 mr-2" />
            {isSaving ? 'Saving...' : 'Update Profile'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function AccountActivityCard({ profile }: { profile: UserProfile }) {
  const { formatDate, formatDateTime } = useFormatters()

  const stats = [
    { icon: FileQuestion, label: 'Saved Queries', value: profile.query_count },
    { icon: Star, label: 'Favorites', value: profile.favorite_count },
    { icon: Users, label: 'Groups', value: profile.group_names.length },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="w-5 h-5" />
          Account Activity
        </CardTitle>
        <CardDescription>Your account details and usage</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-4">
          {stats.map(({ icon: Icon, label, value }) => (
            <div key={label} className="text-center p-3 rounded-lg bg-muted/50">
              <Icon className="w-5 h-5 mx-auto mb-1 text-muted-foreground" />
              <p className="text-2xl font-semibold">{value}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>

        <Separator />

        {/* Account details */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground flex items-center gap-2">
              <Calendar className="w-4 h-4" /> Member since
            </span>
            <span className="text-sm font-medium">
              {formatDate(profile.date_joined)}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground flex items-center gap-2">
              <Clock className="w-4 h-4" /> Last login
            </span>
            <span className="text-sm font-medium">
              {profile.last_login
                ? formatDateTime(profile.last_login)
                : 'Never'}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground flex items-center gap-2">
              <Shield className="w-4 h-4" /> Two-factor auth
            </span>
            {profile.mfa_enabled ? (
              <Badge variant="default" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                Enabled
              </Badge>
            ) : (
              <Badge variant="secondary">Disabled</Badge>
            )}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground flex items-center gap-2">
              <Mail className="w-4 h-4" /> Email status
            </span>
            {profile.email_verified ? (
              <Badge variant="default" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                Verified
              </Badge>
            ) : (
              <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 border-amber-500/20">
                Unverified
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function GeneralSettings() {
  const queryClient = useQueryClient()

  const { data: profile, isLoading } = useQuery<UserProfile>({
    queryKey: ['user-profile'],
    queryFn: async () => (await api.get('/api/auth/profile/')).data,
  })

  const profileMutation = useMutation({
    mutationFn: async (data: { first_name: string; last_name: string; email: string }) => {
      await api.patch('/api/auth/profile/', data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-profile'] })
      toast.success('Profile updated')
    },
    onError: () => toast.error('Failed to update profile'),
  })

  if (isLoading) {
    return (
      <div className="space-y-4 w-full">
        <div className="h-6 w-32 bg-muted animate-pulse rounded" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-80 bg-muted animate-pulse rounded-lg" />
          <div className="h-80 bg-muted animate-pulse rounded-lg" />
        </div>
      </div>
    )
  }

  if (!profile) return null

  return (
    <div className="space-y-6 w-full">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ProfileCard
          profile={profile}
          onSave={data => profileMutation.mutate(data)}
          isSaving={profileMutation.isPending}
        />
        <AccountActivityCard profile={profile} />
      </div>
    </div>
  )
}
