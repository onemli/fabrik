// query/QueryPreviewBar.tsx
//
// Live query preview bar — sits above zoom controls on the canvas.
// Shows the frontend-generated APIC path instantly, then fetches the
// backend-optimized path (debounced) and shows it when it differs.

import { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import { ChevronRight, ChevronDown, Copy, Check, AlertTriangle, Zap, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import { generateAPICQuery } from '@/lib/queryGenerator'
import { queriesService } from '@/services/queries'
import { NodeType } from '@/types'
import type { Node, Edge } from '@xyflow/react'
import type { QueryNodeData } from '@/types'

interface BackendPreview {
  query: string
  strategy: string
  estimatedCost: number
  suggestions: string[]
}

function copyToClipboard(text: string) {
  try {
    navigator.clipboard.writeText(text)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
  }
}

export function QueryPreviewBar() {
  const { nodes, edges } = useQueryBuilderStore()
  const [isExpanded, setIsExpanded] = useState(false)
  const [isCopied, setIsCopied] = useState(false)
  const [backendPreview, setBackendPreview] = useState<BackendPreview | null>(null)
  const [isLoadingBackend, setIsLoadingBackend] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hasClassNode = useMemo(
    () => nodes.some(n => n.type === NodeType.CLASS && (n.data as any).className),
    [nodes]
  )

  const queryPreview = useMemo(() => {
    if (!hasClassNode) return null
    try {
      return generateAPICQuery(
        nodes as Node<QueryNodeData>[],
        edges as Edge[]
      )
    } catch {
      return null
    }
  }, [nodes, edges, hasClassNode])

  // Build frontend display path
  const frontendPath = useMemo(() => {
    if (!queryPreview) return null
    const params = new URLSearchParams(queryPreview.params).toString()
    const decoded = params ? decodeURIComponent(params) : ''
    return decoded ? `${queryPreview.url}?${decoded}` : queryPreview.url
  }, [queryPreview])

  // Fetch backend-optimized query (debounced 800ms)
  const fetchBackendPreview = useCallback(async () => {
    if (!hasClassNode) return

    // Skip backend call for single class node — MO optimization requires
    // a multi-node chain with parent context to build a DN path
    const classNodes = nodes.filter(n => n.type === NodeType.CLASS)
    if (classNodes.length < 2) {
      setBackendPreview(null)
      return
    }

    setIsLoadingBackend(true)
    try {
      const result = await queriesService.generateQueryPath({ nodes, edges })
      if (result.success && result.preview_query) {
        setBackendPreview({
          query: decodeURIComponent(result.preview_query),
          strategy: result.strategy,
          estimatedCost: result.estimated_cost,
          suggestions: result.suggestions || [],
        })
      } else {
        setBackendPreview(null)
      }
    } catch {
      setBackendPreview(null)
    } finally {
      setIsLoadingBackend(false)
    }
  }, [nodes, edges, hasClassNode])

  useEffect(() => {
    if (!hasClassNode) {
      setBackendPreview(null)
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(fetchBackendPreview, 800)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [nodes, edges, hasClassNode, fetchBackendPreview])

  // Pagination from Output node — appended to whichever path we display.
  // Must stay above the early return below so hook order is stable.
  const outputPagination = useMemo(() => {
    const outputNode = nodes.find(n => n.type === NodeType.OUTPUT)
    const data = outputNode?.data as any
    if (!data?.enablePagination) return null
    return { pageSize: data.pageSize || 50 }
  }, [nodes])

  if (!hasClassNode) return null

  const handleCopy = (text: string) => {
    copyToClipboard(text)
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 1500)
  }

  const hasPostProcessors = queryPreview?.postProcessors && queryPreview.postProcessors.length > 0
  const paramEntries = queryPreview ? Object.entries(queryPreview.params) : []

  const appendPagination = (path: string | null): string | null => {
    if (!path || !outputPagination) return path
    const separator = path.includes('?') ? '&' : '?'
    return `${path}${separator}page=0&page-size=${outputPagination.pageSize}`
  }

  // The path shown — backend when available, frontend as fallback
  const displayPath = appendPagination(backendPreview ? backendPreview.query : frontendPath)

  if (!queryPreview) {
    return (
      <div className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-xs">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
        <span className="text-amber-600 dark:text-amber-400">
          Query cannot be generated — check node configuration
        </span>
      </div>
    )
  }

  return (
    <div className="w-full">
      <div className="rounded-md border border-border bg-muted/30 overflow-hidden transition-all">
        {/* Collapsed bar */}
        <div
          className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded
            ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          }

          <Badge variant="outline" className="font-mono text-[10px] py-0 px-1.5 flex-shrink-0 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
            Query
          </Badge>

          {backendPreview && (
            <Badge variant="outline" className="text-[10px] py-0 px-1.5 flex-shrink-0 bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/30 gap-0.5">
              <Zap className="w-2.5 h-2.5" />
              {backendPreview.strategy}
            </Badge>
          )}

          {isLoadingBackend && (
            <Loader2 className="w-3 h-3 text-muted-foreground animate-spin flex-shrink-0" />
          )}

          <code className="flex-1 text-xs font-mono text-foreground/80 truncate select-all">
            {displayPath}
          </code>

          {hasPostProcessors && (
            <Badge variant="secondary" className="text-[10px] py-0 px-1.5 flex-shrink-0">
              +{queryPreview.postProcessors!.length} processor
            </Badge>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation()
              handleCopy(displayPath || '')
            }}
          >
            {isCopied
              ? <Check className="w-3 h-3 text-emerald-500" />
              : <Copy className="w-3 h-3 text-muted-foreground" />
            }
          </Button>
        </div>

        {/* Expanded view */}
        {isExpanded && (
          <div className="border-t border-border px-3 py-2 space-y-1.5 bg-muted/20">
            {/* Backend query */}
            {backendPreview && (
              <div className="flex items-start gap-2">
                <code className="text-xs font-mono text-foreground/80 break-all select-all">
                  {appendPagination(backendPreview.query)}
                </code>
              </div>
            )}

            {/* Loading state */}
            {isLoadingBackend && !backendPreview && (
              <div className="flex items-center gap-2">
                <Loader2 className="w-3 h-3 text-muted-foreground animate-spin" />
                <span className="text-[10px] text-muted-foreground">Generating query...</span>
              </div>
            )}

            {/* Fallback — backend not yet available */}
            {!backendPreview && !isLoadingBackend && frontendPath && (
              <div className="flex items-start gap-2">
                <code className="text-xs font-mono text-foreground/50 break-all select-all">
                  {appendPagination(frontendPath)}
                </code>
              </div>
            )}

            {/* Parameters */}
            {paramEntries.length > 0 && (
              <div className="border-t border-border/50 pt-1.5 mt-1.5 space-y-1">
                {paramEntries.map(([key, value]) => (
                  <div key={key} className="flex items-start gap-2">
                    <span className="text-[10px] text-muted-foreground w-14 flex-shrink-0 pt-0.5 truncate" title={key}>
                      {key.replace('query-target-', '').replace('rsp-', '')}
                    </span>
                    <code className="text-xs font-mono text-foreground/80 break-all select-all">
                      {decodeURIComponent(value)}
                    </code>
                  </div>
                ))}
              </div>
            )}

            {/* Post-processors */}
            {hasPostProcessors && queryPreview.postProcessors!.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground w-14 flex-shrink-0">
                  P{i + 1}
                </span>
                <Badge variant="outline" className="text-[10px] py-0">
                  {p.type}
                </Badge>
              </div>
            ))}

            {/* Backend suggestions */}
            {backendPreview && backendPreview.suggestions.length > 0 && (
              <div className="border-t border-border/50 pt-1.5 mt-1.5">
                {backendPreview.suggestions.map((suggestion, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-[10px] text-amber-500 w-14 flex-shrink-0 pt-0.5">
                      {i === 0 ? 'Tips' : ''}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{suggestion}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
