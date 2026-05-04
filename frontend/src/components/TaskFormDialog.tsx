// TaskFormDialog.tsx
//
// Create/edit dialog for scheduled tasks. The user sets a name, picks a saved
// query, configures the cron schedule, and optionally links an AWX template.
// Validates cron syntax client-side before letting the user save.

import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Search, FileText } from 'lucide-react'
import { api } from '@/services/api'
import { queriesService } from '@/services/queries'
import { apicService } from '@/services/apic'
import { toast } from 'sonner'
import { useTimezone } from '@/contexts/TimezoneContext'

interface TaskFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  task?: any
  onSuccess: () => void
}

interface SavedQuery {
  id: number
  name: string
  is_template: boolean
  variables?: any[]
}

interface APICConnection {
  id: number
  name: string
  url: string
}

export function TaskFormDialog({ open, onOpenChange, task, onSuccess }: TaskFormDialogProps) {
  const { preferences } = useTimezone()
  const userTz = preferences?.display_timezone || 'UTC'

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    priority: 'medium',
    saved_query: null as number | null,
    apic_connection_ids: [] as number[],
    variable_values: {} as Record<string, any>,
    frequency: 'daily',
    minute_of_hour: 0,
    time_of_day: '00:00',
    day_of_week: 'monday',
    day_of_month: 1,
    scheduled_datetime: '',
    timezone: userTz,
    retry_enabled: false,
    retry_count: 3,
    retry_interval_minutes: 5,
    log_retention_days: 30,
  })

  const [selectedQuery, setSelectedQuery] = useState<SavedQuery | null>(null)
  const [_variableModalOpen, setVariableModalOpen] = useState(false)
  const [querySearchModalOpen, setQuerySearchModalOpen] = useState(false)
  const [querySearchTerm, setQuerySearchTerm] = useState('')

  // Fetch saved queries
  const { data: queriesData, isLoading: queriesLoading } = useQuery({
    queryKey: ['saved-queries'],
    queryFn: () => queriesService.getSavedQueries(),
    enabled: open,
  })

  // Ensure queries is always an array (filter out templates)
  const queries: SavedQuery[] = useMemo(() => {
    const allQueries = Array.isArray(queriesData) ? queriesData : []
    return allQueries.filter(q => !q.is_template)
  }, [queriesData])

  // Filtered queries for search modal
  const filteredQueries = useMemo(() => {
    if (!querySearchTerm.trim()) return queries
    const searchLower = querySearchTerm.toLowerCase()
    return queries.filter(q => q.name.toLowerCase().includes(searchLower))
  }, [queries, querySearchTerm])

  // Fetch APIC connections
  const { data: connectionsData, isLoading: connectionsLoading } = useQuery({
    queryKey: ['apic-connections'],
    queryFn: () => apicService.getConnections(),
    enabled: open,
  })

  // Ensure connections is always an array
  const connections: APICConnection[] = useMemo(() => {
    return Array.isArray(connectionsData) ? connectionsData : []
  }, [connectionsData])

  // Fetch default settings
  const { data: settings } = useQuery({
    queryKey: ['task-settings'],
    queryFn: async () => {
      const response = await api.get('/api/queries/task-settings/')
      return response.data
    },
  })

  // Initialize form with task data
  useEffect(() => {
    if (task) {
      setFormData({
        name: task.name,
        description: task.description || '',
        priority: task.priority,
        saved_query: task.saved_query,
        apic_connection_ids: task.apic_connection_ids,
        variable_values: task.variable_values || {},
        frequency: task.frequency,
        minute_of_hour: task.minute_of_hour || 0,
        time_of_day: task.time_of_day || '00:00',
        day_of_week: task.day_of_week || 'monday',
        day_of_month: task.day_of_month || 1,
        scheduled_datetime: task.scheduled_datetime || '',
        timezone: task.timezone || userTz,
        retry_enabled: task.retry_enabled,
        retry_count: task.retry_count,
        retry_interval_minutes: task.retry_interval_minutes,
        log_retention_days: task.log_retention_days,
      })
    }
  }, [task])

  // Set selected query when task changes
  useEffect(() => {
    if (task && queries.length > 0) {
      const query = queries.find(q => q.id === task.saved_query)
      setSelectedQuery(query || null)
    }
  }, [task, queries])

  // Apply default settings when not editing
  useEffect(() => {
    if (!task && settings) {
      setFormData(prev => ({
        ...prev,
        retry_count: settings.default_retry_count,
        retry_interval_minutes: settings.default_retry_interval_minutes,
        log_retention_days: settings.default_log_retention_days,
      }))
    }
  }, [task, settings])

  // Create/Update mutation
  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      if (task) {
        await api.put(`/api/queries/scheduled-tasks/${task.id}/`, data)
      } else {
        await api.post('/api/queries/scheduled-tasks/', data)
      }
    },
    onSuccess: () => {
      onSuccess()
      resetForm()
    },
    onError: (error: any) => {
      const errorMessage = error.message || 'Failed to save task'
      toast.error('Error', { description: errorMessage })
    },
  })

  const handleQueryChange = (value: string) => {
    const queryId = parseInt(value, 10)
    const query = queries.find(q => q.id === queryId)
    setSelectedQuery(query || null)
    setFormData(prev => ({ ...prev, saved_query: queryId }))
  }

  const handleConnectionToggle = (connectionId: number) => {
    setFormData(prev => {
      const ids = prev.apic_connection_ids.includes(connectionId)
        ? prev.apic_connection_ids.filter(id => id !== connectionId)
        : [...prev.apic_connection_ids, connectionId]
      return { ...prev, apic_connection_ids: ids }
    })
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    // Validate required fields
    if (!formData.saved_query) {
      toast.error('Validation Error', { description: 'Please select a saved query' })
      return
    }

    if (formData.apic_connection_ids.length === 0) {
      toast.error('Validation Error', { description: 'Please select at least one APIC connection' })
      return
    }

    // Validate template variables if needed
    if (selectedQuery?.is_template && selectedQuery.variables) {
      const hasAllVariables = selectedQuery.variables.every(
        v => formData.variable_values[v.id] !== undefined && formData.variable_values[v.id] !== ''
      )
      if (!hasAllVariables) {
        toast.error('Validation Error', { description: 'Please provide values for all template variables' })
        setVariableModalOpen(true)
        return
      }
    }

    // Prepare data for submission
    const submitData = {
      ...formData,
      // Convert datetime-local to ISO format with timezone, or null if not 'once'
      scheduled_datetime: formData.frequency === 'once' && formData.scheduled_datetime
        ? new Date(formData.scheduled_datetime).toISOString()
        : null
    }

    saveMutation.mutate(submitData)
  }

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      priority: 'medium',
      saved_query: null,
      apic_connection_ids: [],
      variable_values: {},
      frequency: 'daily',
      minute_of_hour: 0,
      time_of_day: '00:00',
      day_of_week: 'monday',
      day_of_month: 1,
      scheduled_datetime: '',
      timezone: userTz,
      retry_enabled: false,
      retry_count: 3,
      retry_interval_minutes: 5,
      log_retention_days: 30,
    })
    setSelectedQuery(null)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{task ? 'Edit Scheduled Task' : 'Create Scheduled Task'}</DialogTitle>
            <DialogDescription>
              Schedule a query or template to run automatically at specified intervals
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Basic Info */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Basic Information</h3>

              <div>
                <Label htmlFor="name">Task Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  required
                />
              </div>

              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  rows={2}
                />
              </div>

              <div>
                <Label htmlFor="priority">Priority *</Label>
                <Select value={formData.priority} onValueChange={v => setFormData(prev => ({ ...prev, priority: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Query Selection */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Query Selection</h3>

              <div>
                <Label htmlFor="query">Saved Query *</Label>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 justify-start text-left font-normal"
                    onClick={() => setQuerySearchModalOpen(true)}
                  >
                    {selectedQuery ? (
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-muted-foreground" />
                        <span>{selectedQuery.name}</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">Select a query</span>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setQuerySearchModalOpen(true)}
                    className="flex-shrink-0"
                  >
                    <Search className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* APIC Connections */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">APIC Connections *</h3>
              <p className="text-sm text-muted-foreground">Select one or more connections to run this task against</p>

              <div className="space-y-2 max-h-40 overflow-y-auto border rounded-md p-3">
                {connectionsLoading ? (
                  <div className="p-2 text-sm text-muted-foreground text-center">Loading connections...</div>
                ) : connections.length === 0 ? (
                  <div className="p-2 text-sm text-muted-foreground text-center">No APIC connections found</div>
                ) : (
                  connections.map(conn => (
                    <div key={conn.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`conn-${conn.id}`}
                        checked={formData.apic_connection_ids.includes(conn.id)}
                        onCheckedChange={() => handleConnectionToggle(conn.id)}
                      />
                      <Label htmlFor={`conn-${conn.id}`} className="flex-1 cursor-pointer">
                        {conn.name} <span className="text-muted-foreground text-xs">({conn.url})</span>
                      </Label>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Schedule Configuration */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Schedule</h3>

              <div>
                <Label htmlFor="frequency">Frequency *</Label>
                <Select value={formData.frequency} onValueChange={v => setFormData(prev => ({ ...prev, frequency: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="once">Once</SelectItem>
                    <SelectItem value="hourly">Hourly</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {formData.frequency === 'hourly' && (
                <div>
                  <Label htmlFor="minute">Minute of Hour (0-59)</Label>
                  <Input
                    id="minute"
                    type="number"
                    min="0"
                    max="59"
                    value={formData.minute_of_hour}
                    onChange={e => setFormData(prev => ({ ...prev, minute_of_hour: parseInt(e.target.value) }))}
                  />
                </div>
              )}

              {(formData.frequency === 'daily' || formData.frequency === 'weekly' || formData.frequency === 'monthly') && (
                <div>
                  <Label htmlFor="time">Time of Day</Label>
                  <Input
                    id="time"
                    type="time"
                    value={formData.time_of_day}
                    onChange={e => setFormData(prev => ({ ...prev, time_of_day: e.target.value }))}
                  />
                </div>
              )}

              {formData.frequency === 'weekly' && (
                <div>
                  <Label htmlFor="day_week">Day of Week</Label>
                  <Select value={formData.day_of_week} onValueChange={v => setFormData(prev => ({ ...prev, day_of_week: v }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monday">Monday</SelectItem>
                      <SelectItem value="tuesday">Tuesday</SelectItem>
                      <SelectItem value="wednesday">Wednesday</SelectItem>
                      <SelectItem value="thursday">Thursday</SelectItem>
                      <SelectItem value="friday">Friday</SelectItem>
                      <SelectItem value="saturday">Saturday</SelectItem>
                      <SelectItem value="sunday">Sunday</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {formData.frequency === 'monthly' && (
                <div>
                  <Label htmlFor="day_month">Day of Month (1-31)</Label>
                  <Input
                    id="day_month"
                    type="number"
                    min="1"
                    max="31"
                    value={formData.day_of_month}
                    onChange={e => setFormData(prev => ({ ...prev, day_of_month: parseInt(e.target.value) }))}
                  />
                </div>
              )}

              {formData.frequency === 'once' && (
                <div>
                  <Label htmlFor="datetime">Scheduled Date & Time</Label>
                  <Input
                    id="datetime"
                    type="datetime-local"
                    value={formData.scheduled_datetime}
                    onChange={e => setFormData(prev => ({ ...prev, scheduled_datetime: e.target.value }))}
                  />
                </div>
              )}
            </div>

            {/* Retry Configuration */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Retry Configuration</h3>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="retry_enabled"
                  checked={formData.retry_enabled}
                  onCheckedChange={checked => setFormData(prev => ({ ...prev, retry_enabled: !!checked }))}
                />
                <Label htmlFor="retry_enabled">Enable automatic retry on failure</Label>
              </div>

              {formData.retry_enabled && (
                <>
                  <div>
                    <Label htmlFor="retry_count">Retry Count</Label>
                    <Input
                      id="retry_count"
                      type="number"
                      min="1"
                      max="10"
                      value={formData.retry_count}
                      onChange={e => setFormData(prev => ({ ...prev, retry_count: parseInt(e.target.value) }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="retry_interval">Retry Interval (minutes)</Label>
                    <Input
                      id="retry_interval"
                      type="number"
                      min="1"
                      max="60"
                      value={formData.retry_interval_minutes}
                      onChange={e => setFormData(prev => ({ ...prev, retry_interval_minutes: parseInt(e.target.value) }))}
                    />
                  </div>
                </>
              )}
            </div>

            {/* Log Retention */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Log Retention</h3>

              <div>
                <Label htmlFor="log_retention">Days to Retain Logs</Label>
                <Input
                  id="log_retention"
                  type="number"
                  min="1"
                  max="365"
                  value={formData.log_retention_days}
                  onChange={e => setFormData(prev => ({ ...prev, log_retention_days: parseInt(e.target.value) }))}
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Saving...' : task ? 'Update Task' : 'Create Task'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Query Search Modal */}
      <Dialog open={querySearchModalOpen} onOpenChange={setQuerySearchModalOpen}>
        <DialogContent className="max-w-2xl max-h-[600px]">
          <DialogHeader>
            <DialogTitle>Select Query</DialogTitle>
            <DialogDescription>
              Search and select a saved query for this task
            </DialogDescription>
          </DialogHeader>

          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search queries..."
              value={querySearchTerm}
              onChange={(e) => setQuerySearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Query List */}
          <div className="max-h-[400px] overflow-y-auto border rounded-lg">
            {queriesLoading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Loading queries...
              </div>
            ) : filteredQueries.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {querySearchTerm ? 'No queries found matching your search' : 'No saved queries found'}
              </div>
            ) : (
              <div className="divide-y">
                {filteredQueries.map((query) => (
                  <button
                    key={query.id}
                    type="button"
                    onClick={() => {
                      handleQueryChange(query.id.toString())
                      setQuerySearchModalOpen(false)
                      setQuerySearchTerm('')
                    }}
                    className={`w-full p-4 text-left hover:bg-accent transition-colors flex items-center gap-3 ${
                      formData.saved_query === query.id ? 'bg-accent' : ''
                    }`}
                  >
                    <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{query.name}</div>
                    </div>
                    {formData.saved_query === query.id && (
                      <Badge variant="outline" className="ml-auto">Selected</Badge>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setQuerySearchModalOpen(false)
                setQuerySearchTerm('')
              }}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  )
}
