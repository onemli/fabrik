// CanvasToolbar.tsx
//
// Top toolbar for the query builder canvas. Contains the query name display,
// settings dropdown (load/save/templates/history/AI/clear), and the execute button.

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  Trash2, Zap, MoreVertical, Save, History,
  Wrench, Folder, X
} from 'lucide-react'

interface CanvasToolbarProps {
  currentQueryName: string | null
  isExecuting: boolean
  hasVariables: boolean
  nodesCount: number
  onCancelExecution: () => void
  onConfigureAndRun: () => void
  onSaveClick: () => void
  onClearCanvas: () => void
  onOpenSavedQueries: () => void
  onOpenHistory: () => void
}

export function CanvasToolbar({
  currentQueryName,
  isExecuting,
  hasVariables,
  nodesCount,
  onCancelExecution,
  onConfigureAndRun,
  onSaveClick,
  onClearCanvas,
  onOpenSavedQueries,
  onOpenHistory,
}: CanvasToolbarProps) {
  return (
    <div className="h-12 flex-none flex items-center justify-between border-b bg-background/95 backdrop-blur-sm px-4 gap-2 z-30">
      {/* Left: query name */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {currentQueryName ? (
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse flex-shrink-0" />
            <span className="text-sm font-medium text-foreground truncate max-w-[280px]">{currentQueryName}</span>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground select-none">Query Builder</span>
        )}
      </div>
      {/* Right: actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* Settings Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onOpenSavedQueries}>
              <Folder className="w-4 h-4 mr-2" />
              Load Query/Template
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onOpenHistory}>
              <History className="w-4 h-4 mr-2" />
              Execution History
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onSaveClick}>
              <Save className="w-4 h-4 mr-2" />
              Save Query
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onClearCanvas}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Clear Canvas
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Execute / Cancel */}
        {isExecuting ? (
          <Button
            size="sm"
            variant="destructive"
            onClick={onCancelExecution}
            className="h-8"
          >
            <X className="w-4 h-4 mr-2" />
            Cancel
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={onConfigureAndRun}
            disabled={nodesCount === 0}
            className="bg-primary hover:opacity-85 hover:shadow-md transition-all h-8 min-w-[140px] px-5"
          >
            {hasVariables ? (
              <>
                <Wrench className="w-4 h-4 mr-2" />
                Configure &amp; Run
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 mr-2" />
                Run
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  )
}
