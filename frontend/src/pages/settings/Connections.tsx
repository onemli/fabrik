// settings/Connections.tsx
//
// Quick-access connection management within the Settings area. This is a lighter
// version of APICConnections.tsx — same CRUD but embedded in the settings layout.

import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Network, Plus, Trash2, TestTube, Edit,
  CheckCircle, XCircle, Eye, EyeOff,
} from 'lucide-react'
import { apicService, APICConnection, APICConnectionCreate } from '@/services/apic'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'

const EMPTY_FORM: APICConnectionCreate = {
  name: '',
  description: '',
  url: '',
  username: '',
  password: '',
  verify_ssl: false,
  is_public: false,
}

export default function Connections() {
  const queryClient = useQueryClient()

  const [showDialog, setShowDialog] = useState(false)
  const [editing, setEditing] = useState<APICConnection | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<APICConnection | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [testingId, setTestingId] = useState<number | null>(null)
  const [testResults, setTestResults] = useState<Record<number, { success: boolean; message: string } | null>>({})
  const [form, setForm] = useState<APICConnectionCreate>(EMPTY_FORM)
  const testAbortRef = useRef<AbortController | null>(null)

  const { data: connections = [], isLoading } = useQuery({
    queryKey: ['apic-connections'],
    queryFn: () => apicService.getConnections(),
  })

  const createMutation = useMutation({
    mutationFn: (data: APICConnectionCreate) => apicService.createConnection(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apic-connections'] })
      closeDialog()
      toast.success('Connection created')
    },
    onError: (err: unknown) =>
      toast.error('Failed to create', { description: (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<APICConnectionCreate> }) =>
      apicService.updateConnection(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apic-connections'] })
      closeDialog()
      toast.success('Connection updated')
    },
    onError: (err: unknown) =>
      toast.error('Failed to update', { description: (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apicService.deleteConnection(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apic-connections'] })
      toast.success('Connection deleted')
    },
    onError: (err: unknown) =>
      toast.error('Failed to delete', { description: (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail }),
  })

  const handleTest = async (id: number) => {
    // If already testing, cancel it
    if (testingId === id && testAbortRef.current) {
      testAbortRef.current.abort()
      testAbortRef.current = null
      setTestingId(null)
      return
    }

    const controller = new AbortController()
    testAbortRef.current = controller
    setTestingId(id)
    setTestResults(prev => ({ ...prev, [id]: null }))
    try {
      const result = await apicService.testConnection(id, controller.signal)
      setTestResults(prev => ({
        ...prev,
        [id]: {
          success: result.success,
          message: result.message || (result.success ? 'Connection successful' : 'Connection failed'),
        },
      }))
      if (result.success) {
        setTimeout(() => setTestResults(prev => ({ ...prev, [id]: null })), 5000)
      }
    } catch (err: unknown) {
      if (!controller.signal.aborted) {
        setTestResults(prev => ({
          ...prev,
          [id]: { success: false, message: (err as Error)?.message || 'Connection test failed' },
        }))
      }
    } finally {
      testAbortRef.current = null
      setTestingId(null)
    }
  }

  const closeDialog = () => {
    setShowDialog(false)
    setEditing(null)
    setForm(EMPTY_FORM)
    setShowPassword(false)
  }

  const openEdit = (conn: APICConnection) => {
    setForm({
      name: conn.name,
      description: conn.description || '',
      url: conn.url,
      username: conn.username,
      password: '',
      verify_ssl: conn.verify_ssl,
      is_public: conn.is_public,
    })
    setEditing(conn)
    setShowDialog(true)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: form })
    } else {
      createMutation.mutate(form)
    }
  }

  return (
    <>
      <ConfirmDialog
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => {
          if (deleteConfirm) deleteMutation.mutate(deleteConfirm.id)
          setDeleteConfirm(null)
        }}
        title="Delete Connection"
        message={`Are you sure you want to delete "${deleteConfirm?.name}"?`}
        confirmText="Delete"
        variant="danger"
      />

      <div className="space-y-6 w-full">
        <div>
          <h2 className="text-lg font-semibold">APIC Connections</h2>
          <p className="text-sm text-muted-foreground">Manage your Cisco APIC controller connections.</p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Network className="w-5 h-5" />
                  Connections
                </CardTitle>
                <CardDescription>
                  {connections.length} connection{connections.length !== 1 ? 's' : ''} configured
                </CardDescription>
              </div>
              <Button
                size="sm"
                onClick={() => { setForm(EMPTY_FORM); setEditing(null); setShowDialog(true) }}
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Connection
              </Button>
            </div>
          </CardHeader>

          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2].map(i => (
                  <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
                ))}
              </div>
            ) : connections.length === 0 ? (
              <div className="text-center py-12 border-2 border-dashed border-border rounded-lg">
                <Network className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground mb-4">No APIC connections configured</p>
                <Button
                  variant="outline"
                  onClick={() => { setForm(EMPTY_FORM); setEditing(null); setShowDialog(true) }}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Your First Connection
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {connections.map(conn => (
                  <div
                    key={conn.id}
                    className="border border-border rounded-lg p-4 hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <h4 className="font-semibold text-lg mb-1">{conn.name}</h4>
                        {conn.description && (
                          <p className="text-sm text-muted-foreground mb-2">{conn.description}</p>
                        )}
                        <div className="flex flex-col gap-1 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="font-medium min-w-[80px]">URL:</span>
                            <span className="font-mono text-muted-foreground">{conn.url}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium min-w-[80px]">Username:</span>
                            <span className="text-muted-foreground">{conn.username}</span>
                          </div>
                          {conn.is_public && (
                            <div className="flex items-center gap-2">
                              <span className="font-medium min-w-[80px]">Visibility:</span>
                              <span className="text-green-600 font-medium">Public</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {testResults[conn.id] && (
                        <div
                          className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm ${
                            testResults[conn.id]!.success
                              ? 'bg-green-50 border border-green-200 text-green-800'
                              : 'bg-red-50 border border-red-200 text-red-800'
                          }`}
                        >
                          {testResults[conn.id]!.success ? (
                            <CheckCircle className="w-4 h-4" />
                          ) : (
                            <XCircle className="w-4 h-4" />
                          )}
                          <span className="font-medium">{testResults[conn.id]!.message}</span>
                        </div>
                      )}

                      {!testResults[conn.id] && conn.last_test_status !== null && (
                        <div className="flex items-center gap-2">
                          {conn.last_test_status ? (
                            <CheckCircle className="w-5 h-5 text-green-600" />
                          ) : (
                            <XCircle className="w-5 h-5 text-red-600" />
                          )}
                          <span className="text-xs text-muted-foreground">
                            {conn.last_test_message}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleTest(conn.id)}
                        disabled={testingId === conn.id}
                      >
                        <TestTube className="w-4 h-4 mr-2" />
                        {testingId === conn.id ? 'Testing…' : 'Test'}
                      </Button>

                      {conn.can_edit && (
                        <>
                          <Button variant="outline" size="sm" onClick={() => openEdit(conn)}>
                            <Edit className="w-4 h-4 mr-2" />
                            Edit
                          </Button>
                          {conn.can_delete && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setDeleteConfirm(conn)}
                              className="hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create / Edit Dialog */}
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-background/50"
            onClick={closeDialog}
          />
          <div className="relative bg-card border border-border rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-4">
                {editing ? 'Edit APIC Connection' : 'Add APIC Connection'}
              </h3>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <Label htmlFor="apic_name">Name *</Label>
                    <Input
                      id="apic_name"
                      type="text"
                      required
                      value={form.name}
                      onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                      placeholder="My APIC"
                      className="mt-2"
                    />
                  </div>

                  <div className="col-span-2">
                    <Label htmlFor="apic_description">Description</Label>
                    <textarea
                      id="apic_description"
                      value={form.description}
                      onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                      className="w-full px-3 py-2 mt-2 border border-border rounded-md bg-background resize-none"
                      rows={2}
                    />
                  </div>

                  <div className="col-span-2">
                    <Label htmlFor="apic_url">URL *</Label>
                    <Input
                      id="apic_url"
                      type="url"
                      required
                      value={form.url}
                      onChange={e => setForm(p => ({ ...p, url: e.target.value }))}
                      placeholder="https://apic.example.com"
                      className="mt-2"
                    />
                  </div>

                  <div>
                    <Label htmlFor="apic_username">Username *</Label>
                    <Input
                      id="apic_username"
                      type="text"
                      required
                      value={form.username}
                      onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
                      className="mt-2"
                    />
                  </div>

                  <div>
                    <Label htmlFor="apic_password">
                      Password {editing ? '' : '*'}
                    </Label>
                    <div className="relative mt-2">
                      <Input
                        id="apic_password"
                        type={showPassword ? 'text' : 'password'}
                        required={!editing}
                        value={form.password}
                        onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                        placeholder={editing ? 'Leave blank to keep current' : ''}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2"
                      >
                        {showPassword
                          ? <EyeOff className="w-4 h-4" />
                          : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="col-span-2 space-y-3">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={form.verify_ssl}
                        onChange={e => setForm(p => ({ ...p, verify_ssl: e.target.checked }))}
                        className="w-4 h-4"
                      />
                      <span className="text-sm">Verify SSL certificates</span>
                    </label>

                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={form.is_public}
                        onChange={e => setForm(p => ({ ...p, is_public: e.target.checked }))}
                        className="w-4 h-4"
                      />
                      <span className="text-sm">Make public (all users can use)</span>
                    </label>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-4">
                  <Button type="button" variant="outline" onClick={closeDialog}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={createMutation.isPending || updateMutation.isPending}
                  >
                    {createMutation.isPending || updateMutation.isPending
                      ? 'Saving…'
                      : editing
                      ? 'Update'
                      : 'Create'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
