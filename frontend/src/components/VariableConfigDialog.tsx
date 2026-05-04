// VariableConfigDialog.tsx
//
// Dialog for defining named variables that can be referenced in query filters
// using the ${variableName} syntax. The user gives each variable a label and
// optional default value. At execution time, RuntimeVariableDialog collects
// the actual values before the query runs.

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TemplateVariable } from '@/types'
import { Wrench } from 'lucide-react'

interface VariableConfigDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  nodeId: string
  fieldPath: string
  currentValue: string
  existingVariable?: Omit<TemplateVariable, 'binding'>
  onSave: (variable: Omit<TemplateVariable, 'binding'>) => void
}

export function VariableConfigDialog({
  open,
  onOpenChange,
  currentValue,
  existingVariable,
  onSave,
}: VariableConfigDialogProps) {
  const [config, setConfig] = useState<Omit<TemplateVariable, 'binding'>>({
    id: '',
    label: '',
    type: 'text',
    required: true,
    defaultValue: currentValue,
    placeholder: '',
  })

  // Reinitialize state when dialog opens
  useEffect(() => {
    if (open) {
      if (existingVariable) {
        setConfig(existingVariable)
      } else {
        setConfig({
          id: '',
          label: '',
          type: 'text',
          required: true,
          defaultValue: currentValue,
          placeholder: '',
        })
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleLabelChange = (newLabel: string) => {
    setConfig(prev => ({
      ...prev,
      label: newLabel,
      // Auto-generate slug ID only for new variables (not when editing)
      ...(existingVariable ? {} : {
        id: newLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
      }),
    }))
  }

  const handleSave = () => {
    if (!config.label.trim()) {
      toast.error('Validation Error', { description: 'Please enter a label for the variable' })
      return
    }

    const finalConfig = config.id ? config : { ...config, id: `var_${Date.now()}` }
    onSave(finalConfig)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="w-5 h-5" />
            Configure Variable
          </DialogTitle>
          <DialogDescription>
            Make this field a template variable that users can customize when using this template.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Variable Label */}
          <div className="space-y-2">
            <Label htmlFor="var-label">
              Variable Label <span className="text-destructive">*</span>
            </Label>
            <Input
              id="var-label"
              placeholder="e.g., IP Address, Tenant Name"
              value={config.label}
              onChange={(e) => handleLabelChange(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              This label will be shown to users when they use the template
            </p>
          </div>

          {/* Variable Type */}
          <div className="space-y-2">
            <Label htmlFor="var-type">Input Type</Label>
            <Select
              value={config.type}
              onValueChange={(value: 'text' | 'select' | 'number') =>
                setConfig({ ...config, type: value })
              }
            >
              <SelectTrigger id="var-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Text Input</SelectItem>
                <SelectItem value="number">Number Input</SelectItem>
                <SelectItem value="select">Dropdown (Select)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Options for Select Type */}
          {config.type === 'select' && (
            <div className="space-y-2">
              <Label htmlFor="var-options">
                Dropdown Options <span className="text-xs text-muted-foreground">(comma-separated)</span>
              </Label>
              <Input
                id="var-options"
                placeholder="e.g., option1, option2, option3"
                value={config.options?.join(', ') || ''}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                  })
                }
              />
            </div>
          )}

          {/* Default Value */}
          <div className="space-y-2">
            <Label htmlFor="var-default">Default Value</Label>
            <Input
              id="var-default"
              placeholder="Optional default value"
              value={config.defaultValue || ''}
              onChange={(e) => setConfig({ ...config, defaultValue: e.target.value })}
            />
          </div>

          {/* Placeholder */}
          <div className="space-y-2">
            <Label htmlFor="var-placeholder">Placeholder Text</Label>
            <Input
              id="var-placeholder"
              placeholder="e.g., Enter IP address"
              value={config.placeholder || ''}
              onChange={(e) => setConfig({ ...config, placeholder: e.target.value })}
            />
          </div>

          {/* Required */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="var-required"
              checked={config.required}
              onCheckedChange={(checked) => setConfig({ ...config, required: !!checked })}
            />
            <Label
              htmlFor="var-required"
              className="text-sm font-normal cursor-pointer"
            >
              This field is required
            </Label>
          </div>

          {/* Info Box */}
          <div className="bg-muted p-3 rounded-md text-sm space-y-2">
            <p className="text-muted-foreground">
              <strong>Current value:</strong> <code className="px-1 py-0.5 bg-background rounded">{currentValue}</code>
            </p>
            <p className="text-muted-foreground">
              <strong>Variable syntax:</strong> <code className="px-1 py-0.5 bg-background rounded">${'{' + config.id + '}'}</code>
            </p>
            <p className="text-xs text-muted-foreground border-t border-border pt-2">
              <strong>Tip:</strong> You can use this variable in multiple fields across different nodes.
              Just type <code className="px-1 py-0.5 bg-background rounded">${'{' + config.id + '}'}</code> in any text field,
              and it will be replaced when the template is executed.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            <Wrench className="w-4 h-4 mr-2" />
            Save Variable
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
