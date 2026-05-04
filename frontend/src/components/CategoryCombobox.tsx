// CategoryCombobox.tsx
//
// Searchable category picker that also supports inline create / rename / delete.
// Replaces the plain Select used in SaveQueryDialog so the user never has to
// leave the dialog to manage categories.

import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronsUpDown, Plus, Pencil, Trash2, X } from 'lucide-react'
import { queriesService, type Category } from '../services/queries'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Input } from './ui/input'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './ui/command'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

interface CategoryComboboxProps {
  value: string                              // category id as string, '' = none
  onChange: (value: string) => void
  disabled?: boolean
}

export function CategoryCombobox({ value, onChange, disabled }: CategoryComboboxProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const editInputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => queriesService.getCategories(),
    enabled: open,
  })

  const selected = categories.find((c) => c.id.toString() === value)

  const trimmedSearch = search.trim()
  const exactMatch = categories.some(
    (c) => c.name.toLowerCase() === trimmedSearch.toLowerCase()
  )
  const canCreate = trimmedSearch.length > 0 && !exactMatch

  const invalidateCategories = () =>
    queryClient.invalidateQueries({ queryKey: ['categories'] })

  const createMutation = useMutation({
    mutationFn: (name: string) => queriesService.createCategory({ name }),
    onSuccess: (created) => {
      invalidateCategories()
      onChange(created.id.toString())
      setSearch('')
      setOpen(false)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      queriesService.updateCategory(id, { name }),
    onSuccess: () => {
      invalidateCategories()
      setEditingId(null)
      setEditValue('')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => queriesService.deleteCategory(id),
    onSuccess: (_, id) => {
      invalidateCategories()
      setConfirmDeleteId(null)
      if (value === id.toString()) onChange('')
    },
  })

  useEffect(() => {
    if (editingId !== null) editInputRef.current?.focus()
  }, [editingId])

  const startEdit = (category: Category, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingId(category.id)
    setEditValue(category.name)
    setConfirmDeleteId(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditValue('')
  }

  const saveEdit = (id: number) => {
    const trimmed = editValue.trim()
    if (!trimmed || trimmed.length < 2) {
      cancelEdit()
      return
    }
    updateMutation.mutate({ id, name: trimmed })
  }

  const handleSelect = (categoryId: string) => {
    if (editingId !== null || confirmDeleteId !== null) return
    onChange(categoryId === value ? '' : categoryId)
    setOpen(false)
    setSearch('')
  }

  const handleCreate = () => {
    if (!canCreate || createMutation.isPending) return
    createMutation.mutate(trimmedSearch)
  }

  return (
    <Popover open={open} onOpenChange={(next) => {
      setOpen(next)
      if (!next) {
        setSearch('')
        setEditingId(null)
        setConfirmDeleteId(null)
      }
    }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          {selected ? (
            <span className="flex items-center gap-2 truncate">
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: selected.color || '#6b7280' }}
              />
              <span className="truncate">{selected.name}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">No category</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={true}>
          <CommandInput
            placeholder="Search or create category..."
            value={search}
            onValueChange={setSearch}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canCreate && categories.every(
                (c) => c.name.toLowerCase().includes(trimmedSearch.toLowerCase()) === false
              )) {
                e.preventDefault()
                handleCreate()
              }
            }}
          />
          <CommandList>
            <CommandEmpty>
              {canCreate ? (
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={createMutation.isPending}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-left hover:bg-accent rounded-sm disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                  Create &ldquo;{trimmedSearch}&rdquo;
                </button>
              ) : (
                <span className="block px-2 py-2 text-sm text-muted-foreground">
                  No categories found.
                </span>
              )}
            </CommandEmpty>

            {categories.length > 0 && (
              <CommandGroup heading="Categories">
                {/* Clear selection */}
                {value && (
                  <CommandItem
                    value="__clear__"
                    onSelect={() => handleSelect('')}
                    className="text-muted-foreground"
                  >
                    <X className="mr-2 h-4 w-4" />
                    Clear selection
                  </CommandItem>
                )}

                {categories.map((category) => {
                  const isSelected = category.id.toString() === value
                  const isEditing = editingId === category.id
                  const isConfirming = confirmDeleteId === category.id

                  return (
                    <CommandItem
                      key={category.id}
                      value={category.name}
                      onSelect={() => handleSelect(category.id.toString())}
                      className="group"
                    >
                      {isEditing ? (
                        <div className="flex items-center gap-2 w-full" onClick={(e) => e.stopPropagation()}>
                          <Input
                            ref={editInputRef}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              e.stopPropagation()
                              if (e.key === 'Enter') saveEdit(category.id)
                              if (e.key === 'Escape') cancelEdit()
                            }}
                            className="h-7 text-sm"
                          />
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); saveEdit(category.id) }}
                            disabled={updateMutation.isPending}
                            className="p-1 rounded text-emerald-500 hover:bg-emerald-500/10"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); cancelEdit() }}
                            className="p-1 rounded text-muted-foreground hover:bg-muted"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : isConfirming ? (
                        <div className="flex items-center gap-2 w-full" onClick={(e) => e.stopPropagation()}>
                          <span className="text-xs text-destructive flex-1 truncate">
                            Delete &ldquo;{category.name}&rdquo;? ({category.query_count} queries)
                          </span>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(category.id) }}
                            disabled={deleteMutation.isPending}
                            className="px-2 py-0.5 rounded text-xs bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Delete
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null) }}
                            className="px-2 py-0.5 rounded text-xs border"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <Check
                            className={cn(
                              'mr-2 h-4 w-4',
                              isSelected ? 'opacity-100' : 'opacity-0'
                            )}
                          />
                          <span
                            className="w-2.5 h-2.5 rounded-full mr-2 flex-shrink-0"
                            style={{ backgroundColor: category.color || '#6b7280' }}
                          />
                          <span className="flex-1 truncate">{category.name}</span>
                          {category.query_count > 0 && (
                            <span className="text-xs text-muted-foreground mr-2">
                              {category.query_count}
                            </span>
                          )}
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={(e) => startEdit(category, e)}
                              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                              title="Rename"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(category.id); setEditingId(null) }}
                              className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                              title="Delete"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </>
                      )}
                    </CommandItem>
                  )
                })}

                {canCreate && (
                  <CommandItem
                    value={`__create__${trimmedSearch}`}
                    onSelect={handleCreate}
                    className="text-primary"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Create &ldquo;{trimmedSearch}&rdquo;
                  </CommandItem>
                )}
              </CommandGroup>
            )}

            {createMutation.isError && (
              <div className="px-2 py-1.5 text-xs text-destructive border-t">
                Could not create category. Try a different name.
              </div>
            )}
            {updateMutation.isError && (
              <div className="px-2 py-1.5 text-xs text-destructive border-t">
                Rename failed.
              </div>
            )}
            {deleteMutation.isError && (
              <div className="px-2 py-1.5 text-xs text-destructive border-t">
                Delete failed.
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
