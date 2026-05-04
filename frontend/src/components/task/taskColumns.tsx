// TanStack Table column definitions for scheduled tasks and executions.
// Extracted from TaskManagement to keep column config independent of page state.

import { ColumnDef } from '@tanstack/react-table'
import {
  Settings,
  Copy,
  History,
  Trash2,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { formatDateTime, type UserPreferences } from '@/contexts/TimezoneContext'
import type { ScheduledTask, ScheduledExecution } from './taskConfig'
import { priorityConfig, statusConfig, executionStatusConfig } from './taskConfig'

// Alias for backward compatibility with earlier call sites.
type TimezonePreferences = UserPreferences

export interface ScheduleColumnHandlers {
  onEdit: (task: ScheduledTask) => void
  onTogglePause: (task: ScheduledTask) => void
  onClone: (taskId: string) => void
  onViewHistory: (task: ScheduledTask) => void
  onDelete: (taskId: string) => void
}

// Shared sortable header builder to avoid repeating the same chevron logic
function SortableHeader({ column, label, centered = false }: {
  column: any
  label: string
  centered?: boolean
}) {
  return (
    <div className={cn('flex flex-col gap-1', centered && 'items-center')}>
      <button
        onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        className={cn(
          'flex items-center gap-1.5 hover:text-foreground transition-colors',
          !centered && 'w-full'
        )}
      >
        {label}
        {column.getIsSorted() === 'asc' ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : column.getIsSorted() === 'desc' ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
        )}
      </button>
    </div>
  )
}

export function getSchedulesColumns(
  handlers: ScheduleColumnHandlers,
  preferences: TimezonePreferences | null,
): ColumnDef<ScheduledTask>[] {
  return [
    {
      accessorKey: 'priority',
      header: ({ column }) => <SortableHeader column={column} label="Priority" centered />,
      cell: ({ row }) => {
        const priorityConf = priorityConfig[row.original.priority]
        return (
          <div className="flex items-center justify-center">
            <Badge variant="outline" className={priorityConf.color}>
              {priorityConf.label}
            </Badge>
          </div>
        )
      },
    },
    {
      accessorKey: 'name',
      header: ({ column }) => <SortableHeader column={column} label="Task Name" />,
      cell: ({ row }) => (
        <div className="font-medium text-sm">{row.original.name}</div>
      ),
    },
    {
      accessorKey: 'query_name',
      header: ({ column }) => <SortableHeader column={column} label="Query" centered />,
      cell: ({ row }) => (
        <div className="flex items-center justify-center text-sm text-muted-foreground">
          {row.original.query_name}
        </div>
      ),
    },
    {
      accessorKey: 'schedule_description',
      header: () => <div className="text-center">Schedule</div>,
      cell: ({ row }) => (
        <div className="flex items-center justify-center text-sm">
          {row.original.schedule_description}
        </div>
      ),
      enableSorting: false,
    },
    {
      accessorKey: 'status',
      header: ({ column }) => <SortableHeader column={column} label="Status" centered />,
      cell: ({ row }) => {
        const statusConf = statusConfig[row.original.status]
        const StatusIcon = statusConf.icon
        return (
          <div className="flex items-center justify-center">
            <Badge variant="outline" className={cn('gap-1', statusConf.color)}>
              <StatusIcon className="w-3 h-3" />
              {statusConf.label}
            </Badge>
          </div>
        )
      },
    },
    {
      accessorKey: 'success_rate',
      header: ({ column }) => <SortableHeader column={column} label="Success Rate" centered />,
      cell: ({ row }) => (
        <div className="flex items-center justify-center">
          <div className="flex items-center gap-2">
            <div className="text-sm font-medium">{row.original.success_rate}%</div>
            <div className="text-xs text-muted-foreground">
              ({row.original.success_count}/{row.original.execution_count})
            </div>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'last_run_at',
      header: ({ column }) => <SortableHeader column={column} label="Last Run" centered />,
      cell: ({ row }) => (
        <div className="flex items-center justify-center text-sm text-muted-foreground">
          {row.original.last_run_at ? formatDateTime(row.original.last_run_at, preferences || undefined) : 'Never'}
        </div>
      ),
    },
    {
      accessorKey: 'next_run_at',
      header: ({ column }) => <SortableHeader column={column} label="Next Run" centered />,
      cell: ({ row }) => (
        <div className="flex items-center justify-center text-sm text-muted-foreground">
          {row.original.next_run_at ? formatDateTime(row.original.next_run_at, preferences || undefined) : '-'}
        </div>
      ),
    },
    {
      id: 'actions',
      header: () => <div className="text-center">Actions</div>,
      cell: ({ row }) => {
        const task = row.original
        return (
          <div className="flex items-center justify-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="sm">
                  <Settings className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handlers.onEdit(task)}>
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handlers.onTogglePause(task)}>
                  {task.status === 'active' ? 'Pause' : 'Resume'}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handlers.onClone(task.id)}>
                  <Copy className="w-4 h-4 mr-2" />
                  Clone
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handlers.onViewHistory(task)}>
                  <History className="w-4 h-4 mr-2" />
                  View History
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handlers.onDelete(task.id)}
                  className="text-destructive"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      },
      enableSorting: false,
    },
  ]
}

