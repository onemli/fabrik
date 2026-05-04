// admin/LdapTab.test.tsx
//
// Tests for the LDAP administration tab — verifies loading states, disabled
// state, server config display, group mappings, user listing, search, and
// connection test interactions.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LdapTab } from './LdapTab'

vi.mock('@/services/auth', () => ({
  authService: {
    getAccessToken: vi.fn(() => 'mock-token'),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/contexts/TimezoneContext', () => ({
  useTimezone: () => ({
    preferences: { display_timezone: 'UTC', date_format: 'DD/MM/YYYY', time_format: '24h' },
  }),
  formatDate: (date: any) => date ? String(date) : '—',
  formatTime: (date: any) => date ? String(date) : '—',
  formatDateTime: (date: any) => date ? String(date) : '—',
  useFormatters: () => ({
    formatDate: (date: any) => date ? String(date) : '—',
    formatTime: (date: any) => date ? String(date) : '—',
    formatDateTime: (date: any) => date ? String(date) : '—',
  }),
}))

// --- Mock data ---

const mockStatus = {
  enabled: true,
  server: {
    uri: 'ldap://openldap:389',
    bind_dn: 'cn=admin,dc=fabrik,dc=local',
    user_search_base: 'ou=users,dc=fabrik,dc=local',
    group_search_base: 'ou=groups,dc=fabrik,dc=local',
  },
  group_mappings: [
    {
      django_flag: 'is_active',
      ldap_group: 'cn=active,ou=groups,dc=fabrik,dc=local',
      description: 'User can log in',
    },
    {
      django_flag: 'is_superuser',
      ldap_group: 'cn=admins,ou=groups,dc=fabrik,dc=local',
      description: 'User has all permissions (full admin)',
    },
  ],
  attribute_map: {
    first_name: 'givenName',
    last_name: 'sn',
    email: 'mail',
  },
  mirror_groups: true,
  always_update_user: false,
}

const mockUsers = {
  users: [
    {
      dn: 'uid=netadmin,ou=users,dc=fabrik,dc=local',
      uid: 'netadmin',
      cn: 'Network Administrator',
      first_name: 'Network',
      last_name: 'Administrator',
      email: 'netadmin@fabrik.local',
      title: 'Senior Network Engineer',
      department: 'Network Operations',
      employee_id: 'EMP-001',
      phone: '+90 555 100 0001',
      office: 'Istanbul DC-1',
      ldap_groups: ['active', 'staff', 'admins'],
      synced_to_django: true,
      django_last_login: '2026-04-02T10:17:29Z',
    },
    {
      dn: 'uid=viewer,ou=users,dc=fabrik,dc=local',
      uid: 'viewer',
      cn: 'Read Only Viewer',
      first_name: 'Read Only',
      last_name: 'Viewer',
      email: 'viewer@fabrik.local',
      title: 'NOC Analyst',
      department: 'NOC',
      employee_id: 'EMP-003',
      phone: '+90 555 100 0003',
      office: 'Ankara NOC',
      ldap_groups: ['active'],
      synced_to_django: false,
      django_last_login: null,
    },
  ],
}

const mockGroups = {
  groups: [
    {
      dn: 'cn=active,ou=groups,dc=fabrik,dc=local',
      cn: 'active',
      description: 'Active users',
      member_count: 3,
      members: ['netadmin', 'netops', 'viewer'],
      django_flag: 'is_active',
    },
    {
      dn: 'cn=admins,ou=groups,dc=fabrik,dc=local',
      cn: 'admins',
      description: 'Admin users',
      member_count: 1,
      members: ['netadmin'],
      django_flag: 'is_superuser',
    },
  ],
}

// --- Helpers ---

function mockFetchResponses(overrides: Record<string, any> = {}) {
  const responses: Record<string, any> = {
    '/status/': mockStatus,
    '/users/': mockUsers,
    '/groups/': mockGroups,
    ...overrides,
  }

  vi.stubGlobal('fetch', vi.fn((url: string) => {
    for (const [path, data] of Object.entries(responses)) {
      if (url.includes(`/ldap${path}`)) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(data),
        })
      }
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  }))
}

