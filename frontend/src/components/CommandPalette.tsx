// CommandPalette.tsx
//
// Application-wide command palette (Ctrl+K / Cmd+K). Searches saved queries,
// pages, and actions. Different from the AI palette — this one is for navigation
// and quick-launching queries, not for generating new ones.

import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/store/authStore'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import { apicService } from '@/services/apic'
import { queriesService } from '@/services/queries'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
import { VisuallyHidden } from './ui/visually-hidden'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './ui/command'
import {
  Home,
  Save,
  Settings,
  HelpCircle,
  Radio,
  Search,
  Library,
  Zap,
  FileText,
  Clock,
  Bell,
  Sun,
  Moon,
  Keyboard,
} from 'lucide-react'
import { useThemeStore } from '@/store/themeStore'

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface CommandAction {
  id: string
  label: string
  icon: React.ReactNode
  action: () => void
  keywords?: string[]
  group: 'navigation' | 'queries' | 'templates' | 'connections' | 'actions'
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { setSelectedConnectionId, clearCanvas } = useQueryBuilderStore()
  const { mode, toggleMode } = useThemeStore()
  const [search, setSearch] = useState('')

  // Fetch data for command palette
  const { data: connectionsData } = useQuery({
    queryKey: ['apic-connections'],
    queryFn: () => apicService.getConnections(),
    enabled: !!user && open,
  })

  const { data: savedQueriesData } = useQuery({
    queryKey: ['saved-queries'],
    queryFn: () => queriesService.getSavedQueries(),
    enabled: !!user && open,
  })

  const { data: templatesData } = useQuery({
    queryKey: ['query-templates'],
    queryFn: async () => {
      const allQueries = await queriesService.getSavedQueries()
      return Array.isArray(allQueries) ? allQueries.filter((q: any) => q.is_template) : []
    },
    enabled: !!user && open,
  })

  // Ensure data is always an array
  const connections = Array.isArray(connectionsData) ? connectionsData : []
  const savedQueries = Array.isArray(savedQueriesData) ? savedQueriesData : []
  const templates = Array.isArray(templatesData) ? templatesData : []

  // Generate command actions
  const commands = useMemo<CommandAction[]>(() => {
    const actions: CommandAction[] = []

    // Navigation commands
    actions.push(
      {
        id: 'nav-home',
        label: 'Go to Query Builder',
        icon: <Home className="w-4 h-4" />,
        action: () => {
          navigate('/')
          onOpenChange(false)
        },
        keywords: ['query', 'builder', 'home'],
        group: 'navigation',
      },
      {
        id: 'nav-saved',
        label: 'Go to Saved Queries',
        icon: <Save className="w-4 h-4" />,
        action: () => {
          navigate('/saved')
          onOpenChange(false)
        },
        keywords: ['saved', 'queries'],
        group: 'navigation',
      },
      {
        id: 'nav-settings',
        label: 'Go to Settings',
        icon: <Settings className="w-4 h-4" />,
        action: () => {
          navigate('/settings')
          onOpenChange(false)
        },
        keywords: ['settings', 'configuration'],
        group: 'navigation',
      },
      {
        id: 'nav-awx-templates',
        label: 'Go to AWX Templates',
        icon: <Library className="w-4 h-4" />,
        action: () => {
          navigate('/awx/templates')
          onOpenChange(false)
        },
        keywords: ['awx', 'templates', 'automation', 'ansible'],
        group: 'navigation',
      },
      {
        id: 'nav-awx-requests',
        label: 'Go to AWX Requests',
        icon: <FileText className="w-4 h-4" />,
        action: () => {
          navigate('/awx/requests')
          onOpenChange(false)
        },
        keywords: ['awx', 'requests', 'jobs', 'executions'],
        group: 'navigation',
      },
      {
        id: 'nav-time-machine',
        label: 'Go to Time Machine',
        icon: <Clock className="w-4 h-4" />,
        action: () => {
          navigate('/time-machine')
          onOpenChange(false)
        },
        keywords: ['time', 'machine', 'snapshots', 'drift', 'history'],
        group: 'navigation',
      },
      {
        id: 'nav-notifications',
        label: 'Go to Notifications',
        icon: <Bell className="w-4 h-4" />,
        action: () => {
          navigate('/notifications')
          onOpenChange(false)
        },
        keywords: ['notifications', 'alerts'],
        group: 'navigation',
      },
      {
        id: 'nav-docs',
        label: 'Open Documentation',
        icon: <HelpCircle className="w-4 h-4" />,
        action: () => {
          window.open('https://docs.fabrikops.com/fabrik/', '_blank', 'noopener,noreferrer')
          onOpenChange(false)
        },
        keywords: ['help', 'documentation', 'docs', 'support'],
        group: 'navigation',
      }
    )

    // Connection switching commands
    connections.forEach((conn) => {
      actions.push({
        id: `conn-${conn.id}`,
        label: `Switch to ${conn.name}`,
        icon: <Radio className="w-4 h-4" />,
        action: () => {
          setSelectedConnectionId(conn.id)
          onOpenChange(false)
        },
        keywords: ['connection', 'apic', 'switch', conn.name, conn.url],
        group: 'connections',
      })
    })

    // Recent queries (limit to 5)
    savedQueries.slice(0, 5).forEach((query: any) => {
      actions.push({
        id: `query-${query.id}`,
        label: `Open: ${query.name}`,
        icon: <Search className="w-4 h-4" />,
        action: () => {
          navigate(`/query/${query.id}`)
          onOpenChange(false)
        },
        keywords: ['query', 'open', query.name, query.description].filter(Boolean),
        group: 'queries',
      })
    })

    // Templates (limit to 5)
    templates.slice(0, 5).forEach((template: any) => {
      actions.push({
        id: `template-${template.id}`,
        label: `Use template: ${template.name}`,
        icon: <Library className="w-4 h-4" />,
        action: () => {
          navigate(`/query/${template.id}`)
          onOpenChange(false)
        },
        keywords: ['template', template.name, template.description].filter(Boolean),
        group: 'templates',
      })
    })

    // Quick actions
    actions.push(
      {
        id: 'action-clear-canvas',
        label: 'Clear Canvas',
        icon: <Zap className="w-4 h-4" />,
        action: () => {
          clearCanvas()
          onOpenChange(false)
        },
        keywords: ['clear', 'reset', 'canvas'],
        group: 'actions',
      },
      {
        id: 'action-toggle-theme',
        label: mode === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode',
        icon: mode === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />,
        action: () => {
          toggleMode()
          onOpenChange(false)
        },
        keywords: ['theme', 'dark', 'light', 'mode', 'toggle'],
        group: 'actions',
      },
      {
        id: 'action-keyboard-shortcuts',
        label: 'Keyboard Shortcuts',
        icon: <Keyboard className="w-4 h-4" />,
        action: () => {
          onOpenChange(false)
          // Trigger the keyboard shortcuts dialog via its Ctrl+/ handler
          window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', ctrlKey: true, bubbles: true }))
        },
        keywords: ['keyboard', 'shortcuts', 'hotkeys', 'keys'],
        group: 'actions',
      }
    )

    return actions
  }, [connections, savedQueries, templates, navigate, onOpenChange, setSelectedConnectionId, clearCanvas, mode, toggleMode])

  // Filter commands based on search
  const filteredCommands = useMemo(() => {
    if (!search) return commands

    const searchLower = search.toLowerCase()
    return commands.filter((cmd) => {
      const labelMatch = cmd.label.toLowerCase().includes(searchLower)
      const keywordsMatch = cmd.keywords?.some((kw) => kw && kw.toLowerCase().includes(searchLower))
      return labelMatch || keywordsMatch
    })
  }, [commands, search])

  // Group filtered commands
  const groupedCommands = useMemo(() => {
    const groups: Record<string, CommandAction[]> = {
      navigation: [],
      connections: [],
      queries: [],
      templates: [],
      actions: [],
    }

    filteredCommands.forEach((cmd) => {
      groups[cmd.group].push(cmd)
    })

    return groups
  }, [filteredCommands])

  // Reset search when dialog closes
  useEffect(() => {
    if (!open) {
      setSearch('')
    }
  }, [open])

  const groupLabels: Record<string, string> = {
    navigation: 'Navigation',
    connections: 'APIC Connections',
    queries: 'Recent Queries',
    templates: 'Templates',
    actions: 'Quick Actions',
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 gap-0 max-w-2xl">
        <VisuallyHidden>
          <DialogTitle>Command Palette</DialogTitle>
          <DialogDescription>
            Quick access to navigation, queries, templates, and connections
          </DialogDescription>
        </VisuallyHidden>
        <Command shouldFilter={false} className="rounded-lg border-0">
          <CommandInput
            placeholder="Type a command or search..."
            value={search}
            onValueChange={setSearch}
            className="border-0"
          />
          <CommandList className="max-h-[400px]">
            <CommandEmpty>No results found.</CommandEmpty>

            {Object.entries(groupedCommands).map(([group, items]) => {
              if (items.length === 0) return null

              return (
                <CommandGroup key={group} heading={groupLabels[group]}>
                  {items.map((cmd) => (
                    <CommandItem
                      key={cmd.id}
                      onSelect={() => cmd.action()}
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                    >
                      <div className="flex items-center justify-center w-8 h-8 rounded-md bg-muted">
                        {cmd.icon}
                      </div>
                      <span className="flex-1">{cmd.label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )
            })}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
