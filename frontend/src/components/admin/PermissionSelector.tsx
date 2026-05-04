// admin/PermissionSelector.tsx — searchable checkbox list for assigning Django
// content-type permissions to a group. Groups permissions by app label.

import { useState, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Search, CheckSquare, XSquare, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface Permission {
  id: number
  name: string
  codename: string
  // Backend occasionally omits category for built-in permissions; default to
  // 'Other' at render time rather than forcing callers to normalize.
  category?: string
  description?: string
  is_dangerous?: boolean
  content_type: {
    id: number
    app_label: string
    model: string
  }
}

interface PermissionSelectorProps {
  permissions: Permission[]
  selectedIds: number[]
  onSelectionChange: (ids: number[]) => void
  isLoading?: boolean
}

export function PermissionSelector({
  permissions,
  selectedIds,
  onSelectionChange,
  isLoading = false
}: PermissionSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedCategories, setExpandedCategories] = useState<string[]>([])

  // Group permissions by category
  const permissionsByCategory = useMemo(() => {
    const grouped = new Map<string, Permission[]>()

    permissions.forEach(perm => {
      const category = perm.category || 'Other'
      if (!grouped.has(category)) {
        grouped.set(category, [])
      }
      grouped.get(category)!.push(perm)
    })

    // Sort categories
    const sortedCategories = Array.from(grouped.entries()).sort((a, b) => {
      // Priority order for categories
      const priority: Record<string, number> = {
        'Queries': 1,
        'APIC Connections': 2,
        'Background Tasks': 3,
        'Scheduled Tasks': 4,
        'Time Machine': 5,
        'User Management': 6,
        'Group Management': 7,
        'Audit Logs': 8,
      }

      const aPriority = priority[a[0]] || 99
      const bPriority = priority[b[0]] || 99

      if (aPriority !== bPriority) {
        return aPriority - bPriority
      }

      return a[0].localeCompare(b[0])
    })

    return new Map(sortedCategories)
  }, [permissions])

  // Filter permissions by search query
  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) {
      return permissionsByCategory
    }

    const query = searchQuery.toLowerCase()
    const filtered = new Map<string, Permission[]>()

    permissionsByCategory.forEach((perms, category) => {
      const matchingPerms = perms.filter(
        p =>
          p.name.toLowerCase().includes(query) ||
          p.codename.toLowerCase().includes(query) ||
          (p.description && p.description.toLowerCase().includes(query))
      )

      if (matchingPerms.length > 0) {
        filtered.set(category, matchingPerms)
      }
    })

    return filtered
  }, [permissionsByCategory, searchQuery])

  // Calculate statistics
  const stats = useMemo(() => {
    const totalCount = permissions.length
    const selectedCount = selectedIds.length
    const dangerousSelected = permissions.filter(
      p => selectedIds.includes(p.id) && p.is_dangerous
    ).length

    return { totalCount, selectedCount, dangerousSelected }
  }, [permissions, selectedIds])

  // Handlers
  const handleSelectAll = () => {
    onSelectionChange(permissions.map(p => p.id))
  }

  const handleClearAll = () => {
    onSelectionChange([])
  }

  const handleTogglePermission = (permId: number) => {
    if (selectedIds.includes(permId)) {
      onSelectionChange(selectedIds.filter(id => id !== permId))
    } else {
      onSelectionChange([...selectedIds, permId])
    }
  }

  const handleToggleCategory = (categoryPerms: Permission[]) => {
    const categoryPermIds = categoryPerms.map(p => p.id)
    const allSelected = categoryPermIds.every(id => selectedIds.includes(id))

    if (allSelected) {
      // Deselect all in category
      onSelectionChange(selectedIds.filter(id => !categoryPermIds.includes(id)))
    } else {
      // Select all in category
      const newSelected = new Set([...selectedIds, ...categoryPermIds])
      onSelectionChange(Array.from(newSelected))
    }
  }

  const handleExpandAll = () => {
    setExpandedCategories(Array.from(filteredCategories.keys()))
  }

  const handleCollapseAll = () => {
    setExpandedCategories([])
  }

  const toggleCategoryExpansion = (category: string) => {
    setExpandedCategories(prev =>
      prev.includes(category)
        ? prev.filter(c => c !== category)
        : [...prev, category]
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        <span className="ml-3">Loading permissions...</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Search and Actions */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search permissions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSelectAll}
              className="gap-2"
            >
              <CheckSquare className="h-4 w-4" />
              Select All
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleClearAll}
              className="gap-2"
            >
              <XSquare className="h-4 w-4" />
              Clear All
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleExpandAll}
              className="gap-1 text-xs"
            >
              <ChevronDown className="h-3 w-3" />
              Expand All
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCollapseAll}
              className="gap-1 text-xs"
            >
              <ChevronUp className="h-3 w-3" />
              Collapse All
            </Button>
          </div>
        </div>

        {/* Statistics */}
        <div className="flex items-center gap-3 text-sm">
          <Badge variant="secondary" className="gap-1">
            {stats.selectedCount} / {stats.totalCount} selected
          </Badge>
          {stats.dangerousSelected > 0 && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              {stats.dangerousSelected} dangerous
            </Badge>
          )}
        </div>
      </div>

      {/* Categorized Permissions */}
      <div className="border rounded-lg max-h-[500px] overflow-y-auto">
        {filteredCategories.size === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <p>No permissions found matching "{searchQuery}"</p>
          </div>
        ) : (
          <Accordion type="multiple" value={expandedCategories} className="w-full">
            {Array.from(filteredCategories.entries()).map(([category, categoryPerms]) => {
              const categoryPermIds = categoryPerms.map(p => p.id)
              const selectedInCategory = categoryPermIds.filter(id => selectedIds.includes(id)).length
              const allSelected = selectedInCategory === categoryPermIds.length
              const someSelected = selectedInCategory > 0 && selectedInCategory < categoryPermIds.length

              return (
                <AccordionItem key={category} value={category} className="border-b last:border-b-0">
                  <div className="flex items-center gap-2 pr-4">
                    <Checkbox
                      // Radix Checkbox supports 'indeterminate' natively via the
                      // checked prop — no ref fiddling required.
                      checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                      onCheckedChange={() => handleToggleCategory(categoryPerms)}
                      className="ml-4"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <AccordionTrigger
                      className="flex-1 hover:no-underline py-3"
                      onClick={() => toggleCategoryExpansion(category)}
                    >
                      <div className="flex items-center justify-between w-full pr-2">
                        <span className="font-semibold text-sm">{category}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {selectedInCategory} / {categoryPerms.length}
                          </Badge>
                        </div>
                      </div>
                    </AccordionTrigger>
                  </div>

                  <AccordionContent className="pb-2">
                    <div className="space-y-1 px-4">
                      {categoryPerms.map(perm => (
                        <div
                          key={perm.id}
                          className={cn(
                            "flex items-start gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors",
                            perm.is_dangerous && "border border-destructive/20 bg-destructive/5"
                          )}
                        >
                          <Checkbox
                            id={`perm-${perm.id}`}
                            checked={selectedIds.includes(perm.id)}
                            onCheckedChange={() => handleTogglePermission(perm.id)}
                          />
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2">
                              <label
                                htmlFor={`perm-${perm.id}`}
                                className="text-sm font-medium cursor-pointer leading-none"
                              >
                                {perm.name}
                              </label>
                              {perm.is_dangerous && (
                                <Badge variant="destructive" className="text-xs gap-1">
                                  <AlertTriangle className="h-3 w-3" />
                                  Dangerous
                                </Badge>
                              )}
                            </div>
                            {perm.description && (
                              <p className="text-xs text-muted-foreground leading-relaxed">
                                {perm.description}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground/70 font-mono">
                              {perm.codename}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )
            })}
          </Accordion>
        )}
      </div>
    </div>
  )
}
