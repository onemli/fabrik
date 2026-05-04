// library/CategoryManager.tsx
//
// Inline category management panel that lives inside the Library page sidebar.
// Users can create, rename, and delete categories here without leaving the page.
// Each category row shows how many queries it contains so you know before deleting.

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queriesService } from '@/services/queries'
import { Plus, Edit, Trash2, Tag, ChevronDown, ChevronUp, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'

export function CategoryManager() {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<any>(null)
  const [expandedCategory, setExpandedCategory] = useState<number | null>(null)
  const [deleteConfirmCategory, setDeleteConfirmCategory] = useState<any>(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    color: '#10b981',
  })

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => queriesService.getCategories(),
  })

  // Fetch queries for expanded category
  const { data: categoryQueries } = useQuery({
    queryKey: ['category-queries', expandedCategory],
    queryFn: () => queriesService.getSavedQueriesPaginated({
      category: expandedCategory!,
      page_size: 100,
    }),
    enabled: !!expandedCategory,
  })

  const createMutation = useMutation({
    mutationFn: (data: any) => queriesService.createCategory(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] })
      setDialogOpen(false)
      resetForm()
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => queriesService.updateCategory(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] })
      setDialogOpen(false)
      resetForm()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => queriesService.deleteCategory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] })
      queryClient.invalidateQueries({ queryKey: ['saved-queries-paginated'] })
    },
  })

  const resetForm = () => {
    setFormData({ name: '', description: '', color: '#10b981' })
    setEditingCategory(null)
  }

  const handleSubmit = () => {
    if (editingCategory) {
      updateMutation.mutate({ id: editingCategory.id, data: formData })
    } else {
      createMutation.mutate(formData)
    }
  }

  const handleDelete = (category: any) => {
    setDeleteConfirmCategory(category)
  }

  const handleEdit = (category: any) => {
    setEditingCategory(category)
    setFormData({
      name: category.name,
      description: category.description || '',
      color: category.color || '#10b981',
    })
    setDialogOpen(true)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">Categories</h2>
          <p className="text-sm text-muted-foreground">Organize your queries with categories</p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="gap-2">
          <Plus className="w-4 h-4" />
          New Category
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {categories.map((category: any) => (
          <div
            key={category.id}
            className="bg-card border border-border rounded-lg p-4 hover:shadow-md transition-all"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: `${category.color}20` }}
                >
                  <Tag className="w-5 h-5" style={{ color: category.color }} />
                </div>
                <div>
                  <h3 className="font-semibold">{category.name}</h3>
                  <p className="text-xs text-muted-foreground">{category.query_count || 0} queries</p>
                </div>
              </div>
            </div>

            {category.description && (
              <p className="text-sm text-muted-foreground mb-3">{category.description}</p>
            )}

            <div className="flex gap-2 mb-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setExpandedCategory(
                  expandedCategory === category.id ? null : category.id
                )}
                className="flex-1"
              >
                {expandedCategory === category.id ? (
                  <>
                    <ChevronUp className="w-3 h-3 mr-2" />
                    Hide Queries
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-3 h-3 mr-2" />
                    View Queries
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleEdit(category)}
                className="px-3"
              >
                <Edit className="w-3 h-3" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDelete(category)}
                className="px-3 hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>

            {/* Expandable Query List */}
            {expandedCategory === category.id && (
              <div className="mt-3 pt-3 border-t border-border space-y-2">
                {!categoryQueries ? (
                  <p className="text-sm text-muted-foreground text-center py-2">Loading...</p>
                ) : categoryQueries.results.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-2">No queries in this category</p>
                ) : (
                  categoryQueries.results.map((query: any) => (
                    <div
                      key={query.id}
                      className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors"
                    >
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm flex-1 truncate">{query.name}</span>
                      {query.is_template && (
                        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">Template</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCategory ? 'Edit Category' : 'Create Category'}</DialogTitle>
            <DialogDescription>
              {editingCategory ? 'Update category details' : 'Add a new category to organize your queries'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Category name"
              />
            </div>

            <div>
              <Label htmlFor="description">Description (Optional)</Label>
              <Input
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Category description"
              />
            </div>

            <div>
              <Label htmlFor="color">Color</Label>
              <div className="flex gap-2">
                <Input
                  id="color"
                  type="color"
                  value={formData.color}
                  onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                  className="w-20 h-10"
                />
                <Input
                  value={formData.color}
                  onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                  placeholder="#10b981"
                  className="flex-1"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!formData.name}>
              {editingCategory ? 'Update' : 'Create'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!deleteConfirmCategory}
        onClose={() => setDeleteConfirmCategory(null)}
        onConfirm={() => {
          if (deleteConfirmCategory) {
            deleteMutation.mutate(deleteConfirmCategory.id)
            setDeleteConfirmCategory(null)
          }
        }}
        title="Delete Category"
        message={
          deleteConfirmCategory?.query_count > 0
            ? `Are you sure you want to delete "${deleteConfirmCategory?.name}"? This category has ${deleteConfirmCategory?.query_count} ${deleteConfirmCategory?.query_count === 1 ? 'query' : 'queries'}. The queries will not be deleted, but they will be uncategorized.`
            : `Are you sure you want to delete "${deleteConfirmCategory?.name}"?`
        }
        confirmText="Delete"
        variant="danger"
      />
    </div>
  )
}
