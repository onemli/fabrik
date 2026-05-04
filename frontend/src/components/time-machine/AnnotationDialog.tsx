// AnnotationDialog.tsx
//
// Modal for attaching a short label and free-text note to a Time Machine snapshot.
// The label shows up as a colored badge in the snapshot list so users can mark
// interesting states ("before migration", "post-change validation", etc.).

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

interface AnnotationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  label: string
  annotation: string
  onLabelChange: (value: string) => void
  onAnnotationChange: (value: string) => void
  onSave: () => void
  isSaving: boolean
}

export default function AnnotationDialog({
  open,
  onOpenChange,
  label,
  annotation,
  onLabelChange,
  onAnnotationChange,
  onSave,
  isSaving,
}: AnnotationDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Note to Snapshot</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="label">Label (short tag)</Label>
            <Input
              id="label"
              placeholder='e.g. "Before maintenance window"'
              value={label}
              onChange={e => onLabelChange(e.target.value)}
              maxLength={100}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="annotation">Note</Label>
            <Textarea
              id="annotation"
              placeholder="Optional longer note about this snapshot..."
              value={annotation}
              onChange={e => onAnnotationChange(e.target.value)}
              rows={4}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
