// library/GridView.tsx
//
// Card-based grid layout for the query library. Each card shows the query name,
// category, last-run info, and quick-action buttons (open, run, duplicate, delete).
// Switching between GridView and ListView is handled by the parent Library page.

import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queriesService } from '@/services/queries'
import { useAuthStore } from '@/store/authStore'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import { Heart, Trash2, Copy, Play, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/ConfirmDialog'

interface GridViewProps {
  items: any[]
  type: 'query' | 'template'
  selectedIds: number[]
  onToggleSelect: (id: number) => void
}

export function GridView({ items, type: _type, selectedIds, onToggleSelect }: GridViewProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const { loadFromSaved } = useQueryBuilderStore()
  const [deleteConfirmItem, setDeleteConfirmItem] = useState<any>(null)

  const favoriteMutation = useMutation({
    mutationFn: (id: number) => queriesService.favoriteQuery(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-queries-paginated'] })
      queryClient.invalidateQueries({ queryKey: ['saved-queries-count', 'queries'] })
      queryClient.invalidateQueries({ queryKey: ['saved-queries-count', 'templates'] })
    },
  })

  const duplicateMutation = useMutation({
    mutationFn: (id: number) => queriesService.duplicateQuery(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-queries-paginated'] })
      queryClient.invalidateQueries({ queryKey: ['saved-queries-count', 'queries'] })
      queryClient.invalidateQueries({ queryKey: ['saved-queries-count', 'templates'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => queriesService.deleteSavedQuery(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-queries-paginated'] })
      queryClient.invalidateQueries({ queryKey: ['saved-queries-count', 'queries'] })
      queryClient.invalidateQueries({ queryKey: ['saved-queries-count', 'templates'] })
    },
  })

  const handleDelete = (item: any) => {
    setDeleteConfirmItem(item)
  }

  const handleLoadQuery = async (query: any) => {
    const fullQuery = await queriesService.getSavedQuery(query.id)

    // Update Output node with enable_time_machine value
    const updatedNodes = fullQuery.flow_data.nodes.map((node: any) => {
      if (node.type === 'output') {
        return {
          ...node,
          data: {
            ...node.data,
            enableTimeMachine: fullQuery.enable_time_machine || false,
            isValidationQuery: fullQuery.is_validation_query || false,
          }
        }
      }
      return node
    })

    // Pass query ID and metadata to loadFromSaved
    loadFromSaved(
      updatedNodes,
      fullQuery.flow_data.edges,
      fullQuery.name,
      fullQuery.id,
      {
        name: fullQuery.name,
        description: fullQuery.description,
        category: fullQuery.category,
        tags: fullQuery.tags,
        is_public: fullQuery.is_public,
        is_template: fullQuery.is_template,
      }
    )
    navigate(`/builder/${fullQuery.id}`)
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map((item) => (
        <div
          key={item.id}
          className="relative glass border border-border/50 rounded-xl overflow-hidden hover:border-border hover:bg-muted/30 transition-all duration-200 group hover-lift animate-fade-in"
        >
          {/* Selection Checkbox */}
          <div className="absolute top-3 left-3 z-10">
            <Checkbox
              checked={selectedIds.includes(item.id)}
              onCheckedChange={() => onToggleSelect(item.id)}
              className="glass border-border bg-background/50 data-[state=checked]:bg-primary data-[state=checked]:border-primary shadow-sm"
            />
          </div>

          {/* Template Badge */}
          {item.is_template && (
            <div className="absolute top-3 right-3 z-10">
              <Badge variant="secondary" className="gap-1 glass border-purple-500/30 bg-purple-500/10 text-purple-300">
                <Sparkles className="w-3 h-3" />
                Template
              </Badge>
            </div>
          )}

          {/* Card Content */}
          <div className="p-5 pt-12">
            {/* Title */}
            <h3 className="text-lg font-semibold text-foreground mb-2 line-clamp-2 min-h-[3.5rem] group-hover:text-primary transition-colors">
              {item.name}
            </h3>

            {/* Description */}
            <p className="text-sm text-muted-foreground mb-4 line-clamp-2 min-h-[2.5rem]">
              {item.description || 'No description'}
            </p>

            {/* Category */}
            {item.category_name && (
              <Badge variant="outline" className="mb-4 glass border-border text-muted-foreground">
                {item.category_name}
              </Badge>
            )}

            {/* Metadata */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4">
              <div className="flex items-center gap-1">
                <Play className="w-3 h-3" />
                {item.execution_count || 0} runs
              </div>
              <div className="flex items-center gap-1">
                {item.is_favorite && <Heart className="w-3 h-3 fill-red-500 text-red-500" />}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <Button
                onClick={() => handleLoadQuery(item)}
                size="sm"
                className="flex-1 bg-primary hover:bg-primary/90 text-foreground shadow-sm shadow-primary/20 hover:shadow-primary/30 transition-all hover:scale-[1.02]"
              >
                Open
              </Button>

              <Button
                onClick={() => favoriteMutation.mutate(item.id)}
                variant="outline"
                size="sm"
                className="px-2 glass border-border text-foreground hover:border-red-500/50 hover:bg-red-500/10 transition-all"
              >
                <Heart
                  className={`w-4 h-4 ${item.is_favorite ? 'fill-red-500 text-red-500' : ''}`}
                />
              </Button>

              <Button
                onClick={() => duplicateMutation.mutate(item.id)}
                variant="outline"
                size="sm"
                className="px-2 glass border-border text-foreground hover:border-border hover:bg-muted/50 transition-all"
              >
                <Copy className="w-4 h-4" />
              </Button>

              {item.created_by?.id === user?.id && (
                <Button
                  onClick={() => handleDelete(item)}
                  variant="outline"
                  size="sm"
                  className="px-2 glass border-border text-foreground hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-400 transition-all"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      ))}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!deleteConfirmItem}
        onClose={() => setDeleteConfirmItem(null)}
        onConfirm={() => {
          if (deleteConfirmItem) {
            deleteMutation.mutate(deleteConfirmItem.id)
            setDeleteConfirmItem(null)
          }
        }}
        title={`Delete ${deleteConfirmItem?.is_template ? 'Template' : 'Query'}`}
        message={`Are you sure you want to delete this ${deleteConfirmItem?.is_template ? 'template' : 'query'}? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
      />
    </div>
  )
}
