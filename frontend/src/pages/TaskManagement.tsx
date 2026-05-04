// TaskManagement.tsx
//
// Scheduled task manager — shows all tasks the current user has configured,
// plus platform system tasks visible to admins. Users can create/edit/delete
// their own tasks; system tasks are read-mostly (status and priority only).

import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Calendar,
  History,
  PlayCircle,
  Activity,
  Target,
  Shield,
  Settings,
  Save,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { api } from '@/services/api'
import {
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { cn } from '@/lib/utils'
import { TaskFormDialog } from '@/components/TaskFormDialog'
import { ExecutionHistoryDialog } from '@/components/ExecutionHistoryDialog'
import { useTimezone } from '@/contexts/TimezoneContext'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useTaskManagement } from '@/hooks/useTaskManagement'
import { getSchedulesColumns, getExecutionsColumns } from '@/components/task/taskColumns'
import { SystemTasksTab } from '@/components/task/SystemTasksTab'
import { DataTableTab } from '@/components/task/DataTableTab'

interface TaskDefaults {
  id?: number
  default_retry_count: number
  default_retry_interval_minutes: number
  default_log_retention_days: number
  email_enabled: boolean
  email_from_address: string
}

const TASK_DEFAULTS: TaskDefaults = {
  default_retry_count: 3,
  default_retry_interval_minutes: 5,
  default_log_retention_days: 30,
  email_enabled: false,
  email_from_address: '',
}

