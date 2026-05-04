// panels/PipelineEdgeConfig.tsx
//
// Configuration panel for pipeline edges. Opens in the right panel when a user
// clicks on a pipeline edge. Allows configuring how upstream data is extracted
// and injected into the downstream query stage.

import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Zap } from 'lucide-react'
import type { PipelineEdgeData, PipelineInjectMode } from '@/types'

interface PipelineEdgeConfigProps {
  edgeId: string
}

const INJECT_MODES: { value: PipelineInjectMode; label: string; description: string }[] = [
  {
    value: 'filter_values',
    label: 'Filter Values',
    description: 'Build an OR filter from extracted values. Best for small-medium sets (up to ~200 values).',
  },
  {
    value: 'dn_scope',
    label: 'DN Scope',
    description: 'Run a subtree query for each upstream DN. Best when you need child objects of specific parents (up to ~50 DNs).',
  },
  {
    value: 'iterate',
    label: 'Iterate',
    description: 'Run the downstream query once per upstream value. Most flexible but slowest (up to ~100 values).',
  },
]

export function PipelineEdgeConfig({ edgeId }: PipelineEdgeConfigProps) {
  const { edges, setEdges } = useQueryBuilderStore()
  const edge = edges.find((e) => e.id === edgeId)

  // Store holds edges with generic data; narrow via edgeType discriminator.
  const data = edge?.data as PipelineEdgeData | undefined
  if (!edge || data?.edgeType !== 'pipeline') {
    return null
  }

  const extractField = data.extractField || 'dn'
  const injectAs: PipelineInjectMode = data.injectAs || 'filter_values'
  const injectProperty = data.injectProperty || ''

  const updateEdgeData = (updates: Record<string, unknown>) => {
    setEdges(
      edges.map((e) =>
        e.id === edgeId
          ? { ...e, data: { ...e.data, ...updates } }
          : e
      )
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
        <Zap className="w-5 h-5" />
        <h3 className="font-semibold text-sm">Pipeline Connection</h3>
      </div>

      <p className="text-xs text-muted-foreground">
        Configure how data flows from the upstream stage to the downstream stage.
        The upstream result is extracted and injected as filter input.
      </p>

      {/* Extract Field */}
      <div className="space-y-2">
        <Label className="text-xs">Extract Field</Label>
        <Input
          value={extractField}
          onChange={(e) => updateEdgeData({ extractField: e.target.value })}
          placeholder="dn"
          className="h-8 text-sm"
        />
        <p className="text-[10px] text-muted-foreground">
          Which field to pull from upstream results (e.g., dn, name, ip)
        </p>
      </div>

      {/* Injection Mode */}
      <div className="space-y-2">
        <Label className="text-xs">Injection Mode</Label>
        <div className="space-y-2">
          {INJECT_MODES.map((mode) => (
            <label
              key={mode.value}
              className={`flex items-start gap-2 p-2 rounded-md border cursor-pointer transition-colors ${
                injectAs === mode.value
                  ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20'
                  : 'border-border hover:border-muted-foreground/30'
              }`}
            >
              <input
                type="radio"
                name="injectAs"
                value={mode.value}
                checked={injectAs === mode.value}
                onChange={() => updateEdgeData({ injectAs: mode.value })}
                className="mt-0.5"
              />
              <div>
                <div className="text-xs font-medium">{mode.label}</div>
                <div className="text-[10px] text-muted-foreground">{mode.description}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Inject Property (for filter_values mode) */}
      {injectAs === 'filter_values' && (
        <div className="space-y-2">
          <Label className="text-xs">Target Filter Property</Label>
          <Input
            value={injectProperty}
            onChange={(e) => updateEdgeData({ injectProperty: e.target.value })}
            placeholder="className.dn (auto-detected)"
            className="h-8 text-sm"
          />
          <p className="text-[10px] text-muted-foreground">
            The downstream class property to filter on. Leave empty for auto-detection (className.dn).
          </p>
        </div>
      )}
    </div>
  )
}
