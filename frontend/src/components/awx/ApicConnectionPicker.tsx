// Combobox-style APIC connection picker for the request wizard.
// Closed by default, opens a searchable popover on click.

import { useState } from 'react'
import { ChevronsUpDown, Check, Loader2, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command'

interface ApicConnection {
  id: number
  name: string
  url: string
  last_test_status?: boolean | null
}

interface ApicConnectionPickerProps {
  connections: ApicConnection[]
  selectedId: string
  onSelect: (id: string) => void
  isLoading?: boolean
}

function statusDot(status?: boolean | null) {
  if (status === true) return 'bg-emerald-500'
  if (status === false) return 'bg-red-500'
  return 'bg-zinc-400'
}

export function ApicConnectionPicker({
  connections,
  selectedId,
  onSelect,
  isLoading,
}: ApicConnectionPickerProps) {
  const [open, setOpen] = useState(false)

  const selected = connections.find(c => c.id.toString() === selectedId)

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 h-10 px-3 border rounded-md bg-muted">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading connections...</span>
      </div>
    )
  }

  if (connections.length === 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 border rounded-md bg-yellow-50 dark:bg-yellow-900/20">
        <XCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
        <span className="text-sm text-yellow-800 dark:text-yellow-200">
          No APIC connections found. Create one first.
        </span>
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between h-auto min-h-10 px-3 py-2"
        >
          {selected ? (
            <div className="flex items-center gap-2.5 min-w-0">
              <div className={cn('h-2.5 w-2.5 rounded-full shrink-0', statusDot(selected.last_test_status))} />
              <div className="flex flex-col items-start min-w-0">
                <span className="font-medium text-sm truncate">{selected.name}</span>
                <span className="text-xs text-muted-foreground truncate">{selected.url}</span>
              </div>
            </div>
          ) : (
            <span className="text-muted-foreground">Select APIC connection...</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search connections..." />
          <CommandList>
            <CommandEmpty>No connections found.</CommandEmpty>
            <CommandGroup>
              {connections.map((conn) => (
                <CommandItem
                  key={conn.id}
                  value={`${conn.name} ${conn.url}`}
                  onSelect={() => {
                    onSelect(conn.id.toString())
                    setOpen(false)
                  }}
                >
                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    <div className={cn('h-2 w-2 rounded-full shrink-0', statusDot(conn.last_test_status))} />
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-medium truncate">{conn.name}</span>
                      <span className="text-xs text-muted-foreground truncate">{conn.url}</span>
                    </div>
                  </div>
                  <Check
                    className={cn(
                      'ml-auto h-4 w-4 shrink-0',
                      selectedId === conn.id.toString() ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
