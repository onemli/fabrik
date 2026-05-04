// admin/CreateGroupDialog.tsx — form for creating a new RBAC group with a name,
// description, and initial permission assignments.

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { userManagementService } from '@/services/userManagement'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import { PermissionSelector, Permission } from './PermissionSelector'
import { Shield, Sparkles } from 'lucide-react'

interface RoleTemplate {
  name: string
  description: string
  permission_ids: number[]
  icon: string
  color: string
}

interface CreateGroupDialogProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

export function CreateGroupDialog({ open, onClose, onSuccess }: CreateGroupDialogProps) {
  const { showLogoNotification } = useQueryBuilderStore()
  const [loading, setLoading] = useState(false)
  const [loadingPermissions, setLoadingPermissions] = useState(false)
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [templates, setTemplates] = useState<Record<string, RoleTemplate>>({})
  const [activeTab, setActiveTab] = useState<'custom' | 'template'>('custom')
  const [formData, setFormData] = useState({
    name: '',
    permission_ids: [] as number[]
  })

  useEffect(() => {
    if (open) {
      loadPermissions()
      loadTemplates()
      // Reset form
      setFormData({ name: '', permission_ids: [] })
      setActiveTab('custom')
    }
  }, [open])

  const loadPermissions = async () => {
    try {
      setLoadingPermissions(true)
      const response = await userManagementService.listPermissions({ page_size: 500 })
      setPermissions(response.results)
    } catch {
      showLogoNotification({
        message: 'LOAD PERMISSIONS FAILED',
        type: 'error',
        statusCode: 500,
        duration: 2000,
      })
    } finally {
      setLoadingPermissions(false)
    }
  }

  const loadTemplates = async () => {
    try {
      setLoadingTemplates(true)
      const response = await userManagementService.getRoleTemplates()
      setTemplates(response)
    } catch {
      /* ignore */
    } finally {
      setLoadingTemplates(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.name.trim()) {
      showLogoNotification({
        message: 'GROUP NAME REQUIRED',
        type: 'error',
        statusCode: 400,
        duration: 2000,
      })
      return
    }

    try {
      setLoading(true)
      await userManagementService.createGroup(formData)

      showLogoNotification({
        message: 'GROUP CREATED',
        type: 'success',
        statusCode: 201,
        duration: 1500,
      })

      setFormData({ name: '', permission_ids: [] })
      onClose()
      onSuccess()
    } catch (error: any) {
      showLogoNotification({
        message: error?.response?.data?.name?.[0] || 'CREATE FAILED',
        type: 'error',
        statusCode: error?.response?.status || 500,
        duration: 2000,
      })
    } finally {
      setLoading(false)
    }
  }

  const handleTemplateSelect = (templateKey: string) => {
    const template = templates[templateKey]
    setFormData({
      name: '',
      permission_ids: template.permission_ids
    })
    setActiveTab('custom')
  }

  const handlePermissionChange = (ids: number[]) => {
    setFormData(prev => ({ ...prev, permission_ids: ids }))
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Create New Group
          </DialogTitle>
          <DialogDescription>
            Create a custom group or use a pre-configured role template
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="custom" className="gap-2">
              <Shield className="h-4 w-4" />
              Custom Group
            </TabsTrigger>
            <TabsTrigger value="template" className="gap-2">
              <Sparkles className="h-4 w-4" />
              Use Template
            </TabsTrigger>
          </TabsList>

          <TabsContent value="custom" className="flex-1 overflow-hidden mt-4">
            <form onSubmit={handleSubmit} className="space-y-4 h-full flex flex-col">
              <div className="space-y-2">
                <Label htmlFor="name">Group Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Senior Engineers, Data Analysts"
                  required
                />
              </div>

              <div className="space-y-2 flex-1 overflow-hidden flex flex-col">
                <Label>Permissions</Label>
                <div className="flex-1 overflow-hidden">
                  <PermissionSelector
                    permissions={permissions}
                    selectedIds={formData.permission_ids}
                    onSelectionChange={handlePermissionChange}
                    isLoading={loadingPermissions}
                  />
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-4 border-t">
                <Button type="button" variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" disabled={loading || !formData.name.trim()}>
                  {loading ? 'Creating...' : 'Create Group'}
                </Button>
              </div>
            </form>
          </TabsContent>

          <TabsContent value="template" className="flex-1 overflow-auto mt-4">
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Choose a pre-configured role template to quickly set up a new group with appropriate permissions.
              </p>

              {loadingTemplates ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : (
                <div className="grid gap-3">
                  {Object.entries(templates).map(([key, template]) => (
                    <div
                      key={key}
                      className="border rounded-lg p-4 hover:border-primary transition-colors cursor-pointer group"
                      onClick={() => handleTemplateSelect(key)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <h4 className="font-semibold">{template.name}</h4>
                            <Badge variant="secondary" className="text-xs">
                              {template.permission_ids.length} permissions
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {template.description}
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="group-hover:bg-primary group-hover:text-primary-foreground transition-colors"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleTemplateSelect(key)
                          }}
                        >
                          Use Template
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
