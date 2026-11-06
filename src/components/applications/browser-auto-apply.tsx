'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Bot } from 'lucide-react'
import { api, useApiMutation, useApiQuery } from '@/lib/api/hooks'
import { flagEmoji, fmtAgo } from '@/lib/format'
import type { BadgeTone } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ToneBadge } from '@/components/shared/status-badge'
import { BatchStrip } from './batch-strip'

interface PortalBatch {
  id: string
  status: 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'FAILED'
  mode: 'fill' | 'submit'
  target: number
  continuous: boolean
  minScore: number
  countries: string[]
  atsTypes: string[]
  considered: number
  submitted: number
  awaitingReview: number
  needsHuman: number
  failed: number
  skipped: number
  waitingFor: string | null
  note: string | null
  startedAt: string
  finishedAt: string | null
}

interface AttemptRow {
  id: string
  status: string
  needsHumanReason: string | null
  error: string | null
  startedAt: string
  application: { id: string; job: { title: string; companyName: string; countryCode: string | null } }
}

interface Candidate {
  jobId: string
  title: string
  company: string
  countryCode: string | null
  score: number | null
  site: string
}

const ATTEMPT_TONE: Record<string, { label: string; tone: BadgeTone }> = {
  QUEUED: { label: 'queued', tone: 'info' },
  RUNNING: { label: 'working', tone: 'info' },
  AWAITING_REVIEW: { label: 'filled', tone: 'accent' },
  SUBMITTED: { label: 'submitted', tone: 'success' },
  NEEDS_HUMAN: { label: 'needs you', tone: 'warning' },
  FAILED: { label: 'failed', tone: 'danger' },
  CANCELLED: { label: 'skipped', tone: 'muted' },
}