export default function TaskManagement() {
  const { preferences } = useTimezone()
  const tm = useTaskManagement()
  const queryClient = useQueryClient()

  // Task defaults dialog
  const [showDefaults, setShowDefaults] = useState(false)
  const [defaultsForm, setDefaultsForm] = useState<TaskDefaults>(TASK_DEFAULTS)

  const { data: taskSettings } = useQuery<TaskDefaults[]>({
    queryKey: ['task-settings'],
    queryFn: async () => (await api.get('/api/queries/task-settings/')).data,
  })

  const defaultsMutation = useMutation({
    mutationFn: async (data: TaskDefaults) => {
      const id = taskSettings?.[0]?.id || 1
      await api.put(`/api/queries/task-settings/${id}/`, data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-settings'] })
      toast.success('Task defaults saved')
      setShowDefaults(false)
    },
    onError: () => toast.error('Failed to save defaults'),
  })

  useEffect(() => {
    if (taskSettings?.length) setDefaultsForm(taskSettings[0])
  }, [taskSettings])

  // TanStack Table state for schedules
  const [schedulesSorting, setSchedulesSorting] = useState<SortingState>([])
  const [schedulesColumnFilters, setSchedulesColumnFilters] = useState<ColumnFiltersState>([])
  const [schedulesColumnVisibility, setSchedulesColumnVisibility] = useState<VisibilityState>({})
  const [schedulesGlobalFilter, setSchedulesGlobalFilter] = useState('')

  // TanStack Table state for executions
  const [executionsSorting, setExecutionsSorting] = useState<SortingState>([{ id: 'created_at', desc: true }])
  const [executionsColumnFilters, setExecutionsColumnFilters] = useState<ColumnFiltersState>([])
  const [executionsColumnVisibility, setExecutionsColumnVisibility] = useState<VisibilityState>({})
  const [executionsGlobalFilter, setExecutionsGlobalFilter] = useState('')

  const schedulesColumns = useMemo(() => getSchedulesColumns({
    onEdit: tm.handleEdit,
    onTogglePause: tm.handleTogglePause,
    onClone: tm.handleClone,
    onViewHistory: tm.handleViewHistory,
    onDelete: tm.handleDelete,
  }, preferences), [preferences, tm.handleEdit, tm.handleTogglePause, tm.handleClone, tm.handleViewHistory, tm.handleDelete])

  const executionsColumns = useMemo(
    () => getExecutionsColumns(preferences),
    [preferences],
  )

  const schedulesTable = useReactTable({
    data: tm.tasks,
    columns: schedulesColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSchedulesSorting,
    onColumnFiltersChange: setSchedulesColumnFilters,
    onColumnVisibilityChange: setSchedulesColumnVisibility,
    onGlobalFilterChange: setSchedulesGlobalFilter,
    state: {
      sorting: schedulesSorting,
      columnFilters: schedulesColumnFilters,
      columnVisibility: schedulesColumnVisibility,
      globalFilter: schedulesGlobalFilter,
    },
    initialState: { pagination: { pageSize: 20 } },
  })

  const executionsTable = useReactTable({
    data: tm.executions,
    columns: executionsColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setExecutionsSorting,
    onColumnFiltersChange: setExecutionsColumnFilters,
    onColumnVisibilityChange: setExecutionsColumnVisibility,
    onGlobalFilterChange: setExecutionsGlobalFilter,
    state: {
      sorting: executionsSorting,
      columnFilters: executionsColumnFilters,
      columnVisibility: executionsColumnVisibility,
      globalFilter: executionsGlobalFilter,
    },
    initialState: { pagination: { pageSize: 20 } },
  })

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="border-b border-border/30 flex-shrink-0">
        <div className="px-8 py-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight mb-2 text-foreground">Task Management</h1>
              <p className="text-sm text-muted-foreground">
                Automate query executions with scheduled tasks and monitor performance
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowDefaults(!showDefaults)}
                title="Task Defaults"
                className={cn(showDefaults && 'bg-accent')}
              >
                <Settings className="w-4 h-4" />
              </Button>
              <Button
                onClick={() => tm.setCreateDialogOpen(true)}
                size="lg"
                className="gap-2 bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all hover:scale-[1.02]"
              >
                <Plus className="w-4 h-4" />
                New Scheduled Task
              </Button>
            </div>
          </div>

          {/* Stats Dashboard */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="group glass border rounded-xl p-5 hover:border-primary/30 hover:bg-accent/50 transition-all duration-200 hover-lift">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-muted-foreground">Total Tasks</span>
                <Calendar className="w-5 h-5 text-primary group-hover:scale-110 transition-transform" />
              </div>
              <div className="text-2xl font-bold text-foreground">{tm.stats.totalTasks}</div>
              <p className="text-xs text-muted-foreground mt-1">Scheduled tasks</p>
            </div>

            <div className="group glass border rounded-xl p-5 hover:border-emerald-500/30 hover:bg-accent/50 transition-all duration-200 hover-lift">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-muted-foreground">Active Tasks</span>
                <PlayCircle className="w-5 h-5 text-emerald-400 group-hover:scale-110 transition-transform" />
              </div>
              <div className="text-2xl font-bold text-foreground">{tm.stats.activeTasks}</div>
              <p className="text-xs text-muted-foreground mt-1">Currently running</p>
            </div>

            <div className="group glass border rounded-xl p-5 hover:border-blue-500/30 hover:bg-accent/50 transition-all duration-200 hover-lift">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-muted-foreground">Total Executions</span>
                <Activity className="w-5 h-5 text-blue-400 group-hover:scale-110 transition-transform" />
              </div>
              <div className="text-2xl font-bold text-foreground">{tm.stats.totalExecutions.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground mt-1">All time runs</p>
            </div>

            <div className="group glass border rounded-xl p-5 hover:border-emerald-500/30 hover:bg-accent/50 transition-all duration-200 hover-lift">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-muted-foreground">Success Rate</span>
                <Target className="w-5 h-5 text-emerald-400 group-hover:scale-110 transition-transform" />
              </div>
              <div className="text-2xl font-bold text-foreground">{tm.stats.avgSuccessRate}%</div>
              <p className="text-xs text-muted-foreground mt-1">Average success</p>
            </div>
          </div>

          {/* Task Defaults Panel */}
          {showDefaults && (
            <div className="mt-4 border border-border/50 rounded-xl p-5 bg-accent/30">
              <div className="flex items-center gap-2 mb-4">
                <Settings className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Task Defaults</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="retry_count" className="text-xs text-muted-foreground">
                    Default Retry Count
                  </Label>
                  <Input
                    id="retry_count"
                    type="number"
                    min={0}
                    max={10}
                    value={defaultsForm.default_retry_count}
                    onChange={e => setDefaultsForm(p => ({ ...p, default_retry_count: Number(e.target.value) }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="retry_interval" className="text-xs text-muted-foreground">
                    Retry Interval (minutes)
                  </Label>
                  <Input
                    id="retry_interval"
                    type="number"
                    min={1}
                    max={60}
                    value={defaultsForm.default_retry_interval_minutes}
                    onChange={e => setDefaultsForm(p => ({ ...p, default_retry_interval_minutes: Number(e.target.value) }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="log_retention" className="text-xs text-muted-foreground">
                    Log Retention (days)
                  </Label>
                  <Input
                    id="log_retention"
                    type="number"
                    min={1}
                    max={365}
                    value={defaultsForm.default_log_retention_days}
                    onChange={e => setDefaultsForm(p => ({ ...p, default_log_retention_days: Number(e.target.value) }))}
                  />
                </div>
              </div>
              <div className="flex justify-end mt-4">
                <Button
                  size="sm"
                  onClick={() => defaultsMutation.mutate(defaultsForm)}
                  disabled={defaultsMutation.isPending}
                  className="gap-2"
                >
                  <Save className="w-3.5 h-3.5" />
                  {defaultsMutation.isPending ? 'Saving...' : 'Save Defaults'}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="px-8">
          <div className="flex items-center gap-8 border-b border-border/30">
            <button
              onClick={() => tm.setActiveTab('schedules')}
              className={cn(
                'group flex items-center gap-2 px-2 py-4 border-b-2 transition-all duration-200 font-semibold',
                tm.activeTab === 'schedules'
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              )}
            >
              <Calendar className={cn("w-4 h-4 transition-colors", tm.activeTab === 'schedules' ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} />
              <span className="text-sm">Scheduled Tasks</span>
              <Badge variant={tm.activeTab === 'schedules' ? 'default' : 'secondary'} className="ml-1 text-xs px-2 py-0.5 transition-none">
                {tm.tasks.length}
              </Badge>
            </button>

            <button
              onClick={() => tm.setActiveTab('executions')}
              className={cn(
                'group flex items-center gap-2 px-2 py-4 border-b-2 transition-all duration-200 font-semibold',
                tm.activeTab === 'executions'
                  ? 'border-blue-500 text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              )}
            >
              <History className={cn("w-4 h-4 transition-colors", tm.activeTab === 'executions' ? 'text-blue-400' : 'text-muted-foreground group-hover:text-foreground')} />
              <span className="text-sm">Execution Logs</span>
              <Badge variant={tm.activeTab === 'executions' ? 'default' : 'secondary'} className="ml-1 text-xs px-2 py-0.5 transition-none">
                {tm.executions.length}
              </Badge>
            </button>

            {tm.isAdmin && (
              <button
                onClick={() => tm.setActiveTab('system-tasks')}
                className={cn(
                  'group flex items-center gap-2 px-2 py-4 border-b-2 transition-all duration-200 font-semibold',
                  tm.activeTab === 'system-tasks'
                    ? 'border-purple-500 text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                )}
              >
                <Shield className={cn("w-4 h-4 transition-colors", tm.activeTab === 'system-tasks' ? 'text-purple-400' : 'text-muted-foreground group-hover:text-foreground')} />
                <span className="text-sm">System Tasks</span>
                <Badge variant={tm.activeTab === 'system-tasks' ? 'default' : 'secondary'} className="ml-1 text-xs px-2 py-0.5 transition-none">
                  {tm.systemTasks.length}
                </Badge>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="px-8 py-6 flex-1 flex flex-col">
        {tm.activeTab === 'schedules' && (
          <DataTableTab
            table={schedulesTable}
            isLoading={tm.tasksLoading}
            globalFilter={schedulesGlobalFilter}
            onGlobalFilterChange={(value) => schedulesTable.setGlobalFilter(value)}
            searchPlaceholder="Search tasks..."
            emptyIcon={<Calendar className="w-10 h-10 text-muted-foreground/70" />}
            emptyTitle="No scheduled tasks yet"
            emptyDescription="Create your first scheduled task to automate query executions"
            emptyAction={
              <Button
                onClick={() => tm.setCreateDialogOpen(true)}
                size="lg"
                className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all hover:scale-[1.02]"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create Scheduled Task
              </Button>
            }
            emptyBgClass="bg-primary/10"
            entityName="tasks"
          />
        )}

        {tm.activeTab === 'executions' && (
          <DataTableTab
            table={executionsTable}
            isLoading={tm.executionsLoading}
            globalFilter={executionsGlobalFilter}
            onGlobalFilterChange={(value) => executionsTable.setGlobalFilter(value)}
            searchPlaceholder="Search executions..."
            emptyIcon={<History className="w-10 h-10 text-muted-foreground/70" />}
            emptyTitle="No execution logs"
            emptyDescription="Execution history will appear here once you run scheduled tasks"
            emptyBgClass="bg-blue-500/10"
            entityName="executions"
          />
        )}

        {tm.activeTab === 'system-tasks' && tm.isAdmin && (
          <div className="flex-1 flex flex-col">
            <div className="flex-1 overflow-auto">
              <div className="space-y-6">
                <SystemTasksTab
                  systemTasks={tm.systemTasks}
                  isLoading={tm.systemTasksLoading}
                  preferences={preferences}
                  onTogglePause={tm.handleToggleSystemTaskPause}
                  onExecuteNow={tm.handleExecuteNow}
                  onViewHistory={tm.handleViewHistory}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Task Form Dialog */}
      <TaskFormDialog
        open={tm.createDialogOpen}
        onOpenChange={tm.setCreateDialogOpen}
        task={tm.editingTask}
        onSuccess={tm.handleDialogSuccess}
      />

      {/* Execution History Dialog */}
      {tm.executionHistoryTask && (
        <ExecutionHistoryDialog
          open={!!tm.executionHistoryTask}
          onOpenChange={(open) => !open && tm.setExecutionHistoryTask(null)}
          task={tm.executionHistoryTask}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!tm.deleteConfirmTaskId}
        onClose={() => tm.setDeleteConfirmTaskId(null)}
        onConfirm={tm.confirmDelete}
        title="Delete Task"
        message="Are you sure you want to delete this task? This action cannot be undone."
        confirmText="Delete"
        variant="danger"
      />

      {/* Execute Now Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!tm.executeConfirmTaskId}
        onClose={() => tm.setExecuteConfirmTaskId(null)}
        onConfirm={tm.confirmExecuteNow}
        title="Execute Task Now"
        message="Are you sure you want to execute this system task immediately?"
        confirmText="Execute"
        variant="warning"
      />
    </div>
  )
}
