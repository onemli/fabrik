// Breadcrumbs.tsx
//
// Dynamic breadcrumb bar derived from the current URL path. Mapped manually
// rather than generated automatically so we can use human-readable labels
// instead of raw route segments.

import { useNavigate, useLocation } from 'react-router-dom'
import {
  ChevronRight, ChevronDown,
  Home, Folder, ListTodo, Bell,
  Settings as SettingsIcon, Network, Users, Shield,
  Clock, History, Database, Workflow, Package, FolderKanban,
  CheckSquare, FileText, Activity, Radio, Sliders,
  ShieldCheck, Server,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// ── Child item definitions (no JSX at module level) ─────────────────────────
interface BreadcrumbChild {
  label: string
  path: string
  Icon?: React.ElementType
}

interface BreadcrumbItem {
  label: string
  path?: string
  icon?: React.ReactNode
  children?: BreadcrumbChild[]
}

// Menu children — mirror NavigationSidebar menuItems
const ANSIBLE_CHILDREN: BreadcrumbChild[] = [
  { label: 'Templates',         path: '/awx/templates',         Icon: Package },
  { label: 'Requests',          path: '/awx/requests',          Icon: Activity },
  { label: 'Executions',        path: '/awx/executions',        Icon: Activity },
  { label: 'Categories',        path: '/awx/categories',        Icon: FolderKanban },
  { label: 'Validation Lists',  path: '/awx/validation-lists',  Icon: ShieldCheck },
  { label: 'Validation Queries',path: '/awx/validation-queries',Icon: CheckSquare },
  { label: 'Regex Patterns',   path: '/awx/regex-patterns',    Icon: CheckSquare },
]

const SETTINGS_CHILDREN: BreadcrumbChild[] = [
  { label: 'General',           path: '/settings/general',       Icon: SettingsIcon },
  { label: 'Preferences',       path: '/settings/preferences',   Icon: Sliders },
  { label: 'APIC Connections',  path: '/settings/connections',   Icon: Radio },
  { label: 'Notifications',     path: '/settings/notifications', Icon: Bell },
  { label: 'AI',                path: '/settings/ai',            Icon: Server },
  { label: 'Security',          path: '/settings/security',      Icon: Shield },
  { label: 'MIM Management',    path: '/settings/mim-management',Icon: Database },
]

const TIME_MACHINE_CHILDREN: BreadcrumbChild[] = [
  { label: 'Overview', path: '/time-machine',          Icon: Clock },
  { label: 'Settings', path: '/time-machine/settings', Icon: SettingsIcon },
]

// ── Helpers ──────────────────────────────────────────────────────────────────
function ansiblCrumb(withPath = true): BreadcrumbItem {
  return {
    label: 'Ansible',
    path: withPath ? '/awx/templates' : undefined,
    icon: <Workflow className="w-3.5 h-3.5" />,
    children: ANSIBLE_CHILDREN,
  }
}

export function Breadcrumbs() {
  const navigate  = useNavigate()
  const location  = useLocation()

  const getBreadcrumbs = (): BreadcrumbItem[] => {
    const path = location.pathname
    const isTimeMachinePage = path.startsWith('/time-machine')

    const breadcrumbs: BreadcrumbItem[] = isTimeMachinePage
      ? []
      : [{ label: 'Home', path: '/', icon: <Home className="w-3.5 h-3.5" /> }]

    if (path === '/saved') {
      breadcrumbs.push({ label: 'Library', icon: <Folder className="w-3.5 h-3.5" /> })
    } else if (path === '/tasks') {
      breadcrumbs.push({ label: 'Task Management', icon: <ListTodo className="w-3.5 h-3.5" /> })
    } else if (path === '/notifications') {
      breadcrumbs.push({ label: 'Notifications', icon: <Bell className="w-3.5 h-3.5" /> })
    } else if (path.startsWith('/settings')) {
      const SUB_LABELS: Record<string, string> = {
        general:          'General',
        preferences:      'Preferences',
        connections:      'APIC Connections',
        notifications:    'Notifications',
        ai:               'AI',
        security:         'Security',
        'mim-management': 'MIM Management',
      }
      const sub = path.replace('/settings/', '')
      const [primarySub] = sub.split('/')
      const subLabel = SUB_LABELS[primarySub]

      if (subLabel) {
        // Sub-page: Settings (dropdown) > Sub
        breadcrumbs.push({
          label: 'Settings',
          path: '/settings/general',
          icon: <SettingsIcon className="w-3.5 h-3.5" />,
          children: SETTINGS_CHILDREN,
        })
        breadcrumbs.push({ label: subLabel })
      } else {
        // /settings exact — just the parent with dropdown
        breadcrumbs.push({
          label: 'Settings',
          icon: <SettingsIcon className="w-3.5 h-3.5" />,
          children: SETTINGS_CHILDREN,
        })
      }
    } else if (path === '/apic-connections') {
      breadcrumbs.push({ label: 'APIC Connections', icon: <Network className="w-3.5 h-3.5" /> })
    } else if (path === '/users') {
      breadcrumbs.push({ label: 'User Management', icon: <Users className="w-3.5 h-3.5" /> })
    } else if (path === '/audit-logs') {
      breadcrumbs.push({ label: 'Audit Logs', icon: <Shield className="w-3.5 h-3.5" /> })

    // ── Time Machine ─────────────────────────────────────────────────────────
    } else if (path === '/time-machine') {
      breadcrumbs.push({
        label: 'Time Machine',
        icon: <Clock className="w-3.5 h-3.5" />,
        children: TIME_MACHINE_CHILDREN,
      })
    } else if (path === '/time-machine/settings') {
      breadcrumbs.push({
        label: 'Time Machine',
        path: '/time-machine',
        icon: <Clock className="w-3.5 h-3.5" />,
        children: TIME_MACHINE_CHILDREN,
      })
      breadcrumbs.push({ label: 'Settings', icon: <SettingsIcon className="w-3.5 h-3.5" /> })
    } else if (path.startsWith('/time-machine/query/')) {
      breadcrumbs.push({
        label: 'Time Machine',
        path: '/time-machine',
        icon: <Clock className="w-3.5 h-3.5" />,
        children: TIME_MACHINE_CHILDREN,
      })
      breadcrumbs.push({ label: 'Query Details', icon: <History className="w-3.5 h-3.5" /> })
    } else if (path.startsWith('/time-machine/class/')) {
      breadcrumbs.push({
        label: 'Time Machine',
        path: '/time-machine',
        icon: <Clock className="w-3.5 h-3.5" />,
        children: TIME_MACHINE_CHILDREN,
      })
      breadcrumbs.push({ label: 'Query Details', icon: <History className="w-3.5 h-3.5" /> })
    } else if (path.startsWith('/time-machine/snapshot/')) {
      breadcrumbs.push({
        label: 'Time Machine',
        path: '/time-machine',
        icon: <Clock className="w-3.5 h-3.5" />,
        children: TIME_MACHINE_CHILDREN,
      })
      breadcrumbs.push({ label: 'Snapshot Details', icon: <History className="w-3.5 h-3.5" /> })
    } else if (path.startsWith('/time-machine/compare/')) {
      breadcrumbs.push({
        label: 'Time Machine',
        path: '/time-machine',
        icon: <Clock className="w-3.5 h-3.5" />,
        children: TIME_MACHINE_CHILDREN,
      })
      breadcrumbs.push({ label: 'Comparison', icon: <History className="w-3.5 h-3.5" /> })

    // ── Query Builder ─────────────────────────────────────────────────────────
    } else if (path.startsWith('/builder')) {
      if (path.endsWith('/results')) {
        breadcrumbs.push({ label: 'Query Builder', path: '/builder', icon: <Workflow className="w-3.5 h-3.5" /> })
        breadcrumbs.push({ label: 'Execution Results', icon: <Database className="w-3.5 h-3.5" /> })
      } else {
        breadcrumbs.push({ label: 'Query Builder', icon: <Workflow className="w-3.5 h-3.5" /> })
      }

    } else if (path === '/help') {
      breadcrumbs.push({ label: 'Help & Documentation' })

    // ── AWX / Ansible ─────────────────────────────────────────────────────────
    } else if (path === '/awx-connections') {
      breadcrumbs.push({ label: 'AWX Connections', icon: <Workflow className="w-3.5 h-3.5" /> })
    } else if (path === '/awx/templates') {
      breadcrumbs.push(ansiblCrumb())
      breadcrumbs.push({ label: 'Templates', icon: <Package className="w-3.5 h-3.5" /> })
    } else if (path === '/awx/templates/create') {
      breadcrumbs.push(ansiblCrumb())
      breadcrumbs.push({ label: 'Templates', path: '/awx/templates', icon: <Package className="w-3.5 h-3.5" /> })
      breadcrumbs.push({ label: 'Create Template', icon: <FileText className="w-3.5 h-3.5" /> })
    } else if (path.startsWith('/awx/templates/') && path.includes('/edit')) {
      breadcrumbs.push(ansiblCrumb())
      breadcrumbs.push({ label: 'Templates', path: '/awx/templates', icon: <Package className="w-3.5 h-3.5" /> })
      breadcrumbs.push({ label: 'Edit Template', icon: <FileText className="w-3.5 h-3.5" /> })
    } else if (path.startsWith('/awx/templates/') && path.includes('/create-request')) {
      breadcrumbs.push(ansiblCrumb())
      breadcrumbs.push({ label: 'Templates', path: '/awx/templates', icon: <Package className="w-3.5 h-3.5" /> })
      breadcrumbs.push({ label: 'Create Request', icon: <FileText className="w-3.5 h-3.5" /> })
    } else if (path === '/awx/categories') {
      breadcrumbs.push(ansiblCrumb())
      breadcrumbs.push({ label: 'Categories', icon: <FolderKanban className="w-3.5 h-3.5" /> })
    } else if (path === '/awx/validation-lists') {
      breadcrumbs.push(ansiblCrumb())
      breadcrumbs.push({ label: 'Validation Lists', icon: <CheckSquare className="w-3.5 h-3.5" /> })
    } else if (path === '/awx/validation-queries') {
      breadcrumbs.push(ansiblCrumb())
      breadcrumbs.push({ label: 'Validation Queries', icon: <CheckSquare className="w-3.5 h-3.5" /> })
    } else if (path === '/awx/regex-patterns') {
      breadcrumbs.push(ansiblCrumb())
      breadcrumbs.push({ label: 'Regex Patterns', icon: <CheckSquare className="w-3.5 h-3.5" /> })
    } else if (path === '/awx/requests') {
      breadcrumbs.push(ansiblCrumb())
      breadcrumbs.push({ label: 'Requests', icon: <Activity className="w-3.5 h-3.5" /> })
    } else if (path.startsWith('/awx/requests/')) {
      const requestId = path.split('/awx/requests/')[1]?.replace(/\/$/, '')
      const shortId = requestId ? `#${requestId.slice(0, 8)}` : ''
      breadcrumbs.push(ansiblCrumb())
      breadcrumbs.push({ label: 'Requests', path: '/awx/requests', icon: <Activity className="w-3.5 h-3.5" /> })
      breadcrumbs.push({ label: `Request ${shortId}`, icon: <FileText className="w-3.5 h-3.5" /> })
    } else if (path === '/awx/executions') {
      breadcrumbs.push(ansiblCrumb())
      breadcrumbs.push({ label: 'Executions', icon: <Activity className="w-3.5 h-3.5" /> })
    }

    return breadcrumbs
  }

  const breadcrumbs = getBreadcrumbs()

  return (
    <div className="border-b border-border bg-background/95 backdrop-blur-sm sticky top-0 z-40">
      <div className="h-11 flex items-center px-6">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
          {breadcrumbs.map((crumb, index) => (
            <div key={index} className="flex items-center gap-1.5">
              {index > 0 && (
                <ChevronRight
                  className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0"
                  aria-hidden="true"
                />
              )}

              {/* ── Crumb with dropdown children ────────────────────────── */}
              {crumb.children && crumb.children.length > 0 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors duration-200 font-medium rounded-md px-2 py-1 -mx-2 hover:bg-accent/50 group"
                      aria-label={`${crumb.label} menu`}
                    >
                      {crumb.icon && <span aria-hidden="true">{crumb.icon}</span>}
                      <span className="truncate max-w-[200px]">{crumb.label}</span>
                      <ChevronDown className="w-3 h-3 opacity-50 group-data-[state=open]:rotate-180 transition-transform duration-150" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-[180px]">
                    {crumb.children.map(child => (
                      <DropdownMenuItem
                        key={child.path}
                        onClick={() => navigate(child.path)}
                        className="flex items-center gap-2 cursor-pointer"
                      >
                        {child.Icon && (
                          <child.Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        )}
                        {child.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

              /* ── Clickable crumb (no dropdown) ──────────────────────── */
              ) : crumb.path ? (
                <button
                  onClick={() => navigate(crumb.path!)}
                  className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors duration-200 font-medium rounded-md px-2 py-1 -mx-2 hover:bg-accent/50"
                  aria-label={`Navigate to ${crumb.label}`}
                >
                  {crumb.icon && <span aria-hidden="true">{crumb.icon}</span>}
                  <span className="truncate max-w-[200px]">{crumb.label}</span>
                </button>

              /* ── Current page (static) ──────────────────────────────── */
              ) : (
                <span
                  className="flex items-center gap-1.5 text-foreground font-semibold px-2 py-1 -mx-2"
                  aria-current="page"
                >
                  {crumb.icon && <span aria-hidden="true">{crumb.icon}</span>}
                  <span className="truncate max-w-[200px]">{crumb.label}</span>
                </span>
              )}
            </div>
          ))}
        </nav>
      </div>
    </div>
  )
}
