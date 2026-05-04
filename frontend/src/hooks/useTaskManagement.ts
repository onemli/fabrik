// All state, queries, mutations, and handlers for the task management page.
// Extracted so the main component only deals with table setup and rendering.

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import { usePermissions } from '@/hooks/usePermissions'
import type { ScheduledTask, ScheduledExecution } from '@/components/task/taskConfig'

// Normalizes paginated or plain array responses into a flat array.
function normalizeResponse<T>(data: unknown): T[] {
  if (data && typeof data === 'object' && 'results' in data && Array.isArray((data as any).results)) {
    return (data as any).results
  }
  if (Array.isArray(data)) {
    return data
  }
  return []
}

export type ActiveTab = 'schedules' | 'executions' | 'system-tasks'

export function useTaskManagement() {
  const queryClient = useQueryClient()
  const { isAdmin } = usePermissions()

  const [activeTab, setActiveTab] = useState<ActiveTab>('schedules')
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<ScheduledTask | null>(null)
  const [executionHistoryTask, setExecutionHistoryTask] = useState<ScheduledTask | null>(null)
  const [deleteConfirmTaskId, setDeleteConfirmTaskId] = useState<string | null>(null)
  const [executeConfirmTaskId, setExecuteConfirmTaskId] = useState<string | null>(null)

  // --- Queries ---

  const { data: tasksData, isLoading: tasksLoading } = useQuery({
    queryKey: ['scheduled-tasks'],
    queryFn: async () => {
      const response = await api.get('/api/queries/scheduled-tasks/')
      return response.data
    },
  })

  const tasks = useMemo<ScheduledTask[]>(() => normalizeResponse(tasksData), [tasksData])

  const { data: systemTasksData, isLoading: systemTasksLoading } = useQuery({
    queryKey: ['system-tasks'],
    queryFn: async () => {
      const response = await api.get('/api/queries/scheduled-tasks/?is_system_task=true')
      return response.data
    },
    enabled: isAdmin,
  })

  const systemTasks = useMemo<ScheduledTask[]>(() => normalizeResponse(systemTasksData), [systemTasksData])

  const { data: executionsData, isLoading: executionsLoading } = useQuery({
    queryKey: ['scheduled-executions'],
    queryFn: async () => {
      const response = await api.get('/api/queries/scheduled-executions/')
      return response.data
    },
    staleTime: 30000,
    refetchInterval: activeTab === 'executions' ? 60000 : false,
    enabled: activeTab === 'executions',
  })

  const executions = useMemo<ScheduledExecution[]>(() => normalizeResponse(executionsData), [executionsData])

  // --- Stats ---

  const stats = useMemo(() => {
    const activeTasks = tasks.filter(t => t.status === 'active').length
    const totalExecutions = tasks.reduce((sum, t) => sum + t.execution_count, 0)
    const avgSuccessRate = tasks.length > 0
      ? Math.round(tasks.reduce((sum, t) => sum + t.success_rate, 0) / tasks.length)
      : 0

    return { totalTasks: tasks.length, activeTasks, totalExecutions, avgSuccessRate }
  }, [tasks])

  // --- Mutations ---

  const pauseMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/api/queries/scheduled-tasks/${id}/pause/`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-tasks'] })
    },
  })

  const resumeMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/api/queries/scheduled-tasks/${id}/resume/`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-tasks'] })
    },
  })

  const cloneMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await api.post(`/api/queries/scheduled-tasks/${id}/clone/`)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-tasks'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/queries/scheduled-tasks/${id}/`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-tasks'] })
    },
  })

  const executeNowMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await api.post(`/api/queries/scheduled-tasks/${id}/execute_now/`)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['scheduled-executions'] })
    },
  })

  // --- Handlers ---

  const handleEdit = (task: ScheduledTask) => {
    setEditingTask(task)
    setCreateDialogOpen(true)
  }

  const handleClone = (taskId: string) => {
    cloneMutation.mutate(taskId)
  }

  const handleDelete = (taskId: string) => {
    setDeleteConfirmTaskId(taskId)
  }

  const handleTogglePause = (task: ScheduledTask) => {
    if (task.status === 'active') {
      pauseMutation.mutate(task.id)
    } else {
      resumeMutation.mutate(task.id)
    }
  }

  const handleViewHistory = (task: ScheduledTask) => {
    setExecutionHistoryTask(task)
  }

  const handleExecuteNow = (taskId: string) => {
    setExecuteConfirmTaskId(taskId)
  }

  // Same toggle logic, kept as a separate name for clarity in the system tasks tab
  const handleToggleSystemTaskPause = handleTogglePause

  const confirmDelete = () => {
    if (deleteConfirmTaskId) {
      deleteMutation.mutate(deleteConfirmTaskId)
      setDeleteConfirmTaskId(null)
    }
  }

  const confirmExecuteNow = () => {
    if (executeConfirmTaskId) {
      executeNowMutation.mutate(executeConfirmTaskId)
      setExecuteConfirmTaskId(null)
    }
  }

  const handleDialogSuccess = () => {
    setCreateDialogOpen(false)
    setEditingTask(null)
    queryClient.invalidateQueries({ queryKey: ['scheduled-tasks'] })
  }

  return {
    // Tab
    activeTab,
    setActiveTab,
    isAdmin,

    // Data
    tasks,
    tasksLoading,
    systemTasks,
    systemTasksLoading,
    executions,
    executionsLoading,
    stats,

    // Dialog state
    createDialogOpen,
    setCreateDialogOpen,
    editingTask,
    executionHistoryTask,
    setExecutionHistoryTask,
    deleteConfirmTaskId,
    setDeleteConfirmTaskId,
    executeConfirmTaskId,
    setExecuteConfirmTaskId,

    // Handlers
    handleEdit,
    handleClone,
    handleDelete,
    handleTogglePause,
    handleViewHistory,
    handleExecuteNow,
    handleToggleSystemTaskPause,
    confirmDelete,
    confirmExecuteNow,
    handleDialogSuccess,
  }
}
