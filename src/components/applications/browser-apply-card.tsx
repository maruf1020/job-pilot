'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Bot, CheckCheck, Eye, Globe, ImageIcon, Loader2, RotateCcw, Send, Square, X } from 'lucide-react'
import { api, useApiMutation, useApiQuery } from '@/lib/api/hooks'
import { fmtAgo, fmtDateTime } from '@/lib/format'
import type { BadgeTone } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ConfirmButton } from '@/components/shared/confirm-button'
import { ToneBadge } from '@/components/shared/status-badge'
import { useCooldownConfirm, type CooldownInfo } from '@/components/shared/cooldown-warning'
import { DiagnosisNote, type Diagnosis } from './diagnosis-note'

export interface PortalAttemptRow {
  id: string
  mode: 'fill' | 'submit'
  status: 'QUEUED' | 'RUNNING' | 'AWAITING_REVIEW' | 'SUBMITTED' | 'NEEDS_HUMAN' | 'FAILED' | 'CANCELLED'
  atsType: string | null
  startUrl: string | null
  formUrl: string | null
  finalUrl: string | null
  tabId: string | null
  steps: Array<{ at: string; level: 'info' | 'warn' | 'error'; message: string }> | null
  fields: Array<{ label: string; kind: string; value: string; source: string; required: boolean; file?: string; choices?: string[]; checked?: boolean }> | null
  questions: Array<{ label: string; kind: string; options: string[]; required: boolean; reason: string; stdKey?: string }> | null
  screenshots: string[]
  needsHumanReason: string | null
  error: string | null
  diagnosis: Diagnosis | null
  aiCalls: number
  startedAt: string
  finishedAt: string | null
}

const STATUS: Record<PortalAttemptRow['status'], { label: string; tone: BadgeTone }> = {
  QUEUED: { label: 'Waiting for the worker', tone: 'info' },
  RUNNING: { label: 'Working in the browser', tone: 'info' },
  AWAITING_REVIEW: { label: 'Filled, waiting for you', tone: 'warning' },
  SUBMITTED: { label: 'Submitted', tone: 'success' },
  NEEDS_HUMAN: { label: 'Needs you', tone: 'danger' },
  FAILED: { label: 'Failed', tone: 'danger' },
  CANCELLED: { label: 'Stopped', tone: 'muted' },
}

const SOURCE_LABEL: Record<string, string> = {
  profile: 'profile',
  bank: 'your answers',
  rule: 'rule',
  ai: 'AI',
  cover_letter: 'cover letter',
  resume: 'CV',
  cached: 'earlier run',
}

const INVALIDATE: unknown[][] = [['applications'], ['jobs'], ['answer-bank']]

