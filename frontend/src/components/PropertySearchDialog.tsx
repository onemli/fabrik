// PropertySearchDialog.tsx
//
// Search dialog for finding ACI class properties. Used in ClassNodeConfig when
// the user wants to search and select specific properties to include in the query
// instead of choosing a broad property group (all / naming / config).

import { useState, useMemo } from 'react'
import { Search, X, Check, Tag, Settings, Eye } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface PropertyOption {
  name: string
  type?: string
  category?: string
  isConfigurable?: boolean
  isNaming?: boolean
  values?: string[]
}

interface PropertySearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  properties: PropertyOption[]
  value: string
  onSelect: (propertyName: string) => void
  title?: string
  className?: string
}

export function PropertySearchDialog({
  open,
  onOpenChange,
  properties,
  value,
  onSelect,
  title = 'Select Property',
  className,
}: PropertySearchDialogProps) {
  const [search, setSearch] = useState('')

  // Filter and group properties
  const { filtered, grouped } = useMemo(() => {
    const searchLower = search.toLowerCase().trim()

    const filtered = properties.filter((prop) => {
      if (!searchLower) return true
      return (
        prop.name.toLowerCase().includes(searchLower) ||
        prop.type?.toLowerCase().includes(searchLower) ||
        prop.category?.toLowerCase().includes(searchLower) ||
        prop.values?.some(v => v.toLowerCase().includes(searchLower))
      )
    })

    // Group by category
    const grouped = {
      naming: filtered.filter(p => p.isNaming),
      configurable: filtered.filter(p => !p.isNaming && p.isConfigurable),
      readonly: filtered.filter(p => !p.isNaming && !p.isConfigurable),
    }

    return { filtered, grouped }
  }, [properties, search])

  const handleSelect = (propertyName: string) => {
    onSelect(propertyName)
    onOpenChange(false)
    setSearch('')
  }

  const handleCustomProperty = () => {
    if (search.trim()) {
      handleSelect(search.trim())
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('max-w-3xl w-[90vw] max-h-[85vh] flex flex-col p-0', className)}>
        <DialogHeader className="px-6 pt-5 pb-3 border-b">
          <DialogTitle className="text-lg">{title}</DialogTitle>
        </DialogHeader>

        {/* Search Input */}
        <div className="px-6 py-3 bg-muted/30">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search properties by name, type, or value..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-9 h-10"
              autoFocus
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
            <span>{filtered.length} of {properties.length} properties</span>
            {value && (
              <span>Selected: <code className="bg-muted px-1.5 py-0.5 rounded font-mono">{value}</code></span>
            )}
          </div>
        </div>

        {/* Property List */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-4">
          {properties.length === 0 ? (
            <div className="py-12 text-center">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                <Search className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground mb-2">No properties available</p>
              <p className="text-xs text-muted-foreground mb-4">
                Backend may need restart or class has no queryable properties
              </p>
              {search && (
                <Button variant="outline" onClick={handleCustomProperty}>
                  Use "{search}" as custom property
                </Button>
              )}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                <X className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground mb-4">No properties match "{search}"</p>
              <Button variant="outline" onClick={handleCustomProperty}>
                Use "{search}" as custom property
              </Button>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Naming Properties */}
              {grouped.naming.length > 0 && (
                <PropertyGroup
                  title="Naming Properties"
                  icon={<Tag className="h-4 w-4" />}
                  description="Primary identifiers for this object"
                  properties={grouped.naming}
                  selectedValue={value}
                  onSelect={handleSelect}
                />
              )}

              {/* Configurable Properties */}
              {grouped.configurable.length > 0 && (
                <PropertyGroup
                  title="Configurable"
                  icon={<Settings className="h-4 w-4" />}
                  description="User-settable properties"
                  properties={grouped.configurable}
                  selectedValue={value}
                  onSelect={handleSelect}
                />
              )}

              {/* Read-only Properties */}
              {grouped.readonly.length > 0 && (
                <PropertyGroup
                  title="Read-only"
                  icon={<Eye className="h-4 w-4" />}
                  description="System-managed properties"
                  properties={grouped.readonly}
                  selectedValue={value}
                  onSelect={handleSelect}
                />
              )}
            </div>
          )}
        </div>

        {/* Footer with keyboard hint */}
        <div className="px-6 py-3 border-t bg-muted/30 text-xs text-muted-foreground flex items-center justify-between">
          <span>Click to select a property</span>
          <span>Press <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">ESC</kbd> to close</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface PropertyGroupProps {
  title: string
  icon: React.ReactNode
  description: string
  properties: PropertyOption[]
  selectedValue: string
  onSelect: (name: string) => void
}

function PropertyGroup({
  title,
  icon,
  description,
  properties,
  selectedValue,
  onSelect,
}: PropertyGroupProps) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-muted-foreground">{icon}</span>
        <span className="font-medium text-sm">{title}</span>
        <Badge variant="secondary" className="text-[10px] h-5">{properties.length}</Badge>
      </div>
      <p className="text-xs text-muted-foreground mb-3">{description}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {properties.map((prop) => (
          <PropertyItem
            key={prop.name}
            property={prop}
            isSelected={selectedValue === prop.name}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  )
}

interface PropertyItemProps {
  property: PropertyOption
  isSelected: boolean
  onSelect: (name: string) => void
}

function PropertyItem({ property, isSelected, onSelect }: PropertyItemProps) {
  return (
    <button
      onClick={() => onSelect(property.name)}
      className={cn(
        'w-full text-left px-3 py-2 rounded-md border transition-colors',
        'hover:bg-accent hover:border-accent-foreground/20',
        isSelected
          ? 'bg-primary/10 border-primary/30'
          : 'bg-card border-border'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <code className="font-mono text-sm font-medium">{property.name}</code>
            {isSelected && <Check className="h-4 w-4 text-primary" />}
          </div>

          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {property.type && (
              <Badge variant="secondary" className="text-[10px] h-5">
                {property.type}
              </Badge>
            )}
            {property.isNaming && (
              <Badge variant="default" className="text-[10px] h-5 bg-blue-500">
                key
              </Badge>
            )}
            {property.values && property.values.length > 0 && (
              <span className="text-[10px] text-muted-foreground">
                Values: {property.values.slice(0, 4).join(', ')}
                {property.values.length > 4 && ` +${property.values.length - 4} more`}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}

// Trigger button component for easy usage
interface PropertySearchTriggerProps {
  value: string
  onClick: () => void
  placeholder?: string
  disabled?: boolean
  className?: string
  compact?: boolean
}

export function PropertySearchTrigger({
  value,
  onClick,
  placeholder = 'Select property...',
  disabled = false,
  className,
  compact = false,
}: PropertySearchTriggerProps) {
  return (
    <Button
      variant="outline"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full justify-between font-normal',
        compact ? 'h-8 text-sm' : 'h-9',
        !value && 'text-muted-foreground',
        className
      )}
    >
      <span className="flex items-center gap-2 truncate">
        <Search className="h-4 w-4 shrink-0 opacity-50" />
        {value || placeholder}
      </span>
    </Button>
  )
}
