// admin/LdapTab.tsx
//
// LDAP administration tab — shows server config, connection test, group-to-flag
// mappings, attribute map, and live directory user/group listings.

import { useState, useEffect, useCallback } from 'react'
import {
  Server, Shield, Users, RefreshCw, CheckCircle2, XCircle,
  Loader2, ArrowRightLeft, MapPin, Phone, Briefcase, Building2,
  Info, ChevronDown, ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { authService } from '@/services/auth'
import { useFormatters } from '@/contexts/TimezoneContext'

// --- Types ---

interface LdapServer {
  uri: string
  bind_dn: string
  user_search_base: string
  group_search_base: string
}

interface GroupMapping {
  django_flag: string
  ldap_group: string
  description: string
}

interface LdapStatus {
  enabled: boolean
  message?: string
  server?: LdapServer
  group_mappings?: GroupMapping[]
  attribute_map?: Record<string, string>
  mirror_groups?: boolean
  always_update_user?: boolean
}

interface LdapTestResult {
  success: boolean
  server_uri?: string
  user_count?: number
  group_count?: number
  error?: string
}

interface LdapUser {
  dn: string
  uid: string
  cn: string
  first_name: string
  last_name: string
  email: string
  title: string
  department: string
  employee_id: string
  phone: string
  office: string
  ldap_groups: string[]
  synced_to_django: boolean
  django_last_login: string | null
}

interface LdapGroup {
  dn: string
  cn: string
  description: string
  member_count: number
  members: string[]
  django_flag: string | null
}

// --- API helpers ---

const API_BASE = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '')