/** Open questions from the agent: answer them here once; they are reused on every form. */
function QuestionAnswers({ questions, onDone }: { questions: NonNullable<PortalAttemptRow['questions']>; onDone: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const save = useApiMutation<{ question: string; answer: string; stdKey?: string }, unknown>((v) => api.post('/api/answer-bank', v), { invalidate: [['answer-bank']], silent: true })
  const [saving, setSaving] = useState(false)
  const ready = questions.every((q) => (values[q.label] ?? '').trim())
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-danger-soft p-3">
      <p className="text-sm font-medium">The form asks for something only you can answer</p>
      {questions.map((q) => (
        <div key={q.label} className="flex flex-col gap-1">
          <label className="text-xs font-medium">{q.label}</label>
          {q.options.length ? (
            <div className="flex flex-wrap gap-1.5">
              {q.options.map((o) => (
                <Button key={o} type="button" size="xs" variant={values[q.label] === o ? 'default' : 'outline'} onClick={() => setValues((s) => ({ ...s, [q.label]: o }))}>
                  {o}
                </Button>
              ))}
            </div>
          ) : (
            <Input value={values[q.label] ?? ''} onChange={(e) => setValues((s) => ({ ...s, [q.label]: e.target.value }))} placeholder="Your answer" className="h-8 text-sm" />
          )}
          <p className="text-xs text-muted-foreground">{q.reason}</p>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!ready || saving}
          onClick={async () => {
            setSaving(true)
            try {
              for (const q of questions) await save.mutateAsync({ question: q.label, answer: values[q.label].trim(), ...(q.stdKey ? { stdKey: q.stdKey } : {}) })
              onDone()
            } finally {
              setSaving(false)
            }
          }}
        >
          {saving ? <Loader2 className="animate-spin" /> : <CheckCheck />} Save answers and retry
        </Button>
        <Link href="/settings/browser" className="text-xs text-muted-foreground underline">
          All saved answers
        </Link>
      </div>
    </div>
  )
}

/** `appliedOnSite`: already submitted on the website (an earlier email does not count). */
export function BrowserApplyCard({ applicationId, appliedOnSite: sent, cooldown }: { applicationId: string; appliedOnSite: boolean; cooldown: CooldownInfo | null | undefined }) {
  const query = useApiQuery<PortalAttemptRow[]>(['applications', applicationId, 'portal'], `/api/applications/${applicationId}/portal`, {
    refetchInterval: (q) => {
      const s = q.state.data?.data?.[0]?.status
      return s === 'QUEUED' || s === 'RUNNING' ? 3000 : false
    },
  })
  const act = useApiMutation<{ action: string; attemptId?: string; ignoreCooldown?: boolean }, unknown>((v) => api.post(`/api/applications/${applicationId}/portal`, v), { invalidate: INVALIDATE })
  const guard = useCooldownConfirm(cooldown)
  const [showLog, setShowLog] = useState(false)
  const attempts = query.data?.data ?? []
  const last = attempts[0]
  const active = last && (last.status === 'QUEUED' || last.status === 'RUNNING')
  const s = last ? STATUS[last.status] : null

  const fill = () => act.mutate({ action: 'fill' })
  const submit = () => guard.guard((ignoreCooldown) => act.mutate({ action: 'submit', ignoreCooldown }))

  return (
    <Card>
      {guard.dialog}
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="size-4" /> Apply in browser
        </CardTitle>
        <CardDescription>
          The agent opens the application form in your apply browser, fills it from your profile and saved answers, and stops before Submit unless you choose to submit.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {last && s ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <ToneBadge tone={s.tone}>{s.label}</ToneBadge>
            {active ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
            <span className="text-xs text-muted-foreground">
              {last.mode === 'submit' ? 'fill and submit' : 'fill only'} · started {fmtAgo(last.startedAt)}
              {last.aiCalls ? ` · ${last.aiCalls} AI call${last.aiCalls === 1 ? '' : 's'}` : ''}
              {last.atsType ? ` · ${last.atsType}` : ''}
            </span>
          </div>
        ) : null}

        {sent ? <p className="text-sm text-success-text">Applied on their website.</p> : null}
        {last?.status === 'NEEDS_HUMAN' && last.needsHumanReason ? <p className="text-sm text-danger-text">{last.needsHumanReason}</p> : null}
        {last?.status === 'FAILED' && last.error ? <p className="text-sm text-danger-text">{last.error}</p> : null}
        {last && (last.status === 'NEEDS_HUMAN' || last.status === 'FAILED') ? <DiagnosisNote d={last.diagnosis} /> : null}
        {last?.status === 'AWAITING_REVIEW' ? <p className="text-sm">Check the answers and the screenshot below. Submit sends the application exactly as filled.</p> : null}
        {last?.status === 'NEEDS_HUMAN' && last.questions?.length ? <QuestionAnswers questions={last.questions} onDone={fill} /> : null}

        <div className="flex flex-wrap gap-2">
          {!sent && !active && last?.status !== 'AWAITING_REVIEW' ? (
            <>
              <Button size="sm" variant="outline" onClick={fill} disabled={act.isPending}>
                {last ? <RotateCcw /> : <Globe />} {last ? 'Fill again' : 'Fill the form'}
              </Button>
              <ConfirmButton
                size="sm"
                title="Apply through the website now?"
                description="The agent fills the form and presses Submit for you. It stops instead if a CAPTCHA, a login or a question it cannot answer truthfully comes up."
                confirmLabel="Fill and submit"
                onConfirm={submit}
              >
                <Send /> Fill and submit
              </ConfirmButton>
            </>
          ) : null}
          {last?.status === 'AWAITING_REVIEW' && !sent ? (
            <ConfirmButton size="sm" title="Submit this application?" description="The agent presses Submit in the filled form (or fills it again the same way if the tab was closed)." confirmLabel="Submit" onConfirm={submit}>
              <Send /> Submit
            </ConfirmButton>
          ) : null}
          {active ? (
            <Button size="sm" variant="outline" onClick={() => act.mutate({ action: 'cancel', attemptId: last!.id })} disabled={act.isPending}>
              <Square /> Stop
            </Button>
          ) : null}
          {last && (last.tabId || last.finalUrl) && !active ? (
            <Button size="sm" variant="ghost" onClick={() => act.mutate({ action: 'focus', attemptId: last.id })} disabled={act.isPending}>
              <Eye /> Show in browser
            </Button>
          ) : null}
          {last && ['AWAITING_REVIEW', 'NEEDS_HUMAN', 'FAILED'].includes(last.status) && !sent ? (
            <ConfirmButton size="sm" variant="ghost" title="Did you submit it yourself?" description="Marks the application as sent (for example after you finished the form in the apply browser)." confirmLabel="Yes, I submitted it" onConfirm={() => act.mutate({ action: 'mark-submitted' })}>
              <CheckCheck /> I submitted it
            </ConfirmButton>
          ) : null}
          {last?.tabId && !active ? (
            <Button size="sm" variant="ghost" onClick={() => act.mutate({ action: 'close-tab', attemptId: last.id })} disabled={act.isPending}>
              <X /> Close tab
            </Button>
          ) : null}
        </div>

        {last?.screenshots.length ? (
          <div className="flex flex-col gap-1.5">
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <ImageIcon className="size-3.5" /> What the agent saw, step by step ({last.screenshots.length})
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {last.screenshots.map((name, i) => {
                const label = name.split('/').pop()?.replace(/^\d+-/, '').replace(/\.jpg$/, '').replace(/-/g, ' ') ?? ''
                return (
                  <a
                    key={name}
                    href={`/api/portal-attempts/${last.id}/screenshot?n=${i + 1}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex w-32 shrink-0 flex-col gap-1 text-[11px] text-muted-foreground"
                    title={label}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- local screenshots served by our API */}
                    <img src={`/api/portal-attempts/${last.id}/screenshot?n=${i + 1}`} alt={label} loading="lazy" className="h-20 w-32 rounded-md border object-cover object-top transition-colors group-hover:border-border-strong" />
                    <span className="truncate">{label}</span>
                  </a>
                )
              })}
            </div>
          </div>
        ) : null}

        {last?.fields?.length ? (
          <details className="rounded-lg border p-2 text-sm" open={last.status === 'AWAITING_REVIEW'}>
            <summary className="cursor-pointer text-xs font-medium">Answers given ({last.fields.length})</summary>
            <dl className="mt-2 grid grid-cols-1 gap-x-3 gap-y-1.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              {last.fields.map((f, i) => (
                <div key={`${f.label}-${i}`} className="contents">
                  <dt className="truncate text-xs text-muted-foreground" title={f.label}>
                    {f.label || '(no label)'}
                    {f.required ? ' *' : ''}
                  </dt>
                  <dd className="min-w-0 text-xs">
                    <span className="line-clamp-3 wrap-break-word">{f.file ?? (f.kind === 'checkbox' ? (f.checked ? 'ticked' : 'not ticked') : f.value)}</span>
                    <span className="text-[10px] text-muted-foreground"> · {SOURCE_LABEL[f.source] ?? f.source}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        ) : null}

        {last?.steps?.length ? (
          <div>
            <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setShowLog((v) => !v)}>
              {showLog ? 'Hide' : 'Show'} what the agent did ({last.steps.length} steps)
            </button>
            {showLog ? (
              <ol className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] leading-relaxed">
                {last.steps.map((st, i) => (
                  <li key={i} className={st.level === 'error' ? 'text-danger-text' : st.level === 'warn' ? 'text-warning-text' : ''}>
                    {new Date(st.at).toLocaleTimeString()} {st.message}
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}

        {attempts.length > 1 ? (
          <p className="text-xs text-muted-foreground">
            Earlier runs: {attempts
              .slice(1, 5)
              .map((a) => `${STATUS[a.status].label.toLowerCase()} ${fmtDateTime(a.startedAt)}`)
              .join(' · ')}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
