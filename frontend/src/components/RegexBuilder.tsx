// RegexBuilder.tsx
//
// Visual regex builder + manual editor + live tester. Used both as a standalone
// page component (RegexPatterns) and inline within the ColumnEditor for quick
// pattern creation. The visual builder provides click-to-add blocks for users
// who aren't comfortable writing regex by hand.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Plus,
  X,
  CheckCircle2,
  XCircle,
  Blocks,
  FlaskConical,
  Info,
  Copy,
  Trash2,
  RotateCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { regexPatternService, type RegexTestResult } from '@/services/validation'

// ── Visual builder block definitions ────────────────────────────────────────

interface RegexBlock {
  id: string
  type: string
  label: string
  pattern: string
}

const BLOCK_CATEGORIES = [
  {
    label: 'Character Classes',
    blocks: [
      { type: 'any_digit', label: 'Any Digit', pattern: '\\d' },
      { type: 'any_letter', label: 'Any Letter', pattern: '[a-zA-Z]' },
      { type: 'any_alphanumeric', label: 'Alphanumeric', pattern: '[a-zA-Z0-9]' },
      { type: 'any_char', label: 'Any Character', pattern: '.' },
      { type: 'whitespace', label: 'Whitespace', pattern: '\\s' },
      { type: 'non_whitespace', label: 'Non-Whitespace', pattern: '\\S' },
      { type: 'word_char', label: 'Word Character', pattern: '\\w' },
    ],
  },
  {
    label: 'Quantifiers',
    blocks: [
      { type: 'one_or_more', label: 'One or More (+)', pattern: '+' },
      { type: 'zero_or_more', label: 'Zero or More (*)', pattern: '*' },
      { type: 'optional', label: 'Optional (?)', pattern: '?' },
      { type: 'exact_n', label: 'Exact Count {n}', pattern: '{3}' },
      { type: 'range_nm', label: 'Range {n,m}', pattern: '{1,5}' },
    ],
  },
  {
    label: 'Anchors & Groups',
    blocks: [
      { type: 'start', label: 'Start of String (^)', pattern: '^' },
      { type: 'end', label: 'End of String ($)', pattern: '$' },
      { type: 'group_open', label: 'Group Start (', pattern: '(' },
      { type: 'group_close', label: 'Group End )', pattern: ')' },
      { type: 'or', label: 'Or (|)', pattern: '|' },
    ],
  },
  {
    label: 'Common Patterns',
    blocks: [
      { type: 'ipv4', label: 'IPv4 Address', pattern: '((25[0-5]|(2[0-4]|1\\d|[1-9]|)\\d)\\.?\\b){4}' },
      { type: 'mac', label: 'MAC Address', pattern: '([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}' },
      { type: 'vlan', label: 'VLAN ID (1-4094)', pattern: '([1-9]|[1-9]\\d{1,2}|[1-3]\\d{3}|40[0-8]\\d|409[0-4])' },
      { type: 'email', label: 'Email', pattern: '[^\\s@]+@[^\\s@]+\\.[^\\s@]+' },
      { type: 'hostname', label: 'Hostname', pattern: '[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\\.[a-zA-Z]{2,})+' },
      { type: 'cidr', label: 'CIDR Notation', pattern: '((25[0-5]|(2[0-4]|1\\d|[1-9]|)\\d)\\.){3}(25[0-5]|(2[0-4]|1\\d|[1-9]|)\\d)/(3[0-2]|[12]?\\d)' },
      { type: 'subnet_mask', label: 'Subnet Mask', pattern: '(255|254|252|248|240|224|192|128|0)\\.){3}(255|254|252|248|240|224|192|128|0)' },
    ],
  },
  {
    label: 'Literals',
    blocks: [
      { type: 'dot_literal', label: 'Literal Dot', pattern: '\\.' },
      { type: 'dash_literal', label: 'Literal Dash', pattern: '\\-' },
      { type: 'colon_literal', label: 'Literal Colon', pattern: ':' },
      { type: 'slash_literal', label: 'Literal Slash', pattern: '\\/' },
      { type: 'underscore', label: 'Underscore', pattern: '_' },
    ],
  },
]