export function getExecutionsColumns(
  preferences: TimezonePreferences | null,
): ColumnDef<ScheduledExecution>[] {
  return [
    {
      accessorKey: 'status',
      header: ({ column }) => <SortableHeader column={column} label="Status" centered />,
      cell: ({ row }) => {
        const statusConf = executionStatusConfig[row.original.status]
        const StatusIcon = statusConf.icon
        return (
          <div className="flex items-center justify-center">
            <Badge variant="outline" className={cn('gap-1', statusConf.color)}>
              <StatusIcon className="w-3 h-3" />
              {statusConf.label}
            </Badge>
          </div>
        )
      },
    },
    {
      accessorKey: 'task_name',
      header: ({ column }) => <SortableHeader column={column} label="Task Name" centered />,
      cell: ({ row }) => (
        <div className="flex items-center justify-center font-medium text-sm">
          {row.original.task_name}
        </div>
      ),
    },
    {
      accessorKey: 'apic_connection_name',
      header: ({ column }) => <SortableHeader column={column} label="Connection" centered />,
      cell: ({ row }) => (
        <div className="flex items-center justify-center text-sm text-muted-foreground">
          {row.original.apic_connection_name}
        </div>
      ),
    },
    {
      accessorKey: 'created_at',
      header: ({ column }) => <SortableHeader column={column} label="Execution Time" centered />,
      cell: ({ row }) => (
        <div className="flex items-center justify-center text-sm text-muted-foreground">
          {formatDateTime(row.original.created_at, preferences || undefined)}
        </div>
      ),
    },
    {
      accessorKey: 'duration_seconds',
      header: ({ column }) => <SortableHeader column={column} label="Duration" centered />,
      cell: ({ row }) => (
        <div className="flex items-center justify-center text-sm text-muted-foreground">
          {row.original.duration_seconds ? `${row.original.duration_seconds.toFixed(2)}s` : '-'}
        </div>
      ),
    },
    {
      accessorKey: 'result_count',
      header: ({ column }) => <SortableHeader column={column} label="Results" centered />,
      cell: ({ row }) => (
        <div className="flex items-center justify-center text-sm">
          {row.original.result_count !== undefined ? `${row.original.result_count} items` : '-'}
        </div>
      ),
    },
    {
      id: 'is_retry',
      accessorKey: 'is_retry',
      header: () => <div className="text-center">Retry</div>,
      cell: ({ row }) => (
        <div className="flex items-center justify-center">
          {row.original.is_retry && (
            <Badge variant="outline" className="text-xs">
              Retry #{row.original.retry_attempt}
            </Badge>
          )}
        </div>
      ),
      enableSorting: false,
    },
  ]
}
