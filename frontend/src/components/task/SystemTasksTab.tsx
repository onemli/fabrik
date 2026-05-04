// System tasks tab — shown only to admins. Renders tasks grouped by category
// with pause/resume/execute controls per task.

import {
  Clock,
  PlayCircle,
  PauseCircle,
  History,
  Calendar,
  Activity,
  Shield,
  Database,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { formatDateTime, type UserPreferences } from '@/contexts/TimezoneContext'
import type { ScheduledTask } from './taskConfig'
import { priorityConfig, statusConfig, categoryConfig } from './taskConfig'

type TimezonePreferences = UserPreferences

interface SystemTasksTabProps {
  systemTasks: ScheduledTask[]
  isLoading: boolean
  preferences: TimezonePreferences | null
  onTogglePause: (task: ScheduledTask) => void
  onExecuteNow: (taskId: string) => void
  onViewHistory: (task: ScheduledTask) => void
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm text-muted-foreground">Loading system tasks...</p>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="text-center max-w-md">
        <div className="relative mb-6">
          <div className="absolute inset-0 bg-purple-500/10 blur-3xl rounded-full" />
          <div className="relative w-20 h-20 glass border border-border/20 rounded-full flex items-center justify-center mx-auto">
            <Shield className="w-10 h-10 text-muted-foreground/70" />
          </div>
        </div>
        <h3 className="text-xl font-bold mb-2 text-foreground">No system tasks</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Run the seed command to populate system tasks
        </p>
      </div>
    </div>
  )
}

function TaskCard({
  task,
  preferences,
  onTogglePause,
  onExecuteNow,
  onViewHistory,
}: {
  task: ScheduledTask
  preferences: TimezonePreferences | null
  onTogglePause: (task: ScheduledTask) => void
  onExecuteNow: (taskId: string) => void
  onViewHistory: (task: ScheduledTask) => void
}) {
  const priorityConf = priorityConfig[task.priority]
  const statusConf = statusConfig[task.status]
  const StatusIcon = statusConf.icon

  return (
    <div className="p-6 hover:bg-accent/50 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-3">
          <div className="flex items-center gap-3">
            <h4 className="text-base font-semibold">{task.name}</h4>
            <Badge variant="outline" className={cn('gap-1', statusConf.color)}>
              <StatusIcon className="w-3 h-3" />
              {statusConf.label}
            </Badge>
            <Badge variant="outline" className={priorityConf.color}>
              {priorityConf.label}
            </Badge>
          </div>
          {task.description && (
            <p className="text-sm text-muted-foreground leading-relaxed">
              {task.description}
            </p>
          )}
          <div className="flex items-center gap-6 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <Calendar className="w-3 h-3" />
              <span>{task.schedule_description}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-3 h-3" />
              <span>
                Next run: {task.next_run_at ? formatDateTime(task.next_run_at, preferences || undefined) : 'Not scheduled'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Activity className="w-3 h-3" />
              <span>
                {task.execution_count} runs ({task.success_rate}% success)
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onExecuteNow(task.id)}
            className="gap-2"
          >
            <PlayCircle className="w-4 h-4" />
            Execute Now
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onTogglePause(task)}
            className="gap-2"
          >
            {task.status === 'active' ? (
              <>
                <PauseCircle className="w-4 h-4" />
                Pause
              </>
            ) : (
              <>
                <PlayCircle className="w-4 h-4" />
                Resume
              </>
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onViewHistory(task)}
          >
            <History className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

export function SystemTasksTab({
  systemTasks,
  isLoading,
  preferences,
  onTogglePause,
  onExecuteNow,
  onViewHistory,
}: SystemTasksTabProps) {
  if (isLoading) return <LoadingSpinner />
  if (systemTasks.length === 0) return <EmptyState />

  // Group tasks by category
  const grouped = systemTasks.reduce<Record<string, ScheduledTask[]>>((acc, task) => {
    const category = task.category || 'Uncategorized'
    if (!acc[category]) acc[category] = []
    acc[category].push(task)
    return acc
  }, {})

  return (
    <>
      {Object.entries(grouped).map(([category, categoryTasks]) => {
        const config = categoryConfig[category as keyof typeof categoryConfig]
        const CategoryIcon = config?.icon || Database

        return (
          <div key={category} className="glass border border-border/20 rounded-xl overflow-hidden">
            <div className={cn('px-6 py-4 border-b border-border/20', config?.color || 'bg-gray-500/10')}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg glass border border-border/20 flex items-center justify-center">
                  <CategoryIcon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold">{category}</h3>
                  <p className="text-xs text-muted-foreground">{config?.description || ''}</p>
                </div>
                <Badge variant="outline" className="ml-auto">
                  {categoryTasks.length} {categoryTasks.length === 1 ? 'task' : 'tasks'}
                </Badge>
              </div>
            </div>

            <div className="divide-y divide-border/20">
              {categoryTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  preferences={preferences}
                  onTogglePause={onTogglePause}
                  onExecuteNow={onExecuteNow}
                  onViewHistory={onViewHistory}
                />
              ))}
            </div>
          </div>
        )
      })}
    </>
  )
}
