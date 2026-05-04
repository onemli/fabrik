// RegexPatterns.tsx
//
// CRUD page for the regex pattern library. Lists saved patterns with search,
// category filter, and inline create/edit dialog powered by the RegexBuilder
// component.

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Copy,
  Code2,
  Globe,
  Lock,
  Filter,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { RegexBuilder } from '@/components/RegexBuilder'
import {
  regexPatternService,
  type RegexPattern,
  type RegexPatternCreate,
} from '@/services/validation'

const CATEGORIES = [
  { value: 'all', label: 'All Categories' },
  { value: 'network', label: 'Network' },
  { value: 'naming', label: 'Naming Convention' },
  { value: 'format', label: 'Data Format' },
  { value: 'security', label: 'Security' },
  { value: 'custom', label: 'Custom' },
]

const CATEGORY_COLORS: Record<string, string> = {
  network: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  naming: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  format: 'bg-green-500/10 text-green-600 dark:text-green-400',
  security: 'bg-red-500/10 text-red-600 dark:text-red-400',
  custom: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
}

const EMPTY_FORM: RegexPatternCreate = {
  name: '',
  description: '',
  pattern: '',
  category: 'custom',
  test_strings: [],
  flags: [],
  error_message: '',
  is_public: false,
}

function RegexPatterns() {
  const [patterns, setPatterns] = useState<RegexPattern[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')

  // Dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingPattern, setEditingPattern] = useState<RegexPattern | null>(null)
  const [formData, setFormData] = useState<RegexPatternCreate>(EMPTY_FORM)
  const [isSaving, setIsSaving] = useState(false)

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<RegexPattern | null>(null)

  const fetchPatterns = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await regexPatternService.getPatterns({
        search: searchQuery || undefined,
        category: categoryFilter !== 'all' ? categoryFilter : undefined,
        ordering: '-created_at',
      })
      setPatterns(data)
    } catch (err: any) {
      toast.error(err.message || 'Failed to load patterns')
    } finally {
      setIsLoading(false)
    }
  }, [searchQuery, categoryFilter])

  useEffect(() => {
    fetchPatterns()
  }, [fetchPatterns])

  const openCreate = () => {
    setEditingPattern(null)
    setFormData(EMPTY_FORM)
    setIsDialogOpen(true)
  }

  const openEdit = (pattern: RegexPattern) => {
    setEditingPattern(pattern)
    setFormData({
      name: pattern.name,
      description: pattern.description,
      pattern: pattern.pattern,
      category: pattern.category,
      test_strings: pattern.test_strings || [],
      flags: pattern.flags || [],
      error_message: pattern.error_message || '',
      is_public: pattern.is_public,
    })
    setIsDialogOpen(true)
  }

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error('Name is required')
      return
    }
    if (!formData.pattern.trim()) {
      toast.error('Pattern is required')
      return
    }

    // Validate regex locally before sending
    try {
      new RegExp(formData.pattern)
    } catch {
      toast.error('Invalid regex pattern')
      return
    }

    setIsSaving(true)
    try {
      if (editingPattern) {
        await regexPatternService.updatePattern(editingPattern.id, formData)
        toast.success('Pattern updated')
      } else {
        await regexPatternService.createPattern(formData)
        toast.success('Pattern created')
      }
      setIsDialogOpen(false)
      fetchPatterns()
    } catch (err: any) {
      toast.error(err.message || 'Failed to save pattern')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await regexPatternService.deletePattern(deleteTarget.id)
      toast.success('Pattern deleted')
      setDeleteTarget(null)
      fetchPatterns()
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete pattern')
    }
  }

  const copyPattern = (pattern: string) => {
    navigator.clipboard.writeText(pattern)
    toast.success('Pattern copied to clipboard')
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="border-b border-border/20 flex-shrink-0">
        <div className="px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Regex Patterns</h1>
              <p className="text-muted-foreground mt-1">
                Build, test, and save reusable regex patterns for column validation
              </p>
            </div>
            <Button onClick={openCreate} className="gap-2">
              <Plus className="h-4 w-4" /> New Pattern
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col px-8 py-6 space-y-6">
      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search patterns..."
            className="pl-9"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-48">
            <Filter className="h-3.5 w-3.5 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map(cat => (
              <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Pattern cards */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : patterns.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Code2 className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">No patterns found</p>
          <p className="text-sm mt-1">
            {searchQuery || categoryFilter !== 'all'
              ? 'Try adjusting your filters'
              : 'Create your first regex pattern to get started'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {patterns.map((p) => (
            <Card key={p.id} className="group hover:border-primary/30 transition-colors">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-sm truncate">{p.name}</CardTitle>
                    {p.description && (
                      <CardDescription className="text-xs mt-1 line-clamp-2">
                        {p.description}
                      </CardDescription>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyPattern(p.pattern)}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    {p.can_edit && (
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(p)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {p.can_delete && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteTarget(p)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Pattern preview */}
                <div className="p-2 bg-muted rounded font-mono text-xs break-all select-all">
                  {p.pattern}
                </div>

                {/* Meta row */}
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className={cn('text-xs', CATEGORY_COLORS[p.category])}>
                    {p.category}
                  </Badge>
                  {p.is_public ? (
                    <Badge variant="outline" className="text-xs gap-1">
                      <Globe className="h-3 w-3" /> Public
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs gap-1 text-muted-foreground">
                      <Lock className="h-3 w-3" /> Private
                    </Badge>
                  )}
                  {p.usage_count > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {p.usage_count} usage{p.usage_count !== 1 ? 's' : ''}
                    </Badge>
                  )}
                  {p.flags && p.flags.length > 0 && (
                    <Badge variant="secondary" className="text-xs font-mono">
                      /{p.flags.join('')}
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingPattern ? 'Edit Pattern' : 'New Regex Pattern'}</DialogTitle>
            <DialogDescription>
              {editingPattern
                ? 'Update the pattern details and test strings'
                : 'Build and test a regex pattern, then save it to your library'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Name + Category row */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>Name</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., IPv4 Address"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select
                  value={formData.category}
                  onValueChange={(v) => setFormData({ ...formData, category: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.filter(c => c.value !== 'all').map(cat => (
                      <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="What does this pattern match?"
                rows={2}
              />
            </div>

            {/* Error message */}
            <div className="space-y-1.5">
              <Label>Error Message (shown when validation fails)</Label>
              <Input
                value={formData.error_message}
                onChange={(e) => setFormData({ ...formData, error_message: e.target.value })}
                placeholder="e.g., Must be a valid IPv4 address"
              />
            </div>

            {/* Visibility */}
            <div className="flex items-center gap-3">
              <Switch
                checked={formData.is_public}
                onCheckedChange={(v) => setFormData({ ...formData, is_public: v })}
              />
              <Label className="text-sm">
                {formData.is_public ? 'Public — visible to all users' : 'Private — only visible to you'}
              </Label>
            </div>

            <hr className="border-border" />

            {/* Regex Builder */}
            <RegexBuilder
              value={formData.pattern}
              flags={formData.flags}
              onChange={(pattern, flags) => setFormData({ ...formData, pattern, flags })}
              testStrings={formData.test_strings.map(t => t.value)}
              onTestStringsChange={(strings) =>
                setFormData({
                  ...formData,
                  test_strings: strings.map(s => ({ value: s, should_match: true })),
                })
              }
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving...' : editingPattern ? 'Update' : 'Save Pattern'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Pattern</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteTarget?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </div>
  )
}

export default RegexPatterns
