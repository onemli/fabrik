// table/TemplateManager.tsx
//
// Popover for managing saved column templates for a given APIC class. The user
// can load a previously saved column layout, delete templates they no longer
// need, or mark one as the default (applied automatically when that class is
// queried). Templates are stored per-user on the backend.

import { useState, useEffect, useRef } from 'react'
import { Trash2, Star, Download, Clock, MoreVertical, Upload, FileDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { mimApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { exportTemplate, importTemplate } from '@/services/templateBundle'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'

interface Template {
  id: number
  class_name: string
  template_name: string
  description?: string
  columns: any[]
  preferences: any
  default_filters?: any[]
  default_sorting?: any[]
  is_default: boolean
  created_at: string
  updated_at: string
  last_used?: string
}

interface TemplateManagerProps {
  className: string
  open: boolean
  onClose: () => void
  onLoadTemplate: (template: Template) => void
}

export function TemplateManager({
  className,
  open,
  onClose,
  onLoadTemplate
}: TemplateManagerProps) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { showLogoNotification } = useQueryBuilderStore()

  // Load templates for this class
  useEffect(() => {
    if (open && className) {
      loadTemplates()
    }
  }, [open, className])

  const loadTemplates = async () => {
    try {
      setLoading(true)
      const data = await mimApi.getTableTemplates(className)
      setTemplates(data)
    } catch (error) {
      showLogoNotification({
        message: 'LOAD FAILED',
        type: 'error',
        statusCode: 500,
        duration: 2000,
      })
    } finally {
      setLoading(false)
    }
  }

  // Delete template
  const handleDelete = async (id: number) => {
    try {
      setDeletingId(id)
      await mimApi.deleteTableTemplate(id)
      setTemplates(prev => prev.filter(t => t.id !== id))
      showLogoNotification({
        message: 'DELETED',
        type: 'success',
        statusCode: 200,
        duration: 1500,
      })
    } catch (error) {
      showLogoNotification({
        message: 'DELETE FAILED',
        type: 'error',
        statusCode: 500,
        duration: 2000,
      })
    } finally {
      setDeletingId(null)
    }
  }

  // Set as default
  const handleSetDefault = async (id: number) => {
    try {
      // Unset all defaults first
      for (const template of templates) {
        if (template.is_default && template.id !== id) {
          await mimApi.updateTableTemplate(template.id, { is_default: false })
        }
      }

      // Set new default
      await mimApi.updateTableTemplate(id, { is_default: true })

      // Refresh templates
      await loadTemplates()

      showLogoNotification({
        message: 'DEFAULT SET',
        type: 'success',
        statusCode: 200,
        duration: 1500,
      })
    } catch (error) {
      showLogoNotification({
        message: 'UPDATE FAILED',
        type: 'error',
        statusCode: 500,
        duration: 2000,
      })
    }
  }

  // Load template
  const handleLoad = (template: Template) => {
    onLoadTemplate(template)
    onClose()
  }

  // Format date
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 60) {
      return `${diffMins} min ago`
    } else if (diffHours < 24) {
      return `${diffHours}h ago`
    } else if (diffDays < 7) {
      return `${diffDays}d ago`
    } else {
      return date.toLocaleDateString()
    }
  }

  // Export template
  const handleExport = (template: Template) => {
    exportTemplate({
      template_name: template.template_name,
      description: template.description,
      class_name: template.class_name,
      columns: template.columns,
      preferences: template.preferences,
      default_filters: template.default_filters,
      default_sorting: template.default_sorting,
    })

    showLogoNotification({
      message: 'EXPORTED',
      type: 'success',
      statusCode: 200,
      duration: 1500,
    })
  }

  // Import template
  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const templateData = await importTemplate(file)

      // Create new template from imported data
      await mimApi.createTableTemplate({
        ...templateData,
        class_name: className, // Force current class
      })

      // Reload templates
      await loadTemplates()

      showLogoNotification({
        message: 'IMPORTED',
        type: 'success',
        statusCode: 200,
        duration: 1500,
      })
    } catch (error) {
      showLogoNotification({
        message: 'ERROR',
        type: 'error',
        statusCode: 500,
        duration: 2000,
      })
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle>Table Templates</DialogTitle>
              <DialogDescription>
                Saved templates for{' '}
                <span className="font-mono font-medium">{className}</span>
              </DialogDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleImportClick}
            >
              <Upload className="h-4 w-4 mr-2" />
              Import
            </Button>
          </div>
        </DialogHeader>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          className="hidden"
        />

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground">
              Loading templates...
            </div>
          ) : templates.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <p className="text-muted-foreground mb-2">No saved templates</p>
              <p className="text-sm text-muted-foreground">
                Customize the table and save it as a template
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {templates.map(template => (
                <div
                  key={template.id}
                  className={cn(
                    'border rounded-lg p-4 hover:bg-muted/30 transition-colors',
                    template.is_default && 'border-primary bg-primary/5'
                  )}
                >
                  <div className="flex items-start gap-3">
                    {/* Icon */}
                    <div className={cn(
                      'flex-shrink-0 mt-1',
                      template.is_default ? 'text-primary' : 'text-muted-foreground'
                    )}>
                      {template.is_default ? (
                        <Star className="h-5 w-5 fill-current" />
                      ) : (
                        <Star className="h-5 w-5" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-sm truncate">
                            {template.template_name}
                          </h4>
                          {template.description && (
                            <p className="text-sm text-muted-foreground mt-0.5">
                              {template.description}
                            </p>
                          )}
                        </div>

                        {/* Actions */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleLoad(template)}>
                              <Download className="h-4 w-4 mr-2" />
                              Load Template
                            </DropdownMenuItem>
                            {!template.is_default && (
                              <DropdownMenuItem onClick={() => handleSetDefault(template.id)}>
                                <Star className="h-4 w-4 mr-2" />
                                Set as Default
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => handleExport(template)}>
                              <FileDown className="h-4 w-4 mr-2" />
                              Export Template
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => handleDelete(template.id)}
                              disabled={deletingId === template.id}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      {/* Metadata */}
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <span>{template.columns.length} columns</span>
                        </div>
                        {template.last_used && (
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            <span>Used {formatDate(template.last_used)}</span>
                          </div>
                        )}
                        <div>
                          Created {formatDate(template.created_at)}
                        </div>
                      </div>

                      {/* Badges */}
                      <div className="flex items-center gap-2 mt-2">
                        {template.is_default && (
                          <Badge variant="secondary" className="text-xs">
                            Default
                          </Badge>
                        )}
                        {template.default_sorting && template.default_sorting.length > 0 && (
                          <Badge variant="outline" className="text-xs">
                            Sorted
                          </Badge>
                        )}
                        {template.default_filters && template.default_filters.length > 0 && (
                          <Badge variant="outline" className="text-xs">
                            Filtered
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
