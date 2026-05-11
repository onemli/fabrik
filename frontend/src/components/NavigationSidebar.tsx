// NavigationSidebar.tsx
//
// Left navigation sidebar with collapsible sections and active-route highlighting.
// Permission-based filtering hides links the current user doesn't have access to.

import { useState, useMemo, useCallback } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import { usePermissions } from '@/hooks/usePermissions'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Library,
  ListChecks,
  Settings,
  ChevronRight,
  Radio,
  FileText,
  BookOpen,
  BookTemplate,
  Pin,
  Users,
  Clock,
  Shield,
  ScrollText,
  Server,
  ShieldCheck,
  Code2,
  User,
  Bell,
  Sparkles,
  Palette,
  Database,
} from 'lucide-react'

interface MenuItem {
  id: string
  label: string
  icon: React.ElementType
  path: string
  // When true, `path` is an absolute URL opened in a new tab via a plain
  // anchor instead of routed through react-router.
  external?: boolean
  children?: MenuItem[]
  adminOnly?: boolean
  featureFlag?: string
}

const menuItems: MenuItem[] = [
  {
    id: 'home',
    label: 'Home',
    icon: LayoutDashboard,
    path: '/',
  },
  {
    id: 'library',
    label: 'Library',
    icon: Library,
    path: '/saved',
    children: [
      {
        id: 'saved-queries',
        label: 'Saved Queries',
        icon: FileText,
        path: '/saved?tab=queries',
      },
      {
        id: 'templates',
        label: 'Templates',
        icon: BookTemplate,
        path: '/saved?tab=templates',
      },
    ],
  },
  {
    id: 'tasks',
    label: 'Task Management',
    icon: ListChecks,
    path: '/tasks',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: Bell,
    path: '/notifications',
  },
  {
    id: 'time-machine',
    label: 'Time Machine',
    icon: Clock,
    path: '/time-machine',
    featureFlag: 'can_use_time_machine',
  },
  {
    id: 'ansible',
    label: 'Ansible',
    icon: Server,
    path: '/awx/templates',
    featureFlag: 'can_use_awx',
    children: [
      {
        id: 'templates',
        label: 'Templates',
        icon: BookTemplate,
        path: '/awx/templates',
      },
      {
        id: 'requests',
        label: 'Requests',
        icon: ListChecks,
        path: '/awx/requests',
      },
      {
        id: 'executions',
        label: 'Executions',
        icon: Clock,
        path: '/awx/executions',
      },
      {
        id: 'validations',
        label: 'Validations',
        icon: ShieldCheck,
        path: '/awx/validation-lists',
        children: [
          {
            id: 'validation-lists',
            label: 'Lists',
            icon: ListChecks,
            path: '/awx/validation-lists',
          },
          {
            id: 'validation-queries',
            label: 'Queries',
            icon: Server,
            path: '/awx/validation-queries',
          },
          {
            id: 'regex-patterns',
            label: 'Regex Patterns',
            icon: Code2,
            path: '/awx/regex-patterns',
          },
        ],
      },
    ],
  },
  {
    id: 'administration',
    label: 'Administration',
    icon: Shield,
    path: '/users',
    adminOnly: true,
    children: [
      {
        id: 'users',
        label: 'User Management',
        icon: Users,
        path: '/users',
      },
      {
        id: 'audit-logs',
        label: 'Audit Logs',
        icon: ScrollText,
        path: '/audit-logs',
      },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    path: '/settings',
    children: [
      {
        id: 'profile',
        label: 'Profile',
        icon: User,
        path: '/settings/general',
      },
      {
        id: 'preferences',
        label: 'Preferences',
        icon: Palette,
        path: '/settings/preferences',
      },
      {
        id: 'apic-connections',
        label: 'APIC Connections',
        icon: Radio,
        path: '/settings/connections',
      },
      {
        id: 'awx-connections',
        label: 'AWX Connections',
        icon: Server,
        path: '/awx-connections',
      },
      {
        id: 'notifications',
        label: 'Notifications',
        icon: Bell,
        path: '/settings/notifications',
      },
      {
        id: 'ai-settings',
        label: 'AI',
        icon: Sparkles,
        path: '/settings/ai',
      },
      {
        id: 'security',
        label: 'Security',
        icon: Shield,
        path: '/settings/security',
      },
      {
        id: 'mim-management',
        label: 'MIM Management',
        icon: Database,
        path: '/settings/mim-management',
        adminOnly: true,
      },
    ],
  },
  {
    id: 'documentation',
    label: 'Documentation',
    icon: BookOpen,
    path: 'https://docs.fabrikops.com/fabrik/',
    external: true,
  },
]

export function NavigationSidebar() {
  const location = useLocation()
  const { isSidebarPinned, setIsSidebarPinned, isSidebarHovered, setIsSidebarHovered } = useQueryBuilderStore()
  const { isAdmin, hasFeature } = usePermissions()
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())

  const isOpen = isSidebarPinned || isSidebarHovered

  // Filter menu items based on permissions and feature flags (memoized).
  // Children are filtered with the same rules so adminOnly works at any depth.
  const visibleMenuItems = useMemo(() => {
    const isVisible = (item: MenuItem) => {
      if (item.adminOnly && !isAdmin) return false
      if (item.featureFlag && !hasFeature(item.featureFlag)) return false
      return true
    }
    const filter = (items: MenuItem[]): MenuItem[] =>
      items.filter(isVisible).map(item => ({
        ...item,
        children: item.children ? filter(item.children) : undefined,
      }))
    return filter(menuItems)
  }, [isAdmin, hasFeature])

  const handleMenuClick = () => {
    if (isSidebarPinned) {
      // If pinned, unpin and close
      setIsSidebarPinned(false)
      setIsSidebarHovered(false)
    } else if (isSidebarHovered) {
      // If temporarily open, pin it
      setIsSidebarPinned(true)
      setIsSidebarHovered(false)
    } else {
      // If closed, open temporarily
      setIsSidebarHovered(true)
    }
  }

  const toggleExpand = useCallback((itemId: string) => {
    setExpandedItems(prev => {
      const newExpanded = new Set(prev)
      if (newExpanded.has(itemId)) {
        newExpanded.delete(itemId)
      } else {
        newExpanded.add(itemId)
      }
      return newExpanded
    })
  }, [])

  const isActive = useCallback((path: string) => {
    if (path === '/') return location.pathname === '/'
    // Match exact path or query-string variants (e.g. /saved?tab=queries)
    const basePath = path.split('?')[0]
    return location.pathname === basePath || location.pathname.startsWith(basePath + '/')
  }, [location.pathname])

  // Check if any child of an item is active (highlights parent)
  const isChildActive = useCallback((item: MenuItem): boolean => {
    if (!item.children) return false
    return item.children.some(child => isActive(child.path) || isChildActive(child))
  }, [isActive])

  const renderMenuItem = (item: MenuItem, depth = 0) => {
    const hasChildren = item.children && item.children.length > 0
    const isExpanded = expandedItems.has(item.id)
    const active = isActive(item.path)
    const parentActive = hasChildren && isChildActive(item)

    const Icon = item.icon

    const commonClasses = cn(
      'w-full flex items-center gap-3 py-2.5 rounded-lg relative',
      'transition-colors duration-200 ease-out',
      depth > 0 ? 'px-3 pl-5' : 'px-3',
      active
        ? 'bg-primary/10 font-medium text-primary'
        : parentActive
          ? 'bg-accent/40 font-medium'
          : 'hover:bg-accent/50 text-muted-foreground hover:text-foreground'
    )

    return (
      <div key={item.id}>
        {/* Main Item */}
        {hasChildren ? (
          <button
            onClick={() => toggleExpand(item.id)}
            className={commonClasses}
          >
            {/* Active indicator bar */}
            {(active || parentActive) && (
              <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-primary" />
            )}

            <Icon className={cn(
              'w-4 h-4 flex-shrink-0 transition-colors duration-200',
              (active || parentActive) ? 'text-primary' : ''
            )} />

            <span
              className={cn(
                'text-sm truncate transition-opacity duration-300',
                isOpen ? 'opacity-100' : 'opacity-0'
              )}
              style={{ width: isOpen ? 'auto' : 0 }}
            >
              {item.label}
            </span>

            {isOpen && (
              <ChevronRight
                className={cn(
                  'w-4 h-4 ml-auto transition-transform duration-200 ease-out',
                  isExpanded && 'rotate-90'
                )}
                style={{ willChange: 'transform' }}
              />
            )}
          </button>
        ) : item.external ? (
          <a
            href={item.path}
            target="_blank"
            rel="noopener noreferrer"
            className={commonClasses}
          >
            <Icon className="w-4 h-4 flex-shrink-0 transition-colors duration-200" />

            <span
              className={cn(
                'text-sm truncate transition-opacity duration-300',
                isOpen ? 'opacity-100' : 'opacity-0'
              )}
              style={{ width: isOpen ? 'auto' : 0 }}
            >
              {item.label}
            </span>
          </a>
        ) : (
          <Link
            to={item.path}
            className={commonClasses}
          >
            {active && (
              <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-primary" />
            )}

            <Icon className={cn(
              'w-4 h-4 flex-shrink-0 transition-colors duration-200',
              active ? 'text-primary' : ''
            )} />

            <span
              className={cn(
                'text-sm truncate transition-opacity duration-300',
                isOpen ? 'opacity-100' : 'opacity-0'
              )}
              style={{ width: isOpen ? 'auto' : 0 }}
            >
              {item.label}
            </span>
          </Link>
        )}

        {/* Children */}
        {hasChildren && isExpanded && isOpen && (
          <div className="mt-1 ml-3 pl-3 space-y-1 border-l border-border/50">
            {item.children!.map((child) => renderMenuItem(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      {/* Sidebar */}
      <aside
        className={cn(
          'fixed left-0 top-16 bottom-0 z-[100] bg-background border-r border-border/50',
          'shadow-lg',
          isOpen ? 'w-64' : 'w-0',
          !isOpen && 'pointer-events-none'
        )}
        style={{
          transition: 'width 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
          willChange: isOpen ? 'auto' : 'width',
        }}
      >
        {/* Sidebar Content */}
        <div
          className={cn(
            'h-full flex flex-col px-3 py-4 overflow-y-auto relative',
            'transition-opacity duration-300',
            isOpen ? 'opacity-100' : 'opacity-0',
            'scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent'
          )}
          style={{ width: '256px' }}
        >
          {/* Pin Button */}
          {isOpen && (
            <div className="flex items-center justify-end px-1 mb-2">
              <button
                onClick={handleMenuClick}
                className={cn(
                  "h-9 w-9 flex items-center justify-center cursor-pointer",
                  "transition-colors duration-200 ease-out",
                  isSidebarPinned
                    ? "text-primary hover:text-primary/70"
                    : "text-muted-foreground hover:text-foreground"
                )}
                title={isSidebarPinned ? "Unpin sidebar" : "Pin sidebar"}
              >
                <Pin
                  className={cn(
                    "w-5 h-5 transition-transform duration-200",
                    isSidebarPinned && "rotate-45"
                  )}
                />
              </button>
            </div>
          )}

          {/* Menu Items */}
          <nav className="space-y-1">
            {visibleMenuItems.map((item) => renderMenuItem(item))}
          </nav>
        </div>
      </aside>

      {/* Overlay - close sidebar when clicking outside (only when not pinned) */}
      {isOpen && !isSidebarPinned && (
        <div
          className="fixed left-0 right-0 top-16 bottom-0 bg-black/20 z-[90]"
          onClick={() => setIsSidebarHovered(false)}
        />
      )}
    </>
  )
}
