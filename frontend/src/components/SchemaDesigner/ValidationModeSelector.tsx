// SchemaDesigner/ValidationModeSelector.tsx
//
// Dropdown for picking a column's validation mode: none (free text), static
// list (user-defined values), or query-backed (values from an APIC query).
// Choosing a mode shows the relevant editor inline in ColumnEditor.

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ShieldCheck, ShieldOff, Code2, Database, ListChecks } from 'lucide-react'

export type ValidationMode = 'none' | 'regex' | 'static_list' | 'query_list'

interface ValidationModeSelectorProps {
  value: ValidationMode
  onChange: (mode: ValidationMode) => void
  disabled?: boolean
}

const VALIDATION_MODES = [
  {
    value: 'none' as const,
    label: 'No Validation',
    icon: ShieldOff,
    description: 'Accept any value',
    color: 'text-muted-foreground',
  },
  {
    value: 'regex' as const,
    label: 'Regex Pattern',
    icon: Code2,
    description: 'Validate using regular expression',
    color: 'text-blue-500',
  },
  {
    value: 'static_list' as const,
    label: 'Static List',
    icon: ListChecks,
    description: 'Choose from predefined values',
    color: 'text-green-500',
  },
  {
    value: 'query_list' as const,
    label: 'Query Validation',
    icon: Database,
    description: 'Validate against live APIC query results',
    color: 'text-purple-500',
  },
]

export function ValidationModeSelector({
  value,
  onChange,
  disabled = false,
}: ValidationModeSelectorProps) {
  const selectedMode = VALIDATION_MODES.find(m => m.value === value)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Validation Mode
        </Label>
        {selectedMode && selectedMode.value !== 'none' && (
          <Badge variant="outline" className="text-xs">
            {selectedMode.label}
          </Badge>
        )}
      </div>

      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger>
          <SelectValue placeholder="Select validation mode">
            {selectedMode && (
              <div className="flex items-center gap-2">
                <selectedMode.icon className={`h-4 w-4 ${selectedMode.color}`} />
                <span>{selectedMode.label}</span>
              </div>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {VALIDATION_MODES.map(mode => {
            const Icon = mode.icon
            return (
              <SelectItem key={mode.value} value={mode.value}>
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${mode.color}`} />
                  <div>
                    <div className="font-medium">{mode.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {mode.description}
                    </div>
                  </div>
                </div>
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>

      {selectedMode && (
        <p className="text-xs text-muted-foreground">
          {selectedMode.description}
        </p>
      )}
    </div>
  )
}
