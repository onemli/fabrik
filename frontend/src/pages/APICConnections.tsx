// APICConnections.tsx
//
// CRUD page for APIC controller credentials. Test Connection fires a login
// against the live APIC to verify the credentials work before saving.
// Passwords are Fernet-encrypted and not included in GET responses.

import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apicService, APICConnection, APICConnectionCreate } from '../services/apic'
import { useAuthStore } from '../store/authStore'
import { useQueryBuilderStore } from '../store/queryBuilderStore'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, TestTube, Edit, CheckCircle, XCircle, Eye, EyeOff, Sparkles } from 'lucide-react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Switch } from '../components/ui/switch'
import { Label } from '../components/ui/label'

export default function APICConnections() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const { isLogoAnimationsEnabled, setIsLogoAnimationsEnabled } = useQueryBuilderStore()

  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [editingConnection, setEditingConnection] = useState<APICConnection | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<APICConnection | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [testingConnectionId, setTestingConnectionId] = useState<number | null>(null)
  const [testResults, setTestResults] = useState<Record<number, { success: boolean; message: string } | null>>({})
  const testAbortRef = useRef<AbortController | null>(null)

  const [formData, setFormData] = useState<APICConnectionCreate>({
    name: '',
    description: '',
    url: '',
    username: '',
    password: '',
    verify_ssl: false,
    is_public: false,
  })

  const { data: connections = [], isLoading } = useQuery({
    queryKey: ['apic-connections'],
    queryFn: () => apicService.getConnections(),
    enabled: !!user,
  })

  const createMutation = useMutation({
    mutationFn: (data: APICConnectionCreate) => apicService.createConnection(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apic-connections'] })
      setShowCreateDialog(false)
      resetForm()
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<APICConnectionCreate> }) =>
      apicService.updateConnection(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apic-connections'] })
      setEditingConnection(null)
      resetForm()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apicService.deleteConnection(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apic-connections'] })
    },
  })

  const handleTestConnection = async (id: number) => {
    // If already testing this connection, cancel it
    if (testingConnectionId === id && testAbortRef.current) {
      testAbortRef.current.abort()
      testAbortRef.current = null
      setTestingConnectionId(null)
      return
    }

    const controller = new AbortController()
    testAbortRef.current = controller
    setTestingConnectionId(id)
    setTestResults({ ...testResults, [id]: null })

    try {
      const result = await apicService.testConnection(id, controller.signal)
      setTestResults({
        ...testResults,
        [id]: {
          success: result.success,
          message: result.message || (result.success ? 'Connection successful' : 'Connection failed')
        }
      })

      // Auto-clear success message after 5 seconds
      if (result.success) {
        setTimeout(() => {
          setTestResults(prev => ({ ...prev, [id]: null }))
        }, 5000)
      }
    } catch (error: any) {
      if (!controller.signal.aborted) {
        setTestResults({
          ...testResults,
          [id]: {
            success: false,
            message: error.message || 'Connection test failed'
          }
        })
      }
    } finally {
      testAbortRef.current = null
      setTestingConnectionId(null)
    }
  }

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      url: '',
      username: '',
      password: '',
      verify_ssl: false,
      is_public: false,
    })
    setShowPassword(false)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (editingConnection) {
      updateMutation.mutate({ id: editingConnection.id, data: formData })
    } else {
      createMutation.mutate(formData)
    }
  }

  const handleEdit = (conn: APICConnection) => {
    setFormData({
      name: conn.name,
      description: conn.description || '',
      url: conn.url,
      username: conn.username,
      password: '', // Don't pre-fill password
      verify_ssl: conn.verify_ssl,
      is_public: conn.is_public,
    })
    setEditingConnection(conn)
    setShowCreateDialog(true)
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-4">Authentication Required</h2>
          <p className="text-muted-foreground mb-6">Please log in to manage APIC connections</p>
          <button
            onClick={() => navigate('/login')}
            className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            Go to Login
          </button>
        </div>
      </div>
    )
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

      <div className="min-h-screen bg-background">
        {/* Breadcrumb Navigation */}

        <div className="p-6">
          <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-semibold text-foreground mb-2">Settings</h1>
              <p className="text-muted-foreground">Manage connections and preferences</p>
            </div>
          </div>

          {/* Preferences Section */}
          <div className="mb-8 bg-card border border-border rounded-lg p-6">
            <h2 className="text-xl font-semibold text-foreground mb-4 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              Preferences
            </h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="logo-animations" className="text-base font-medium">
                    Animated Logo Notifications
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Show status codes and messages in the logo with retro terminal animations
                  </p>
                </div>
                <Switch
                  id="logo-animations"
                  checked={isLogoAnimationsEnabled}
                  onCheckedChange={setIsLogoAnimationsEnabled}
                />
              </div>
            </div>
          </div>

          {/* APIC Connections Section */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-semibold text-foreground mb-1">APIC Connections</h2>
              <p className="text-sm text-muted-foreground">Manage your Cisco APIC connections</p>
            </div>
            <button
              onClick={() => {
                resetForm()
                setEditingConnection(null)
                setShowCreateDialog(true)
              }}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
            >
              <Plus className="w-4 h-4" />
              Add Connection
            </button>
          </div>

          {isLoading ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Loading connections...</p>
            </div>
          ) : connections.length === 0 ? (
            <div className="text-center py-12 bg-card border border-border rounded-lg">
              <p className="text-muted-foreground mb-4">No connections yet</p>
              <button
                onClick={() => setShowCreateDialog(true)}
                className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
              >
                Add Your First Connection
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {connections.map((conn) => (
                <div
                  key={conn.id}
                  className="bg-card border border-border rounded-lg p-6 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1 text-left">
                      <h3 className="text-xl font-bold text-foreground mb-2 text-left">{conn.name}</h3>
                      {conn.description && (
                        <p className="text-sm font-medium text-muted-foreground mb-3 text-left">{conn.description}</p>
                      )}
                      <div className="flex flex-col gap-2 text-sm text-muted-foreground text-left">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold min-w-[80px]">URL:</span>
                          <span className="font-mono">{conn.url}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold min-w-[80px]">Username:</span>
                          <span>{conn.username}</span>
                        </div>
                        {conn.is_public && (
                          <div className="flex items-center gap-2">
                            <span className="font-semibold min-w-[80px]">Visibility:</span>
                            <span className="text-green-600 font-semibold">Public</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Real-time test result */}
                    {testResults[conn.id] && (
                      <div className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm ${
                        testResults[conn.id]!.success
                          ? 'bg-green-500/10 border border-green-500/20 text-green-600 dark:text-green-400'
                          : 'bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400'
                      }`}>
                        {testResults[conn.id]!.success ? (
                          <CheckCircle className="w-4 h-4" />
                        ) : (
                          <XCircle className="w-4 h-4" />
                        )}
                        <span className="font-medium">{testResults[conn.id]!.message}</span>
                      </div>
                    )}

                    {/* Last test status (if no real-time result) */}
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
                    <button
                      onClick={() => handleTestConnection(conn.id)}
                      disabled={testingConnectionId === conn.id}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm border border-border rounded-md hover:bg-accent disabled:opacity-50"
                    >
                      <TestTube className="w-4 h-4" />
                      {testingConnectionId === conn.id ? 'Testing...' : 'Test'}
                    </button>

                    {conn.can_edit && (
                      <>
                        <button
                          onClick={() => handleEdit(conn)}
                          className="flex items-center gap-2 px-3 py-1.5 text-sm border border-border rounded-md hover:bg-accent"
                        >
                          <Edit className="w-4 h-4" />
                          Edit
                        </button>

                        {conn.can_delete && (
                          <button
                            onClick={() => setDeleteConfirm(conn)}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm border border-border rounded-md hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                          >
                            <Trash2 className="w-4 h-4" />
                            Delete
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>

    {/* Create/Edit Dialog */}
    {showCreateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-background/50" onClick={() => setShowCreateDialog(false)} />
          <div className="relative bg-card border border-border rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-4">
                {editingConnection ? 'Edit Connection' : 'Add APIC Connection'}
              </h3>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium mb-2">Name *</label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-3 py-2 border border-border rounded-md bg-background"
                      placeholder="My APIC"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-medium mb-2">Description</label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      className="w-full px-3 py-2 border border-border rounded-md bg-background resize-none"
                      rows={2}
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-medium mb-2">URL *</label>
                    <input
                      type="url"
                      required
                      value={formData.url}
                      onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                      className="w-full px-3 py-2 border border-border rounded-md bg-background"
                      placeholder="https://apic.example.com"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">Username *</label>
                    <input
                      type="text"
                      required
                      value={formData.username}
                      onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                      className="w-full px-3 py-2 border border-border rounded-md bg-background"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Password {editingConnection ? '' : '*'}
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required={!editingConnection}
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        className="w-full px-3 py-2 pr-10 border border-border rounded-md bg-background"
                        placeholder={editingConnection ? 'Leave blank to keep current' : ''}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="col-span-2 space-y-2">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={formData.verify_ssl}
                        onChange={(e) => setFormData({ ...formData, verify_ssl: e.target.checked })}
                        className="w-4 h-4"
                      />
                      <span className="text-sm">Verify SSL certificates</span>
                    </label>

                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={formData.is_public}
                        onChange={(e) => setFormData({ ...formData, is_public: e.target.checked })}
                        className="w-4 h-4"
                      />
                      <span className="text-sm">Make public (all users can use)</span>
                    </label>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateDialog(false)
                      setEditingConnection(null)
                      resetForm()
                    }}
                    className="px-4 py-2 border border-border rounded-md hover:bg-accent"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createMutation.isPending || updateMutation.isPending}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
                  >
                    {createMutation.isPending || updateMutation.isPending
                      ? 'Saving...'
                      : editingConnection
                      ? 'Update'
                      : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
