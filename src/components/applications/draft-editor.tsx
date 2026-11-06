'use client'

import { ClipboardCheck, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { CopyButton } from '@/components/shared/copy-button'

interface DraftEditorProps {
  subject: string
  body: string
  onSubjectChange: (value: string) => void
  onBodyChange: (value: string) => void
  /** Runs the linter on the current text without saving. */
  onCheck: () => void
  /** Saves the current text as a new version. */
  onSave: () => void
  checking?: boolean
  saving?: boolean
  dirty?: boolean
}

export function DraftEditor({ subject, body, onSubjectChange, onBodyChange, onCheck, onSave, checking, saving, dirty }: DraftEditorProps) {
  const words = body.trim() ? body.trim().split(/\s+/).length : 0
  const canSubmit = subject.trim().length > 0 && body.trim().length > 0

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="draft-subject">Subject</Label>
        <Input id="draft-subject" value={subject} onChange={(e) => onSubjectChange(e.target.value)} maxLength={200} placeholder="Subject line" />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="draft-body">Body</Label>
          <span className="text-xs tabular-nums text-muted-foreground">
            {words} words · {subject.length}/200 subject chars
          </span>
        </div>
        <Textarea
          id="draft-body"
          value={body}
          onChange={(e) => onBodyChange(e.target.value)}
          className="min-h-80 whitespace-pre-wrap font-mono text-sm leading-relaxed"
          maxLength={10000}
          placeholder="Write the email body here."
          spellCheck
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={onCheck} disabled={!canSubmit || checking}>
          <ClipboardCheck /> {checking ? 'Checking…' : 'Check'}
        </Button>
        <Button size="sm" onClick={onSave} disabled={!canSubmit || saving}>
          <Save /> {saving ? 'Saving…' : 'Save as new version'}
        </Button>
        {dirty ? <span className="text-xs text-muted-foreground">Unsaved changes</span> : null}
        <CopyButton text={body} label="Copy body" className="ml-auto" />
      </div>
    </div>
  )
}
