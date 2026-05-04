import { useState, useRef } from 'react'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  POST_PROCESSOR_META,
  POST_PROCESSOR_CATEGORIES,
  type PostProcessorCategory,
} from './postProcessorMeta'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Plus, X, HelpCircle, Wrench, Maximize2 } from 'lucide-react'
import { JavaScriptEditor, type JavaScriptEditorHandle } from './javascript/JavaScriptEditor'
import { JavaScriptEditorDialog } from './javascript/JavaScriptEditorDialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type {
  PostProcessorNodeData,
  DNExtractConfig,
  RegexTransformConfig,
  ArraySortConfig,
  PatternFilterConfig,
  JavaScriptConfig,
  AggregateConfig,
  FieldExtractConfig,
  FlattenConfig,
  MapTransformConfig,
  TextOperationsConfig,
  TemplateVariable,
} from '@/types'
import { VariableConfigDialog } from '@/components/VariableConfigDialog'
import { extractVariableId } from '@/lib/templateUtils'

interface PostProcessorNodeConfigProps {
  nodeId: string
  data: PostProcessorNodeData
}

export function PostProcessorNodeConfig({ nodeId, data }: PostProcessorNodeConfigProps) {
  const updateNode = useQueryBuilderStore((state) => state.updateNode)
  const [showVariableDialog, setShowVariableDialog] = useState(false)
  const [currentVariableContext, setCurrentVariableContext] = useState<{
    field: 'pattern' | 'replacement'
    currentValue: string
  } | null>(null)

  const handleProcessorTypeChange = (processorType: PostProcessorNodeData['processorType']) => {
    let defaultConfig: any = {}

    switch (processorType) {
      case 'dn-extract':
        defaultConfig = { extractField: 'dn' }
        break
      case 'regex-transform':
        defaultConfig = { pattern: '', replacement: '', flags: 'g' }
        break
      case 'array-sort':
        defaultConfig = { unique: false, numeric: false, reverse: false }
        break
      case 'pattern-filter':
        defaultConfig = { includePatterns: [], excludePatterns: [], caseSensitive: false }
        break
      case 'field-extract':
        defaultConfig = { fields: [], keepStructure: false }
        break
      case 'flatten':
        defaultConfig = { depth: 1, separator: '.' }
        break
      case 'map-transform':
        defaultConfig = { expression: 'item', itemVar: 'item' }
        break
      case 'text-operations':
        defaultConfig = { operation: 'trim' }
        break
      case 'javascript':
        defaultConfig = { code: '(data) => data', timeout: 5000 }
        break
      case 'aggregate':
        defaultConfig = { operation: 'count' }
        break
    }

    updateNode(nodeId, {
      processorType,
      config: defaultConfig,
      label: `Post Processor: ${processorType.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}`,
    })
  }

  const updateConfig = (updates: Partial<typeof data.config>) => {
    updateNode(nodeId, {
      config: {
        ...data.config,
        ...updates,
      },
    })
  }

  const handleVariableSave = (variableConfig: Omit<TemplateVariable, 'binding'>) => {
    const variableSyntax = `\${${variableConfig.id}}`
    const variables = { ...(data._variables || {}) }
    variables[variableConfig.id] = variableConfig

    if (currentVariableContext?.field === 'pattern') {
      updateConfig({ pattern: variableSyntax } as any)
    } else if (currentVariableContext?.field === 'replacement') {
      updateConfig({ replacement: variableSyntax } as any)
    }

    updateNode(nodeId, { _variables: variables })
    setCurrentVariableContext(null)
  }

  const handleConfigureVariable = (field: 'pattern' | 'replacement', currentValue: string) => {
    const varId = extractVariableId(currentValue)
    setCurrentVariableContext({ field, currentValue: varId ? data._variables?.[varId]?.defaultValue || currentValue : currentValue })
    setShowVariableDialog(true)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border">
        <div className="px-6 py-3 border-b border-border bg-muted/30">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Processor Type
          </h3>
        </div>
        <div className="p-6">
          <Select
            value={data.processorType}
            onValueChange={(value) => handleProcessorTypeChange(value as PostProcessorNodeData['processorType'])}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {POST_PROCESSOR_CATEGORIES.map((category) => {
                const itemsInCategory = Object.values(POST_PROCESSOR_META)
                  .filter((meta) => meta.category === (category.id as PostProcessorCategory))
                if (itemsInCategory.length === 0) return null
                return (
                  <SelectGroup key={category.id}>
                    <SelectLabel
                      className={`mx-2 my-1 px-0 pb-1 text-[10px] uppercase tracking-wider font-semibold border-b ${category.textClass} ${category.underlineClass}`}
                    >
                      {category.label}
                    </SelectLabel>
                    {itemsInCategory.map((meta) => (
                      <SelectItem key={meta.id} value={meta.id}>
                        {meta.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )
              })}
            </SelectContent>
          </Select>
        </div>
      </div>

      {data.processorType === 'dn-extract' && (
        <DNExtractConfigPanel config={data.config as DNExtractConfig} updateConfig={updateConfig} />
      )}

      {data.processorType === 'regex-transform' && (
        <RegexTransformConfigPanel
          config={data.config as RegexTransformConfig}
          updateConfig={updateConfig}
          onConfigureVariable={handleConfigureVariable}
        />
      )}

      {data.processorType === 'array-sort' && (
        <ArraySortConfigPanel config={data.config as ArraySortConfig} updateConfig={updateConfig} />
      )}

      {data.processorType === 'pattern-filter' && (
        <PatternFilterConfigPanel config={data.config as PatternFilterConfig} updateConfig={updateConfig} />
      )}

      {data.processorType === 'field-extract' && (
        <FieldExtractConfigPanel config={data.config as FieldExtractConfig} updateConfig={updateConfig} />
      )}

      {data.processorType === 'flatten' && (
        <FlattenConfigPanel config={data.config as FlattenConfig} updateConfig={updateConfig} />
      )}

      {data.processorType === 'map-transform' && (
        <MapTransformConfigPanel config={data.config as MapTransformConfig} updateConfig={updateConfig} />
      )}

      {data.processorType === 'text-operations' && (
        <TextOperationsConfigPanel config={data.config as TextOperationsConfig} updateConfig={updateConfig} />
      )}

      {data.processorType === 'javascript' && (
        <JavaScriptConfigPanel config={data.config as JavaScriptConfig} updateConfig={updateConfig} />
      )}

      {data.processorType === 'aggregate' && (
        <AggregateConfigPanel config={data.config as AggregateConfig} updateConfig={updateConfig} />
      )}

      <VariableConfigDialog
        open={showVariableDialog}
        onOpenChange={(open) => {
          setShowVariableDialog(open)
          if (!open) setCurrentVariableContext(null)
        }}
        nodeId={nodeId}
        fieldPath={currentVariableContext?.field || 'pattern'}
        currentValue={currentVariableContext?.currentValue || ''}
        onSave={handleVariableSave}
      />
    </div>
  )
}

function DNExtractConfigPanel({ config, updateConfig }: { config: DNExtractConfig; updateConfig: (u: any) => void }) {
  return (
    <div className="border-b border-border">
      <div className="px-4 py-3 bg-card/50">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          DN Extract Configuration
        </h3>
      </div>
      <div className="p-4 space-y-4">
        <div>
          <Label className="text-xs text-muted-foreground">Extract Field</Label>
          <Input
            value={config.extractField || 'dn'}
            onChange={(e) => updateConfig({ extractField: e.target.value })}
            placeholder="dn"
            className="text-xs mt-2"
          />
          <p className="text-xs text-muted-foreground mt-1">Field to extract from APIC response</p>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">
            Remove Prefix (Regex)
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="w-3 h-3 inline ml-1 opacity-50" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-xs">Example: /node-[0-9]+/ removes "/node-101/"</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </Label>
          <Input
            value={config.removePrefix || ''}
            onChange={(e) => updateConfig({ removePrefix: e.target.value })}
            placeholder="/node-[0-9]+/"
            className="font-mono text-xs mt-2"
          />
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">
            Extract Pattern (Regex)
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="w-3 h-3 inline ml-1 opacity-50" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-xs">Use capture groups: uni/tn-([^/]+)/ extracts tenant name</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </Label>
          <Input
            value={config.extractPattern || ''}
            onChange={(e) => updateConfig({ extractPattern: e.target.value })}
            placeholder="uni/tn-([^/]+)/"
            className="font-mono text-xs mt-2"
          />
        </div>
      </div>
    </div>
  )
}

function RegexTransformConfigPanel({
  config,
  updateConfig,
  onConfigureVariable
}: {
  config: RegexTransformConfig
  updateConfig: (u: any) => void
  onConfigureVariable: (field: 'pattern' | 'replacement', currentValue: string) => void
}) {
  return (
    <div className="border-b border-border">
      <div className="px-4 py-3 bg-card/50">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Regex Transform (sed-like)
        </h3>
      </div>
      <div className="p-4 space-y-4">
        <div>
          <Label className="text-xs text-muted-foreground">Pattern (Regex)</Label>
          <div className="flex gap-2 mt-2">
            <Input
              value={config.pattern}
              onChange={(e) => updateConfig({ pattern: e.target.value })}
              placeholder="uni/tn-([^/]+)/.* or ${regex_pattern}"
              className="flex-1 font-mono text-xs"
            />
            <Button
              variant={config.pattern?.includes('${') ? "default" : "outline"}
              size="icon"
              onClick={() => onConfigureVariable('pattern', config.pattern)}
              title={config.pattern?.includes('${') ? "Configure variable metadata" : "Make this a template variable"}
              className="h-9 w-9"
            >
              <Wrench className={`w-4 h-4 ${config.pattern?.includes('${') ? 'animate-pulse' : ''}`} />
            </Button>
          </div>
          {config.pattern?.includes('${') && (
            <p className="text-xs text-blue-600 mt-1">Variable detected - Click wrench to configure metadata</p>
          )}
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">
            Replacement
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="w-3 h-3 inline ml-1 opacity-50" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-xs">Use $1, $2, etc. for capture groups or ${'{variable_name}'} for templates</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </Label>
          <div className="flex gap-2 mt-2">
            <Input
              value={config.replacement}
              onChange={(e) => updateConfig({ replacement: e.target.value })}
              placeholder="$1 or ${replacement_text}"
              className="flex-1 font-mono text-xs"
            />
            <Button
              variant={config.replacement?.includes('${') ? "default" : "outline"}
              size="icon"
              onClick={() => onConfigureVariable('replacement', config.replacement)}
              title={config.replacement?.includes('${') ? "Configure variable metadata" : "Make this a template variable"}
              className="h-9 w-9"
            >
              <Wrench className={`w-4 h-4 ${config.replacement?.includes('${') ? 'animate-pulse' : ''}`} />
            </Button>
          </div>
          {config.replacement?.includes('${') && (
            <p className="text-xs text-blue-600 mt-1">Variable detected - Click wrench to configure metadata</p>
          )}
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">
            Apply To Field
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="w-3 h-3 inline ml-1 opacity-50" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-xs">
                    Optional. When the input is a list of objects (e.g. fvTenant rows),
                    set this to the field that holds the string you want to transform
                    (e.g. <code>dn</code> or <code>attributes.dn</code>).
                    Leave blank when the input is already a list of strings.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </Label>
          <Input
            value={config.applyTo || ''}
            onChange={(e) => updateConfig({ applyTo: e.target.value })}
            placeholder="dn, attributes.dn (optional)"
            className="font-mono text-xs mt-2"
          />
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Flags</Label>
          <Input
            value={config.flags || 'g'}
            onChange={(e) => updateConfig({ flags: e.target.value })}
            placeholder="g, gi, gm"
            className="font-mono text-xs mt-2"
          />
          <p className="text-xs text-muted-foreground mt-1">g=global, i=case-insensitive, m=multiline</p>
        </div>
      </div>
    </div>
  )
}

function ArraySortConfigPanel({ config, updateConfig }: { config: ArraySortConfig; updateConfig: (u: any) => void }) {
  return (
    <div className="border-b border-border">
      <div className="px-4 py-3 bg-card/50">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Array Sort Configuration
        </h3>
      </div>
      <div className="p-4 space-y-4">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="unique"
            checked={config.unique || false}
            onCheckedChange={(checked) => updateConfig({ unique: checked === true })}
          />
          <label htmlFor="unique" className="text-xs cursor-pointer">
            Unique (Remove duplicates like sort -u)
          </label>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="numeric"
            checked={config.numeric || false}
            onCheckedChange={(checked) => updateConfig({ numeric: checked === true })}
          />
          <label htmlFor="numeric" className="text-xs cursor-pointer">
            Numeric Sort (like sort -n)
          </label>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="reverse"
            checked={config.reverse || false}
            onCheckedChange={(checked) => updateConfig({ reverse: checked === true })}
          />
          <label htmlFor="reverse" className="text-xs cursor-pointer">
            Reverse Order (like sort -r)
          </label>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Sort by Field (for objects)</Label>
          <Input
            value={config.field || ''}
            onChange={(e) => updateConfig({ field: e.target.value })}
            placeholder="attributes.name"
            className="text-xs mt-2"
          />
        </div>
      </div>
    </div>
  )
}

function PatternFilterConfigPanel({ config, updateConfig }: { config: PatternFilterConfig; updateConfig: (u: any) => void }) {
  const addIncludePattern = () => {
    const patterns = config.includePatterns || []
    updateConfig({ includePatterns: [...patterns, ''] })
  }

  const updateIncludePattern = (index: number, value: string) => {
    const patterns = [...(config.includePatterns || [])]
    patterns[index] = value
    updateConfig({ includePatterns: patterns })
  }

  const removeIncludePattern = (index: number) => {
    const patterns = [...(config.includePatterns || [])]
    patterns.splice(index, 1)
    updateConfig({ includePatterns: patterns })
  }

  const addExcludePattern = () => {
    const patterns = config.excludePatterns || []
    updateConfig({ excludePatterns: [...patterns, ''] })
  }

  const updateExcludePattern = (index: number, value: string) => {
    const patterns = [...(config.excludePatterns || [])]
    patterns[index] = value
    updateConfig({ excludePatterns: patterns })
  }

  const removeExcludePattern = (index: number) => {
    const patterns = [...(config.excludePatterns || [])]
    patterns.splice(index, 1)
    updateConfig({ excludePatterns: patterns })
  }

  return (
    <div className="border-b border-border">
      <div className="px-4 py-3 bg-card/50">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Pattern Filter (grep-like)
        </h3>
      </div>
      <div className="p-4 space-y-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-xs text-muted-foreground">Include Patterns (OR logic)</Label>
            <Button size="sm" variant="ghost" onClick={addIncludePattern} className="h-6 px-2">
              <Plus className="w-3 h-3" />
            </Button>
          </div>
          {(config.includePatterns || []).map((pattern, index) => (
            <div key={index} className="flex gap-2 mb-2">
              <Input
                value={pattern}
                onChange={(e) => updateIncludePattern(index, e.target.value)}
                placeholder="/epg-|out-"
                className="font-mono text-xs flex-1"
              />
              <Button size="sm" variant="ghost" onClick={() => removeIncludePattern(index)} className="h-8 w-8 p-0">
                <X className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-xs text-muted-foreground">Exclude Patterns</Label>
            <Button size="sm" variant="ghost" onClick={addExcludePattern} className="h-6 px-2">
              <Plus className="w-3 h-3" />
            </Button>
          </div>
          {(config.excludePatterns || []).map((pattern, index) => (
            <div key={index} className="flex gap-2 mb-2">
              <Input
                value={pattern}
                onChange={(e) => updateExcludePattern(index, e.target.value)}
                placeholder="ExtEPG|PE_BGP"
                className="font-mono text-xs flex-1"
              />
              <Button size="sm" variant="ghost" onClick={() => removeExcludePattern(index)} className="h-8 w-8 p-0">
                <X className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">
            Match Field
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="w-3 h-3 inline ml-1 opacity-50" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-xs">
                    Optional. When the input is a list of objects (e.g. fvBD rows),
                    set this to the field that the patterns should be tested against
                    (e.g. <code>attributes.name</code>). Leave blank to match against
                    the whole item — useful only when the input is already a list of
                    strings.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </Label>
          <Input
            value={config.field || ''}
            onChange={(e) => updateConfig({ field: e.target.value })}
            placeholder="attributes.name (optional)"
            className="font-mono text-xs mt-2"
          />
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="caseSensitive"
            checked={config.caseSensitive || false}
            onCheckedChange={(checked) => updateConfig({ caseSensitive: checked === true })}
          />
          <label htmlFor="caseSensitive" className="text-xs cursor-pointer">
            Case Sensitive
          </label>
        </div>
      </div>
    </div>
  )
}

function JavaScriptConfigPanel({ config, updateConfig }: { config: JavaScriptConfig; updateConfig: (u: any) => void }) {
  const [expanded, setExpanded] = useState(false)
  const inlineEditorRef = useRef<JavaScriptEditorHandle>(null)

  // Flush any pending inline edit before opening the dialog so the dialog
  // reads the freshest value from config.code.
  const handleExpand = () => {
    inlineEditorRef.current?.flush()
    setExpanded(true)
  }

  return (
    <div className="border-b border-border">
      <div className="px-4 py-3 bg-card/50">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          JavaScript Configuration (Sandboxed)
        </h3>
      </div>
      <div className="p-4 space-y-4">
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-md p-3">
          <p className="text-xs text-yellow-600 dark:text-yellow-400 font-medium mb-1">Security Notice</p>
          <p className="text-xs text-muted-foreground">
            JavaScript execution is sandboxed. No access to window, document, fetch, or external APIs.
            Execution is limited by timeout to prevent infinite loops.
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-xs text-muted-foreground">
              JavaScript Function
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="w-3 h-3 inline ml-1 opacity-50" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-xs font-medium mb-1">Two styles work — pick whichever you prefer:</p>
                    <p className="text-xs">1. Arrow function: <code>(data) =&gt; data.filter(...)</code></p>
                    <p className="text-xs mt-1">2. Plain body with return: <code>const x = ...; return x;</code></p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleExpand}
              className="h-7 px-2 text-xs"
              title="Open in full editor"
            >
              <Maximize2 className="w-3.5 h-3.5 mr-1" />
              Expand
            </Button>
          </div>

          <div className="border border-border rounded-md overflow-hidden">
            <JavaScriptEditor
              ref={inlineEditorRef}
              value={config.code || ''}
              onChange={(code) => updateConfig({ code })}
              height={220}
            />
          </div>

          <p className="text-xs text-muted-foreground mt-1">
            Auto-saves while you type. Click Expand for a full-screen editor.
          </p>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Execution Timeout (ms)</Label>
          <Input
            type="number"
            value={config.timeout || 5000}
            onChange={(e) => updateConfig({ timeout: parseInt(e.target.value) || 5000 })}
            placeholder="5000"
            className="text-xs mt-2"
            min="100"
            max="30000"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Maximum execution time in milliseconds (default: 5000ms)
          </p>
        </div>
      </div>

      <JavaScriptEditorDialog
        open={expanded}
        onOpenChange={setExpanded}
        value={config.code || ''}
        onChange={(code) => updateConfig({ code })}
      />
    </div>
  )
}

function AggregateConfigPanel({ config, updateConfig }: { config: AggregateConfig; updateConfig: (u: any) => void }) {
  return (
    <div className="border-b border-border">
      <div className="px-4 py-3 bg-card/50">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Aggregate Configuration
        </h3>
      </div>
      <div className="p-4 space-y-4">
        <div>
          <Label className="text-xs text-muted-foreground">Operation</Label>
          <Select
            value={config.operation}
            onValueChange={(value: any) => updateConfig({ operation: value })}
          >
            <SelectTrigger className="mt-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="count">Count</SelectItem>
              <SelectItem value="sum">Sum</SelectItem>
              <SelectItem value="avg">Average</SelectItem>
              <SelectItem value="min">Minimum</SelectItem>
              <SelectItem value="max">Maximum</SelectItem>
              <SelectItem value="group">Group By</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {config.operation !== 'count' && (
          <div>
            <Label className="text-xs text-muted-foreground">
              {config.operation === 'group' ? 'Group By Field' : 'Field'}
            </Label>
            <Input
              value={config.field || config.groupBy || ''}
              onChange={(e) => updateConfig(
                config.operation === 'group'
                  ? { groupBy: e.target.value }
                  : { field: e.target.value }
              )}
              placeholder="attributes.value"
              className="text-xs mt-2"
            />
          </div>
        )}
      </div>
    </div>
  )
}

function FieldExtractConfigPanel({ config, updateConfig }: { config: FieldExtractConfig; updateConfig: (u: any) => void }) {
  const addField = () => {
    const fields = config.fields || []
    updateConfig({ fields: [...fields, ''] })
  }

  const updateField = (index: number, value: string) => {
    const fields = [...(config.fields || [])]
    fields[index] = value
    updateConfig({ fields })
  }

  const removeField = (index: number) => {
    const fields = [...(config.fields || [])]
    fields.splice(index, 1)
    updateConfig({ fields })
  }

  return (
    <div className="border-b border-border">
      <div className="px-4 py-3 bg-card/50">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Field Extract Configuration
        </h3>
      </div>
      <div className="p-4 space-y-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-xs text-muted-foreground">
              Fields to Extract
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="w-3 h-3 inline ml-1 opacity-50" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-xs">Use dot notation for nested fields</p>
                    <p className="text-xs mt-1">Example: attributes.name, attributes.dn</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Label>
            <Button size="sm" variant="ghost" onClick={addField} className="h-6 px-2">
              <Plus className="w-3 h-3" />
            </Button>
          </div>
          {(config.fields || []).map((field, index) => (
            <div key={index} className="flex gap-2 mb-2">
              <Input
                value={field}
                onChange={(e) => updateField(index, e.target.value)}
                placeholder="attributes.name"
                className="font-mono text-xs flex-1"
              />
              <Button size="sm" variant="ghost" onClick={() => removeField(index)} className="h-8 w-8 p-0">
                <X className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="keepStructure"
            checked={config.keepStructure || false}
            onCheckedChange={(checked) => updateConfig({ keepStructure: checked === true })}
          />
          <label htmlFor="keepStructure" className="text-xs cursor-pointer">
            Keep Original Structure (preserve nested paths)
          </label>
        </div>
      </div>
    </div>
  )
}

function FlattenConfigPanel({ config, updateConfig }: { config: FlattenConfig; updateConfig: (u: any) => void }) {
  return (
    <div className="border-b border-border">
      <div className="px-4 py-3 bg-card/50">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Flatten Configuration
        </h3>
      </div>
      <div className="p-4 space-y-4">
        <div>
          <Label className="text-xs text-muted-foreground">
            Depth
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="w-3 h-3 inline ml-1 opacity-50" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-xs">How many levels to flatten</p>
                  <p className="text-xs mt-1">1 = flatten one level, 0 = flatten all levels</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </Label>
          <Input
            type="number"
            value={config.depth ?? 1}
            onChange={(e) => {
              const value = parseInt(e.target.value)
              updateConfig({ depth: value === 0 ? Infinity : value })
            }}
            placeholder="1"
            className="text-xs mt-2"
            min="0"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Set to 0 to flatten all levels (Infinity)
          </p>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">
            Separator (for objects)
          </Label>
          <Input
            value={config.separator || '.'}
            onChange={(e) => updateConfig({ separator: e.target.value })}
            placeholder="."
            className="text-xs mt-2"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Used when flattening object keys (e.g., "parent.child")
          </p>
        </div>
      </div>
    </div>
  )
}

function MapTransformConfigPanel({ config, updateConfig }: { config: MapTransformConfig; updateConfig: (u: any) => void }) {
  return (
    <div className="border-b border-border">
      <div className="px-4 py-3 bg-card/50">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Map Transform Configuration
        </h3>
      </div>
      <div className="p-4 space-y-4">
        <div>
          <Label className="text-xs text-muted-foreground">
            Transform Expression
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="w-3 h-3 inline ml-1 opacity-50" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-xs">JavaScript expression applied to each item</p>
                  <p className="text-xs mt-1">Examples:</p>
                  <p className="text-xs mt-1">item.name</p>
                  <p className="text-xs">item.value * 2</p>
                  <p className="text-xs">{`{ name: item.name, upper: item.name.toUpperCase() }`}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </Label>
          <Textarea
            value={config.expression}
            onChange={(e) => updateConfig({ expression: e.target.value })}
            placeholder="item.toUpperCase()"
            className="font-mono text-xs mt-2 min-h-[80px]"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Expression to transform each array item
          </p>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Item Variable Name</Label>
          <Input
            value={config.itemVar || 'item'}
            onChange={(e) => updateConfig({ itemVar: e.target.value })}
            placeholder="item"
            className="font-mono text-xs mt-2"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Variable name to use in expression (default: "item")
          </p>
        </div>
      </div>
    </div>
  )
}

function TextOperationsConfigPanel({ config, updateConfig }: { config: TextOperationsConfig; updateConfig: (u: any) => void }) {
  return (
    <div className="border-b border-border">
      <div className="px-4 py-3 bg-card/50">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Text Operations Configuration
        </h3>
      </div>
      <div className="p-4 space-y-4">
        <div>
          <Label className="text-xs text-muted-foreground">Operation</Label>
          <Select
            value={config.operation}
            onValueChange={(value: any) => updateConfig({ operation: value })}
          >
            <SelectTrigger className="mt-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="split">Split (string to array)</SelectItem>
              <SelectItem value="join">Join (array to string)</SelectItem>
              <SelectItem value="trim">Trim (whitespace)</SelectItem>
              <SelectItem value="upper">Uppercase</SelectItem>
              <SelectItem value="lower">Lowercase</SelectItem>
              <SelectItem value="replace">Replace (find/replace)</SelectItem>
              <SelectItem value="substring">Substring (extract part)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Split Options */}
        {config.operation === 'split' && (
          <>
            <div>
              <Label className="text-xs text-muted-foreground">Separator</Label>
              <Input
                value={config.separator || ','}
                onChange={(e) => updateConfig({ separator: e.target.value })}
                placeholder=","
                className="text-xs mt-2"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Limit (optional)</Label>
              <Input
                type="number"
                value={config.limit || ''}
                onChange={(e) => updateConfig({ limit: e.target.value ? parseInt(e.target.value) : undefined })}
                placeholder="No limit"
                className="text-xs mt-2"
              />
            </div>
          </>
        )}

        {/* Join Options */}
        {config.operation === 'join' && (
          <div>
            <Label className="text-xs text-muted-foreground">Delimiter</Label>
            <Input
              value={config.delimiter || ','}
              onChange={(e) => updateConfig({ delimiter: e.target.value })}
              placeholder=","
              className="text-xs mt-2"
            />
          </div>
        )}

        {/* Replace Options */}
        {config.operation === 'replace' && (
          <>
            <div>
              <Label className="text-xs text-muted-foreground">Find (regex)</Label>
              <Input
                value={config.find || ''}
                onChange={(e) => updateConfig({ find: e.target.value })}
                placeholder="pattern"
                className="font-mono text-xs mt-2"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Replace With</Label>
              <Input
                value={config.replaceWith || ''}
                onChange={(e) => updateConfig({ replaceWith: e.target.value })}
                placeholder="replacement"
                className="text-xs mt-2"
              />
            </div>
          </>
        )}

        {/* Substring Options */}
        {config.operation === 'substring' && (
          <>
            <div>
              <Label className="text-xs text-muted-foreground">Start Index</Label>
              <Input
                type="number"
                value={config.start || 0}
                onChange={(e) => updateConfig({ start: parseInt(e.target.value) || 0 })}
                placeholder="0"
                className="text-xs mt-2"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">End Index (optional)</Label>
              <Input
                type="number"
                value={config.end || ''}
                onChange={(e) => updateConfig({ end: e.target.value ? parseInt(e.target.value) : undefined })}
                placeholder="To end"
                className="text-xs mt-2"
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
