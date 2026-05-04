// Combobox-style device credential picker. Selects which AWX-stored
// credential the playbook uses to authenticate with the target device.
// Searches server-side so it scales to hundreds of credentials.

import { useState, useCallback, useRef, useEffect } from 'react'
import { KeyRound, ChevronsUpDown, Check, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

interface AwxCredential {
  id: number
  name: string
  description: string
  credential_type: number
}

interface AwxCredentialPickerProps {
  credentials: AwxCredential[]
  selectedId: number | null
  selectedName: string
  onSelect: (id: number | null, name: string) => void
  onSearch: (query: string) => void
  isLoading?: boolean
}

export function AwxCredentialPicker({
  credentials,
  selectedId,
  selectedName,
  onSelect,
  onSearch,
  isLoading,
}: AwxCredentialPickerProps) {
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  const handleSearchChange = useCallback((value: string) => {
    setSearchValue(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => onSearch(value), 300)
  }, [onSearch])

  // Fetch initial list when popover opens
  useEffect(() => {
    if (open) {
      setSearchValue('')
      onSearch('')
    }
  }, [open])

  const handleSelect = (cred: AwxCredential) => {
    if (selectedId === cred.id) {
      onSelect(null, '')
    } else {
      onSelect(cred.id, cred.name)
    }
    setOpen(false)
  }

  const handleClear = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onSelect(null, '')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          role="combobox"
          aria-expanded={open}
          tabIndex={0}
          className={cn(
            'flex items-center w-full min-h-10 px-3 py-2 border rounded-md cursor-pointer',
            'bg-background hover:bg-accent/50 transition-colors',
            'text-sm',
            open && 'ring-2 ring-ring ring-offset-2'
          )}
        >
          {selectedId ? (
            <>
              <KeyRound className="h-4 w-4 shrink-0 text-primary mr-2" />
              <span className="font-medium truncate flex-1">{selectedName}</span>
              <span
                role="button"
                tabIndex={0}
                onClick={handleClear}
                onKeyDown={(e) => { if (e.key === 'Enter') handleClear(e as any) }}
                className="ml-2 shrink-0 text-muted-foreground hover:text-foreground p-0.5 rounded-sm hover:bg-muted"
              >
                <X className="h-3.5 w-3.5" />
              </span>
            </>
          ) : (
            <>
              <span className="text-muted-foreground flex-1">Select device credential (optional)...</span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </>
          )}
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <div className="flex flex-col">
          {/* Search bar — plain input to avoid shadcn Input border/ring overflow */}
          <div className="flex items-center border-b px-3">
            <KeyRound className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <input
              placeholder="Search device credentials..."
              value={searchValue}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="flex h-11 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div className="max-h-[280px] overflow-y-auto p-1">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Loading...</span>
              </div>
            ) : credentials.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {searchValue ? 'No credentials match your search.' : 'No credentials found.'}
              </div>
            ) : (
              credentials.map((cred) => {
                const isSelected = selectedId === cred.id
                return (
                  <button
                    key={cred.id}
                    onClick={() => handleSelect(cred)}
                    className={cn(
                      'w-full flex items-center gap-2 rounded-sm px-2 py-2 text-sm cursor-default transition-colors',
                      isSelected
                        ? 'bg-accent text-accent-foreground'
                        : 'hover:bg-accent hover:text-accent-foreground'
                    )}
                  >
                    <div className="flex flex-col items-start min-w-0 flex-1">
                      <span className="font-medium truncate w-full text-left">{cred.name}</span>
                      {cred.description && (
                        <span className="text-xs text-muted-foreground truncate w-full text-left">
                          {cred.description}
                        </span>
                      )}
                    </div>
                    <Check
                      className={cn(
                        'h-4 w-4 shrink-0',
                        isSelected ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                  </button>
                )
              })
            )}
          </div>

          <div className="border-t px-3 py-2">
            <p className="text-xs text-muted-foreground">
              Credentials are stored securely in AWX vault — Fabrik never sees passwords.
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
