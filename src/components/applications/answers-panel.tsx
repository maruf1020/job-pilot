'use client'

import { useState, type ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { CopyButton } from '@/components/shared/copy-button'
import { FindingsPanel } from './findings-panel'
import { ANSWER_FIELDS, type AnswerKey, type ApplicationAnswers } from './types'

interface CoverLetterCardProps {
  value: string | null
  onSave: (text: string | null) => Promise<unknown>
  saving?: boolean
}

export function CoverLetterCard({ value, onSave, saving }: CoverLetterCardProps) {
  const [text, setText] = useState(value ?? '')
  const dirty = text !== (value ?? '')
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cover letter</CardTitle>
        <CardDescription>Paste this into the application form.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="min-h-64 whitespace-pre-wrap text-sm leading-relaxed"
          maxLength={10000}
          placeholder="No cover letter yet."
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void onSave(text.trim() ? text : null)} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save cover letter'}
          </Button>
          <CopyButton text={text} label="Copy" />
          {dirty ? <span className="text-xs text-muted-foreground">Unsaved changes</span> : null}
        </div>
      </CardContent>
    </Card>
  )
}

function pickAnswers(answers: ApplicationAnswers | null): Record<AnswerKey, string> {
  const out = {} as Record<AnswerKey, string>
  for (const f of ANSWER_FIELDS) {
    const v = answers?.[f.key]
    out[f.key] = typeof v === 'string' ? v : ''
  }
  return out
}

interface AnswersCardProps {
  answers: ApplicationAnswers | null
  jobUrl: string
  onSave: (answers: Record<string, unknown>) => Promise<unknown>
  saving?: boolean
  /** Slot for the "Mark as applied" trigger. */
  markApplied?: ReactNode
}

export function AnswersCard({ answers, jobUrl, onSave, saving, markApplied }: AnswersCardProps) {
  const [values, setValues] = useState<Record<AnswerKey, string>>(() => pickAnswers(answers))
  const initial = pickAnswers(answers)
  const dirty = ANSWER_FIELDS.some((f) => values[f.key] !== initial[f.key])
  const lint = answers?.lint ?? null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Application answers</CardTitle>
        <CardDescription>Copy each answer into the form, then mark the application as applied.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <a href={jobUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            <ExternalLink /> Open job posting
          </a>
          {markApplied}
        </div>
        <div className="flex flex-col gap-3">
          {ANSWER_FIELDS.map((f) => (
            <div key={f.key} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor={`answer-${f.key}`}>{f.label}</Label>
                <CopyButton text={values[f.key]} size="xs" />
              </div>
              <Textarea
                id={`answer-${f.key}`}
                value={values[f.key]}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                className="min-h-16 text-sm"
                maxLength={2000}
              />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void onSave({ ...(answers ?? {}), ...values })} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save answers'}
          </Button>
          {dirty ? <span className="text-xs text-muted-foreground">Unsaved changes</span> : null}
        </div>
        {lint ? (
          <div className="border-t pt-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Cover letter findings</p>
            <FindingsPanel lint={lint} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
