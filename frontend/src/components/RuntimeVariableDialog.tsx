// RuntimeVariableDialog.tsx
//
// Modal that prompts for variable values before executing a query that has
// ${variable} placeholders in its filters. Shows each variable as a labeled
// input field. Values are substituted client-side before the query is sent.

import { useState, useEffect, useMemo } from 'react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Play, Wrench, AlertCircle } from 'lucide-react'
import type { Node } from '@xyflow/react'
import { QueryNodeData, FilterNodeData, TemplateVariable } from '@/types'

interface RuntimeVariableDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  nodes: Node<QueryNodeData>[]
  onExecute: (values: Record<string, any>) => void
}

export function RuntimeVariableDialog({
  open,
  onOpenChange,
  nodes,
  onExecute,
}: RuntimeVariableDialogProps) {
  const [values, setValues] = useState<Record<string, any>>({})
  const [errors, setErrors] = useState<string[]>([])

  // Extract all variables from nodes
  const variables = useMemo(() => {
    const vars: Array<TemplateVariable & { nodeId: string; nodeLabel: string }> = []

    nodes.forEach((node) => {
      if (node.type === 'filterNode') {
        const filterData = node.data as FilterNodeData

        // Handle new multiple variables format (PREFERRED)
        if (filterData._variables && Object.keys(filterData._variables).length > 0) {
          Object.entries(filterData._variables).forEach(([key, variable]) => {
            vars.push({
              ...variable,
              id: `${node.id}_${key}`,
              nodeId: node.id,
              nodeLabel: filterData.label,
              binding: {
                nodeId: node.id,
                fieldPath: key,
              },
            })
          })
        }
        // Handle legacy single variable format ONLY if _variables doesn't exist
        else if (filterData._variable) {
          vars.push({
            ...filterData._variable,
            id: `${node.id}_value`,
            nodeId: node.id,
            nodeLabel: filterData.label,
            binding: {
              nodeId: node.id,
              fieldPath: 'value',
            },
          })
        }
      }
    })

    return vars
  }, [nodes])

  // Initialize default values only when dialog first opens
  useEffect(() => {
    if (open && variables.length > 0) {
      const defaults: Record<string, any> = {}
      variables.forEach((variable) => {
        defaults[variable.id] = variable.defaultValue || ''
      })
      setValues(defaults)
      setErrors([])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleExecute = () => {
    // Validate required fields
    const newErrors: string[] = []
    variables.forEach((variable) => {
      const value = values[variable.id]
      if (variable.required && (!value || value.toString().trim() === '')) {
        newErrors.push(`${variable.label} is required`)
      }
    })

    if (newErrors.length > 0) {
      setErrors(newErrors)
      return
    }

    // Execute with values
    onExecute(values)
    onOpenChange(false)
  }

  // Check if all required variables are filled
  const canExecute = useMemo(() => {
    return variables.every((variable) => {
      if (!variable.required) return true
      const value = values[variable.id]
      return value !== undefined && value !== null && value.toString().trim() !== ''
    })
  }, [variables, values])

  if (variables.length === 0) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] px-8">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="w-5 h-5 text-primary" />
            Configure Query Variables
          </DialogTitle>
          <DialogDescription>
            Fill in the variables below to execute this query.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Variable Count Info */}
          <div className="bg-muted/50 border border-border rounded-lg p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Total Variables:</span>
              <span className="font-medium">{variables.length}</span>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-muted-foreground">Required:</span>
              <span className="font-medium text-destructive">
                {variables.filter(v => v.required).length}
              </span>
            </div>
          </div>

          {/* Error Display */}
          {errors.length > 0 && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-destructive mb-1">Please fix the following errors:</p>
                  <ul className="text-sm text-destructive list-disc list-inside">
                    {errors.map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Variable Inputs */}
          <div className="space-y-4 max-h-[400px] overflow-y-auto px-3">
            {variables.map((variable) => (
              <div key={variable.id} className="space-y-2 p-3 bg-card border border-border rounded-lg">
                {/* Node context */}
                <div className="text-xs text-muted-foreground mb-1">
                  From node: <span className="font-medium text-foreground">{variable.nodeLabel}</span>
                </div>

                <Label htmlFor={variable.id} className="flex items-center gap-1">
                  {variable.label}
                  {variable.required && (
                    <span className="text-destructive text-base">*</span>
                  )}
                </Label>

                {variable.type === 'text' && (
                  <Input
                    id={variable.id}
                    value={values[variable.id] || ''}
                    onChange={(e) => {
                      setValues({ ...values, [variable.id]: e.target.value })
                      setErrors([])
                    }}
                    placeholder={variable.placeholder || `Enter ${variable.label.toLowerCase()}`}
                    className="font-mono text-sm"
                  />
                )}

                {variable.type === 'number' && (
                  <Input
                    id={variable.id}
                    type="number"
                    value={values[variable.id] || ''}
                    onChange={(e) => {
                      setValues({ ...values, [variable.id]: e.target.value })
                      setErrors([])
                    }}
                    placeholder={variable.placeholder || `Enter ${variable.label.toLowerCase()}`}
                    className="font-mono text-sm"
                  />
                )}

                {variable.type === 'select' && variable.options && (
                  <Select
                    value={values[variable.id] || ''}
                    onValueChange={(value) => {
                      setValues({ ...values, [variable.id]: value })
                      setErrors([])
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={`Select ${variable.label.toLowerCase()}`} />
                    </SelectTrigger>
                    <SelectContent>
                      {variable.options.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {variable.defaultValue && (
                  <p className="text-xs text-muted-foreground">
                    Default: <code className="px-1 py-0.5 bg-muted rounded font-mono">{variable.defaultValue}</code>
                  </p>
                )}

                {variable.placeholder && (
                  <p className="text-xs text-muted-foreground italic">
                    {variable.placeholder}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleExecute}
            disabled={!canExecute}
            className="gap-2"
          >
            <Play className="w-4 h-4" />
            Run Query
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
