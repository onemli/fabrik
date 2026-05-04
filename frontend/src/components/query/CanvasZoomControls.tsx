// CanvasZoomControls.tsx
//
// Bottom-center zoom bar (Vercel-style). Zoom in/out, fit view, auto-layout,
// and lock/unlock toggle for the canvas interaction mode.

import { useReactFlow } from '@xyflow/react'
import { Button } from '@/components/ui/button'
import { Minus, Plus, Maximize2, Lock, Unlock, LayoutGrid } from 'lucide-react'

interface CanvasZoomControlsProps {
  currentZoom: number
  isInteractive: boolean
  onToggleInteractive: () => void
  onAutoLayout: () => void
}

export function CanvasZoomControls({
  currentZoom,
  isInteractive,
  onToggleInteractive,
  onAutoLayout,
}: CanvasZoomControlsProps) {
  const reactFlowInstance = useReactFlow()

  return (
    <div className="flex items-center gap-1 bg-card/95 backdrop-blur-xl border border-border rounded-lg p-1 shadow-2xl">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          const viewport = reactFlowInstance?.getViewport()
          if (viewport) {
            reactFlowInstance?.setViewport({
              ...viewport,
              zoom: Math.max(viewport.zoom - 0.1, 0.1)
            })
          }
        }}
        className="h-8 w-8 p-0 hover:bg-muted transition-colors"
      >
        <Minus className="w-4 h-4 text-muted-foreground" />
      </Button>
      <div className="px-3 min-w-[60px] text-center">
        <span className="text-xs text-muted-foreground font-mono">
          {Math.round(currentZoom * 100)}%
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          const viewport = reactFlowInstance?.getViewport()
          if (viewport) {
            reactFlowInstance?.setViewport({
              ...viewport,
              zoom: Math.min(viewport.zoom + 0.1, 2)
            })
          }
        }}
        className="h-8 w-8 p-0 hover:bg-muted transition-colors"
      >
        <Plus className="w-4 h-4 text-muted-foreground" />
      </Button>
      <div className="w-px h-6 bg-muted" />
      <Button
        variant="ghost"
        size="sm"
        onClick={() => reactFlowInstance?.fitView({ padding: 0.2, maxZoom: 1 })}
        className="h-8 px-3 hover:bg-muted transition-colors"
      >
        <Maximize2 className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground ml-1.5">Fit</span>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onAutoLayout}
        className="h-8 px-3 hover:bg-muted transition-colors"
      >
        <LayoutGrid className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground ml-1.5">Layout</span>
      </Button>
      <div className="w-px h-6 bg-muted" />
      <Button
        variant="ghost"
        size="sm"
        onClick={onToggleInteractive}
        className="h-8 px-3 hover:bg-muted transition-colors"
      >
        {isInteractive ? (
          <Unlock className="w-4 h-4 text-emerald-400" />
        ) : (
          <Lock className="w-4 h-4 text-muted-foreground" />
        )}
        <span className="text-xs text-muted-foreground ml-1.5">
          {isInteractive ? 'Unlocked' : 'Locked'}
        </span>
      </Button>
    </div>
  )
}
