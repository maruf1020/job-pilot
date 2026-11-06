'use client'

import { useId, useState, type ReactElement } from 'react'
import { CheckCheck, WandSparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface NoteDialogProps {
  trigger: ReactElement
  title: string
  description?: string
  noteLabel: string
  notePlaceholder?: string
  confirmLabel: string
  onConfirm: (note: string) => Promise<unknown>
}

/** A dialog with one optional free-text field; closes only after `onConfirm` resolves. */
function NoteDialog({ trigger, title, description, noteLabel, notePlaceholder, confirmLabel, onConfirm }: NoteDialogProps) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      await onConfirm(note.trim())
      setOpen(false)
      setNote('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id}>{noteLabel}</Label>
          <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder={notePlaceholder} className="min-h-24" maxLength={2000} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RegenerateDialog({ onConfirm, trigger }: { onConfirm: (note: string) => Promise<unknown>; trigger?: ReactElement }) {
  return (
    <NoteDialog
      trigger={
        trigger ?? (
          <Button variant="outline" size="sm">
            <WandSparkles /> Regenerate
          </Button>
        )
      }
      title="Regenerate draft"
      description="Queues a fresh draft for this job. Add an instruction if you want something specific changed."
      noteLabel="Instruction (optional)"
      notePlaceholder="e.g. Lead with the HRMS project and keep it under 150 words"
      confirmLabel="Regenerate"
      onConfirm={onConfirm}
    />
  )
}

export function MarkAppliedDialog({ onConfirm, trigger }: { onConfirm: (note: string) => Promise<unknown>; trigger?: ReactElement }) {
  return (
    <NoteDialog
      trigger={
        trigger ?? (
          <Button size="sm">
            <CheckCheck /> Mark applied
          </Button>
        )
      }
      title="Mark as applied"
      description="Records that you submitted this application outside the app. The job moves to Applied."
      noteLabel="Note (optional)"
      notePlaceholder="e.g. Applied via Greenhouse, confirmation #1234"
      confirmLabel="Mark applied"
      onConfirm={onConfirm}
    />
  )
}
