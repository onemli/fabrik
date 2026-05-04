// QueryHistoryDialog.tsx
//
// Dialog showing the recent query execution history stored in localStorage.
// Each entry shows the query name, execution time, and result count. Clicking
// an entry reloads that canvas state so the user can re-run or modify it.

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Card } from './ui/card'
import { Clock, CheckCircle, XCircle, Trash2, Play, TrendingUp } from 'lucide-react'
import {
  getQueryHistory,
  deleteQueryHistoryEntry,
  clearQueryHistory,
  getHistoryStats,
  QueryHistoryEntry,
} from '@/lib/queryHistory'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import { formatDistanceToNow } from 'date-fns'
import { ConfirmDialog } from './ConfirmDialog'

interface QueryHistoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function QueryHistoryDialog({ open, onOpenChange }: QueryHistoryDialogProps) {
  const { loadFromSaved } = useQueryBuilderStore()
  const [history, setHistory] = useState<QueryHistoryEntry[]>([])
  const [stats, setStats] = useState(getHistoryStats())
  const [clearAllConfirm, setClearAllConfirm] = useState(false)

  useEffect(() => {
    if (open) {
      refreshHistory()
    }
  }, [open])

  const refreshHistory = () => {
    setHistory(getQueryHistory())
    setStats(getHistoryStats())
  }

  const handleLoadQuery = (entry: QueryHistoryEntry) => {
    loadFromSaved(entry.nodes, entry.edges, entry.name || undefined)
    onOpenChange(false)
  }

  const handleDeleteEntry = (id: string) => {
    deleteQueryHistoryEntry(id)
    refreshHistory()
  }

  const handleClearAll = () => {
    setClearAllConfirm(true)
  }

  const confirmClearAll = () => {
    clearQueryHistory()
    refreshHistory()
    setClearAllConfirm(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Query History</DialogTitle>
          <DialogDescription>
            View and reload previously executed queries
          </DialogDescription>
        </DialogHeader>

        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-2">
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Total</div>
            <div className="text-2xl font-bold">{stats.total}</div>
          </Card>
          <Card className="p-3 bg-green-50 border-green-200">
            <div className="text-xs text-green-700">Successful</div>
            <div className="text-2xl font-bold text-green-700">{stats.successful}</div>
          </Card>
          <Card className="p-3 bg-red-50 border-red-200">
            <div className="text-xs text-red-700">Failed</div>
            <div className="text-2xl font-bold text-red-700">{stats.failed}</div>
          </Card>
          <Card className="p-3 bg-blue-50 border-blue-200">
            <div className="text-xs text-blue-700">Success Rate</div>
            <div className="text-2xl font-bold text-blue-700">
              {stats.successRate.toFixed(0)}%
            </div>
          </Card>
        </div>

        {/* Actions */}
        <div className="flex justify-between items-center">
          <div className="text-sm text-muted-foreground">
            <TrendingUp className="w-4 h-4 inline mr-1" />
            Avg execution: {stats.avgExecutionTime.toFixed(0)}ms
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClearAll}
            disabled={history.length === 0}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Clear All
          </Button>
        </div>

        {/* History List */}
        <div className="flex-1 overflow-y-auto space-y-2">
          {history.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No query history yet</p>
              <p className="text-sm mt-1">Execute some queries to see them here</p>
            </div>
          ) : (
            history.map((entry) => (
              <Card
                key={entry.id}
                className="p-3 hover:shadow-md transition-shadow border-l-4"
                style={{
                  borderLeftColor: entry.success ? '#22c55e' : '#ef4444',
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    {/* Header */}
                    <div className="flex items-center gap-2 mb-1">
                      {entry.success ? (
                        <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
                      )}
                      <h3 className="font-semibold text-sm truncate">
                        {entry.name || 'Unnamed Query'}
                      </h3>
                      <Badge variant="outline" className="text-xs ml-auto">
                        {formatDistanceToNow(entry.timestamp, { addSuffix: true })}
                      </Badge>
                    </div>

                    {/* Details */}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground mb-2">
                      <span>{entry.nodes.length} nodes</span>
                      <span>•</span>
                      <span>{entry.resultCount} results</span>
                      <span>•</span>
                      <span>{entry.executionTime}ms</span>
                    </div>

                    {/* Query Description */}
                    {entry.query?.description && (
                      <p className="text-xs text-muted-foreground line-clamp-1">
                        {entry.query.description}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-1 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleLoadQuery(entry)}
                      title="Load query"
                    >
                      <Play className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteEntry(entry.id)}
                      title="Delete from history"
                    >
                      <Trash2 className="w-4 h-4 text-red-600" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      </DialogContent>

      {/* Clear All Confirmation Dialog */}
      <ConfirmDialog
        isOpen={clearAllConfirm}
        onClose={() => setClearAllConfirm(false)}
        onConfirm={confirmClearAll}
        title="Clear Query History"
        message="Are you sure you want to clear all query history? This action cannot be undone."
        confirmText="Clear All"
        variant="danger"
      />
    </Dialog>
  )
}