function useDebounced<T>(value: T, ms = 400): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** Applications page: start/stop the browser auto-apply batch and watch it. */
export function BrowserApplyPanel({ part = 'all' }: { part?: 'controls' | 'status' | 'all' }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'fill' | 'submit'>('fill')
  const [continuous, setContinuous] = useState(false)
  const [target, setTarget] = useState(10)
  const [minScore, setMinScore] = useState(75)
  const [countries, setCountries] = useState('')
  const [confirm, setConfirm] = useState(false)

  const q = useApiQuery<{ batch: PortalBatch; attempts: AttemptRow[] } | null>(['portal-batch'], '/api/portal-batches', {
    refetchInterval: (s) => (s.state.data?.data?.batch.status === 'RUNNING' ? 8000 : 60_000),
  })
  const countryList = countries
    .split(/[\s,]+/)
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c))
  const previewKey = useDebounced(JSON.stringify({ minScore, countries: countryList }))
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  useEffect(() => {
    if (!open) return
    let cancelled = false
    api
      .put<Candidate[]>('/api/portal-batches', JSON.parse(previewKey))
      .then((r) => {
        if (!cancelled) setCandidates(r.data)
      })
      .catch(() => {
        if (!cancelled) setCandidates([])
      })
    return () => {
      cancelled = true
    }
  }, [open, previewKey])

  const start = useApiMutation((body: { mode: 'fill' | 'submit'; target: number; continuous: boolean; minScore: number; countries: string[]; confirm: boolean }) => api.post('/api/portal-batches', body), {
    invalidate: [['portal-batch'], ['applications']],
    onSuccess: () => {
      setOpen(false)
      setConfirm(false)
    },
  })
  const stop = useApiMutation(() => api.delete('/api/portal-batches'), { invalidate: [['portal-batch'], ['applications']] })

  const data = q.data?.data ?? null
  const batch = data?.batch ?? null
  const running = batch?.status === 'RUNNING'
  const done = batch ? (batch.mode === 'submit' ? batch.submitted : batch.submitted + batch.awaitingReview) : 0

  const controls = (
      <div className="flex items-center gap-2">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button size="sm" variant="outline" disabled={running} />}>
            <Bot className="size-3.5" /> {running ? 'Browser apply on' : 'Browser apply'}
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Apply through company websites</DialogTitle>
              <DialogDescription>
                The agent opens each application form in your apply browser (Greenhouse, Ashby, Lever, Workday, company career pages), fills it from your profile and saved answers, and uploads your CV and a tailored cover letter. Best score first, one company at a time, never within the cooldown of an earlier application. LinkedIn and Indeed are never automated.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    { v: 'fill', title: 'Fill, I review and submit', help: 'Stops before Submit on every form. You check the answers and press Submit.' },
                    { v: 'submit', title: 'Fill and submit for me', help: 'Submits when the form is complete. Stops for CAPTCHAs, logins and questions only you can answer.' },
                  ] as const
                ).map((o) => (
                  <label key={o.v} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${mode === o.v ? 'border-primary bg-primary-soft' : ''}`}>
                    <input type="radio" name="ba-mode" className="mt-1" checked={mode === o.v} onChange={() => setMode(o.v)} />
                    <span>
                      <span className="font-medium">{o.title}</span>
                      <span className="block text-xs text-muted-foreground">{o.help}</span>
                    </span>
                  </label>
                ))}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={continuous} onCheckedChange={(c) => setContinuous(Boolean(c))} /> Keep going with new matches until I press Stop
              </label>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className={`grid gap-1.5 ${continuous ? 'opacity-50' : ''}`}>
                  <Label htmlFor="ba-target">How many</Label>
                  <Input id="ba-target" type="number" min={1} max={1000} value={target} disabled={continuous} onChange={(e) => setTarget(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ba-score">Minimum score</Label>
                  <Input id="ba-score" type="number" min={0} max={100} value={minScore} onChange={(e) => setMinScore(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ba-countries">Countries (optional)</Label>
                  <Input id="ba-countries" value={countries} onChange={(e) => setCountries(e.target.value)} placeholder="IE, NL, DE" />
                </div>
              </div>
              <div className="rounded-lg border p-3 text-sm">
                <p className="font-medium">First in line</p>
                {candidates === null ? (
                  <p className="text-xs text-muted-foreground">Checking…</p>
                ) : candidates.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No matching jobs right now (all applied, in cooldown, or on sites that are turned off in Settings → Browser).</p>
                ) : (
                  <ul className="mt-1 flex flex-col gap-0.5 text-xs">
                    {candidates.slice(0, 8).map((c) => (
                      <li key={c.jobId} className="truncate">
                        {flagEmoji(c.countryCode)} {c.company} · {c.title} <span className="text-muted-foreground">({c.score ?? '?'} · {c.site})</span>
                      </li>
                    ))}
                    {candidates.length > 8 ? <li className="text-muted-foreground">and {candidates.length - 8} more</li> : null}
                  </ul>
                )}
              </div>
              {mode === 'submit' ? (
                <label className="flex items-start gap-2 rounded-lg border border-warning/50 bg-warning-soft p-3 text-sm">
                  <Checkbox checked={confirm} onCheckedChange={(c) => setConfirm(Boolean(c))} className="mt-0.5" />
                  <span>I want the agent to submit these applications for me, without asking for each one.</span>
                </label>
              ) : null}
              <p className="text-xs text-muted-foreground">
                The apply browser opens on this computer and the worker must be running. Answers it needs from you appear in{' '}
                <Link href="/settings/browser" className="underline">
                  Settings → Browser
                </Link>
                .
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={start.isPending || (mode === 'submit' && !confirm) || candidates?.length === 0}
                onClick={() => start.mutate({ mode, target, continuous, minScore, countries: countryList, confirm })}
              >
                {mode === 'submit' ? 'Start applying' : 'Start filling'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
  )
  const status =
      batch && (running || (batch.finishedAt && q.dataUpdatedAt - new Date(batch.finishedAt).getTime() < 6 * 3_600_000)) ? (
        <BatchStrip
          label="Browser apply status"
          tone={running ? (batch.waitingFor ? 'warning' : 'info') : batch.status === 'COMPLETED' ? 'success' : 'muted'}
          title={running ? `${batch.mode === 'submit' ? 'Browser apply' : 'Browser fill'}${batch.continuous ? ' · continuous' : ''}` : `Browser ${batch.mode === 'submit' ? 'apply' : 'fill'} ${batch.status === 'COMPLETED' ? 'finished' : 'stopped'}`}
          stats={[
            { label: batch.continuous ? 'submitted' : `of ${batch.target} done`, value: batch.continuous ? batch.submitted : done },
            ...(batch.mode === 'fill' ? [{ label: 'filled for review', value: batch.awaitingReview }] : []),
            { label: 'need you', value: batch.needsHuman, tone: batch.needsHuman ? ('warning' as const) : undefined },
            { label: 'failed', value: batch.failed },
            { label: 'skipped', value: batch.skipped },
          ]}
          note={batch.waitingFor ?? (!running ? batch.note : null)}
          progress={batch.continuous ? null : Math.min(100, (done / Math.max(1, batch.target)) * 100)}
          onStop={running ? () => stop.mutateAsync(undefined).catch(() => null) : undefined}
          stopping={stop.isPending}
          stopTitle="Stop browser apply?"
          stopDescription="A form being filled stops at its next step; queued ones never start. Submitted applications stay submitted."
          details={
            <div className="flex flex-col gap-2">
              <p className="text-muted-foreground">
                Started {fmtAgo(batch.startedAt)}
                {batch.finishedAt ? ` · ended ${fmtAgo(batch.finishedAt)}` : ''} · score {batch.minScore}+{batch.countries.length ? ` · ${batch.countries.join(', ')}` : ''} · {batch.considered} considered
              </p>
              {data?.attempts.length ? (
                <ul className="flex flex-col gap-1">
                  {data.attempts.slice(0, 12).map((a) => {
                    const t = ATTEMPT_TONE[a.status] ?? { label: a.status, tone: 'neutral' as const }
                    return (
                      <li key={a.id} className="flex min-w-0 items-center justify-between gap-2">
                        <Link href={`/applications/${a.application.id}`} className="min-w-0 truncate hover:underline" title={a.needsHumanReason ?? a.error ?? undefined}>
                          {flagEmoji(a.application.job.countryCode)} {a.application.job.companyName} · {a.application.job.title}
                        </Link>
                        <ToneBadge tone={t.tone}>{t.label}</ToneBadge>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="text-muted-foreground">No forms yet.</p>
              )}
            </div>
          }
        />
      ) : null
  if (part === 'controls') return controls
  if (part === 'status') return status
  return (
    <div className="flex flex-col items-end gap-2">
      {controls}
      {status}
    </div>
  )
}
