// SavedQueriesDialog.tsx
//
// Dialog for loading a saved query from the backend database onto the canvas.
// Shows saved queries grouped by category with search. Also shows template
// queries (marked is_template) so the user can find both personal queries
// and shared templates in one place.

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Badge } from './ui/badge'
import { Card } from './ui/card'
import { Search, Folder, Sparkles, Loader2, Tag } from 'lucide-react'
import { queriesService, SavedQueryListItem } from '@/services/queries'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import { useAuthStore } from '@/store/authStore'
import { cn } from '@/lib/utils'

interface SavedQueriesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type TabType = 'queries' | 'templates' | 'all'

export function SavedQueriesDialog({ open, onOpenChange }: SavedQueriesDialogProps) {
  const { loadFromSaved } = useQueryBuilderStore()
  const { user } = useAuthStore()
  const [activeTab, setActiveTab] = useState<TabType>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Fetch all saved queries and templates
  const { data: allItems = [], isLoading } = useQuery({
    queryKey: ['saved-queries-templates'],
    queryFn: () => queriesService.getSavedQueries(),
    enabled: !!user && open,
  })

  // Ensure allItems is always an array
  const items = useMemo(() => {
    return Array.isArray(allItems) ? allItems : []
  }, [allItems])

  // Filter items based on tab and search
  const filteredItems = useMemo(() => {
    let filtered = items

    // Filter by tab
    if (activeTab === 'queries') {
      filtered = filtered.filter(item => !item.is_template)
    } else if (activeTab === 'templates') {
      filtered = filtered.filter(item => item.is_template)
    }

    // Filter by search
    if (searchQuery.trim()) {
      const searchLower = searchQuery.toLowerCase()
      filtered = filtered.filter(item => {
        const nameMatch = item.name?.toLowerCase().includes(searchLower)
        const descMatch = item.description?.toLowerCase().includes(searchLower)
        const categoryMatch = item.category_name?.toLowerCase().includes(searchLower)
        const tagsMatch = item.tags_list?.some((tag: string) => tag.toLowerCase().includes(searchLower))
        return nameMatch || descMatch || categoryMatch || tagsMatch
      })
    }

    return filtered
  }, [items, activeTab, searchQuery])

  const handleLoadItem = async (item: SavedQueryListItem) => {
    try {
      // Fetch full query details
      const fullQuery = await queriesService.getSavedQuery(item.id)

      if (fullQuery.flow_data?.nodes && fullQuery.flow_data?.edges) {
        loadFromSaved(fullQuery.flow_data.nodes, fullQuery.flow_data.edges, fullQuery.name)
        onOpenChange(false)
      }
    } catch {
      /* ignore */
    }
  }

  // Stats
  const stats = useMemo(() => {
    return {
      totalQueries: items.filter(item => !item.is_template).length,
      totalTemplates: items.filter(item => item.is_template).length,
      total: items.length,
    }
  }, [items])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col glass-strong border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground">Saved Queries & Templates</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Load saved queries and templates to start building
          </DialogDescription>
        </DialogHeader>

        {/* Search Bar */}
        <div className="relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-hover:text-muted-foreground transition-colors" />
          <Input
            placeholder="Search by name, description, category, or tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 glass border-border text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all"
          />
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-border/50">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActiveTab('all')}
            className={cn(
              "rounded-none border-b-2 transition-all",
              activeTab === 'all'
                ? "border-primary text-foreground font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            )}
          >
            <Folder className="w-4 h-4 mr-2" />
            All ({stats.total})
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActiveTab('queries')}
            className={cn(
              "rounded-none border-b-2 transition-all",
              activeTab === 'queries'
                ? "border-primary text-foreground font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            )}
          >
            <Folder className="w-4 h-4 mr-2" />
            Queries ({stats.totalQueries})
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActiveTab('templates')}
            className={cn(
              "rounded-none border-b-2 transition-all",
              activeTab === 'templates'
                ? "border-purple-500 text-foreground font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            )}
          >
            <Sparkles className="w-4 h-4 mr-2" />
            Templates ({stats.totalTemplates})
          </Button>
        </div>

        {/* Items Grid */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>No {activeTab === 'all' ? 'items' : activeTab} found</p>
              <p className="text-sm mt-1">Try a different search or tab</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-1">
              {filteredItems.map((item) => (
                <Card
                  key={item.id}
                  className="p-4 glass border-border hover:bg-white/[0.02] hover:border-primary/50 transition-all cursor-pointer hover-lift"
                  onClick={() => handleLoadItem(item)}
                >
                  <div className="flex flex-col gap-3">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-sm mb-1 text-foreground truncate">
                          {item.name}
                        </h3>
                        {item.description && (
                          <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                            {item.description}
                          </p>
                        )}
                      </div>
                      {item.is_template && (
                        <Badge className="bg-purple-500/10 border-purple-500/30 text-purple-400 text-xs flex-shrink-0">
                          Template
                        </Badge>
                      )}
                    </div>

                    {/* Meta info */}
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {item.category_name && (
                        <div className="flex items-center gap-1">
                          <Tag className="w-3 h-3" />
                          <span>{item.category_name}</span>
                        </div>
                      )}
                      {item.created_by && (
                        <span>by {item.created_by.username}</span>
                      )}
                      {item.is_public && (
                        <Badge variant="outline" className="text-xs border-blue-500/30 bg-blue-500/10 text-blue-400">
                          Public
                        </Badge>
                      )}
                    </div>

                    {/* Tags */}
                    {item.tags_list && item.tags_list.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {item.tags_list.slice(0, 3).map((tag: string) => (
                          <Badge
                            key={tag}
                            variant="secondary"
                            className="text-xs glass border-border text-muted-foreground"
                          >
                            {tag}
                          </Badge>
                        ))}
                        {item.tags_list.length > 3 && (
                          <Badge variant="secondary" className="text-xs glass border-border text-muted-foreground">
                            +{item.tags_list.length - 3}
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Footer Stats */}
        <div className="pt-3 border-t border-border/50 text-xs text-muted-foreground">
          Showing {filteredItems.length} of {activeTab === 'all' ? stats.total : activeTab === 'queries' ? stats.totalQueries : stats.totalTemplates} {activeTab === 'all' ? 'items' : activeTab}
        </div>
      </DialogContent>
    </Dialog>
  )
}
