// NodeActionBar.tsx
//
// Hover-reveal action bar that appears above ClassNode and similar nodes.
// Contains delete and optional pause/resume buttons. Pause is only enabled
// for post-processor nodes — class and filter nodes opt out via
// canPause={false} because pausing them breaks the query chain structure.

import { Pause, Play, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface NodeActionBarProps {
  nodeId: string
  isPaused?: boolean
  onTogglePause?: () => void
  onDelete: () => void
  canPause?: boolean
}

export function NodeActionBar({
  isPaused = false,
  onTogglePause,
  onDelete,
  canPause = false,
}: NodeActionBarProps) {
  return (
    <div className="absolute -top-10 left-0 right-0 flex items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-50">
      <div className="flex items-center bg-background border border-border rounded-md shadow-lg overflow-hidden">
        <TooltipProvider>

          {/* Pause/Resume — only rendered when canPause=true and a handler is supplied */}
          {canPause && onTogglePause && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-none border-r border-border hover:bg-accent"
                  onClick={(e) => {
                    e.stopPropagation()
                    onTogglePause()
                  }}
                >
                  {isPaused ? (
                    <Play className="h-4 w-4" />
                  ) : (
                    <Pause className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{isPaused ? 'Resume' : 'Pause'}</p>
              </TooltipContent>
            </Tooltip>
          )}

          {/* Delete */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-none hover:bg-destructive hover:text-destructive-foreground"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete()
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Delete</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  )
}