// ── Pattern explanation engine ───────────────────────────────────────────────

type ExplainEntry = [token: string, description: string]

function explainPattern(pattern: string): ExplainEntry[] {
  const entries: ExplainEntry[] = []
  let i = 0
  while (i < pattern.length) {
    const remaining = pattern.slice(i)

    if (remaining.startsWith('^')) {
      entries.push(['^', 'Start of string'])
      i++
    } else if (remaining.startsWith('$')) {
      entries.push(['$', 'End of string'])
      i++
    } else if (remaining.startsWith('\\d')) {
      entries.push(['\\d', 'Any digit (0-9)'])
      i += 2
    } else if (remaining.startsWith('\\D')) {
      entries.push(['\\D', 'Any non-digit'])
      i += 2
    } else if (remaining.startsWith('\\w')) {
      entries.push(['\\w', 'Word character (letter, digit, underscore)'])
      i += 2
    } else if (remaining.startsWith('\\W')) {
      entries.push(['\\W', 'Non-word character'])
      i += 2
    } else if (remaining.startsWith('\\s')) {
      entries.push(['\\s', 'Whitespace'])
      i += 2
    } else if (remaining.startsWith('\\S')) {
      entries.push(['\\S', 'Non-whitespace'])
      i += 2
    } else if (remaining.startsWith('\\.')) {
      entries.push(['\\.', 'Literal dot'])
      i += 2
    } else if (remaining.startsWith('\\-')) {
      entries.push(['\\-', 'Literal dash'])
      i += 2
    } else if (remaining.startsWith('\\/')) {
      entries.push(['\\/', 'Literal slash'])
      i += 2
    } else if (remaining.startsWith('.')) {
      entries.push(['.', 'Any character'])
      i++
    } else if (remaining.startsWith('+')) {
      entries.push(['+', 'One or more of previous'])
      i++
    } else if (remaining.startsWith('*')) {
      entries.push(['*', 'Zero or more of previous'])
      i++
    } else if (remaining.startsWith('?')) {
      entries.push(['?', 'Optional (zero or one)'])
      i++
    } else if (remaining.startsWith('|')) {
      entries.push(['|', 'Or (alternative)'])
      i++
    } else if (remaining.startsWith('(')) {
      entries.push(['(', 'Start capture group'])
      i++
    } else if (remaining.startsWith(')')) {
      entries.push([')', 'End capture group'])
      i++
    } else if (remaining.match(/^\{(\d+)(?:,(\d*))?\}/)) {
      const m = remaining.match(/^\{(\d+)(?:,(\d*))?\}/)!
      if (m[2] !== undefined) {
        entries.push([m[0], `Between ${m[1]} and ${m[2] || '∞'} times`])
      } else {
        entries.push([m[0], `Exactly ${m[1]} times`])
      }
      i += m[0].length
    } else if (remaining.match(/^\[([^\]]+)\]/)) {
      const m = remaining.match(/^\[([^\]]+)\]/)!
      entries.push([m[0], `Character set: ${m[1]}`])
      i += m[0].length
    } else if (remaining.startsWith('\\')) {
      const escaped = remaining.slice(0, 2)
      entries.push([escaped, `Escaped "${remaining[1]}"`])
      i += 2
    } else {
      let literal = ''
      while (i < pattern.length) {
        const ch = pattern[i]
        if ('^$.*+?|(){}[]\\'.includes(ch)) break
        literal += ch
        i++
      }
      if (literal) {
        entries.push([`"${literal}"`, 'Literal text'])
      }
    }
  }
  return entries
}

// ── Component props ─────────────────────────────────────────────────────────

interface RegexBuilderProps {
  value?: string
  flags?: string[]
  onChange?: (pattern: string, flags: string[]) => void
  testStrings?: string[]
  onTestStringsChange?: (strings: string[]) => void
  compact?: boolean  // Inline mode for ColumnEditor
}

