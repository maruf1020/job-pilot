import { Lightbulb, ScanSearch } from 'lucide-react'
import type { FailureCategory, FailureDiagnosis } from '@/lib/ai/schemas'
import type { BadgeTone } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ToneBadge } from '@/components/shared/status-badge'

export type Diagnosis = FailureDiagnosis & { at?: string }

export const FAILURE_LABEL: Record<FailureCategory, { label: string; tone: BadgeTone }> = {
  captcha: { label: 'CAPTCHA', tone: 'warning' },
  account: { label: 'Sign-in or account', tone: 'warning' },
  missing_answer: { label: 'Needs your answer', tone: 'info' },
  widget: { label: 'Field would not take it', tone: 'danger' },
  validation: { label: 'Site shows an error', tone: 'danger' },
  navigation: { label: 'Form not found', tone: 'danger' },
  closed: { label: 'Posting closed', tone: 'muted' },
  knockout: { label: 'Not eligible', tone: 'muted' },
  already_applied: { label: 'Already applied', tone: 'success' },
  other: { label: 'Other', tone: 'muted' },
}

/** Why a form stopped, as Gemini read it from a screenshot of the page: the blocker, and how to get past it next time. */
export function DiagnosisNote({ d, compact, className }: { d: Diagnosis | null | undefined; compact?: boolean; className?: string }) {
  if (!d) return null
  const c = FAILURE_LABEL[d.category] ?? FAILURE_LABEL.other
  return (
    <div className={cn('flex flex-col gap-1 rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs', className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <ScanSearch className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="font-medium text-foreground">Why it stopped</span>
        <ToneBadge tone={c.tone}>{c.label}</ToneBadge>
        {!compact && d.pattern ? <span className="text-muted-foreground">· {d.pattern}</span> : null}
      </div>
      <p className="break-words text-foreground">
        {d.blocker}
        {d.field ? <span className="text-muted-foreground"> (field: {d.field})</span> : null}
      </p>
      {d.fixHint ? (
        <p className="flex items-start gap-1 break-words text-muted-foreground">
          <Lightbulb className="mt-px size-3.5 shrink-0" aria-hidden /> Next time: {d.fixHint}
        </p>
      ) : null}
    </div>
  )
}
