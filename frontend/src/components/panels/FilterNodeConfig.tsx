// panels/FilterNodeConfig.tsx
//
// Side-panel configuration for FilterNode. The user picks a property from the
// parent class (pulled from the MIM graph), chooses a filter operator (eq, ne,
// wildcard, etc.), and enters the value. Multiple filter rows are supported.

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import { mimApi } from '@/lib/api'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Info, AlertCircle, Wrench } from 'lucide-react'
import { NodeType } from '@/types'
import type { FilterNodeData, TemplateVariable, PatternGroup } from '@/types'
import { VariableConfigDialog } from '@/components/VariableConfigDialog'
import { extractVariableId } from '@/lib/templateUtils'
import {
  PropertySearchDialog,
  PropertySearchTrigger,
  type PropertyOption,
} from '@/components/PropertySearchDialog'
import { WildcardPatternBuilder } from './WildcardPatternBuilder'

interface FilterNodeConfigProps {
  nodeId: string
  data: FilterNodeData
}

export function FilterNodeConfig({ nodeId, data }: FilterNodeConfigProps) {
  const { nodes, edges } = useQueryBuilderStore()
  const updateNode = useQueryBuilderStore((state) => state.updateNode)

  // Variable configuration state
  const [showVariableDialog, setShowVariableDialog] = useState(false)
  const [currentVariableContext, setCurrentVariableContext] = useState<{
    field: 'value' | 'wildcardPattern'
    groupIndex?: number
    patternIndex?: number
    currentValue: string
    existingVariable?: Omit<TemplateVariable, 'binding'>
  } | null>(null)

  // Property search dialog state
  const [showPropertyDialog, setShowPropertyDialog] = useState(false)
  const [propertyDialogContext, setPropertyDialogContext] = useState<{
    type: 'property' | 'wildcard'
    groupIndex?: number
    patternIndex?: number
  } | null>(null)

  const [isValueVariable, setIsValueVariable] = useState(
    data.value?.startsWith('${') && data.value?.endsWith('}')
  )

  const handleVariableSave = (variableConfig: Omit<TemplateVariable, 'binding'>) => {
    const variableSyntax = `\${${variableConfig.id}}`
    const variables = { ...(data._variables || {}) }
    variables[variableConfig.id] = variableConfig

    if (currentVariableContext?.field === 'value') {
      // Property filter value
      updateNode(nodeId, {
        value: variableSyntax,
        _variable: variableConfig,  // Keep for backward compatibility
        _variables: variables
      })
      setIsValueVariable(true)
    } else if (currentVariableContext?.field === 'wildcardPattern' && currentVariableContext.groupIndex !== undefined && currentVariableContext.patternIndex !== undefined) {
      // Wildcard pattern in group
      const groups = [...(data.patternGroups || resolveGroups())]
      const group = { ...groups[currentVariableContext.groupIndex] }
      group.patterns = [...group.patterns]
      group.patterns[currentVariableContext.patternIndex] = {
        ...group.patterns[currentVariableContext.patternIndex],
        pattern: variableSyntax
      }
      groups[currentVariableContext.groupIndex] = group
      updateNode(nodeId, {
        patternGroups: groups,
        _variables: variables
      })
    }

    setCurrentVariableContext(null)
  }

  const handleRemoveVariable = () => {
    const varId = data._variable?.id
    const variables = { ...(data._variables || {}) }
    if (varId) delete variables[varId]
    updateNode(nodeId, {
      value: data._variable?.defaultValue || '',
      _variable: undefined,
      _variables: variables,
    })
    setIsValueVariable(false)
  }

  const handleConfigurePatternVariable = (groupIndex: number, patternIndex: number, currentPattern: string) => {
    const varId = extractVariableId(currentPattern)
    const existingVar = varId ? data._variables?.[varId] : undefined

    setCurrentVariableContext({
      field: 'wildcardPattern',
      groupIndex,
      patternIndex,
      currentValue: existingVar?.defaultValue || currentPattern,
      existingVariable: existingVar,
    })
    setShowVariableDialog(true)
  }

  // Convert legacy flat wildcardPatterns to grouped format
  const resolveGroups = (): PatternGroup[] => {
    if (data.patternGroups && data.patternGroups.length > 0) return data.patternGroups
    if (data.wildcardPatterns && data.wildcardPatterns.length > 0) {
      return [{ patterns: data.wildcardPatterns, logicalOperator: data.logicalOperator || 'and' }]
    }
    return []
  }

  const handleGroupsChange = (newGroups: PatternGroup[]) => {
    // Collect all variable IDs from old and new groups for cleanup
    const oldGroups = resolveGroups()
    const oldVarIds = new Set(
      oldGroups.flatMap(g => g.patterns.map(p => extractVariableId(p.pattern || ''))).filter(Boolean) as string[]
    )
    const newVarIds = new Set(
      newGroups.flatMap(g => g.patterns.map(p => extractVariableId(p.pattern || ''))).filter(Boolean) as string[]
    )
    const removedIds = [...oldVarIds].filter(id => !newVarIds.has(id))

    const update: Partial<FilterNodeData> = { patternGroups: newGroups }

    // Also write flat wildcardPatterns for backward compat with backend
    const flatPatterns = newGroups.flatMap(g => g.patterns)
    update.wildcardPatterns = flatPatterns
    update.logicalOperator = newGroups[0]?.logicalOperator || 'and'

    if (removedIds.length > 0) {
      const variables = { ...(data._variables || {}) }
      removedIds.forEach(id => delete variables[id])
      update._variables = variables
    }

    updateNode(nodeId, update)
  }

  // Find parent Class node
  const parentClassNode = (() => {
    const incomingEdges = edges.filter((e) => e.target === nodeId)
    for (const edge of incomingEdges) {
      const sourceNode = nodes.find((n) => n.id === edge.source)
      if (sourceNode?.type === NodeType.CLASS) {
        return sourceNode
      }
    }
    return null
  })()

  const parentClassName: string | undefined =
    parentClassNode && 'className' in parentClassNode.data
      ? (parentClassNode.data.className as string)
      : undefined

  // Fetch class properties
  const { data: classDetail, isLoading: isLoadingProperties } = useQuery({
    queryKey: ['classDetail', parentClassName],
    queryFn: () => mimApi.getClassDetail(parentClassName!),
    enabled: !!parentClassName,
  })

  // Transform properties for PropertySearchDialog
  const propertyOptions: PropertyOption[] = useMemo(() => {
    if (!classDetail?.properties) return []
    const options = classDetail.properties
      .filter((prop) => !prop.isHidden)
      .map((prop) => ({
        name: prop.name,
        type: prop.type,
        category: prop.category,
        isConfigurable: prop.isConfigurable,
        isNaming: prop.isNaming,
        values: prop.values,
      }))
    return options
  }, [classDetail?.properties])

  // Handle property selection from dialog
  const handlePropertySelect = (propertyName: string) => {
    if (propertyDialogContext?.type === 'property') {
      updateNode(nodeId, { property: propertyName })
    } else if (propertyDialogContext?.type === 'wildcard' && propertyDialogContext.groupIndex !== undefined && propertyDialogContext.patternIndex !== undefined) {
      // Update pattern property within group
      const groups = [...(data.patternGroups || resolveGroups())]
      const group = { ...groups[propertyDialogContext.groupIndex] }
      group.patterns = [...group.patterns]
      group.patterns[propertyDialogContext.patternIndex] = {
        ...group.patterns[propertyDialogContext.patternIndex],
        property: propertyName
      }
      groups[propertyDialogContext.groupIndex] = group
      updateNode(nodeId, { patternGroups: groups })
    }
    setPropertyDialogContext(null)
  }

  // Open property dialog for property filter
  const openPropertyDialogForFilter = () => {
    setPropertyDialogContext({ type: 'property' })
    setShowPropertyDialog(true)
  }

  // Open property dialog for wildcard pattern
  const openPropertyDialogForWildcard = (groupIndex: number, patternIndex: number) => {
    setPropertyDialogContext({ type: 'wildcard', groupIndex, patternIndex })
    setShowPropertyDialog(true)
  }

  const handleFilterTypeChange = (filterType: FilterNodeData['filterType']) => {
    updateNode(nodeId, {
      filterType,
      property: undefined,
      operator: filterType === 'property' ? 'eq' : undefined,
      value: undefined,
      queryTargetFilter: undefined,
      wildcardPatterns: filterType === 'query-target-filter' ? [] : undefined,
      logicalOperator: filterType === 'query-target-filter' ? 'and' : undefined,
      patternGroups: filterType === 'query-target-filter' ? [] : undefined,
      groupCombineOperator: filterType === 'query-target-filter' ? 'and' : undefined,
      subscriptionType: undefined,
    })
  }


  return (
    <div className="flex flex-col h-full">
      {/* Filter Type Selection */}
      <div className="border-b border-border">
        <div className="px-6 py-3 border-b border-border bg-muted/30">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Filter Type
          </h3>
        </div>
        <div className="p-6">
          <Select
            value={data.filterType}
            onValueChange={(value) => handleFilterTypeChange(value as FilterNodeData['filterType'])}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="property">Property Filter</SelectItem>
              <SelectItem value="query-target-filter">Query Target Filter (Wildcard)</SelectItem>
              <SelectItem value="subscription">Subscription</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {data.filterType === 'property' && (
        <div className="border-b border-border">
          <div className="px-6 py-3 border-b border-border bg-muted/30">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Property Configuration
            </h3>
          </div>
          <div className="p-6 space-y-4">
            {!parentClassName ? (
              <div className="flex items-start gap-2 p-3 bg-orange-50 border border-orange-200 rounded-md text-orange-800">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <div className="font-semibold">Connect to Class Node</div>
                  <div className="text-xs mt-1">This filter must be connected to a Class node to select properties.</div>
                </div>
              </div>
            ) : (
              <div>
                <Label className="text-xs text-muted-foreground">Property Name</Label>
                {isLoadingProperties ? (
                  <div className="mt-2 text-sm text-muted-foreground">Loading properties...</div>
                ) : (
                  <PropertySearchTrigger
                    value={data.property || ''}
                    onClick={openPropertyDialogForFilter}
                    placeholder="Click to search properties..."
                    className="mt-2"
                  />
                )}
                <div className="mt-1 text-xs text-muted-foreground">
                  From class: <span className="font-mono">{parentClassName}</span>
                  {propertyOptions.length > 0 && (
                    <span className="ml-1">({propertyOptions.length} properties available)</span>
                  )}
                </div>
              </div>
            )}

            <div>
              <Label className="text-xs text-muted-foreground">Operator</Label>
              <Select
                value={data.operator || 'eq'}
                onValueChange={(value) => updateNode(nodeId, { operator: value as FilterNodeData['operator'] })}
                defaultValue="eq"
              >
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="eq">Equals (=)</SelectItem>
                  <SelectItem value="ne">Not Equals (≠)</SelectItem>
                  <SelectItem value="gt">Greater Than (&gt;)</SelectItem>
                  <SelectItem value="lt">Less Than (&lt;)</SelectItem>
                  <SelectItem value="ge">Greater or Equal (≥)</SelectItem>
                  <SelectItem value="le">Less or Equal (≤)</SelectItem>
                  <SelectItem value="wcard">Wildcard (regex)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Value</Label>
              <div className="flex gap-2 mt-2">
                {(() => {
                  // Get selected property metadata
                  const selectedProperty = classDetail?.properties?.find(p => p.name === data.property)

                  // ENUM: Show dropdown with valid values
                  if (selectedProperty?.values && selectedProperty.values.length > 0) {
                    return (
                      <Select
                        value={data.value || ''}
                        onValueChange={(value) => updateNode(nodeId, { value })}
                        disabled={isValueVariable}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Select value" />
                        </SelectTrigger>
                        <SelectContent>
                          {selectedProperty.values.map((val) => (
                            <SelectItem key={val} value={val}>
                              {val}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )
                  }

                  // BOOLEAN: Show true/false dropdown
                  if (selectedProperty?.type === 'bool') {
                    return (
                      <Select
                        value={data.value || ''}
                        onValueChange={(value) => updateNode(nodeId, { value })}
                        disabled={isValueVariable}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Select value" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="true">true</SelectItem>
                          <SelectItem value="false">false</SelectItem>
                        </SelectContent>
                      </Select>
                    )
                  }

                  // INTEGER: Show number input. `range` is shaped as `[[min, max]]`
                  // in the MIM metadata, so unwrap the first tuple before binding.
                  if (selectedProperty?.type === 'int') {
                    const [min, max] = selectedProperty.range?.[0] ?? []

                    return (
                      <Input
                        type="number"
                        value={data.value || ''}
                        onChange={(e) => updateNode(nodeId, { value: e.target.value })}
                        placeholder="Enter number"
                        disabled={isValueVariable}
                        className="flex-1"
                        min={min}
                        max={max}
                      />
                    )
                  }

                  // STRING: Show text input (with length hint if available)
                  const range = selectedProperty?.range?.[0]
                  const maxLength = range?.[1]

                  return (
                    <Input
                      value={data.value || ''}
                      onChange={(e) => updateNode(nodeId, { value: e.target.value })}
                      placeholder={maxLength ? `Max ${maxLength} chars` : "Filter value"}
                      disabled={isValueVariable}
                      className="flex-1"
                      maxLength={maxLength}
                    />
                  )
                })()}
                <Button
                  variant={isValueVariable ? "default" : "outline"}
                  size="icon"
                  onClick={() => {
                    if (isValueVariable) {
                      handleRemoveVariable()
                    } else {
                      setCurrentVariableContext({ field: 'value', currentValue: data.value || '' })
                      setShowVariableDialog(true)
                    }
                  }}
                  title={isValueVariable ? "Remove variable" : "Make this a template variable"}
                >
                  <Wrench className="w-4 h-4" />
                </Button>
              </div>
              {isValueVariable && data._variable && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Variable: <span className="font-semibold">{data._variable.label}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {data.filterType === 'query-target-filter' && (
        <div className="border-b border-border">
          <div className="px-6 py-3 border-b border-border bg-muted/30">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Query Target Filter (Wildcard)
            </h3>
          </div>
          <div className="p-6 space-y-4">
            {!parentClassName && (
              <div className="flex items-start gap-2 p-3 bg-orange-50 border border-orange-200 rounded-md text-orange-800">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <div className="font-semibold">Connect to Class Node</div>
                  <div className="text-xs mt-1">This filter must be connected to a Class node to select properties.</div>
                </div>
              </div>
            )}

            <div className="bg-accent/30 border border-border rounded-lg p-3">
              <div className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>
                  Query Target Filter performs wildcard matching on APIC side using regex patterns.
                  Supports: <span className="font-mono">prefix.*</span> (starts), <span className="font-mono">.*suffix</span> (ends), <span className="font-mono">.*value.*</span> (contains).
                  {parentClassName && (
                    <div className="mt-1 text-xs">
                      Connected to: <span className="font-mono">{parentClassName}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Grouped Pattern Builder */}
            <WildcardPatternBuilder
              groups={resolveGroups()}
              groupCombineOperator={data.groupCombineOperator || 'and'}
              onGroupsChange={handleGroupsChange}
              onGroupCombineOperatorChange={(op) => updateNode(nodeId, { groupCombineOperator: op })}
              onOpenPropertyDialog={openPropertyDialogForWildcard}
              onConfigureVariable={handleConfigurePatternVariable}
              isConnectedToClass={!!parentClassName}
            />
          </div>
        </div>
      )}

      {data.filterType === 'subscription' && (
        <div className="border-b border-border">
          <div className="px-6 py-3 border-b border-border bg-muted/30">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Subscription Configuration
            </h3>
          </div>
          <div className="p-6">
            <Label className="text-xs font-medium text-foreground">Subscription Type</Label>
            <Select
              value={data.subscriptionType || 'audit'}
              onValueChange={(value) => updateNode(nodeId, { subscriptionType: value as 'audit' | 'event' })}
            >
              <SelectTrigger className="h-9 mt-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="audit">Audit Logs</SelectItem>
                <SelectItem value="event">Events</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Property Search Dialog */}
      <PropertySearchDialog
        open={showPropertyDialog}
        onOpenChange={(open) => {
          setShowPropertyDialog(open)
          if (!open) setPropertyDialogContext(null)
        }}
        properties={propertyOptions}
        value={
          propertyDialogContext?.type === 'property'
            ? data.property || ''
            : propertyDialogContext?.type === 'wildcard' && propertyDialogContext.groupIndex !== undefined && propertyDialogContext.patternIndex !== undefined
            ? resolveGroups()[propertyDialogContext.groupIndex]?.patterns[propertyDialogContext.patternIndex]?.property || ''
            : ''
        }
        onSelect={handlePropertySelect}
        title={`Select Property from ${parentClassName || 'Class'}`}
      />

      {/* Variable Configuration Dialog */}
      <VariableConfigDialog
        open={showVariableDialog}
        onOpenChange={(open) => {
          setShowVariableDialog(open)
          if (!open) setCurrentVariableContext(null)
        }}
        nodeId={nodeId}
        fieldPath={currentVariableContext?.field || 'value'}
        currentValue={currentVariableContext?.currentValue || ''}
        existingVariable={currentVariableContext?.existingVariable}
        onSave={handleVariableSave}
      />
    </div>
  )
}
