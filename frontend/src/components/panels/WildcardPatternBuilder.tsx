// panels/WildcardPatternBuilder.tsx
//
// Grouped pattern builder for APIC query-target-filter. Supports multiple
// condition groups, each with its own logical operator (AND/OR/XOR), combined
// at the top level with a separate operator. Enables nested filter expressions
// like and(or(eq(name,"a"),eq(name,"b")),not(eq(descr,""))).

import { useState } from 'react'
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Plus, Trash2, Pencil, Copy, Wrench, FolderPlus } from 'lucide-react'
import { PropertySearchTrigger } from '@/components/PropertySearchDialog'
import type { WildcardPattern, PatternGroup, LogicalOperator } from '@/types'

// Colors for group left borders — cycles through these for visual distinction
const GROUP_COLORS = [
  'border-l-blue-500',
  'border-l-emerald-500',
  'border-l-amber-500',
  'border-l-purple-500',
  'border-l-rose-500',
]

interface WildcardPatternBuilderProps {
  groups: PatternGroup[]
  groupCombineOperator: LogicalOperator
  onGroupsChange: (groups: PatternGroup[]) => void
  onGroupCombineOperatorChange: (operator: LogicalOperator) => void
  onOpenPropertyDialog: (groupIndex: number, patternIndex: number) => void
  onConfigureVariable: (groupIndex: number, patternIndex: number, pattern: string) => void
  isConnectedToClass: boolean
}

