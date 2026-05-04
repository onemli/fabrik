// AWXConnections.tsx
//
// CRUD page for AWX/Ansible Tower connection credentials. Tokens are encrypted
// server-side (Fernet) and never returned to the frontend after save.

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { awxService, AWXConnection, AWXConnectionCreate } from '../services/awx'
import { useAuthStore } from '../store/authStore'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, TestTube, Edit, CheckCircle, XCircle, Eye, EyeOff, Server, AlertCircle } from 'lucide-react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Switch } from '../components/ui/switch'
import { Label } from '../components/ui/label'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'

export default function AWXConnections() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuthStore()

  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [editingConnection, setEditingConnection] = useState<AWXConnection | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<AWXConnection | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [testingConnectionId, setTestingConnectionId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string; version?: string } | null>>({})
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  const [formData, setFormData] = useState<AWXConnectionCreate>({
    name: '',
    description: '',
    url: '',
    auth_type: 'token',
    token: '',
    username: '',
    password: '',
    verify_ssl: true,
    timeout: 30,
    credential_prefix: '',
    is_public: false,
  })

  const { data: connections = [], isLoading } = useQuery({
    queryKey: ['awx-connections'],
    queryFn: () => awxService.listConnections(),
    enabled: !!user,
  })

  const createMutation = useMutation({
    mutationFn: (data: AWXConnectionCreate) => awxService.createConnection(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['awx-connections'] })
      setShowCreateDialog(false)
      resetForm()
      setFormErrors({})
    },
    onError: (error: any) => {
      // Parse validation errors from backend
      if (error.response?.data) {
        const errors: Record<string, string> = {}
        Object.entries(error.response.data).forEach(([key, value]) => {
          if (Array.isArray(value)) {
            errors[key] = value.join(', ')
          } else if (typeof value === 'string') {
            errors[key] = value
          }
        })
        setFormErrors(errors)
      } else {
        setFormErrors({ general: error.message || 'Failed to create connection' })
      }
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<AWXConnectionCreate> }) =>
      awxService.updateConnection(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['awx-connections'] })
      setEditingConnection(null)
      resetForm()
      setFormErrors({})
    },
    onError: (error: any) => {
      // Parse validation errors from backend
      if (error.response?.data) {
        const errors: Record<string, string> = {}
        Object.entries(error.response.data).forEach(([key, value]) => {
          if (Array.isArray(value)) {
            errors[key] = value.join(', ')
          } else if (typeof value === 'string') {
            errors[key] = value
          }
        })
        setFormErrors(errors)
      } else {
        setFormErrors({ general: error.message || 'Failed to update connection' })
      }
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => awxService.deleteConnection(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['awx-connections'] })
    },
  })

  const handleTestConnection = async (id: string) => {
    setTestingConnectionId(id)
    setTestResults({ ...testResults, [id]: null })

    try {
      const result = await awxService.testConnection(id)
      setTestResults({
        ...testResults,
        [id]: {
          success: result.success,
          message: result.message || result.error || (result.success ? 'Connection successful' : 'Connection failed'),
          version: result.metadata?.version
        }
      })

      // Auto-clear success message after 5 seconds
      if (result.success) {
        setTimeout(() => {
          setTestResults(prev => ({ ...prev, [id]: null }))
        }, 5000)
      }

      // Refresh connections to update version
      queryClient.invalidateQueries({ queryKey: ['awx-connections'] })
    } catch (error: any) {
      setTestResults({
        ...testResults,
        [id]: {
          success: false,
          message: error.message || 'Connection test failed'
        }
      })
    } finally {
      setTestingConnectionId(null)
    }
  }

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      url: '',
      auth_type: 'token',
      token: '',
      username: '',
      password: '',
      verify_ssl: true,
      timeout: 30,
      credential_prefix: '',
      is_public: false,
    })
    setShowPassword(false)
    setShowToken(false)
    setShowCreateDialog(false)
    setFormErrors({})
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (editingConnection) {
      updateMutation.mutate({ id: editingConnection.id, data: formData })
    } else {
      createMutation.mutate(formData)
    }
  }

  const handleEdit = (conn: AWXConnection) => {
    setFormData({
      name: conn.name,
      description: conn.description || '',
      url: conn.url,
      auth_type: conn.auth_type,
      token: '', // Don't pre-fill credentials
      username: conn.username || '',
      password: '',
      verify_ssl: conn.verify_ssl,
      timeout: conn.timeout,
      credential_prefix: conn.credential_prefix || '',
      is_public: conn.is_public,
    })
    setEditingConnection(conn)
    setShowCreateDialog(true)
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center glass-strong border border-border/20 rounded-2xl p-12 max-w-md animate-scale-in">
          <h2 className="text-2xl font-bold text-foreground mb-4">Authentication Required</h2>
          <p className="text-muted-foreground mb-6">Please log in to manage AWX connections</p>
          <Button
            onClick={() => navigate('/login')}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            Go to Login
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">

      {/* Header */}
      <div className="border-b border-border/20">
        <div className="px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 glass border border-primary/30 bg-primary/10 rounded-xl">
                <Server className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-foreground">AWX Connections</h1>
                <p className="text-sm text-muted-foreground">
                  Manage AWX/Ansible Tower connections for automation
                </p>
              </div>
            </div>

            <Button
              onClick={() => {
                resetForm()
                setEditingConnection(null)
                setShowCreateDialog(true)
              }}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Connection
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-8 py-8">
        {isLoading ? (
          <div className="text-center py-12">
            <div className="inline-block w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-sm text-muted-foreground">Loading connections...</p>
          </div>
        ) : connections.length === 0 ? (
          <div className="text-center py-20 glass border border-border/20 rounded-xl max-w-2xl mx-auto">
            <div className="relative mb-6">
              <div className="absolute inset-0 bg-primary/10 blur-3xl rounded-full" />
              <div className="relative w-20 h-20 glass border border-border/20 rounded-full flex items-center justify-center mx-auto">
                <Server className="w-10 h-10 text-muted-foreground" />
              </div>
            </div>
            <h3 className="text-xl font-bold mb-2 text-foreground">No AWX Connections</h3>
            <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
              Add your first AWX or Ansible Tower connection to start automating
            </p>
            <Button
              onClick={() => setShowCreateDialog(true)}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Connection
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {connections.map((connection) => {
              const testResult = testResults[connection.id]
              const isTesting = testingConnectionId === connection.id

              return (
                <div
                  key={connection.id}
                  className="glass border border-border/20 rounded-xl p-6 hover:border-white/20 transition-all"
                >
                  {/* Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-foreground mb-1">
                        {connection.name}
                      </h3>
                      <p className="text-sm text-muted-foreground break-all">
                        {connection.url}
                      </p>
                    </div>

                    {connection.last_test_status === 'success' && (
                      <div className="ml-2">
                        <CheckCircle className="w-5 h-5 text-emerald-500" />
                      </div>
                    )}
                  </div>

                  {/* Description */}
                  {connection.description && (
                    <p className="text-sm text-muted-foreground mb-4">
                      {connection.description}
                    </p>
                  )}

                  {/* Metadata */}
                  <div className="space-y-2 mb-4">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Auth Type:</span>
                      <span className="text-foreground capitalize">
                        {connection.auth_type}
                      </span>
                    </div>

                    {connection.awx_version && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Version:</span>
                        <span className="text-emerald-400 font-mono">
                          {connection.awx_version}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">SSL Verify:</span>
                      <span className="text-foreground">
                        {connection.verify_ssl ? 'Yes' : 'No'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Visibility:</span>
                      <span className="text-foreground">
                        {connection.is_public ? 'Public' : 'Private'}
                      </span>
                    </div>
                  </div>

                  {/* Test Result */}
                  {testResult && (
                    <div className={`p-3 rounded-lg mb-4 ${
                      testResult.success
                        ? 'bg-emerald-500/10 border border-emerald-500/30'
                        : 'bg-red-500/10 border border-red-500/30'
                    }`}>
                      <div className="flex items-start gap-2">
                        {testResult.success ? (
                          <CheckCircle className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm ${
                            testResult.success ? 'text-emerald-400' : 'text-red-400'
                          }`}>
                            {testResult.message}
                          </p>
                          {testResult.version && (
                            <p className="text-xs text-muted-foreground mt-1">
                              AWX {testResult.version}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleTestConnection(connection.id)}
                      disabled={isTesting}
                      className="flex-1 glass border-border/20 text-foreground hover:border-primary/50"
                    >
                      <TestTube className={`w-4 h-4 mr-2 ${isTesting ? 'animate-pulse' : ''}`} />
                      {isTesting ? 'Testing...' : 'Test'}
                    </Button>

                    {connection.can_edit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEdit(connection)}
                        className="glass hover:bg-orange-500/10 hover:text-orange-400"
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                    )}

                    {connection.can_delete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteConfirm(connection)}
                        className="glass hover:bg-red-500/10 hover:text-red-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={(open) => {
        if (!open) {
          resetForm()
          setEditingConnection(null)
        }
        setShowCreateDialog(open)
      }}>
        <DialogContent className="glass max-w-2xl border-border/20">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {editingConnection ? 'Edit AWX Connection' : 'Add AWX Connection'}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* General error message */}
            {formErrors.general && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                <span className="text-sm text-red-400">{formErrors.general}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label htmlFor="name" className="text-foreground">Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => {
                    setFormData({ ...formData, name: e.target.value })
                    if (formErrors.name) setFormErrors({ ...formErrors, name: '' })
                  }}
                  required
                  className={`glass border-border/20 text-foreground ${formErrors.name ? 'border-red-500' : ''}`}
                  placeholder="My AWX Server"
                />
                {formErrors.name && <p className="text-xs text-red-400 mt-1">{formErrors.name}</p>}
              </div>

              <div className="col-span-2">
                <Label htmlFor="url" className="text-foreground">URL *</Label>
                <Input
                  id="url"
                  value={formData.url}
                  onChange={(e) => {
                    setFormData({ ...formData, url: e.target.value })
                    if (formErrors.url) setFormErrors({ ...formErrors, url: '' })
                  }}
                  required
                  className={`glass border-border/20 text-foreground ${formErrors.url ? 'border-red-500' : ''}`}
                  placeholder="https://awx.example.com"
                />
                {formErrors.url && <p className="text-xs text-red-400 mt-1">{formErrors.url}</p>}
              </div>

              <div className="col-span-2">
                <Label htmlFor="description" className="text-foreground">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="glass border-border/20 text-foreground"
                  rows={3}
                />
              </div>

              <div>
                <Label htmlFor="auth_type" className="text-foreground">Authentication Type *</Label>
                <Select
                  value={formData.auth_type}
                  onValueChange={(value: 'token' | 'basic') => setFormData({ ...formData, auth_type: value })}
                >
                  <SelectTrigger className="glass border-border/20 text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="glass border-border/20">
                    <SelectItem value="token">OAuth2 Token</SelectItem>
                    <SelectItem value="basic">Username/Password</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="timeout" className="text-foreground">Timeout (seconds)</Label>
                <Input
                  id="timeout"
                  type="number"
                  value={formData.timeout}
                  onChange={(e) => setFormData({ ...formData, timeout: parseInt(e.target.value) })}
                  className="glass border-border/20 text-foreground"
                  min={5}
                  max={120}
                />
              </div>

              {formData.auth_type === 'token' ? (
                <div className="col-span-2">
                  <Label htmlFor="token" className="text-foreground">
                    OAuth2 Token {!editingConnection && '*'}
                  </Label>
                  <div className="relative">
                    <Input
                      id="token"
                      type={showToken ? 'text' : 'password'}
                      value={formData.token}
                      onChange={(e) => {
                        setFormData({ ...formData, token: e.target.value })
                        if (formErrors.token) setFormErrors({ ...formErrors, token: '' })
                      }}
                      required={!editingConnection}
                      className={`glass border-border/20 text-foreground pr-10 ${formErrors.token ? 'border-red-500' : ''}`}
                      placeholder={editingConnection ? 'Leave blank to keep current token' : 'Enter token'}
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken(!showToken)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {formErrors.token && <p className="text-xs text-red-400 mt-1">{formErrors.token}</p>}
                </div>
              ) : (
                <>
                  <div>
                    <Label htmlFor="username" className="text-foreground">Username *</Label>
                    <Input
                      id="username"
                      value={formData.username}
                      onChange={(e) => {
                        setFormData({ ...formData, username: e.target.value })
                        if (formErrors.username) setFormErrors({ ...formErrors, username: '' })
                      }}
                      required
                      className={`glass border-border/20 text-foreground ${formErrors.username ? 'border-red-500' : ''}`}
                    />
                    {formErrors.username && <p className="text-xs text-red-400 mt-1">{formErrors.username}</p>}
                  </div>

                  <div>
                    <Label htmlFor="password" className="text-foreground">
                      Password {!editingConnection && '*'}
                    </Label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        value={formData.password}
                        onChange={(e) => {
                          setFormData({ ...formData, password: e.target.value })
                          if (formErrors.password) setFormErrors({ ...formErrors, password: '' })
                        }}
                        required={!editingConnection}
                        className={`glass border-border/20 text-foreground pr-10 ${formErrors.password ? 'border-red-500' : ''}`}
                        placeholder={editingConnection ? 'Leave blank to keep current password' : 'Enter password'}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {formErrors.password && <p className="text-xs text-red-400 mt-1">{formErrors.password}</p>}
                  </div>
                </>
              )}

              <div className="col-span-2 space-y-1">
                <Label htmlFor="credential_prefix" className="text-foreground">
                  Credential Prefix Filter <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Input
                  id="credential_prefix"
                  placeholder="e.g. CISCO_ACI_"
                  value={formData.credential_prefix || ''}
                  onChange={(e) => setFormData({ ...formData, credential_prefix: e.target.value })}
                  className="glass border-border/20 text-foreground"
                />
                <p className="text-xs text-muted-foreground">
                  Case-sensitive. Only credentials whose name starts with this prefix will appear in Device Credentials.
                  Leave blank to list all.
                </p>
              </div>

              <div className="col-span-2 space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="verify_ssl" className="text-foreground">Verify SSL Certificate</Label>
                  <Switch
                    id="verify_ssl"
                    checked={formData.verify_ssl}
                    onCheckedChange={(checked) => setFormData({ ...formData, verify_ssl: checked })}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <Label htmlFor="is_public" className="text-foreground">Make Public (visible to all users)</Label>
                  <Switch
                    id="is_public"
                    checked={formData.is_public}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_public: checked })}
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  resetForm()
                  setEditingConnection(null)
                }}
                className="glass border-border/20 text-foreground"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {createMutation.isPending || updateMutation.isPending
                  ? 'Saving...'
                  : editingConnection
                  ? 'Update Connection'
                  : 'Create Connection'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => {
          if (deleteConfirm) {
            deleteMutation.mutate(deleteConfirm.id)
            setDeleteConfirm(null)
          }
        }}
        title="Delete AWX Connection"
        message={`Are you sure you want to delete "${deleteConfirm?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />
    </div>
  )
}
