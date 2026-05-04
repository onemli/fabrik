// Library.tsx
//
// Saved query library — searchable, sortable list of all queries the current user
// can access (own + shared + public). Opening a query loads its canvas state into
// the query builder store and navigates to the builder. Export/import is also here.

import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { queriesService } from '@/services/queries'
import {
  Search,
  Plus,
  SlidersHorizontal,
  Download,
  Upload,
  FileText,
  Sparkles,
  Activity,
  Star,
  Folder,
  Tag,
  Filter,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
// Grid view removed - using professional table layout only
import { ListView } from '@/components/library/ListView'
import { CategoryManager } from '@/components/library/CategoryManager'
import { ExportDialog } from '@/components/library/ExportDialog'
import { ImportDialog } from '@/components/library/ImportDialog'
import { EmptyState } from '@/components/library/EmptyState'
import { LibrarySkeletonLoader } from '@/components/LibrarySkeletonLoader'

type ViewMode = 'grid' | 'list'
type SortBy = 'recent' | 'name' | 'usage' | 'favorites'
type FilterMode = 'all' | 'mine' | 'public' | 'favorites'

export default function Library() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [searchParams, setSearchParams] = useSearchParams()

  // Get initial tab from URL parameter, default to 'queries'
  const getInitialTab = (): 'queries' | 'templates' | 'categories' => {
    const tabParam = searchParams.get('tab')
    if (tabParam === 'templates' || tabParam === 'categories') {
      return tabParam
    }
    return 'queries'
  }

  // State
  const [activeTab, setActiveTab] = useState<'queries' | 'templates' | 'categories'>(getInitialTab())
  const [viewMode, _setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('library-view-mode')
    return (saved as ViewMode) || 'list'
  })
  const [sortBy, setSortBy] = useState<SortBy>('recent')
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null)
  const [selectedQueryIds, setSelectedQueryIds] = useState<number[]>([])
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [showFilters, setShowFilters] = useState(false)

  // Sync activeTab with URL parameter
  useEffect(() => {
    const tabParam = searchParams.get('tab')
    const validTabs = ['queries', 'templates', 'categories']

    if (tabParam && validTabs.includes(tabParam)) {
      setActiveTab(tabParam as 'queries' | 'templates' | 'categories')
    } else if (!tabParam) {
      setActiveTab('queries')
    }
  }, [searchParams])

  // Update URL when tab changes
  const handleTabChange = (newTab: 'queries' | 'templates' | 'categories') => {
    setActiveTab(newTab)
    setSearchParams({ tab: newTab })
  }

  // Persist view mode to localStorage
  useEffect(() => {
    localStorage.setItem('library-view-mode', viewMode)
  }, [viewMode])

  // Fetch all data (pagination handled by ListView component)
  const {
    data: queriesData,
    isLoading: queriesLoading,
  } = useQuery({
    queryKey: ['saved-queries-paginated', activeTab, searchQuery, filterMode, selectedCategory],
    queryFn: () =>
      queriesService.getSavedQueriesPaginated({
        page: 1,
        page_size: 1000,
        search: searchQuery || undefined,
        category: selectedCategory || undefined,
        is_favorite: filterMode === 'favorites' || undefined,
        is_owner: filterMode === 'mine' || undefined,
        is_template: activeTab === 'templates' ? true : activeTab === 'queries' ? false : undefined,
      }),
    enabled: !!user && activeTab !== 'categories',
  })

  const queries = useMemo(() => {
    return queriesData?.results ?? []
  }, [queriesData])

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => queriesService.getCategories(),
    enabled: !!user,
  })

  // Fetch separate stats for counts (independent of active tab)
  const { data: queriesCount = { count: 0 } } = useQuery({
    queryKey: ['saved-queries-count', 'queries'],
    queryFn: () => queriesService.getSavedQueriesPaginated({ page: 1, page_size: 1, is_template: false, is_owner: true }),
    enabled: !!user,
    staleTime: 30000,
  })

  const { data: templatesCount = { count: 0 } } = useQuery({
    queryKey: ['saved-queries-count', 'templates'],
    queryFn: () => queriesService.getSavedQueriesPaginated({ page: 1, page_size: 1, is_template: true, is_owner: true }),
    enabled: !!user,
    staleTime: 30000,
  })

  // Sort data (filtering is done by backend via useInfiniteQuery)
  const filteredAndSortedItems = useMemo(() => {
    let items = [...queries]

    if (filterMode === 'public') {
      items = items.filter((q: any) => q.is_public)
    }

    items.sort((a: any, b: any) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name)
        case 'usage':
          return (b.execution_count || 0) - (a.execution_count || 0)
        case 'favorites':
          return (b.is_favorite ? 1 : 0) - (a.is_favorite ? 1 : 0)
        case 'recent':
        default:
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      }
    })

    return items
  }, [queries, filterMode, sortBy])

  // Stats calculations using separate count queries
  const stats = useMemo(() => {
    const totalExecutions = queries.reduce((sum: number, q: any) => sum + (q.execution_count || 0), 0)
    const favorites = queries.filter((q: any) => q.is_favorite)

    return {
      totalQueries: queriesCount.count || 0,
      totalTemplates: templatesCount.count || 0,
      totalExecutions,
      favorites: favorites.length,
    }
  }, [queries, queriesCount, templatesCount])

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center glass-strong border border-border/20 rounded-2xl p-12 max-w-md animate-scale-in">
          <h2 className="text-2xl font-bold mb-4 text-foreground">Authentication Required</h2>
          <p className="text-muted-foreground mb-6">Please log in to access your library</p>
          <Button
            onClick={() => navigate('/login')}
            className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all hover:scale-[1.02]"
          >
            Go to Login
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">

      {/* Professional Header - Premium Glass */}
      <div className="border-b border-border/20 flex-shrink-0">
        <div className="px-8 py-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Library</h1>
              <p className="text-muted-foreground mt-1">Manage your queries, templates, and categories</p>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setImportDialogOpen(true)}
                className="glass border-border/20 text-foreground hover:border-primary/30 hover:bg-accent/50 transition-all hover:scale-[1.02]"
              >
                <Upload className="w-4 h-4 mr-2" />
                Import
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setExportDialogOpen(true)}
                disabled={selectedQueryIds.length === 0}
                className="glass border-border/20 text-foreground hover:border-primary/30 hover:bg-accent/50 transition-all hover:scale-[1.02] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                <Download className="w-4 h-4 mr-2" />
                Export {selectedQueryIds.length > 0 && `(${selectedQueryIds.length})`}
              </Button>
              <Button
                onClick={() => navigate('/builder')}
                size="sm"
                className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all hover:scale-[1.02]"
              >
                <Plus className="w-4 h-4" />
                New Query
              </Button>
            </div>
          </div>

          {/* Stats Cards - Premium Glassmorphism */}
          <div className="grid grid-cols-4 gap-4">
            <div className="group glass border border-border/20 rounded-xl p-5 hover:border-primary/30 hover:bg-muted/30 transition-all duration-200 hover-lift">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-primary/10 rounded-lg group-hover:bg-primary/15 transition-colors">
                  <FileText className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-foreground">{stats.totalQueries}</div>
                  <div className="text-xs text-muted-foreground">My Queries</div>
                </div>
              </div>
            </div>

            <div className="group glass border border-border/20 rounded-xl p-5 hover:border-purple-500/30 hover:bg-muted/30 transition-all duration-200 hover-lift">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-purple-500/10 rounded-lg group-hover:bg-purple-500/15 transition-colors">
                  <Sparkles className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-foreground">{stats.totalTemplates}</div>
                  <div className="text-xs text-muted-foreground">Templates</div>
                </div>
              </div>
            </div>

            <div className="group glass border border-border/20 rounded-xl p-5 hover:border-emerald-500/30 hover:bg-muted/30 transition-all duration-200 hover-lift">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-emerald-500/10 rounded-lg group-hover:bg-emerald-500/15 transition-colors">
                  <Activity className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-foreground">{stats.totalExecutions.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">Executions</div>
                </div>
              </div>
            </div>

            <div className="group glass border border-border/20 rounded-xl p-5 hover:border-yellow-500/30 hover:bg-muted/30 transition-all duration-200 hover-lift">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-yellow-500/10 rounded-lg group-hover:bg-yellow-500/15 transition-colors">
                  <Star className="w-5 h-5 text-yellow-400" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-foreground">{stats.favorites}</div>
                  <div className="text-xs text-muted-foreground">Favorites</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Premium Underline Tabs */}
        <div className="px-8">
          <div className="flex items-center gap-8 border-b border-border/20">
            <button
              onClick={() => handleTabChange('queries')}
              className={cn(
                'group flex items-center gap-2 px-2 py-4 border-b-2 transition-all duration-200 font-semibold',
                activeTab === 'queries'
                  ? 'border-primary text-white'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              )}
            >
              <Folder className={cn("w-4 h-4 transition-colors", activeTab === 'queries' ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} />
              <span className="text-sm">Queries</span>
              <Badge variant={activeTab === 'queries' ? 'default' : 'secondary'} className="ml-1 text-xs px-2 py-0.5 transition-none">
                {stats.totalQueries}
              </Badge>
            </button>

            <button
              onClick={() => handleTabChange('templates')}
              className={cn(
                'group flex items-center gap-2 px-2 py-4 border-b-2 transition-all duration-200 font-semibold',
                activeTab === 'templates'
                  ? 'border-purple-500 text-white'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              )}
            >
              <Sparkles className={cn("w-4 h-4 transition-colors", activeTab === 'templates' ? 'text-purple-400' : 'text-muted-foreground group-hover:text-foreground')} />
              <span className="text-sm">Templates</span>
              <Badge variant={activeTab === 'templates' ? 'default' : 'secondary'} className="ml-1 text-xs px-2 py-0.5 transition-none">
                {stats.totalTemplates}
              </Badge>
            </button>

            <button
              onClick={() => handleTabChange('categories')}
              className={cn(
                'group flex items-center gap-2 px-2 py-4 border-b-2 transition-all duration-200 font-semibold',
                activeTab === 'categories'
                  ? 'border-blue-500 text-white'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              )}
            >
              <Tag className={cn("w-4 h-4 transition-colors", activeTab === 'categories' ? 'text-blue-400' : 'text-muted-foreground group-hover:text-foreground')} />
              <span className="text-sm">Categories</span>
              <Badge variant={activeTab === 'categories' ? 'default' : 'secondary'} className="ml-1 text-xs px-2 py-0.5 transition-none">
                {categories.length}
              </Badge>
            </button>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="px-8 py-6 flex-1 flex flex-col">
        {activeTab === 'categories' ? (
          <div className="flex-1">
            <CategoryManager />
          </div>
        ) : (
          <div className="flex-1 flex flex-col">
            {/* Premium Toolbar */}
            <div className="mb-6 space-y-4">
              {/* Main Toolbar */}
              <div className="flex items-center gap-3">
                {/* Premium Search */}
                <div className="flex-1 max-w-md relative group">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-hover:text-muted-foreground transition-colors" />
                  <Input
                    type="text"
                    placeholder={`Search ${activeTab}...`}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 h-10 glass border-border/20 text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-accent/50"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Filters Toggle - Glass Effect */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowFilters(!showFilters)}
                  className={cn(
                    "gap-2 glass border-border/20 text-foreground hover:border-primary/30 hover:bg-accent/50 transition-all hover:scale-[1.02]",
                    showFilters && "border-primary/50 bg-primary/10"
                  )}
                >
                  <SlidersHorizontal className="w-4 h-4" />
                  Filters
                  {(filterMode !== 'all' || selectedCategory) && (
                    <Badge variant="secondary" className="ml-1 bg-primary/20 text-foreground border-0">
                      {[filterMode !== 'all' ? 1 : 0, selectedCategory ? 1 : 0].reduce((a, b) => a + b)}
                    </Badge>
                  )}
                </Button>

                <div className="h-6 w-px bg-accent/20" />

                {/* View Mode: List Only - Professional Table Layout */}

                {/* Sort Dropdown */}
                <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
                  <SelectTrigger className="w-[160px] h-10 glass border-border/20 text-foreground hover:border-primary/30 transition-all">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="glass-strong border-border/20">
                    <SelectItem value="recent">Most Recent</SelectItem>
                    <SelectItem value="name">Name (A-Z)</SelectItem>
                    <SelectItem value="usage">Most Used</SelectItem>
                    <SelectItem value="favorites">Favorites First</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Premium Filter Bar - Collapsible Glass Panel */}
              {showFilters && (
                <div className="flex items-center gap-3 p-4 glass border border-border/20 rounded-xl animate-slide-down">
                  <Filter className="w-4 h-4 text-primary" />

                  {/* Filter Mode */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Show:</span>
                    <div className="flex gap-1">
                      {(['all', 'mine', 'public', 'favorites'] as FilterMode[]).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => setFilterMode(mode)}
                          className={cn(
                            'px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200',
                            filterMode === mode
                              ? 'bg-primary text-white shadow-sm shadow-primary/30'
                              : 'glass border border-border text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-accent/20'
                          )}
                        >
                          {mode === 'all' && 'All'}
                          {mode === 'mine' && 'My Items'}
                          {mode === 'public' && 'Public'}
                          {mode === 'favorites' && 'Favorites'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="h-6 w-px bg-accent/20" />

                  {/* Category Filter */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Category:</span>
                    <Select
                      value={selectedCategory?.toString() || 'all'}
                      onValueChange={(v) => setSelectedCategory(v === 'all' ? null : parseInt(v))}
                    >
                      <SelectTrigger className="w-[200px] glass border-border/20 text-foreground hover:border-primary/30 transition-all">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="glass-strong border-border/20">
                        <SelectItem value="all">All Categories</SelectItem>
                        {categories.map((cat: any) => (
                          <SelectItem key={cat.id} value={cat.id.toString()}>
                            {cat.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Clear Filters */}
                  {(filterMode !== 'all' || selectedCategory) && (
                    <>
                      <div className="h-6 w-px bg-accent/20" />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setFilterMode('all')
                          setSelectedCategory(null)
                        }}
                        className="gap-2 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-all"
                      >
                        <X className="w-4 h-4" />
                        Clear Filters
                      </Button>
                    </>
                  )}
                </div>
              )}

              {/* Premium Selection Bar */}
              {selectedQueryIds.length > 0 && (
                <div className="flex items-center justify-between p-4 glass border border-primary/30 rounded-xl bg-primary/5 animate-slide-down">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                    <span className="text-sm font-medium text-foreground">
                      {selectedQueryIds.length} item{selectedQueryIds.length > 1 ? 's' : ''} selected
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedQueryIds([])}
                      className="text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-all"
                    >
                      Clear Selection
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setExportDialogOpen(true)}
                      className="glass border-border/20 text-foreground hover:border-primary/50 hover:bg-primary/10 transition-all hover:scale-[1.02]"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Export Selected
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Content Grid/List */}
            {queriesLoading ? (
              <LibrarySkeletonLoader viewMode={viewMode} count={9} />
            ) : filteredAndSortedItems.length === 0 ? (
              <EmptyState
                title={`No ${activeTab} found`}
                description={
                  searchQuery || filterMode !== 'all' || selectedCategory
                    ? 'Try adjusting your search or filters'
                    : `Create your first ${activeTab === 'queries' ? 'query' : 'template'} to get started`
                }
                action={
                  <Button onClick={() => navigate('/builder')} size="lg" className="gap-2">
                    <Plus className="w-4 h-4" />
                    Create {activeTab === 'queries' ? 'Query' : 'Template'}
                  </Button>
                }
              />
            ) : (
              <ListView
                items={filteredAndSortedItems}
                type={activeTab === 'templates' ? 'template' : 'query'}
                selectedIds={selectedQueryIds}
                onToggleSelect={(id) => {
                  if (selectedQueryIds.includes(id)) {
                    setSelectedQueryIds(selectedQueryIds.filter(qid => qid !== id))
                  } else {
                    setSelectedQueryIds([...selectedQueryIds, id])
                  }
                }}
              />
            )}
          </div>
        )}
      </div>

      {/* Dialogs */}
      <ExportDialog
        open={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
        selectedQueryIds={selectedQueryIds}
      />
      <ImportDialog
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
      />
    </div>
  )
}