export function WildcardPatternBuilder({
  groups,
  groupCombineOperator,
  onGroupsChange,
  onGroupCombineOperatorChange,
  onOpenPropertyDialog,
  onConfigureVariable,
  isConnectedToClass,
}: WildcardPatternBuilderProps) {
  // Track which pattern is being edited: [groupIndex, patternIndex]
  const [editingKey, setEditingKey] = useState<string | null>(null)

  const totalPatterns = groups.reduce((sum, g) => sum + g.patterns.length, 0)
  const hasMultipleGroups = groups.length > 1

  // --- Group operations ---

  const addGroup = () => {
    onGroupsChange([
      ...groups,
      { patterns: [{ property: '', pattern: '', type: 'starts', operator: 'eq' }], logicalOperator: 'and' },
    ])
  }

  const removeGroup = (groupIndex: number) => {
    onGroupsChange(groups.filter((_, i) => i !== groupIndex))
  }

  const updateGroupOperator = (groupIndex: number, op: LogicalOperator) => {
    const updated = [...groups]
    updated[groupIndex] = { ...updated[groupIndex], logicalOperator: op }
    onGroupsChange(updated)
  }

  // --- Pattern operations within a group ---

  const addPattern = (groupIndex: number) => {
    const updated = [...groups]
    const group = { ...updated[groupIndex] }
    group.patterns = [...group.patterns, { property: '', pattern: '', type: 'starts' as const, operator: 'eq' as const }]
    updated[groupIndex] = group
    onGroupsChange(updated)
    setEditingKey(`${groupIndex}-${group.patterns.length - 1}`)
  }

  const removePattern = (groupIndex: number, patternIndex: number) => {
    const updated = [...groups]
    const group = { ...updated[groupIndex] }
    group.patterns = group.patterns.filter((_, i) => i !== patternIndex)
    updated[groupIndex] = group
    // Remove empty groups automatically
    if (group.patterns.length === 0) {
      onGroupsChange(updated.filter((_, i) => i !== groupIndex))
    } else {
      onGroupsChange(updated)
    }
  }

  const duplicatePattern = (groupIndex: number, patternIndex: number) => {
    const updated = [...groups]
    const group = { ...updated[groupIndex] }
    group.patterns = [...group.patterns, { ...group.patterns[patternIndex] }]
    updated[groupIndex] = group
    onGroupsChange(updated)
  }

  const updatePattern = (groupIndex: number, patternIndex: number, field: string, value: unknown) => {
    const updated = [...groups]
    const group = { ...updated[groupIndex] }
    group.patterns = [...group.patterns]
    group.patterns[patternIndex] = { ...group.patterns[patternIndex], [field]: value }
    updated[groupIndex] = group
    onGroupsChange(updated)
  }

  // --- Display helpers ---

  const formatPatternDisplay = (pattern: WildcardPattern): { property: string; operator: string; value: string } => {
    if (!pattern.property) return { property: '', operator: '', value: 'Configure condition...' }

    const operatorLabels: Record<string, string> = {
      eq: 'equals',
      ne: 'not equals',
      gt: '>',
      lt: '<',
      ge: '>=',
      le: '<=',
      wcard: pattern.type === 'starts' ? 'starts with' :
             pattern.type === 'ends' ? 'ends with' :
             pattern.type === 'contains' ? 'contains' : 'matches',
    }

    const label = operatorLabels[pattern.operator || 'eq'] || pattern.operator || 'eq'

    return {
      property: pattern.property,
      operator: pattern.negate ? `NOT ${label}` : label,
      value: pattern.pattern || '""',
    }
  }

  const buildPatternExpr = (p: WildcardPattern): string | null => {
    if (!p.property || p.pattern === undefined) return null

    const operator = p.operator || 'eq'
    let expr: string

    if (operator === 'wcard') {
      let pat = p.pattern
      if (p.type === 'starts') pat = `${p.pattern}.*`
      else if (p.type === 'ends') pat = `.*${p.pattern}`
      else if (p.type === 'contains') pat = `.*${p.pattern}.*`
      expr = `wcard(${p.property},"${pat}")`
    } else {
      expr = `${operator}(${p.property},"${p.pattern}")`
    }

    return p.negate ? `not(${expr})` : expr
  }

  const buildGroupExpr = (group: PatternGroup): string | null => {
    const exprs = group.patterns.map(buildPatternExpr).filter(Boolean) as string[]
    if (exprs.length === 0) return null
    if (exprs.length === 1) return exprs[0]
    return `${group.logicalOperator}(${exprs.join(',')})`
  }

  const generateFilterPreview = (): string => {
    const groupExprs = groups.map(buildGroupExpr).filter(Boolean) as string[]
    if (groupExprs.length === 0) return ''
    if (groupExprs.length === 1) return groupExprs[0]
    return `${groupCombineOperator}(${groupExprs.join(',')})`
  }

  // --- Render a single pattern row ---

  const renderPatternRow = (pattern: WildcardPattern, groupIndex: number, patternIndex: number, groupPatternCount: number, groupOp: LogicalOperator) => {
    const display = formatPatternDisplay(pattern)
    const key = `${groupIndex}-${patternIndex}`

    return (
      <div key={key} className="space-y-1">
        <Popover
          open={editingKey === key}
          onOpenChange={(open) => setEditingKey(open ? key : null)}
        >
          <PopoverTrigger asChild>
            <div className="group flex items-center gap-2 px-3 py-2 border border-border rounded bg-background hover:bg-muted/50 hover:border-primary/30 transition-all cursor-pointer">
              <div className="flex-1 flex items-center gap-1.5 text-sm min-w-0">
                {display.property ? (
                  <>
                    {pattern.negate && <span className="text-red-500 font-semibold text-xs">NOT</span>}
                    <span className="font-mono text-foreground truncate">{display.property}</span>
                    <span className="font-medium text-primary shrink-0">{pattern.negate ? display.operator.replace('NOT ', '') : display.operator}</span>
                    <span className="font-mono text-foreground truncate">"{display.value}"</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">{display.value}</span>
                )}
              </div>

              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); duplicatePattern(groupIndex, patternIndex) }} title="Duplicate">
                  <Copy className="w-3 h-3" />
                </Button>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); setEditingKey(key) }} title="Edit">
                  <Pencil className="w-3 h-3" />
                </Button>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive hover:bg-destructive/10" onClick={(e) => { e.stopPropagation(); removePattern(groupIndex, patternIndex) }} title="Delete">
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
          </PopoverTrigger>

          {/* Edit Popover */}
          <PopoverContent className="w-80 p-4" align="start">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">Edit Condition</h4>
                <span className="text-xs text-muted-foreground">
                  {hasMultipleGroups ? `G${groupIndex + 1} · P${patternIndex + 1}` : `Pattern ${patternIndex + 1}`}
                </span>
              </div>

              {/* Property */}
              <div>
                <Label className="text-xs font-medium">Property</Label>
                <PropertySearchTrigger
                  value={pattern.property}
                  onClick={() => { setEditingKey(null); onOpenPropertyDialog(groupIndex, patternIndex) }}
                  placeholder="Select property..."
                  className="mt-1"
                  compact={true}
                />
              </div>

              {/* Operator */}
              <div>
                <Label className="text-xs font-medium">Operator</Label>
                <Select
                  value={pattern.operator || 'eq'}
                  onValueChange={(value) => updatePattern(groupIndex, patternIndex, 'operator', value)}
                >
                  <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="eq">Equals</SelectItem>
                    <SelectItem value="ne">Not Equals</SelectItem>
                    <SelectItem value="gt">Greater Than</SelectItem>
                    <SelectItem value="lt">Less Than</SelectItem>
                    <SelectItem value="ge">Greater or Equal</SelectItem>
                    <SelectItem value="le">Less or Equal</SelectItem>
                    <SelectItem value="wcard">Wildcard (regex)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* NOT toggle */}
              <div className="flex items-center gap-2">
                <Label className="text-xs font-medium">Negate (NOT)</Label>
                <Button
                  size="sm"
                  variant={pattern.negate ? "default" : "outline"}
                  className="h-7 px-3 text-xs"
                  onClick={() => updatePattern(groupIndex, patternIndex, 'negate', !pattern.negate)}
                >
                  {pattern.negate ? 'NOT active' : 'OFF'}
                </Button>
                {pattern.negate && <span className="text-xs text-muted-foreground">Excludes matches</span>}
              </div>

              {/* Match Type (wcard only) */}
              {pattern.operator === 'wcard' && (
                <div>
                  <Label className="text-xs font-medium">Match Type</Label>
                  <Select
                    value={pattern.type || 'starts'}
                    onValueChange={(value) => updatePattern(groupIndex, patternIndex, 'type', value)}
                  >
                    <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="starts">Starts with</SelectItem>
                      <SelectItem value="ends">Ends with</SelectItem>
                      <SelectItem value="contains">Contains</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Value */}
              <div>
                <Label className="text-xs font-medium">Value</Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    value={pattern.pattern}
                    onChange={(e) => updatePattern(groupIndex, patternIndex, 'pattern', e.target.value)}
                    placeholder='Enter value or ${variable}'
                    className="flex-1 h-8 text-sm font-mono"
                  />
                  <Button
                    variant={pattern.pattern?.includes('${') ? "default" : "outline"}
                    size="icon"
                    onClick={() => { setEditingKey(null); onConfigureVariable(groupIndex, patternIndex, pattern.pattern) }}
                    title="Configure as template variable"
                    className="h-8 w-8"
                  >
                    <Wrench className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Preview */}
              {pattern.property && pattern.pattern !== undefined && (
                <div className="pt-2 border-t border-border">
                  <Label className="text-xs text-muted-foreground">APIC Syntax</Label>
                  <code className="block mt-1 text-xs font-mono bg-muted/50 rounded px-2 py-1">
                    {buildPatternExpr(pattern) || ''}
                  </code>
                </div>
              )}

              <Button size="sm" className="w-full" onClick={() => setEditingKey(null)}>Done</Button>
            </div>
          </PopoverContent>
        </Popover>

        {/* Intra-group logical operator badge */}
        {patternIndex < groupPatternCount - 1 && (
          <div className="flex items-center justify-center py-0.5">
            <span className="px-2 py-0.5 bg-primary/10 text-primary text-[10px] font-semibold rounded-full">
              {groupOp.toUpperCase()}
            </span>
          </div>
        )}
      </div>
    )
  }

  // --- Main render ---

  return (
    <div className="space-y-3">
      {/* Group combine operator — only when multiple groups */}
      {hasMultipleGroups && (
        <div className="flex items-center gap-2">
          <Label className="text-xs font-medium text-foreground">Combine groups with</Label>
          <Select
            value={groupCombineOperator}
            onValueChange={(value) => onGroupCombineOperatorChange(value as LogicalOperator)}
          >
            <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="and">AND</SelectItem>
              <SelectItem value="or">OR</SelectItem>
              <SelectItem value="xor">XOR</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Groups */}
      <div className="space-y-3">
        {groups.map((group, groupIndex) => (
          <div key={groupIndex}>
            <div className={`border border-border rounded-lg overflow-hidden ${hasMultipleGroups ? `border-l-[3px] ${GROUP_COLORS[groupIndex % GROUP_COLORS.length]}` : ''}`}>
              {/* Group header — only show when multiple groups */}
              {hasMultipleGroups && (
                <div className="flex items-center justify-between px-3 py-1.5 bg-muted/40 border-b border-border">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-muted-foreground">Group {groupIndex + 1}</span>
                    <Select
                      value={group.logicalOperator}
                      onValueChange={(value) => updateGroupOperator(groupIndex, value as LogicalOperator)}
                    >
                      <SelectTrigger className="h-6 w-20 text-[11px] border-dashed"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="and">AND</SelectItem>
                        <SelectItem value="or">OR</SelectItem>
                        <SelectItem value="xor">XOR</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0 text-destructive hover:bg-destructive/10"
                    onClick={() => removeGroup(groupIndex)}
                    title="Remove group"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              )}

              {/* Single group — show inline operator selector */}
              {!hasMultipleGroups && group.patterns.length > 1 && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/40 border-b border-border">
                  <Label className="text-xs font-medium text-foreground">Combine with</Label>
                  <Select
                    value={group.logicalOperator}
                    onValueChange={(value) => updateGroupOperator(groupIndex, value as LogicalOperator)}
                  >
                    <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="and">AND</SelectItem>
                      <SelectItem value="or">OR</SelectItem>
                      <SelectItem value="xor">XOR</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Patterns */}
              <div className="p-2 space-y-1">
                {group.patterns.map((pattern, patternIndex) =>
                  renderPatternRow(pattern, groupIndex, patternIndex, group.patterns.length, group.logicalOperator)
                )}

                {group.patterns.length === 0 && (
                  <div className="text-center py-4 text-xs text-muted-foreground">
                    Empty group. Add a condition or remove this group.
                  </div>
                )}

                {/* Add condition to this group */}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => addPattern(groupIndex)}
                  className="w-full h-7 text-xs text-muted-foreground hover:text-foreground"
                  disabled={!isConnectedToClass}
                >
                  <Plus className="w-3 h-3 mr-1" />
                  Add Condition
                </Button>
              </div>
            </div>

            {/* Inter-group combine operator badge */}
            {hasMultipleGroups && groupIndex < groups.length - 1 && (
              <div className="flex items-center justify-center py-2">
                <div className="px-3 py-1 bg-primary/10 text-primary text-xs font-bold rounded-full">
                  {groupCombineOperator.toUpperCase()}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Empty state */}
        {groups.length === 0 && (
          <div className="text-center py-8 text-sm text-muted-foreground border border-dashed border-border rounded">
            No conditions yet. Add a condition or group to start.
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            if (groups.length === 0) {
              // First add — create single group with one pattern
              onGroupsChange([{ patterns: [{ property: '', pattern: '', type: 'starts', operator: 'eq' }], logicalOperator: 'and' }])
            } else {
              // Add pattern to last group
              addPattern(groups.length - 1)
            }
          }}
          className="flex-1"
          disabled={!isConnectedToClass}
        >
          <Plus className="w-4 h-4 mr-1" />
          Add Condition
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={addGroup}
          className="shrink-0"
          disabled={!isConnectedToClass}
          title="Add a new condition group for nested logic"
        >
          <FolderPlus className="w-4 h-4 mr-1" />
          Add Group
        </Button>
      </div>

      {/* Generated Filter Preview */}
      {totalPatterns > 0 && (
        <div className="pt-3 border-t border-border">
          <Label className="text-xs font-medium text-muted-foreground">Generated Filter</Label>
          <div className="mt-2 p-3 bg-muted/50 border border-border rounded">
            <code className="text-xs text-foreground font-mono break-all">
              {generateFilterPreview() || 'No valid conditions'}
            </code>
          </div>
        </div>
      )}
    </div>
  )
}