async function fetchJson<T>(path: string, method = 'GET'): Promise<T> {
  const token = authService.getAccessToken()
  const res = await fetch(`${API_BASE}/api/auth/ldap${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) throw new Error(`LDAP API error: ${res.status}`)
  return res.json()
}

// --- Flag badge colors ---

function flagBadge(flag: string) {
  switch (flag) {
    case 'is_superuser':
      return <Badge className="bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30 text-[10px]">superuser</Badge>
    case 'is_staff':
      return <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 text-[10px]">staff</Badge>
    case 'is_active':
      return <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-[10px]">active</Badge>
    default:
      return <Badge variant="outline" className="text-[10px]">{flag}</Badge>
  }
}

// --- Main Component ---

export function LdapTab() {
  const { formatDateTime } = useFormatters()
  const [ldapStatus, setLdapStatus] = useState<LdapStatus | null>(null)
  const [testResult, setTestResult] = useState<LdapTestResult | null>(null)
  const [ldapUsers, setLdapUsers] = useState<LdapUser[]>([])
  const [ldapGroups, setLdapGroups] = useState<LdapGroup[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isTesting, setIsTesting] = useState(false)
  const [userSearch, setUserSearch] = useState('')
  const [expandedUser, setExpandedUser] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    setIsLoading(true)
    try {
      const [statusData, usersData, groupsData] = await Promise.all([
        fetchJson<LdapStatus>('/status/'),
        fetchJson<{ users: LdapUser[] }>('/users/').catch(() => ({ users: [] })),
        fetchJson<{ groups: LdapGroup[] }>('/groups/').catch(() => ({ groups: [] })),
      ])
      setLdapStatus(statusData)
      setLdapUsers(usersData.users)
      setLdapGroups(groupsData.groups)
    } catch (err) {
      toast.error('Failed to load LDAP status')
      setLdapStatus({ enabled: false, message: 'Failed to load LDAP configuration.' })
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const handleTestConnection = async () => {
    setIsTesting(true)
    setTestResult(null)
    try {
      const result = await fetchJson<LdapTestResult>('/test/', 'POST')
      setTestResult(result)
      if (result.success) {
        toast.success(`Connected — ${result.user_count} users, ${result.group_count} groups`)
      } else {
        toast.error(result.error || 'Connection failed')
      }
    } catch {
      toast.error('Connection test failed')
      setTestResult({ success: false, error: 'Network error' })
    } finally {
      setIsTesting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // LDAP not enabled
  if (!ldapStatus?.enabled) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
          <Server className="h-8 w-8 text-muted-foreground" />
        </div>
        <div className="text-center">
          <h3 className="text-lg font-medium">LDAP Not Enabled</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-md">
            {ldapStatus?.message || 'Set LDAP_ENABLED=true in .env and restart the backend to enable LDAP authentication.'}
          </p>
        </div>
        <div className="bg-muted/50 rounded-lg p-4 text-xs font-mono max-w-md">
          <p className="text-muted-foreground mb-1"># .env</p>
          <p>LDAP_ENABLED=true</p>
          <p>LDAP_SERVER_URI=ldap://openldap:389</p>
          <p>LDAP_BIND_DN=cn=admin,dc=fabrik,dc=local</p>
          <p>LDAP_BIND_PASSWORD=admin</p>
        </div>
      </div>
    )
  }

  const filteredUsers = ldapUsers.filter(u =>
    !userSearch ||
    u.uid.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.cn.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.email.toLowerCase().includes(userSearch.toLowerCase())
  )

  return (
    <div className="space-y-6">
      {/* Server Configuration Card */}
      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">Server Configuration</h3>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8" onClick={loadAll}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              className="h-8"
              onClick={handleTestConnection}
              disabled={isTesting}
            >
              {isTesting
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Testing...</>
                : 'Test Connection'
              }
            </Button>
          </div>
        </div>

        <div className="p-4 space-y-3">
          {/* Test result banner */}
          {testResult && (
            <div className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm ${
              testResult.success
                ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                : 'bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400'
            }`}>
              {testResult.success
                ? <><CheckCircle2 className="h-4 w-4 flex-shrink-0" /> Connected — {testResult.user_count} users, {testResult.group_count} groups found</>
                : <><XCircle className="h-4 w-4 flex-shrink-0" /> {testResult.error}</>
              }
            </div>
          )}

          {/* Server settings grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <ConfigField label="Server URI" value={ldapStatus.server?.uri} />
            <ConfigField label="Bind DN" value={ldapStatus.server?.bind_dn} />
            <ConfigField label="User Search Base" value={ldapStatus.server?.user_search_base} />
            <ConfigField label="Group Search Base" value={ldapStatus.server?.group_search_base} />
          </div>

          {/* Feature flags */}
          <div className="flex items-center gap-4 pt-2 border-t">
            <FeatureFlag label="Mirror Groups" enabled={ldapStatus.mirror_groups} />
            <FeatureFlag label="Always Update User" enabled={ldapStatus.always_update_user} />
          </div>

          <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-blue-500/5 border border-blue-500/10 text-xs text-blue-600 dark:text-blue-400">
            <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            <span>
              Server settings are configured via environment variables (.env). Changes require a backend restart.
            </span>
          </div>
        </div>
      </div>

      {/* Group Mappings Card */}
      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-2">
          <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Group → Flag Mappings</h3>
          <span className="text-xs text-muted-foreground ml-auto">
            LDAP group membership determines Django user flags
          </span>
        </div>

        <div className="divide-y">
          {ldapStatus.group_mappings?.map((mapping) => {
            const matchingGroup = ldapGroups.find(g => g.dn === mapping.ldap_group)
            return (
              <div key={mapping.django_flag} className="flex items-center gap-4 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <code className="text-xs font-mono text-foreground/80 truncate">
                      {mapping.ldap_group.split(',')[0]}
                    </code>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 ml-6 truncate" title={mapping.ldap_group}>
                    {mapping.ldap_group}
                  </p>
                </div>

                <div className="flex items-center gap-2 text-muted-foreground">
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {flagBadge(mapping.django_flag)}
                    <span className="text-xs text-muted-foreground">{mapping.description}</span>
                  </div>
                  {matchingGroup && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {matchingGroup.member_count} member{matchingGroup.member_count !== 1 ? 's' : ''}:
                      {' '}{matchingGroup.members.join(', ')}
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Attribute Map Card */}
      {ldapStatus.attribute_map && Object.keys(ldapStatus.attribute_map).length > 0 && (
        <div className="bg-card border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">Attribute Mapping</h3>
            <span className="text-xs text-muted-foreground ml-auto">
              LDAP attributes synced to Django user fields on login
            </span>
          </div>

          <div className="p-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {Object.entries(ldapStatus.attribute_map).map(([djangoField, ldapAttr]) => (
                <div key={djangoField} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-muted/30 border text-xs">
                  <code className="font-mono text-foreground/80">{ldapAttr}</code>
                  <ArrowRightLeft className="h-2.5 w-2.5 text-muted-foreground flex-shrink-0" />
                  <code className="font-mono text-primary">{djangoField}</code>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* LDAP Directory — Groups */}
      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-2">
          <Shield className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Directory Groups</h3>
          <Badge variant="outline" className="text-[10px] ml-auto">{ldapGroups.length}</Badge>
        </div>

        <div className="divide-y">
          {ldapGroups.map((group) => (
            <div key={group.dn} className="px-4 py-2.5 flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Shield className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{group.cn}</span>
                  {group.django_flag && flagBadge(group.django_flag)}
                </div>
                {group.description && (
                  <p className="text-xs text-muted-foreground truncate">{group.description}</p>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Users className="h-3.5 w-3.5" />
                <span>{group.member_count}</span>
              </div>
              <div className="flex gap-1">
                {group.members.map(uid => (
                  <Badge key={uid} variant="secondary" className="text-[10px] font-mono">{uid}</Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* LDAP Directory — Users */}
      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">Directory Users</h3>
            <Badge variant="outline" className="text-[10px]">{ldapUsers.length}</Badge>
          </div>
          <div className="w-56">
            <Input
              placeholder="Search users..."
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
        </div>

        <div className="divide-y">
          {filteredUsers.map((user) => {
            const isExpanded = expandedUser === user.uid
            return (
              <div key={user.dn}>
                <div
                  className="px-4 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setExpandedUser(isExpanded ? null : user.uid)}
                >
                  {isExpanded
                    ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  }

                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-medium text-primary">
                      {user.uid.substring(0, 2).toUpperCase()}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{user.cn}</span>
                      <span className="text-xs font-mono text-muted-foreground">({user.uid})</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {user.ldap_groups.map(g => (
                      <Badge key={g} variant="secondary" className="text-[10px]">{g}</Badge>
                    ))}
                  </div>

                  {user.synced_to_django ? (
                    <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-[10px]">
                      Synced
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">
                      Not synced
                    </Badge>
                  )}
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="px-4 pb-3 pt-0 ml-14">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3 rounded-md bg-muted/20 border text-xs">
                      <DetailField icon={Briefcase} label="Title" value={user.title} />
                      <DetailField icon={Building2} label="Department" value={user.department} />
                      <DetailField icon={MapPin} label="Office" value={user.office} />
                      <DetailField icon={Phone} label="Phone" value={user.phone} />
                      <DetailField icon={Users} label="Employee ID" value={user.employee_id} />
                      <DetailField
                        icon={CheckCircle2}
                        label="Last Login"
                        value={user.django_last_login
                          ? formatDateTime(user.django_last_login)
                          : 'Never'
                        }
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1.5 font-mono truncate" title={user.dn}>
                      DN: {user.dn}
                    </p>
                  </div>
                )}
              </div>
            )
          })}

          {filteredUsers.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {userSearch ? 'No matching users' : 'No users in LDAP directory'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// --- Helper components ---

function ConfigField({ label, value }: { label: string; value?: string }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{label}</label>
      <div className="px-3 py-2 rounded-md bg-muted/30 border">
        <code className="text-xs font-mono text-foreground/80">{value || '—'}</code>
      </div>
    </div>
  )
}

function FeatureFlag({ label, enabled }: { label: string; enabled?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={`h-2 w-2 rounded-full ${enabled ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

function DetailField({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  if (!value) return null
  return (
    <div className="flex items-start gap-1.5">
      <Icon className="h-3 w-3 text-muted-foreground mt-0.5 flex-shrink-0" />
      <div>
        <p className="text-[10px] text-muted-foreground">{label}</p>
        <p className="text-xs">{value}</p>
      </div>
    </div>
  )
}