export function RegexBuilder({
  value = '',
  flags: initialFlags = [],
  onChange,
  testStrings: externalTestStrings,
  onTestStringsChange,
  compact = false,
}: RegexBuilderProps) {
  const [pattern, setPattern] = useState(value)
  const [flags, setFlags] = useState<string[]>(initialFlags)
  const [blocks, setBlocks] = useState<RegexBlock[]>([])
  const [testStrings, setTestStrings] = useState<string[]>(externalTestStrings || [''])
  const [testResults, setTestResults] = useState<RegexTestResult | null>(null)
  const [isTestLoading, setIsTestLoading] = useState(false)
  const [newTestInput, setNewTestInput] = useState('')
  const [patternError, setPatternError] = useState<string | null>(null)

  // Sync external value
  useEffect(() => {
    if (value !== pattern) setPattern(value)
  }, [value])

  useEffect(() => {
    if (externalTestStrings) setTestStrings(externalTestStrings)
  }, [externalTestStrings])

  // Validate pattern locally on change
  useEffect(() => {
    if (!pattern) {
      setPatternError(null)
      return
    }
    try {
      new RegExp(pattern)
      setPatternError(null)
    } catch (e: any) {
      setPatternError(e.message)
    }
  }, [pattern])

  const handlePatternChange = useCallback((newPattern: string) => {
    setPattern(newPattern)
    onChange?.(newPattern, flags)
  }, [flags, onChange])

  const handleFlagToggle = useCallback((flag: string) => {
    const newFlags = flags.includes(flag)
      ? flags.filter(f => f !== flag)
      : [...flags, flag]
    setFlags(newFlags)
    onChange?.(pattern, newFlags)
  }, [pattern, flags, onChange])

  // Visual builder: add block to pattern
  const addBlock = useCallback((blockPattern: string) => {
    const newId = `block_${Date.now()}`
    setBlocks(prev => [...prev, { id: newId, type: 'custom', label: blockPattern, pattern: blockPattern }])
    const newPattern = pattern + blockPattern
    handlePatternChange(newPattern)
  }, [pattern, handlePatternChange])

  const removeBlock = useCallback((index: number) => {
    const block = blocks[index]
    if (!block) return
    const newBlocks = blocks.filter((_, i) => i !== index)
    setBlocks(newBlocks)
    // Rebuild pattern from remaining blocks
    const newPattern = newBlocks.map(b => b.pattern).join('')
    handlePatternChange(newPattern)
  }, [blocks, handlePatternChange])

  const clearBlocks = useCallback(() => {
    setBlocks([])
    handlePatternChange('')
  }, [handlePatternChange])

  // Test strings management
  const addTestString = useCallback(() => {
    if (!newTestInput.trim()) return
    const updated = [...testStrings, newTestInput.trim()]
    setTestStrings(updated)
    onTestStringsChange?.(updated)
    setNewTestInput('')
  }, [newTestInput, testStrings, onTestStringsChange])

  const removeTestString = useCallback((index: number) => {
    const updated = testStrings.filter((_, i) => i !== index)
    setTestStrings(updated)
    onTestStringsChange?.(updated)
  }, [testStrings, onTestStringsChange])

  // Run test via backend (more accurate) or local fallback
  const runTest = useCallback(async () => {
    if (!pattern || testStrings.length === 0) return
    const nonEmpty = testStrings.filter(s => s.length > 0)
    if (nonEmpty.length === 0) return

    setIsTestLoading(true)
    try {
      const result = await regexPatternService.testPattern(pattern, flags, nonEmpty)
      setTestResults(result)
    } catch {
      // Fallback to local testing
      try {
        let regexFlags = ''
        if (flags.includes('i')) regexFlags += 'i'
        if (flags.includes('m')) regexFlags += 'm'
        if (flags.includes('s')) regexFlags += 's'
        const regex = new RegExp(pattern, regexFlags)
        const results = nonEmpty.map(value => {
          const match = regex.exec(value)
          return {
            value,
            is_match: !!match,
            match_start: match?.index ?? null,
            match_end: match ? match.index + match[0].length : null,
            matched_text: match?.[0] ?? null,
          }
        })
        setTestResults({ valid: true, error: null, results })
      } catch (e: any) {
        setTestResults({ valid: false, error: e.message, results: [] })
      }
    } finally {
      setIsTestLoading(false)
    }
  }, [pattern, flags, testStrings])

  // Auto-test when pattern or test strings change (debounced)
  useEffect(() => {
    if (!pattern || testStrings.filter(s => s).length === 0) {
      setTestResults(null)
      return
    }
    const timer = setTimeout(runTest, 400)
    return () => clearTimeout(timer)
  }, [pattern, flags, testStrings])

  const explanations = useMemo(() => explainPattern(pattern), [pattern])

  const copyPattern = useCallback(() => {
    navigator.clipboard.writeText(pattern)
  }, [pattern])

  // ── Compact mode for ColumnEditor inline ──────────────────────────────────
  if (compact) {
    return (
      <div className="space-y-3">
        {/* Pattern input */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Input
              value={pattern}
              onChange={(e) => handlePatternChange(e.target.value)}
              placeholder="^[a-zA-Z0-9_-]+$"
              className={cn('font-mono text-sm flex-1', patternError && 'border-red-500')}
            />
            <Button variant="ghost" size="icon" onClick={copyPattern} className="shrink-0">
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          {patternError && (
            <p className="text-xs text-red-500">{patternError}</p>
          )}
        </div>

        {/* Quick-add common patterns */}
        <div className="flex flex-wrap gap-1.5">
          {BLOCK_CATEGORIES[3].blocks.slice(0, 4).map((block) => (
            <Button
              key={block.type}
              variant="outline"
              size="sm"
              className="text-xs h-7"
              onClick={() => handlePatternChange(block.pattern)}
            >
              {block.label}
            </Button>
          ))}
        </div>

        {/* Inline test */}
        {pattern && (
          <div className="space-y-2 p-3 bg-muted rounded-lg">
            <Label className="text-xs">Quick Test</Label>
            <div className="flex gap-2">
              <Input
                value={testStrings[0] || ''}
                onChange={(e) => {
                  const updated = [e.target.value]
                  setTestStrings(updated)
                  onTestStringsChange?.(updated)
                }}
                placeholder="Enter test value..."
                className="text-sm"
              />
              {testResults && testResults.results[0] && (
                <div className="flex items-center px-2">
                  {testResults.results[0].is_match ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-500" />
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Full mode ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Pattern display + flags */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Pattern</Label>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground font-mono text-lg">/</span>
          <Input
            value={pattern}
            onChange={(e) => handlePatternChange(e.target.value)}
            placeholder="Enter regex pattern..."
            className={cn('font-mono flex-1', patternError && 'border-red-500')}
          />
          <span className="text-muted-foreground font-mono text-lg">/</span>
          <div className="flex items-center gap-1">
            {['i', 'm', 's'].map(flag => (
              <TooltipProvider key={flag}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={flags.includes(flag) ? 'default' : 'outline'}
                      size="sm"
                      className="w-8 h-8 font-mono text-xs"
                      onClick={() => handleFlagToggle(flag)}
                    >
                      {flag}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {flag === 'i' && 'Case insensitive'}
                    {flag === 'm' && 'Multiline (^ and $ match line boundaries)'}
                    {flag === 's' && 'Dot matches newlines'}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ))}
          </div>
          <Button variant="ghost" size="icon" onClick={copyPattern}>
            <Copy className="h-4 w-4" />
          </Button>
        </div>
        {patternError && (
          <p className="text-sm text-red-500 flex items-center gap-1">
            <XCircle className="h-3.5 w-3.5" /> {patternError}
          </p>
        )}
      </div>

      {/* Tabs: Visual Builder / Explanation / Test */}
      <Tabs defaultValue="visual" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="visual" className="gap-1.5">
            <Blocks className="h-3.5 w-3.5" /> Visual
          </TabsTrigger>
          <TabsTrigger value="explain" className="gap-1.5">
            <Info className="h-3.5 w-3.5" /> Explain
          </TabsTrigger>
          <TabsTrigger value="test" className="gap-1.5">
            <FlaskConical className="h-3.5 w-3.5" /> Test
          </TabsTrigger>
        </TabsList>

        {/* ── Visual Builder Tab ───────────────────────────────────────── */}
        <TabsContent value="visual" className="space-y-4 mt-4">
          {/* Current blocks */}
          {blocks.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Pattern Blocks</Label>
                <Button variant="ghost" size="sm" onClick={clearBlocks} className="h-6 text-xs">
                  <Trash2 className="h-3 w-3 mr-1" /> Clear All
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5 p-3 bg-muted/50 rounded-lg min-h-[40px]">
                {blocks.map((block, idx) => (
                  <Badge
                    key={block.id}
                    variant="secondary"
                    className="font-mono text-xs gap-1 cursor-pointer hover:bg-destructive/20"
                    onClick={() => removeBlock(idx)}
                  >
                    {block.pattern}
                    <X className="h-3 w-3" />
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Block categories */}
          {BLOCK_CATEGORIES.map((category) => (
            <div key={category.label} className="space-y-2">
              <Label className="text-xs text-muted-foreground">{category.label}</Label>
              <div className="flex flex-wrap gap-1.5">
                {category.blocks.map((block) => (
                  <Button
                    key={block.type}
                    variant="outline"
                    size="sm"
                    className="text-xs h-7 gap-1"
                    onClick={() => addBlock(block.pattern)}
                  >
                    <Plus className="h-3 w-3" />
                    {block.label}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </TabsContent>

        {/* ── Explanation Tab ──────────────────────────────────────────── */}
        <TabsContent value="explain" className="mt-4">
          {pattern ? (
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/60 border-b">
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-[140px]">Token</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {explanations.length > 0 ? (
                    explanations.map(([token, desc], idx) => (
                      <tr key={idx} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-3 py-1.5 font-mono text-primary/90 whitespace-nowrap">{token}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{desc}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={2} className="px-3 py-3 text-muted-foreground text-center">Literal text pattern</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Enter a pattern to see its explanation
            </div>
          )}
        </TabsContent>

        {/* ── Test Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="test" className="space-y-4 mt-4">
          {/* Add test string */}
          <div className="flex gap-2">
            <Input
              value={newTestInput}
              onChange={(e) => setNewTestInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTestString()}
              placeholder="Add test string..."
              className="flex-1"
            />
            <Button variant="outline" size="icon" className="shrink-0 h-9 w-9" onClick={runTest} title="Re-run tests">
              <RotateCw className={cn("h-4 w-4", isTestLoading && "animate-spin")} />
            </Button>
            <Button variant="outline" size="sm" onClick={addTestString}>
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>

          {/* Test results */}
          {testResults && !testResults.valid && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-sm text-red-500">{testResults.error}</p>
            </div>
          )}

          <div className="space-y-2">
            {testStrings.map((str, idx) => {
              if (!str) return null
              const result = testResults?.results?.find(r => r.value === str)
              const isMatch = result?.is_match ?? null

              return (
                <div
                  key={idx}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-lg border text-sm',
                    isMatch === true && 'bg-green-500/5 border-green-500/30',
                    isMatch === false && 'bg-red-500/5 border-red-500/30',
                    isMatch === null && 'bg-muted/50 border-border',
                  )}
                >
                  <div className="shrink-0">
                    {isMatch === true && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                    {isMatch === false && <XCircle className="h-4 w-4 text-red-500" />}
                    {isMatch === null && <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />}
                  </div>

                  <span className="font-mono flex-1 break-all">
                    {result?.matched_text && isMatch ? (
                      <>
                        {str.slice(0, result.match_start!)}
                        <span className="bg-green-500/20 text-green-700 dark:text-green-400 rounded px-0.5">
                          {result.matched_text}
                        </span>
                        {str.slice(result.match_end!)}
                      </>
                    ) : (
                      str
                    )}
                  </span>

                  {isMatch !== null && (
                    <Badge variant={isMatch ? 'default' : 'destructive'} className="text-xs shrink-0">
                      {isMatch ? 'Match' : 'No Match'}
                    </Badge>
                  )}

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={() => removeTestString(idx)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )
            })}
          </div>

          {testStrings.filter(s => s).length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Add test strings to see match results
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
