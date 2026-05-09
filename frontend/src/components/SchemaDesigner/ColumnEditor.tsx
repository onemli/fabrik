// SchemaDesigner/ColumnEditor.tsx
//
// Dialog for adding or editing a single schema column. The user sets the column
// name, display label, data type (text/number/date/select/etc.), whether it's
// required, and any validation mode (none, static list, or APIC query-backed).

import { useState, useEffect, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
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
import {
  Type,
  Hash,
  ToggleLeft,
  List,
  FileText,
  Key,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Sparkles,
  Code2,
  ChevronsUpDown,
  Check,
  Library,
  PenLine,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { TableColumn } from './types'
import { ValidationModeSelector } from './ValidationModeSelector'
import { StaticListEditor } from './StaticListEditor'
import { ValidationQuerySelector } from './ValidationQuerySelector'
import { validationService, ValidationList, regexPatternService, RegexPattern } from '@/services/validation'

interface ColumnEditorProps {
  open?: boolean
  column?: TableColumn | null
  onSave: (column: TableColumn) => void
  onCancel: () => void
  existingColumns?: TableColumn[]
  asPanel?: boolean
}

const FIELD_TYPES = [
  { value: 'text' as const, label: 'Text', icon: Type, description: 'Single line text input' },
  { value: 'textarea' as const, label: 'Text Area', icon: FileText, description: 'Multi-line text' },
  { value: 'number' as const, label: 'Number', icon: Hash, description: 'Numeric input' },
  { value: 'boolean' as const, label: 'Boolean', icon: ToggleLeft, description: 'Checkbox' },
  { value: 'select' as const, label: 'Select', icon: List, description: 'Single choice' },
  { value: 'multiselect' as const, label: 'Multi-Select', icon: List, description: 'Multiple choice (list)' },
  { value: 'password' as const, label: 'Password', icon: Key, description: 'Secure field' },
]

const COMMON_VALIDATIONS = [
  { label: 'IP Address (IPv4)', regex: '^((25[0-5]|(2[0-4]|1\\d|[1-9]|)\\d)\\.?\\b){4}$' },
  { label: 'MAC Address', regex: '^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$' },
  { label: 'VLAN ID (1-4094)', regex: '^([1-9]|[1-9]\\d{1,2}|[1-3]\\d{3}|40[0-8]\\d|409[0-4])$' },
  { label: 'Email', regex: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' },
  { label: 'Alphanumeric', regex: '^[a-zA-Z0-9_-]+$' },
  { label: 'No Spaces', regex: '^\\S+$' },
]

export function ColumnEditor({ open = false, column, onSave, onCancel, existingColumns = [], asPanel = false }: ColumnEditorProps) {
  const isEdit = !!column

  const [formData, setFormData] = useState<TableColumn>({
    name: '',
    display_name: '',
    type: 'text',
    required: false,
  })

  const [enumInput, setEnumInput] = useState('')
  const [validationTest, setValidationTest] = useState('')
  const [validationResult, setValidationResult] = useState<boolean | null>(null)
  const [listSource, setListSource] = useState<'inline' | 'saved'>('inline')
  const [savedLists, setSavedLists] = useState<ValidationList[]>([])
  const [savedListsLoading, setSavedListsLoading] = useState(false)
  const [listComboOpen, setListComboOpen] = useState(false)
  const [selectedSavedList, setSelectedSavedList] = useState<ValidationList | null>(null)
  const [regexSource, setRegexSource] = useState<'inline' | 'saved'>('inline')
  const [savedPatterns, setSavedPatterns] = useState<RegexPattern[]>([])
  const [savedPatternsLoading, setSavedPatternsLoading] = useState(false)
  const [regexComboOpen, setRegexComboOpen] = useState(false)
  const [selectedSavedPattern, setSelectedSavedPattern] = useState<RegexPattern | null>(null)

  useEffect(() => {
    if (column) {
      setFormData(column)
      if (column.enum_values) {
        setEnumInput(column.enum_values.join(', '))
      }
      // Determine list source from existing data
      setListSource(column.validation_list_id ? 'saved' : 'inline')
    } else {
      setFormData({
        name: '',
        display_name: '',
        type: 'text',
        required: false,
      })
      setEnumInput('')
      setListSource('inline')
    }
    setSelectedSavedList(null)
    setSelectedSavedPattern(null)
    setRegexSource(column?.regex_pattern_id ? 'saved' : 'inline')
    setValidationTest('')
    setValidationResult(null)
  }, [column, open, asPanel])

  // Fetch saved validation lists when static_list mode is active
  const isOpen = asPanel || open
  useEffect(() => {
    if (formData.validation_mode === 'static_list' && isOpen) {
      setSavedListsLoading(true)
      validationService.getValidationLists({ ordering: 'name' })
        .then((lists) => {
          setSavedLists(lists)
          // If editing and has a saved list reference, find it
          if (formData.validation_list_id) {
            const found = lists.find(l => l.id === formData.validation_list_id)
            setSelectedSavedList(found || null)
          }
        })
        .catch(() => setSavedLists([]))
        .finally(() => setSavedListsLoading(false))
    }
  }, [formData.validation_mode, isOpen])

  // Fetch saved regex patterns when regex mode is active
  useEffect(() => {
    if (formData.validation_mode === 'regex' && isOpen) {
      setSavedPatternsLoading(true)
      regexPatternService.getPatterns({ ordering: 'name' })
        .then((patterns) => {
          setSavedPatterns(patterns)
          if (formData.regex_pattern_id) {
            const found = patterns.find(p => p.id === formData.regex_pattern_id)
            setSelectedSavedPattern(found || null)
          }
        })
        .catch(() => setSavedPatterns([]))
        .finally(() => setSavedPatternsLoading(false))
    }
  }, [formData.validation_mode, isOpen])

  const handleNameChange = (value: string) => {
    const newName = value.toLowerCase().replace(/[^a-z0-9_]/g, '_')
    const shouldUpdateDisplay = !formData.display_name ||
      formData.display_name === formatDisplayName(formData.name)

    setFormData({
      ...formData,
      name: newName,
      display_name: shouldUpdateDisplay ? formatDisplayName(newName) : formData.display_name,
    })
  }

  const formatDisplayName = (name: string) => {
    return name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  }

  const handleRegexSourceChange = (next: 'inline' | 'saved') => {
    if (next === regexSource) return
    setRegexSource(next)
    if (next === 'inline') {
      setFormData({ ...formData, regex_pattern_id: undefined })
      setSelectedSavedPattern(null)
    } else {
      setFormData({ ...formData, validation: undefined })
    }
  }

  const handleListSourceChange = (next: 'inline' | 'saved') => {
    if (next === listSource) return
    setListSource(next)
    if (next === 'inline') {
      setFormData({ ...formData, validation_list_id: undefined })
      setSelectedSavedList(null)
    } else {
      setFormData({ ...formData, validation_list: undefined })
    }
  }

  const handleEnumInputChange = (value: string) => {
    setEnumInput(value)
    const values = value.split(',').map(v => v.trim()).filter(v => v.length > 0)
    setFormData({ ...formData, enum_values: values })
  }

  const testValidation = () => {
    if (!formData.validation || !validationTest) {
      setValidationResult(null)
      return
    }
    try {
      const regex = new RegExp(formData.validation)
      setValidationResult(regex.test(validationTest))
    } catch {
      setValidationResult(false)
    }
  }

  useEffect(() => {
    testValidation()
  }, [formData.validation, validationTest])

  const handleSave = () => {
    if (!formData.name || !formData.display_name) return

    const isDuplicate = existingColumns.some(
      col => col.name === formData.name && (!isEdit || col.name !== column?.name)
    )

    if (isDuplicate) {
      toast.error('Duplicate Column', { description: `Column "${formData.name}" already exists!` })
      return
    }

    onSave(formData)
  }

  const innerContent = (
    <Tabs defaultValue="basic" className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="basic">Basic Info</TabsTrigger>
        <TabsTrigger
          value="validation"
          disabled={formData.type === 'select' || formData.type === 'multiselect'}
        >
          Validation
        </TabsTrigger>
        <TabsTrigger value="advanced">Hints &amp; Defaults</TabsTrigger>
      </TabsList>

      <TabsContent value="basic" className="space-y-6 mt-6">
        <div className="space-y-2">
          <Label htmlFor="name" className="flex items-center gap-2">
            Variable Name <Badge variant="secondary" className="text-xs">Required</Badge>
          </Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="tenant_name"
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">Lowercase, alphanumeric, underscores only</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="display_name" className="flex items-center gap-2">
            Display Name <Badge variant="secondary" className="text-xs">Required</Badge>
          </Label>
          <Input
            id="display_name"
            value={formData.display_name}
            onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
            placeholder="Tenant Name"
          />
        </div>

        <div className="space-y-2">
          <Label>Field Type</Label>
          <Select value={formData.type} onValueChange={(v) => setFormData({ ...formData, type: v as any })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FIELD_TYPES.map(type => (
                <SelectItem key={type.value} value={type.value}>
                  <div className="flex items-center gap-3">
                    <type.icon className="h-4 w-4" />
                    <div>
                      <div className="font-medium">{type.label}</div>
                      <div className="text-xs text-muted-foreground">{type.description}</div>
                    </div>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {(formData.type === 'select' || formData.type === 'multiselect') && (
          <div className="space-y-2">
            <Label>Choices (comma-separated)</Label>
            <Textarea
              value={enumInput}
              onChange={(e) => handleEnumInputChange(e.target.value)}
              placeholder="Development, Staging, Production"
              rows={3}
            />
            {formData.enum_values && formData.enum_values.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {formData.enum_values.map((v, i) => (
                  <Badge key={i} variant="outline">{v}</Badge>
                ))}
              </div>
            )}
            {formData.type === 'multiselect' && (
              <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20">
                <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Selected values are sent to AWX as a list. Your playbook must handle list variables
                  (e.g., using <code className="font-mono bg-amber-100 dark:bg-amber-900/30 px-1 rounded">loop:</code> or <code className="font-mono bg-amber-100 dark:bg-amber-900/30 px-1 rounded">join(',')</code>).
                </p>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div>
            <Label className="text-base font-medium">Required Field</Label>
            <p className="text-sm text-muted-foreground">Users must provide a value</p>
          </div>
          <Switch
            checked={formData.required}
            onCheckedChange={(c) => setFormData({ ...formData, required: c })}
          />
        </div>

        <div className="flex items-center justify-between p-4 border rounded-lg bg-blue-50 dark:bg-blue-900/10">
          <div>
            <Label className="text-base font-medium flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-blue-600" />
              Send to AWX
            </Label>
            <p className="text-sm text-muted-foreground mt-1">
              Include this column in AWX playbook execution
            </p>
            <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
              Disable for metadata-only columns (validation, audit, approval tracking)
            </p>
          </div>
          <Switch
            checked={formData.send_to_awx !== false}
            onCheckedChange={(c) => setFormData({ ...formData, send_to_awx: c })}
          />
        </div>
      </TabsContent>

      <TabsContent value="validation" className="space-y-8 mt-6">
        <ValidationModeSelector
          value={formData.validation_mode || 'none'}
          onChange={(mode) => setFormData({ ...formData, validation_mode: mode })}
        />

        {formData.validation_mode === 'regex' && (
          <div className="space-y-8">
            <SectionHeading title="Pattern Source">
              <ToggleGroup
                type="single"
                value={regexSource}
                onValueChange={(v) => v && handleRegexSourceChange(v as 'inline' | 'saved')}
                variant="outline"
                className="justify-start"
              >
                <ToggleGroupItem value="inline" className="gap-2 px-3">
                  <PenLine className="h-4 w-4" /> Inline Pattern
                </ToggleGroupItem>
                <ToggleGroupItem value="saved" className="gap-2 px-3">
                  <Library className="h-4 w-4" /> Saved Pattern
                </ToggleGroupItem>
              </ToggleGroup>
            </SectionHeading>

            {regexSource === 'inline' && (
              <>
                <SectionHeading title="Common Patterns" hint="Click to fill the custom pattern below.">
                  <div className="grid grid-cols-2 gap-2">
                    {COMMON_VALIDATIONS.map((val, idx) => (
                      <Button
                        key={idx}
                        variant="outline"
                        size="sm"
                        className="justify-start text-xs"
                        onClick={() => setFormData({ ...formData, validation: val.regex })}
                      >
                        <Code2 className="h-3 w-3 mr-2" />
                        {val.label}
                      </Button>
                    ))}
                  </div>
                </SectionHeading>

                <SectionHeading title="Custom Regex Pattern">
                  <Input
                    value={formData.validation || ''}
                    onChange={(e) => setFormData({ ...formData, validation: e.target.value })}
                    placeholder="^[a-zA-Z0-9_-]{3,64}$"
                    className="font-mono text-sm"
                  />
                </SectionHeading>

                {formData.validation && (
                  <SectionHeading title="Test Pattern" hint="Enter a sample value to see if it matches.">
                    <div className="flex gap-2">
                      <Input
                        value={validationTest}
                        onChange={(e) => setValidationTest(e.target.value)}
                        placeholder="Enter test value..."
                      />
                      {validationResult !== null && (
                        <div className="flex items-center px-2">
                          {validationResult ? (
                            <CheckCircle2 className="h-5 w-5 text-green-500" />
                          ) : (
                            <AlertCircle className="h-5 w-5 text-red-500" />
                          )}
                        </div>
                      )}
                    </div>
                  </SectionHeading>
                )}
              </>
            )}

            {regexSource === 'saved' && (
              <SectionHeading title="Select Regex Pattern">
                <Popover open={regexComboOpen} onOpenChange={setRegexComboOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={regexComboOpen}
                      className="w-full justify-between font-normal"
                    >
                      {selectedSavedPattern
                        ? selectedSavedPattern.name
                        : savedPatternsLoading
                          ? 'Loading...'
                          : 'Search and select a pattern...'}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search regex patterns..." />
                      <CommandList>
                        <CommandEmpty>No patterns found.</CommandEmpty>
                        <CommandGroup>
                          {savedPatterns.map((pat) => (
                            <CommandItem
                              key={pat.id}
                              value={pat.name}
                              onSelect={() => {
                                setSelectedSavedPattern(pat)
                                setFormData({
                                  ...formData,
                                  regex_pattern_id: pat.id,
                                  validation: pat.pattern,
                                  validation_error_title: pat.error_message ? 'Validation Error' : formData.validation_error_title,
                                  validation_error_message: pat.error_message || formData.validation_error_message,
                                })
                                setRegexComboOpen(false)
                              }}
                            >
                              <Check className={cn(
                                "mr-2 h-4 w-4",
                                selectedSavedPattern?.id === pat.id ? "opacity-100" : "opacity-0"
                              )} />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium truncate">{pat.name}</div>
                                <div className="text-xs text-muted-foreground font-mono truncate">{pat.pattern}</div>
                              </div>
                              <Badge variant="outline" className="ml-2 text-xs shrink-0">{pat.category}</Badge>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>

                {selectedSavedPattern && (
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{selectedSavedPattern.name}</span>
                      <Badge variant="outline" className="text-xs">{selectedSavedPattern.category}</Badge>
                    </div>
                    {selectedSavedPattern.description && (
                      <p className="text-xs text-muted-foreground">{selectedSavedPattern.description}</p>
                    )}
                    <div className="p-2 bg-background rounded font-mono text-xs break-all">
                      {selectedSavedPattern.pattern}
                    </div>
                  </div>
                )}
              </SectionHeading>
            )}

            <FailureFeedbackBlock
              idPrefix="regex"
              titleValue={formData.validation_error_title || ''}
              onTitleChange={(v) => setFormData({ ...formData, validation_error_title: v })}
              messageValue={formData.validation_error_message || ''}
              onMessageChange={(v) => setFormData({ ...formData, validation_error_message: v })}
              titlePlaceholder="e.g. Invalid IP format"
              messagePlaceholder="e.g., Enter a valid IPv4 address."
            />
          </div>
        )}

        {formData.validation_mode === 'static_list' && (
          <div className="space-y-8">
            <SectionHeading title="List Source">
              <ToggleGroup
                type="single"
                value={listSource}
                onValueChange={(v) => v && handleListSourceChange(v as 'inline' | 'saved')}
                variant="outline"
                className="justify-start"
              >
                <ToggleGroupItem value="inline" className="gap-2 px-3">
                  <PenLine className="h-4 w-4" /> Inline Values
                </ToggleGroupItem>
                <ToggleGroupItem value="saved" className="gap-2 px-3">
                  <Library className="h-4 w-4" /> Saved List
                </ToggleGroupItem>
              </ToggleGroup>
            </SectionHeading>

            {listSource === 'inline' && (
              <StaticListEditor
                values={formData.validation_list || []}
                onChange={(values) => setFormData({ ...formData, validation_list: values })}
                caseSensitive={formData.validation_case_sensitive}
                onCaseSensitiveChange={(value) => setFormData({ ...formData, validation_case_sensitive: value })}
              />
            )}

            {listSource === 'saved' && (
              <SectionHeading title="Select Validation List">
                <Popover open={listComboOpen} onOpenChange={setListComboOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={listComboOpen}
                      className="w-full justify-between font-normal"
                    >
                      {selectedSavedList
                        ? selectedSavedList.name
                        : savedListsLoading
                          ? 'Loading...'
                          : 'Search and select a list...'}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search validation lists..." />
                      <CommandList>
                        <CommandEmpty>No validation list found.</CommandEmpty>
                        <CommandGroup>
                          {savedLists.map((list) => (
                            <CommandItem
                              key={list.id}
                              value={list.name}
                              onSelect={() => {
                                setSelectedSavedList(list)
                                setFormData({
                                  ...formData,
                                  validation_list_id: list.id,
                                  validation_list: undefined,
                                  validation_case_sensitive: list.case_sensitive,
                                })
                                setListComboOpen(false)
                              }}
                            >
                              <Check
                                className={cn(
                                  'mr-2 h-4 w-4',
                                  selectedSavedList?.id === list.id ? 'opacity-100' : 'opacity-0'
                                )}
                              />
                              <div className="flex-1 min-w-0">
                                <div className="font-medium truncate">{list.name}</div>
                                <div className="text-xs text-muted-foreground">
                                  {list.values.length} values
                                  {list.description && ` — ${list.description}`}
                                </div>
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>

                {selectedSavedList && (
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">
                        Preview ({selectedSavedList.values.length} values)
                      </span>
                      {selectedSavedList.case_sensitive && (
                        <Badge variant="outline" className="text-xs">Case Sensitive</Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                      {selectedSavedList.values.slice(0, 50).map((val, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">{val}</Badge>
                      ))}
                      {selectedSavedList.values.length > 50 && (
                        <Badge variant="outline" className="text-xs">
                          +{selectedSavedList.values.length - 50} more
                        </Badge>
                      )}
                    </div>
                  </div>
                )}
              </SectionHeading>
            )}

            <MatchBehaviorToggle
              invert={formData.validation_invert || false}
              onChange={(invert) => setFormData({ ...formData, validation_invert: invert })}
              existHint="Allow-list — value must exist in the list (for selecting from known values)."
              notExistHint="Conflict check — value must not exist in the list (for creating new items)."
            />

            <FailureFeedbackBlock
              idPrefix="static"
              titleValue={formData.validation_error_title || ''}
              onTitleChange={(v) => setFormData({ ...formData, validation_error_title: v })}
              messageValue={formData.validation_error_message || ''}
              onMessageChange={(v) => setFormData({ ...formData, validation_error_message: v })}
              titlePlaceholder="e.g. Invalid Tenant"
              messagePlaceholder="e.g., This tenant name already exists. Please choose a different name."
            />
          </div>
        )}

        {formData.validation_mode === 'query_list' && (
          <div className="space-y-8">
            <ValidationQuerySelector
              queryId={formData.validation_query ? parseInt(formData.validation_query) : null}
              onChange={(queryId) => setFormData({ ...formData, validation_query: queryId?.toString() })}
              errorTitle={formData.validation_error_title || ''}
              onErrorTitleChange={(title) => setFormData({ ...formData, validation_error_title: title })}
              errorMessage={formData.validation_error_message || ''}
              onErrorMessageChange={(msg) => setFormData({ ...formData, validation_error_message: msg })}
            />

            <MatchBehaviorToggle
              invert={formData.validation_invert || false}
              onChange={(invert) => setFormData({ ...formData, validation_invert: invert })}
              existHint="Allow-list — value must exist in query results (for selecting existing items)."
              notExistHint="Conflict check — value must not exist in query results (for creating new items)."
            />

            <SectionHeading title="Matching Options">
              <div className="flex items-start gap-3">
                <input
                  id="query-case-sensitive"
                  type="checkbox"
                  checked={formData.validation_case_sensitive || false}
                  onChange={(e) => setFormData({ ...formData, validation_case_sensitive: e.target.checked })}
                  className="w-4 h-4 mt-1"
                />
                <div className="flex-1">
                  <label htmlFor="query-case-sensitive" className="text-sm font-medium cursor-pointer">
                    Case Sensitive Matching
                  </label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    "tenant" and "Tenant" will be treated as different values.
                  </p>
                </div>
              </div>
            </SectionHeading>
          </div>
        )}

        {formData.type === 'number' && (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Min Value</Label>
              <Input
                type="number"
                value={formData.min ?? ''}
                onChange={(e) => setFormData({ ...formData, min: e.target.value ? parseInt(e.target.value) : undefined })}
              />
            </div>
            <div className="space-y-2">
              <Label>Max Value</Label>
              <Input
                type="number"
                value={formData.max ?? ''}
                onChange={(e) => setFormData({ ...formData, max: e.target.value ? parseInt(e.target.value) : undefined })}
              />
            </div>
          </div>
        )}
      </TabsContent>

      <TabsContent value="advanced" className="space-y-6 mt-6">
        <div className="space-y-2">
          <Label>Default Value</Label>
          <Input
            value={formData.default_value || ''}
            onChange={(e) => setFormData({ ...formData, default_value: e.target.value })}
            placeholder="Pre-filled value"
          />
        </div>

        <div className="space-y-2">
          <Label>Placeholder</Label>
          <Input
            value={formData.placeholder || ''}
            onChange={(e) => setFormData({ ...formData, placeholder: e.target.value })}
            placeholder="e.g., prod_tenant"
          />
        </div>

        <div className="space-y-2">
          <Label>Help Text</Label>
          <Textarea
            value={formData.help_text || ''}
            onChange={(e) => setFormData({ ...formData, help_text: e.target.value })}
            placeholder="Guidance for users..."
            rows={3}
          />
        </div>
      </TabsContent>
    </Tabs>
  )

  if (asPanel) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 pt-4 pb-2 border-b">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-base">
              {isEdit ? `Edit: ${column?.display_name || column?.name}` : 'New Column'}
            </h3>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {innerContent}
        </div>
        <div className="px-4 py-3 border-t flex items-center justify-between bg-card">
          <button
            type="button"
            onClick={onCancel}
            className="text-sm px-3 py-1.5 rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
          >
            Discard
          </button>
          <Button onClick={handleSave} disabled={!formData.name || !formData.display_name} size="sm">
            <CheckCircle2 className="h-4 w-4 mr-2" />
            {isEdit ? 'Save Column' : 'Add Column'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <Sparkles className="h-6 w-6 text-primary" />
            {isEdit ? 'Edit Column' : 'Add New Column'}
          </DialogTitle>
          <DialogDescription>
            {isEdit ? 'Modify column properties' : 'Define a new column for your template'}
          </DialogDescription>
        </DialogHeader>

        {innerContent}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={handleSave} disabled={!formData.name || !formData.display_name}>
            <CheckCircle2 className="h-4 w-4 mr-2" />
            {isEdit ? 'Save' : 'Add Column'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface SectionHeadingProps {
  title: string
  hint?: string
  children: ReactNode
}

function SectionHeading({ title, hint, children }: SectionHeadingProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h4>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

interface FailureFeedbackBlockProps {
  idPrefix: string
  titleValue: string
  onTitleChange: (value: string) => void
  messageValue: string
  onMessageChange: (value: string) => void
  titlePlaceholder: string
  messagePlaceholder: string
}

function FailureFeedbackBlock({
  idPrefix,
  titleValue,
  onTitleChange,
  messageValue,
  onMessageChange,
  titlePlaceholder,
  messagePlaceholder,
}: FailureFeedbackBlockProps) {
  return (
    <SectionHeading title="Failure Feedback" hint="Shown to users when their input fails validation.">
      <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-error-title`} className="text-xs">
            Error Title <span className="text-muted-foreground font-normal">(shown on hover)</span>
          </Label>
          <Input
            id={`${idPrefix}-error-title`}
            placeholder={titlePlaceholder}
            value={titleValue}
            onChange={(e) => onTitleChange(e.target.value)}
            maxLength={100}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-error-message`} className="text-xs">
            Error Message <span className="text-muted-foreground font-normal">(shown in detail panel)</span>
          </Label>
          <Textarea
            id={`${idPrefix}-error-message`}
            placeholder={messagePlaceholder}
            value={messageValue}
            onChange={(e) => onMessageChange(e.target.value)}
            rows={2}
            className="text-sm resize-none"
          />
        </div>
      </div>
    </SectionHeading>
  )
}

interface MatchBehaviorToggleProps {
  invert: boolean
  onChange: (invert: boolean) => void
  existHint: string
  notExistHint: string
}

function MatchBehaviorToggle({ invert, onChange, existHint, notExistHint }: MatchBehaviorToggleProps) {
  return (
    <SectionHeading title="Match Behavior">
      <ToggleGroup
        type="single"
        value={invert ? 'must-not-exist' : 'must-exist'}
        onValueChange={(v) => v && onChange(v === 'must-not-exist')}
        variant="outline"
        className="justify-start"
      >
        <ToggleGroupItem value="must-exist" className="gap-2 px-3">
          <CheckCircle2 className="h-4 w-4" /> Must exist
        </ToggleGroupItem>
        <ToggleGroupItem value="must-not-exist" className="gap-2 px-3">
          <XCircle className="h-4 w-4" /> Must NOT exist
        </ToggleGroupItem>
      </ToggleGroup>
      <p className="text-xs text-muted-foreground">{invert ? notExistHint : existHint}</p>
    </SectionHeading>
  )
}
