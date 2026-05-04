// CategoriesManagement.tsx
//
// CRUD page for AWX automation template categories. Categories are just labels
// with a color — they help users organize templates in the template library.

import { useState, useEffect } from 'react'
import { awxService, TemplateCategory } from '../services/awx'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Textarea } from '../components/ui/textarea'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import {
  Plus,
  Edit,
  Trash2,
  MoreVertical,
  Folder,
  Save,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '../components/ConfirmDialog'

const PRESET_COLORS = [
  '#EF4444', // red
  '#F59E0B', // orange
  '#F59E0B', // amber
  '#10B981', // green
  '#14B8A6', // teal
  '#3B82F6', // blue
  '#6366F1', // indigo
  '#8B5CF6', // violet
  '#A855F7', // purple
  '#EC4899', // pink
  '#6B7280', // gray
]

interface CategoryDialogProps {
  category?: TemplateCategory | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

function CategoryDialog({ category, open, onOpenChange, onSuccess }: CategoryDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('#6366F1')
  const [displayOrder, setDisplayOrder] = useState(0)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (category) {
      setName(category.name)
      setDescription(category.description || '')
      setColor(category.color)
      setDisplayOrder(category.display_order)
    } else {
      setName('')
      setDescription('')
      setColor('#6366F1')
      setDisplayOrder(0)
    }
  }, [category, open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim()) {
      toast.error('Category name is required')
      return
    }

    try {
      setSaving(true)

      const data = {
        name: name.trim(),
        description: description.trim(),
        color,
        display_order: displayOrder,
      }

      if (category) {
        await awxService.updateCategory(category.id, data)
        toast.success('Category updated successfully')
      } else {
        await awxService.createCategory(data)
        toast.success('Category created successfully')
      }

      onSuccess()
      onOpenChange(false)
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to save category')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{category ? 'Edit Category' : 'Create Category'}</DialogTitle>
          <DialogDescription>
            {category
              ? 'Update category details and organization settings'
              : 'Create a new category to organize your automation templates'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                placeholder="e.g., Network Automation"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Describe what templates belong in this category..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>

            {/* Color Picker */}
            <div className="space-y-2">
              <Label>Category Color</Label>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map((presetColor) => (
                  <button
                    key={presetColor}
                    type="button"
                    onClick={() => setColor(presetColor)}
                    className={`w-10 h-10 rounded-md border-2 transition-all ${
                      color === presetColor
                        ? 'border-primary scale-110'
                        : 'border-transparent hover:border-muted-foreground/50'
                    }`}
                    style={{ backgroundColor: presetColor }}
                  />
                ))}
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="w-10 h-10 rounded-md border cursor-pointer"
                  />
                  <span className="text-sm text-muted-foreground">{color}</span>
                </div>
              </div>
            </div>

            {/* Display Order */}
            <div className="space-y-2">
              <Label htmlFor="displayOrder">Display Order</Label>
              <Input
                id="displayOrder"
                type="number"
                min="0"
                value={displayOrder}
                onChange={(e) => setDisplayOrder(parseInt(e.target.value) || 0)}
              />
              <p className="text-xs text-muted-foreground">
                Lower numbers appear first in the category list
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              <X className="mr-2 h-4 w-4" />
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? 'Saving...' : category ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function CategoriesManagement() {
  const [categories, setCategories] = useState<TemplateCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<TemplateCategory | null>(null)

  // Confirmation dialog
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; category: TemplateCategory | null }>({
    isOpen: false,
    category: null,
  })

  useEffect(() => {
    loadCategories()
  }, [])

  const loadCategories = async () => {
    try {
      setLoading(true)
      const data = await awxService.listCategories()
      setCategories(data)
    } catch (error: any) {
      toast.error('Failed to load categories')
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = () => {
    setEditingCategory(null)
    setDialogOpen(true)
  }

  const handleEdit = (category: TemplateCategory) => {
    setEditingCategory(category)
    setDialogOpen(true)
  }

  const confirmDelete = (category: TemplateCategory) => {
    setDeleteConfirm({ isOpen: true, category })
  }

  const handleDelete = async () => {
    if (!deleteConfirm.category) return

    try {
      await awxService.deleteCategory(deleteConfirm.category.id)
      toast.success('Category Deleted', {
        description: `"${deleteConfirm.category.name}" has been permanently deleted.`,
      })
      loadCategories()
    } catch (error: any) {
      toast.error('Delete Failed', {
        description: error.response?.data?.error || 'Failed to delete category',
      })
    } finally {
      setDeleteConfirm({ isOpen: false, category: null })
    }
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="border-b">
        <div className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Template Categories</h1>
              <p className="text-muted-foreground mt-1">
                Organize your automation templates with categories
              </p>
            </div>
            <Button onClick={handleCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Create Category
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-sm text-muted-foreground">Loading categories...</p>
            </div>
          </div>
        ) : categories.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <Folder className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="font-semibold text-lg mb-2">No categories yet</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Create your first category to organize templates
              </p>
              <Button onClick={handleCreate}>
                <Plus className="mr-2 h-4 w-4" />
                Create Category
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {categories.map((category) => (
              <Card key={category.id} className="hover:shadow-lg transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3 flex-1">
                      <div
                        className="w-12 h-12 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: `${category.color}20` }}
                      >
                        <div
                          className="w-6 h-6 rounded-full"
                          style={{ backgroundColor: category.color }}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-lg line-clamp-1">
                          {category.name}
                        </CardTitle>
                        <p className="text-sm text-muted-foreground">
                          {category.template_count} template{category.template_count !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleEdit(category)}>
                          <Edit className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => confirmDelete(category)}
                          className="text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>

                {category.description && (
                  <CardContent className="pt-0">
                    <CardDescription className="line-clamp-2">
                      {category.description}
                    </CardDescription>
                  </CardContent>
                )}

                <CardContent className="pt-3 border-t">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Display Order:</span>
                    <span className="font-medium">{category.display_order}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Category Dialog */}
      <CategoryDialog
        category={editingCategory}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={loadCategories}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ isOpen: false, category: null })}
        onConfirm={handleDelete}
        title="Delete Category"
        message={
          deleteConfirm.category && deleteConfirm.category.template_count > 0
            ? `Category "${deleteConfirm.category.name}" contains ${deleteConfirm.category.template_count} template(s). Deleting this category will unassign these templates. Are you sure?`
            : `Are you sure you want to delete "${deleteConfirm.category?.name}"? This action cannot be undone.`
        }
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />
    </div>
  )
}
