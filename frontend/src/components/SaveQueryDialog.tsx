// SaveQueryDialog.tsx
//
// Dialog for saving the current canvas state as a named query. The user picks
// a name, optional description, category, and tags. If a query is already open
// (edit mode) the dialog defaults to the existing name with an update button.

import { useState, useEffect, useMemo } from 'react'
import { useQueryBuilderStore } from '../store/queryBuilderStore'
import { Save, Wrench, X } from 'lucide-react'
import { extractVariablesFromNodes } from '../lib/templateUtils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Textarea } from './ui/textarea'
import { CategoryCombobox } from './CategoryCombobox'
import { Checkbox } from './ui/checkbox'

interface SaveQueryDialogProps {
  isOpen: boolean
  onClose: () => void
  onSave: (data: {
    name: string
    description?: string
    category?: number
    tags?: string
    is_public?: boolean
    is_template?: boolean
    variables?: any[]
  }) => void
  flowData: { nodes: any[]; edges: any[] }
  generatedQuery: string
}

export function SaveQueryDialog({
  isOpen,
  onClose,
  onSave,
  flowData,
  generatedQuery,
}: SaveQueryDialogProps) {
  const { currentQueryId, currentQueryMetadata } = useQueryBuilderStore()

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: '',
    is_public: false,
    is_template: false,
  })
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')

  // Extract variables from flow data
  const extractedVariables = useMemo(() => {
    // Safety check: ensure flowData and nodes exist
    if (!flowData || !flowData.nodes || !Array.isArray(flowData.nodes)) {
      return []
    }
    return extractVariablesFromNodes(flowData.nodes)
  }, [flowData])

  // Pre-fill form when editing existing query
  useEffect(() => {
    if (isOpen && currentQueryMetadata) {
      setFormData({
        name: currentQueryMetadata.name || '',
        description: currentQueryMetadata.description || '',
        category: currentQueryMetadata.category ? String(currentQueryMetadata.category) : '',
        is_public: currentQueryMetadata.is_public || false,
        is_template: currentQueryMetadata.is_template || false,
      })
      setTags(currentQueryMetadata.tags ? currentQueryMetadata.tags.split(',').filter(Boolean) : [])
    } else if (!isOpen) {
      // Reset form when dialog closes
      setFormData({
        name: '',
        description: '',
        category: '',
        is_public: false,
        is_template: false,
          })
      setTags([])
      setTagInput('')
    }
  }, [isOpen, currentQueryMetadata])

  const handleAddTag = () => {
    const trimmedTag = tagInput.trim()
    if (trimmedTag && !tags.includes(trimmedTag)) {
      setTags([...tags, trimmedTag])
      setTagInput('')
    }
  }

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter(tag => tag !== tagToRemove))
  }

  const handleTagInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      handleAddTag()
    } else if (e.key === 'Backspace' && tagInput === '' && tags.length > 0) {
      // Remove last tag when backspace on empty input
      setTags(tags.slice(0, -1))
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Add current tag input if exists
    if (tagInput.trim()) {
      handleAddTag()
    }

    onSave({
      name: formData.name,
      description: formData.description || undefined,
      category: formData.category ? Number(formData.category) : undefined,
      tags: tags.length > 0 ? tags.join(',') : undefined,
      is_public: formData.is_public,
      is_template: formData.is_template,
      variables: formData.is_template ? extractedVariables : undefined,
    })
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <Save className="w-5 h-5 text-primary" />
            <DialogTitle>{currentQueryId ? 'Update Query' : 'Save Query'}</DialogTitle>
          </div>
          <DialogDescription>
            {currentQueryId
              ? 'Update your query with the latest changes.'
              : 'Save your query for future use. Fill in the details below.'
            }
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">
              Query Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              name="name"
              type="text"
              required
              minLength={3}
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="e.g., Tenant Endpoint Lookup"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              name="description"
              rows={3}
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Describe what this query does..."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">Category</Label>
            <CategoryCombobox
              value={formData.category}
              onChange={(value) => setFormData(prev => ({ ...prev, category: value }))}
            />
            <p className="text-xs text-muted-foreground">
              Search to filter, or type a new name and press Enter to create. Hover a category to rename or delete.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tags">Tags</Label>
            <div className="space-y-2">
              {/* Tag badges */}
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-primary/10 text-primary rounded-md text-sm font-medium"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        className="hover:bg-primary/20 rounded-sm p-0.5 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {/* Tag input */}
              <Input
                id="tags"
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagInputKeyDown}
                onBlur={handleAddTag}
                placeholder={tags.length === 0 ? "Type a tag and press Enter or comma" : "Add another tag..."}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Press Enter or comma to add a tag • Backspace to remove
            </p>
          </div>

          <div className="flex items-start space-x-3">
            <Checkbox
              id="is_public"
              checked={formData.is_public}
              onCheckedChange={(checked) =>
                setFormData(prev => ({ ...prev, is_public: checked === true }))
              }
            />
            <div className="grid gap-1.5 leading-none">
              <Label
                htmlFor="is_public"
                className="text-sm font-normal cursor-pointer"
              >
                Make this query public
              </Label>
              <p className="text-xs text-muted-foreground">
                Public queries can be viewed by all users
              </p>
            </div>
          </div>

          {/* Template Checkbox */}
          <div className="flex items-start space-x-3 border border-border rounded-lg p-3 bg-accent/20">
            <Checkbox
              id="is_template"
              checked={formData.is_template}
              onCheckedChange={(checked) =>
                setFormData(prev => ({ ...prev, is_template: checked === true }))
              }
            />
            <div className="grid gap-1.5 leading-none flex-1">
              <Label
                htmlFor="is_template"
                className="text-sm font-normal cursor-pointer flex items-center gap-2"
              >
                <Wrench className="w-4 h-4" />
                Save as Template
              </Label>
              <p className="text-xs text-muted-foreground">
                This query can be reused with different variable values
              </p>

              {/* Show detected variables */}
              {extractedVariables.length > 0 && (
                <div className="mt-2 space-y-1">
                  <p className="text-xs font-medium text-foreground">
                    Detected Variables ({extractedVariables.length}):
                  </p>
                  <div className="space-y-1">
                    {extractedVariables.map((variable) => (
                      <div key={variable.id} className="text-xs text-muted-foreground flex items-center gap-2">
                        <code className="px-1.5 py-0.5 bg-background rounded">
                          {variable.label}
                        </code>
                        <span className="text-xs">
                          ({variable.type}, {variable.required ? 'required' : 'optional'})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {extractedVariables.length === 0 && formData.is_template && (
                <div className="mt-2 text-xs text-orange-600 bg-orange-50 p-2 rounded border border-orange-200">
                  No variables detected. Use the 🔧 button in Filter nodes to create template variables.
                </div>
              )}

            </div>
          </div>

          {/* Query Preview */}
          <div className="border border-border rounded-md p-3 bg-muted/50">
            <p className="text-xs font-medium text-foreground mb-2">Query Preview:</p>
            <code className="text-xs text-muted-foreground break-all">
              {(() => {
                if (!generatedQuery) return 'No query generated yet'
                try {
                  // Decode URL for better readability
                  return decodeURIComponent(generatedQuery)
                } catch {
                  // If decoding fails, show original
                  return generatedQuery
                }
              })()}
            </code>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!formData.name.trim() || formData.name.length < 3}
            >
              <Save className="w-4 h-4 mr-2" />
              {currentQueryId ? 'Update Query' : 'Save Query'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
