// TemplateConfigurePage.tsx
//
// Edit page for an existing automation template — name, category, execution mode,
// schema and column template settings. Not the same as the
// creation wizard; this is for modifying a template that already exists.

import { useState, useEffect } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { awxService, TemplateCategory } from '../services/awx'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Textarea } from '../components/ui/textarea'
import { Badge } from '../components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../components/ui/tooltip'
import {
  Save,
  FolderOpen,
  Search,
  Plus,
  X,
  FileCode,
  Workflow,
  Server,
  ExternalLink,
  Info,
} from 'lucide-react'
import { toast } from 'sonner'
import { isSafeUrl } from '../lib/utils'
import { SchemaDesigner } from '../components/SchemaDesigner'
import { TableSchema } from '../components/SchemaDesigner/types'
import { ConfirmDialog } from '../components/ConfirmDialog'

interface CreateModeState {
  connectionId: string
  connectionName: string
  connectionUrl: string
  awxTemplateId: number
  awxTemplateName: string
  awxType: 'job_template' | 'workflow_template'
  workflowJobNodes: any[]
}

export default function TemplateConfigurePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { templateId } = useParams<{ templateId?: string }>()
  const isEditMode = !!templateId

  const createState = location.state as CreateModeState | null

  const [loading, setLoading] = useState(isEditMode)
  const [saving, setSaving] = useState(false)

  // AWX kaynak bilgileri
  const [awxTemplateName, setAwxTemplateName] = useState(createState?.awxTemplateName || '')
  const [awxType, setAwxType] = useState<'job_template' | 'workflow_template'>(
    createState?.awxType || 'job_template'
  )
  const [connectionName, setConnectionName] = useState(createState?.connectionName || '')
  const [connectionUrl, setConnectionUrl] = useState(createState?.connectionUrl || '')

  // Form alanları
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [categories, setCategories] = useState<TemplateCategory[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const [categorySearch, setCategorySearch] = useState('')
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryColor, setNewCategoryColor] = useState('#3b82f6')
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [tags, setTags] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  const [requiresValidation, setRequiresValidation] = useState(false)

  // Şema
  const [tableSchemas, setTableSchemas] = useState<TableSchema[]>([
    { name: 'Table 1', awx_variable_name: 'table_1', columns: [] },
  ])
  const [activeSchemaIndex, setActiveSchemaIndex] = useState(0)
  const [removeSchemaConfirmIndex, setRemoveSchemaConfirmIndex] = useState<number | null>(null)

  const isWorkflow = awxType === 'workflow_template'

  useEffect(() => {
    loadCategories()
    if (isEditMode && templateId) {
      loadTemplate(templateId)
    } else if (!isEditMode && !createState) {
      navigate('/awx/templates/create', { replace: true })
    }
  }, [templateId])

  const loadCategories = async () => {
    try {
      const data = await awxService.listCategories()
      setCategories(data)
    } catch {
      /* ignore */
    }
  }

  const loadTemplate = async (id: string) => {
    try {
      setLoading(true)
      const template = await awxService.getTemplate(id)
      setName(template.name)
      setDescription(template.description || '')
      setSelectedCategory(template.category || '')
      setTags(template.tags?.join(', ') || '')
      setIsPublic(template.is_public)
      setRequiresValidation(template.requires_validation || false)
      setAwxTemplateName(template.awx_template_name)
      setAwxType(template.awx_type)
      setTableSchemas(
        template.table_schemas?.length
          ? template.table_schemas
          : [{ name: 'Table 1', awx_variable_name: 'table_1', columns: [] }]
      )
      try {
        const conn = await awxService.getConnection(template.awx_connection)
        setConnectionName(conn.name)
        setConnectionUrl(conn.url)
      } catch {
        // non-critical
      }
    } catch (error: any) {
      toast.error('Failed to load template')
      navigate('/awx/templates')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) {
      toast.error('Category name is required')
      return
    }
    try {
      setCreatingCategory(true)
      const newCategory = await awxService.createCategory({
        name: newCategoryName.trim(),
        color: newCategoryColor,
      })
      setCategories([...categories, newCategory])
      setSelectedCategory(newCategory.id)
      setNewCategoryName('')
      setNewCategoryColor('#3b82f6')
      toast.success('Category created successfully')
    } catch (error: any) {
      toast.error('Failed to create category')
    } finally {
      setCreatingCategory(false)
    }
  }

  const handleAddSchema = () => {
    const idx = tableSchemas.length
    const newSchema: TableSchema = {
      name: `Table ${idx + 1}`,
      awx_variable_name: `table_${idx + 1}`,
      columns: [],
    }
    setTableSchemas([...tableSchemas, newSchema])
    setActiveSchemaIndex(idx)
  }

  const handleRemoveSchema = (index: number) => {
    if (tableSchemas.length === 1) {
      toast.error('At least one table schema is required')
      return
    }
    setRemoveSchemaConfirmIndex(index)
  }

  const confirmRemoveSchema = () => {
    if (removeSchemaConfirmIndex !== null) {
      const newSchemas = tableSchemas.filter((_, i) => i !== removeSchemaConfirmIndex)
      setTableSchemas(newSchemas)
      if (activeSchemaIndex >= newSchemas.length) {
        setActiveSchemaIndex(Math.max(0, newSchemas.length - 1))
      }
      setRemoveSchemaConfirmIndex(null)
    }
  }

  const handleSchemaChange = (index: number, schema: TableSchema) => {
    const newSchemas = [...tableSchemas]
    newSchemas[index] = schema
    setTableSchemas(newSchemas)
  }

  const handleSchemaNameChange = (index: number, schemaName: string, awxVarName: string) => {
    const newSchemas = [...tableSchemas]
    newSchemas[index] = { ...newSchemas[index], name: schemaName, awx_variable_name: awxVarName }
    setTableSchemas(newSchemas)
  }

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('Template name is required')
      return
    }

    try {
      setSaving(true)

      const payload: any = {
        name: name.trim(),
        description: description.trim(),
        category: selectedCategory || null,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        is_public: isPublic,
        requires_validation: requiresValidation,
        table_schemas: tableSchemas,
        execution_mode: 'bulk',
      }

      if (!isEditMode) {
        payload.awx_connection = createState!.connectionId
        payload.awx_type = createState!.awxType
        payload.awx_template_id = createState!.awxTemplateId
        payload.awx_template_name = createState!.awxTemplateName
        payload.workflow_job_nodes = createState!.workflowJobNodes || []
      }

      if (isEditMode) {
        await awxService.updateTemplate(templateId!, payload)
        toast.success('Template updated successfully')
      } else {
        await awxService.createTemplate(payload)
        toast.success('Template created successfully')
      }

      navigate('/awx/templates')
    } catch (error: any) {
      toast.error(error.response?.data?.error || `Failed to ${isEditMode ? 'update' : 'create'} template`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Loading template...</p>
        </div>
      </div>
    )
  }

  const selectedCategoryObj = categories.find((c) => c.id === selectedCategory)

  return (
    <TooltipProvider>
      <div className="h-full flex flex-col bg-muted/10">

        {/* ── Page header ── */}
        <div className="border-b bg-card px-8 py-4 flex items-center justify-between flex-shrink-0">
          <h1 className="text-xl font-semibold">
            {isEditMode ? 'Edit Automation Template' : 'Create Automation Template'}
          </h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => navigate('/awx/templates')} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              {saving
                ? isEditMode ? 'Saving...' : 'Creating...'
                : isEditMode ? 'Save Changes' : 'Create Template'}
            </Button>
          </div>
        </div>

        {/* ── AWX source bar ── */}
        <div className="flex items-center gap-2.5 px-8 py-2.5 border-b bg-muted/30 text-sm min-w-0 overflow-hidden flex-shrink-0">
          <div className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 ${
            isWorkflow ? 'bg-purple-500/10' : 'bg-blue-500/10'
          }`}>
            {isWorkflow
              ? <Workflow className="h-3.5 w-3.5 text-purple-500" />
              : <FileCode className="h-3.5 w-3.5 text-blue-500" />
            }
          </div>
          <span className="font-medium truncate">{awxTemplateName || '—'}</span>
          <Badge variant="secondary" className="text-xs flex-shrink-0">
            {isWorkflow ? 'Workflow' : 'Job Template'}
          </Badge>
          {connectionName && (
            <>
              <span className="text-border flex-shrink-0">·</span>
              <Server className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <span className="text-muted-foreground truncate">{connectionName}</span>
            </>
          )}
          {connectionUrl && (
            <>
              <span className="text-border flex-shrink-0">·</span>
              {isSafeUrl(connectionUrl) ? (
                <a
                  href={connectionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-primary flex items-center gap-0.5 transition-colors truncate min-w-0"
                >
                  <span className="truncate">{connectionUrl}</span>
                  <ExternalLink className="h-3 w-3 ml-0.5 flex-shrink-0" />
                </a>
              ) : (
                <span className="text-muted-foreground truncate min-w-0">{connectionUrl}</span>
              )}
            </>
          )}
        </div>

        {/* ── Two-panel content: metadata (left) + schema designer (right) ── */}
        <div className="flex-1 flex min-h-0">

          {/* Left panel — template metadata, fixed width, own scroll */}
          <div className="w-[300px] flex-shrink-0 border-r bg-card overflow-y-auto">
            <div className="p-5 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">
                  Template Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="name"
                  placeholder="e.g., Deploy L3Out Configuration"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  placeholder="Describe what this template does..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />
              </div>

              <div className="border-t pt-4 space-y-1.5">
                <Label>Category</Label>
                <Dialog open={categoryModalOpen} onOpenChange={setCategoryModalOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-sm h-9">
                      {selectedCategoryObj ? (
                        <div className="flex items-center gap-2 min-w-0">
                          <div
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: selectedCategoryObj.color }}
                          />
                          <span className="truncate">{selectedCategoryObj.name}</span>
                        </div>
                      ) : (
                        <>
                          <FolderOpen className="mr-2 h-3.5 w-3.5 flex-shrink-0" />
                          <span className="text-muted-foreground">Select category</span>
                        </>
                      )}
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>Select Category</DialogTitle>
                      <DialogDescription>
                        Choose a category or create a new one
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search categories..."
                          value={categorySearch}
                          onChange={(e) => setCategorySearch(e.target.value)}
                          className="pl-9"
                        />
                      </div>
                      <div className="space-y-2 max-h-60 overflow-y-auto">
                        {categories
                          .filter((cat) =>
                            cat.name.toLowerCase().includes(categorySearch.toLowerCase())
                          )
                          .map((category) => (
                            <button
                              key={category.id}
                              onClick={() => {
                                setSelectedCategory(category.id)
                                setCategoryModalOpen(false)
                                setCategorySearch('')
                              }}
                              className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                                selectedCategory === category.id
                                  ? 'border-primary bg-primary/5'
                                  : 'border-border hover:bg-accent'
                              }`}
                            >
                              <div
                                className="w-4 h-4 rounded-full flex-shrink-0"
                                style={{ backgroundColor: category.color }}
                              />
                              <span className="text-sm font-medium">{category.name}</span>
                            </button>
                          ))}
                        {categories.filter((cat) =>
                          cat.name.toLowerCase().includes(categorySearch.toLowerCase())
                        ).length === 0 && (
                          <p className="text-center text-sm text-muted-foreground py-4">
                            No categories found
                          </p>
                        )}
                      </div>
                      <div className="border-t pt-4 space-y-3">
                        <Label className="text-sm font-medium">Create New Category</Label>
                        <div className="space-y-2">
                          <Input
                            placeholder="Category name"
                            value={newCategoryName}
                            onChange={(e) => setNewCategoryName(e.target.value)}
                          />
                          <div className="flex gap-2">
                            <Input
                              type="color"
                              value={newCategoryColor}
                              onChange={(e) => setNewCategoryColor(e.target.value)}
                              className="w-20 h-10"
                            />
                            <Button
                              onClick={handleCreateCategory}
                              disabled={creatingCategory || !newCategoryName.trim()}
                              className="flex-1"
                            >
                              {creatingCategory ? 'Creating...' : (
                                <><Plus className="mr-2 h-4 w-4" />Create</>
                              )}
                            </Button>
                          </div>
                        </div>
                      </div>
                      {selectedCategory && (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setSelectedCategory('')
                            setCategoryModalOpen(false)
                          }}
                          className="w-full"
                        >
                          <X className="mr-2 h-4 w-4" />
                          Clear Selection
                        </Button>
                      )}
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tags">Tags</Label>
                <Input
                  id="tags"
                  placeholder="network, l3out (comma-separated)"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                />
              </div>

              <div className="border-t pt-4 space-y-2.5">
                <label className="flex items-center justify-between gap-3 cursor-pointer group">
                  <span className="text-sm group-hover:text-foreground transition-colors">
                    Public Template
                  </span>
                  <input
                    type="checkbox"
                    checked={isPublic}
                    onChange={(e) => setIsPublic(e.target.checked)}
                    className="w-4 h-4 accent-primary flex-shrink-0"
                  />
                </label>
                <label className="flex items-center justify-between gap-3 cursor-pointer group">
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="text-sm group-hover:text-foreground transition-colors truncate">
                      Require Validation
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                          onClick={(e) => e.preventDefault()}
                        >
                          <Info className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs">
                        <p className="text-xs">
                          Users must validate input data before running this template.
                          Prevents malformed data from being sent to AWX.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <input
                    type="checkbox"
                    checked={requiresValidation}
                    onChange={(e) => setRequiresValidation(e.target.checked)}
                    className="w-4 h-4 accent-primary flex-shrink-0"
                  />
                </label>
              </div>
            </div>
          </div>

          {/* Right panel — schema designer, fills remaining space */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

            {/* Workflow table tabs */}
            {isWorkflow && (
              <div className="flex items-center gap-2 px-6 py-3 border-b flex-shrink-0">
                <div className="flex-1 flex items-center gap-1 overflow-x-auto">
                  {tableSchemas.map((schema, index) => (
                    <div key={index} className="relative inline-flex items-center flex-shrink-0">
                      <button
                        onClick={() => setActiveSchemaIndex(index)}
                        className={`px-4 py-2 text-sm font-medium rounded-md border transition-colors ${
                          activeSchemaIndex === index
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'border-border hover:bg-accent'
                        } ${tableSchemas.length > 1 ? 'pr-7' : ''}`}
                      >
                        {schema.name || `Table ${index + 1}`}
                      </button>
                      {tableSchemas.length > 1 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRemoveSchema(index) }}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <Button variant="outline" size="sm" onClick={handleAddSchema}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Table
                </Button>
              </div>
            )}

            {/* Table name + AWX variable name */}
            {tableSchemas[activeSchemaIndex] && (
              <div className="grid grid-cols-2 gap-4 px-6 py-4 border-b flex-shrink-0">
                <div className="space-y-1.5">
                  <Label htmlFor={`schema-name-${activeSchemaIndex}`}>
                    Table Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id={`schema-name-${activeSchemaIndex}`}
                    placeholder="e.g., Tenants"
                    value={tableSchemas[activeSchemaIndex].name || ''}
                    onChange={(e) =>
                      handleSchemaNameChange(
                        activeSchemaIndex,
                        e.target.value,
                        tableSchemas[activeSchemaIndex].awx_variable_name || ''
                      )
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`schema-var-${activeSchemaIndex}`}>
                    AWX Variable Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id={`schema-var-${activeSchemaIndex}`}
                    placeholder="e.g., tenants"
                    value={tableSchemas[activeSchemaIndex].awx_variable_name || ''}
                    onChange={(e) =>
                      handleSchemaNameChange(
                        activeSchemaIndex,
                        tableSchemas[activeSchemaIndex].name || '',
                        e.target.value
                      )
                    }
                  />
                  <p className="text-xs text-muted-foreground">Use snake_case</p>
                </div>
              </div>
            )}

            {/* SchemaDesigner fills remaining height */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <SchemaDesigner
                key={activeSchemaIndex}
                schema={tableSchemas[activeSchemaIndex]}
                onSchemaChange={(updatedSchema) =>
                  handleSchemaChange(activeSchemaIndex, updatedSchema)
                }
                sheetName={tableSchemas[activeSchemaIndex]?.name || `Table ${activeSchemaIndex + 1}`}
                panelMode={true}
              />
            </div>
          </div>
        </div>

        {/* Tablo silme onay dialogu */}
        <ConfirmDialog
          isOpen={removeSchemaConfirmIndex !== null}
          onClose={() => setRemoveSchemaConfirmIndex(null)}
          onConfirm={confirmRemoveSchema}
          title="Remove Table Schema"
          message={`Are you sure you want to remove "${tableSchemas[removeSchemaConfirmIndex ?? 0]?.name || 'this table'}"? This action cannot be undone.`}
          confirmText="Remove"
          variant="danger"
        />
      </div>
    </TooltipProvider>
  )
}
