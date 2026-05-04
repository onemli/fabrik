// PreviewResultsModal.tsx
//
// Lightweight preview of the raw APIC response before running the full execution.
// Shows a JSON snippet so users can verify they're querying the right class/path.

import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { PlayCircle } from 'lucide-react'

interface PreviewResultsModalProps {
  isOpen: boolean
  onClose: () => void
  results: any[]
  count: number
  nodeName: string
  query: string
}

export function PreviewResultsModal({
  isOpen,
  onClose,
  results,
  count,
  nodeName,
  query
}: PreviewResultsModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlayCircle className="w-5 h-5 text-blue-500" />
            Preview Results - {nodeName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-muted p-4 rounded">
            <div className="text-sm font-semibold mb-2">
              Found: {count} {count === 1 ? 'result' : 'results'}
            </div>
            <div className="text-xs font-mono text-muted-foreground break-all">
              Query: {query}
            </div>
          </div>

          {results && results.length > 0 ? (
            <div className="space-y-2">
              {results.slice(0, 10).map((result, idx) => (
                <div key={idx} className="border p-3 rounded text-sm">
                  <pre className="text-xs overflow-auto max-h-40">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </div>
              ))}
              {count > 10 && (
                <div className="text-xs text-muted-foreground text-center py-2">
                  Showing 10 of {count} results
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No results found
            </div>
          )}

          <div className="flex gap-2 justify-end pt-4 border-t">
            <Button variant="outline" onClick={onClose}>
              Continue Building
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