describe('LdapTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows loading spinner initially', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    render(<LdapTab />)
    // Spinner is rendered (Loader2 animating)
    const spinner = document.querySelector('.animate-spin')
    expect(spinner).toBeTruthy()
  })

  it('shows disabled state when LDAP is off', async () => {
    mockFetchResponses({
      '/status/': { enabled: false, message: 'LDAP is not enabled. Set LDAP_ENABLED=true in .env and restart.' },
      '/users/': { users: [] },
      '/groups/': { groups: [] },
    })

    render(<LdapTab />)

    await waitFor(() => {
      expect(screen.getByText('LDAP Not Enabled')).toBeInTheDocument()
    })
    expect(screen.getAllByText(/LDAP_ENABLED=true/).length).toBeGreaterThanOrEqual(1)
  })

  it('displays server configuration when LDAP is enabled', async () => {
    mockFetchResponses()
    render(<LdapTab />)

    await waitFor(() => {
      expect(screen.getByText('Server Configuration')).toBeInTheDocument()
    })
    expect(screen.getByText('ldap://openldap:389')).toBeInTheDocument()
    expect(screen.getByText('cn=admin,dc=fabrik,dc=local')).toBeInTheDocument()
    expect(screen.getByText('ou=users,dc=fabrik,dc=local')).toBeInTheDocument()
    expect(screen.getByText('ou=groups,dc=fabrik,dc=local')).toBeInTheDocument()
  })

  it('displays feature flags', async () => {
    mockFetchResponses()
    render(<LdapTab />)

    await waitFor(() => {
      expect(screen.getByText('Mirror Groups')).toBeInTheDocument()
    })
    expect(screen.getByText('Always Update User')).toBeInTheDocument()
  })

  it('displays group-to-flag mappings', async () => {
    mockFetchResponses()
    render(<LdapTab />)

    await waitFor(() => {
      expect(screen.getByText(/Group.*Flag Mappings/)).toBeInTheDocument()
    })
    expect(screen.getByText('User can log in')).toBeInTheDocument()
    expect(screen.getByText('User has all permissions (full admin)')).toBeInTheDocument()
  })

  it('displays attribute mapping', async () => {
    mockFetchResponses()
    render(<LdapTab />)

    await waitFor(() => {
      expect(screen.getByText('Attribute Mapping')).toBeInTheDocument()
    })
    expect(screen.getByText('givenName')).toBeInTheDocument()
    expect(screen.getByText('first_name')).toBeInTheDocument()
  })

  it('displays directory groups with member counts', async () => {
    mockFetchResponses()
    render(<LdapTab />)

    await waitFor(() => {
      expect(screen.getByText('Directory Groups')).toBeInTheDocument()
    })
    // "active" appears both as a group name and as a flag badge — use getAllBy
    expect(screen.getAllByText('active').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('admins').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Active users')).toBeInTheDocument()
  })

  it('displays directory users with sync status', async () => {
    mockFetchResponses()
    render(<LdapTab />)

    await waitFor(() => {
      expect(screen.getByText('Network Administrator')).toBeInTheDocument()
    })
    expect(screen.getByText('(netadmin)')).toBeInTheDocument()
    expect(screen.getByText('Read Only Viewer')).toBeInTheDocument()
    expect(screen.getByText('(viewer)')).toBeInTheDocument()

    // Sync badges
    expect(screen.getByText('Synced')).toBeInTheDocument()
    expect(screen.getByText('Not synced')).toBeInTheDocument()
  })

  it('filters users by search term', async () => {
    mockFetchResponses()
    render(<LdapTab />)

    await waitFor(() => {
      expect(screen.getByText('Network Administrator')).toBeInTheDocument()
    })

    const searchInput = screen.getByPlaceholderText('Search users...')
    await userEvent.type(searchInput, 'viewer')

    expect(screen.getByText('Read Only Viewer')).toBeInTheDocument()
    expect(screen.queryByText('Network Administrator')).not.toBeInTheDocument()
  })

  it('expands user details on click', async () => {
    mockFetchResponses()
    render(<LdapTab />)

    await waitFor(() => {
      expect(screen.getByText('Network Administrator')).toBeInTheDocument()
    })

    // Click on user row to expand
    fireEvent.click(screen.getByText('Network Administrator'))

    await waitFor(() => {
      expect(screen.getByText('Senior Network Engineer')).toBeInTheDocument()
    })
    expect(screen.getByText('Network Operations')).toBeInTheDocument()
    expect(screen.getByText('Istanbul DC-1')).toBeInTheDocument()
    expect(screen.getByText('EMP-001')).toBeInTheDocument()
  })

  it('runs connection test and shows success', async () => {
    const testResult = {
      success: true,
      server_uri: 'ldap://openldap:389',
      user_count: 3,
      group_count: 3,
    }

    // First load normal, then test endpoint responds
    const fetchMock = vi.fn((url: string, options?: any) => {
      if (url.includes('/ldap/test/') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(testResult),
        })
      }
      if (url.includes('/ldap/status/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockStatus),
        })
      }
      if (url.includes('/ldap/users/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockUsers),
        })
      }
      if (url.includes('/ldap/groups/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockGroups),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<LdapTab />)

    const testButton = await screen.findByRole('button', { name: /test connection/i })
    fireEvent.click(testButton)

    await waitFor(() => {
      expect(screen.getByText(/Connected/)).toBeInTheDocument()
    })
    expect(screen.getByText(/3 users, 3 groups/)).toBeInTheDocument()
  })

  it('runs connection test and shows failure', async () => {
    const fetchMock = vi.fn((url: string, options?: any) => {
      if (url.includes('/ldap/test/') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: false, error: 'Connection refused' }),
        })
      }
      if (url.includes('/ldap/status/')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockStatus) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ users: [], groups: [] }) })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<LdapTab />)

    const testButton = await screen.findByRole('button', { name: /test connection/i })
    fireEvent.click(testButton)

    await waitFor(() => {
      expect(screen.getByText('Connection refused')).toBeInTheDocument()
    })
  })

  it('shows empty state when no users in directory', async () => {
    mockFetchResponses({ '/users/': { users: [] } })
    render(<LdapTab />)

    await waitFor(() => {
      expect(screen.getByText('No users in LDAP directory')).toBeInTheDocument()
    })
  })

  it('shows search empty state when no matches', async () => {
    mockFetchResponses()
    render(<LdapTab />)

    await waitFor(() => {
      expect(screen.getByText('Network Administrator')).toBeInTheDocument()
    })

    const searchInput = screen.getByPlaceholderText('Search users...')
    await userEvent.type(searchInput, 'nonexistentuser')

    expect(screen.getByText('No matching users')).toBeInTheDocument()
  })
})
