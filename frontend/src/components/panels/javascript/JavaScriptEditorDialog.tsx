// JavaScriptEditorDialog.tsx
//
// Full-size modal wrapper around JavaScriptEditor. Provides the same edit
// surface as the inline panel but with much more screen real estate. Saves are
// debounced through the inner editor so any pending change is flushed when the
// dialog closes — closing without "Apply" still keeps the user's work.

import { useRef } from 'react'
import { Maximize2, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { JavaScriptEditor, type JavaScriptEditorHandle } from './JavaScriptEditor'

interface JavaScriptEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: string
  onChange: (next: string) => void
  timeoutMs?: number
}

export function JavaScriptEditorDialog({
  open,
  onOpenChange,
  value,
  onChange,
}: JavaScriptEditorDialogProps) {
  const editorRef = useRef<JavaScriptEditorHandle>(null)

  const closeWithFlush = () => {
    editorRef.current?.flush()
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) editorRef.current?.flush()
        onOpenChange(next)
      }}
    >
      <DialogContent
        className="max-w-[90vw] w-[90vw] h-[85vh] flex flex-col p-0 gap-0"
        onInteractOutside={(e) => {
          // Allow closing on outside click, but flush first.
          editorRef.current?.flush()
          e.preventDefault()
          onOpenChange(false)
        }}
      >
        <DialogHeader className="flex-none px-6 py-3 border-b border-border flex flex-row items-center">
          <div className="flex items-center gap-2">
            <Maximize2 className="w-4 h-4 text-primary" />
            <DialogTitle className="text-sm font-semibold">
              JavaScript Post-Processor
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-hidden">
          <JavaScriptEditor
            ref={editorRef}
            value={value}
            onChange={onChange}
            height="100%"
            className="h-full"
          />
        </div>

        <div className="flex-none flex items-center justify-between px-6 py-3 border-t border-border bg-muted/20">
          <p className="text-xs text-muted-foreground">
            Function signature: <code className="px-1 py-0.5 rounded bg-background border text-foreground">(data) =&gt; transformed</code>
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={closeWithFlush}>
              <X className="w-3.5 h-3.5 mr-1.5" />
              Close
            </Button>
            <Button size="sm" onClick={closeWithFlush}>
              Apply &amp; Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
