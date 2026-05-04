// PackageCombobox.tsx
//
// Searchable picker for ACI MIM packages. Replaces the fixed Top-15 Select
// dropdown so users can reach niche packages (coop, lacp, lldp, …) without
// memorising the full taxonomy. Top packages are still pinned at the top
// for one-click access.

import { useMemo, useState } from 'react'
import { Check, ChevronsUpDown, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { mimApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { PackageInfo } from '@/types'

interface PackageComboboxProps {
  value: string
  onValueChange: (value: string) => void
  /** Number of packages to pin at the top under "Top". */
  topCount?: number
  className?: string
  triggerClassName?: string
}

const ALL_VALUE = '__all__'

export function PackageCombobox({
  value,
  onValueChange,
  topCount = 15,
  className,
  triggerClassName,
}: PackageComboboxProps) {
  const [open, setOpen] = useState(false)

  const { data: allPackages = [] } = useQuery({
    queryKey: ['allPackages'],
    queryFn: () => mimApi.getPackages(),
    staleTime: Infinity,
  })

  const { topPackages, restPackages } = useMemo(() => {
    const filtered = allPackages.filter((p: PackageInfo) => !!p.package)
    // The /api/mim/packages/ endpoint returns alphabetical order. We re-derive
    // "top" by class count so the pinned section stays meaningful even if the
    // backend ordering changes.
    const sortedByCount = [...filtered].sort((a, b) => b.classCount - a.classCount)
    const top = sortedByCount.slice(0, topCount)
    const topNames = new Set(top.map((p) => p.package))
    const rest = filtered
      .filter((p) => !topNames.has(p.package))
      .sort((a, b) => a.package.localeCompare(b.package))
    return { topPackages: top, restPackages: rest }
  }, [allPackages, topCount])

  const handleSelect = (next: string) => {
    onValueChange(next)
    setOpen(false)
  }

  const display =
    value === ALL_VALUE
      ? 'All Packages'
      : (() => {
          const match = allPackages.find((p) => p.package === value)
          return match ? `${match.package} (${match.classCount})` : value
        })()

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('justify-between font-normal', triggerClassName)}
        >
          <span className="truncate">{display}</span>
          {value !== ALL_VALUE ? (
            <X
              role="button"
              aria-label="Clear package filter"
              className="ml-2 h-4 w-4 shrink-0 opacity-60 hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation()
                onValueChange(ALL_VALUE)
              }}
            />
          ) : (
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn('p-0', className)} align="start">
        <Command>
          <CommandInput placeholder="Search packages…" />
          <CommandList>
            <CommandEmpty>No packages found.</CommandEmpty>
            <CommandItem
              value={ALL_VALUE}
              onSelect={() => handleSelect(ALL_VALUE)}
              className="font-medium"
            >
              <Check className={cn('mr-2 h-4 w-4', value === ALL_VALUE ? 'opacity-100' : 'opacity-0')} />
              All Packages
            </CommandItem>
            {topPackages.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading={`Top ${topPackages.length}`}>
                  {topPackages.map((p) => (
                    <CommandItem
                      key={p.package}
                      value={p.package}
                      onSelect={() => handleSelect(p.package)}
                    >
                      <Check className={cn('mr-2 h-4 w-4', value === p.package ? 'opacity-100' : 'opacity-0')} />
                      <span className="font-mono text-sm">{p.package}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{p.classCount}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
            {restPackages.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="All packages (A–Z)">
                  {restPackages.map((p) => (
                    <CommandItem
                      key={p.package}
                      value={p.package}
                      onSelect={() => handleSelect(p.package)}
                    >
                      <Check className={cn('mr-2 h-4 w-4', value === p.package ? 'opacity-100' : 'opacity-0')} />
                      <span className="font-mono text-sm">{p.package}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{p.classCount}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
