'use client'

import { useEffect, useState } from 'react'
import { Mail, Rocket } from 'lucide-react'
import { api, useApiMutation, useApiQuery } from '@/lib/api/hooks'
import Link from 'next/link'
import { flagEmoji, fmtAgo, fmtDateTime } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BatchStrip } from './batch-strip'

interface Batch {
  id: string
  status: 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'FAILED'
  target: number
  minScore: number
  includeGuessed: boolean
  continuous: boolean
  countries: string[]
  considered: number
  drafted: number
  queued: number
  sent: number
  held: number
  waitingFor: string | null
  activity: string | null
  upcoming: Array<{ id: string; scheduledFor: string | null; toEmail: string | null; job: { title: string; companyName: string; countryCode: string | null } }>
  recentSent: Array<{ id: string; sentAt: string | null; job: { title: string; companyName: string; countryCode: string | null } }>
  /** Whether the mailbox can send right now (running batches only). */
  mail: { ready: boolean; reason?: string; provider: 'gmail' | 'smtp' } | null
  note: string | null
  startedAt: string
  finishedAt: string | null
}

interface Preview {
  eligible: number
  readyNow: number
  needDraft: number
  top: Array<{ title: string; company: string; country: string | null; score: number; ready: boolean }>
  dailySendCap: number
  draftsAvailableToday: number
  cooldownDays: number
  providerReady: boolean
}

const PRESETS = [10, 25, 50, 100, 250, 500, 1000]

function useDebounced<T>(value: T, ms = 400): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/**
 * Auto-apply: prepare and send the best N applications without per-job approval, one by one.
 * `part` splits it for the page layout: the button and dialog in the header, the batch status
 * as a full-width card below it.
 */
export function AutoApplyPanel({ part = 'all' }: { part?: 'controls' | 'status' | 'all' }) {
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState(25)
  const [minScore, setMinScore] = useState(80)
  const [countries, setCountries] = useState('')
  const [includeGuessed, setIncludeGuessed] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  /** 'batch' = a fixed number; 'continuous' = no end, keeps applying to new good matches as runs find them. */
  const [mode, setMode] = useState<'batch' | 'continuous'>('batch')
  const continuous = mode === 'continuous'

  const batchQ = useApiQuery<Batch | null>(['apply-batch'], '/api/apply-batches', {
    refetchInterval: (q) => (q.state.data?.data?.status === 'RUNNING' ? 10_000 : 60_000),
  })
  const params = useDebounced(`minScore=${minScore}&includeGuessed=${includeGuessed}&countries=${encodeURIComponent(countries)}`)
  const preview = useApiQuery<Preview>(['apply-batch-preview', params], open ? `/api/apply-batches/preview?${params}` : null)

  const start = useApiMutation(
    (body: { target: number; continuous: boolean; minScore: number; includeGuessed: boolean; countries: string[]; confirmSend: true }) => api.post('/api/apply-batches', body),
    {
      invalidate: [['apply-batch'], ['applications'], ['status']],
      onSuccess: () => {
        setOpen(false)
        setConfirm(false)
      },
    },
  )
  const stop = useApiMutation(() => api.delete('/api/apply-batches'), { invalidate: [['apply-batch'], ['applications'], ['status']] })

  const batch = batchQ.data?.data ?? null
  const running = batch?.status === 'RUNNING'
  const p = preview.data?.data
  const willApply = p ? Math.min(target, p.eligible) : target
  const perDay = p ? Math.max(1, Math.min(p.dailySendCap, p.draftsAvailableToday + p.readyNow)) : null
  const days = p && perDay ? Math.max(1, Math.ceil(willApply / perDay)) : null
  const countryList = countries
    .split(/[\s,]+/)
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c))

  const controls = (
      <div className="flex items-center gap-2">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button size="sm" disabled={running} />}>
            <Rocket className="size-3.5" /> {running ? 'Email auto-apply on' : 'Email auto-apply'}
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Auto-apply to your best matches</DialogTitle>
              <DialogDescription>
                Each application is prepared exactly like a single one: a tailored email from your profile and the posting, checked by the humanizer and the AI-writing judge. Only drafts that pass are sent, best score first, one per company and country, never within {p?.cooldownDays ?? 15} days of an earlier application to that company. The daily send cap and send window pace it.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4">
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    { v: 'batch', title: 'A set number', help: 'Apply to the best N matches (2 to 1000), then stop.' },
                    { v: 'continuous', title: 'Keep applying automatically', help: 'No end: every new good match the searches find is checked, prepared and sent if it passes. Runs until you press Stop.' },
                  ] as const
                ).map((o) => (
                  <label key={o.v} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${mode === o.v ? 'border-primary bg-primary-soft' : ''}`}>
                    <input type="radio" name="aa-mode" className="mt-1" checked={mode === o.v} onChange={() => setMode(o.v)} />
                    <span>
                      <span className="font-medium">{o.title}</span>
                      <span className="block text-xs text-muted-foreground">{o.help}</span>
                    </span>
                  </label>
                ))}
              </div>
              <div className={`grid gap-2 ${continuous ? 'hidden' : ''}`}>
                <Label htmlFor="aa-target">How many applications (2 to 1000)</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Input id="aa-target" type="number" min={2} max={1000} value={target} onChange={(e) => setTarget(Math.max(2, Math.min(1000, Number(e.target.value) || 2)))} className="w-28" />
                  {PRESETS.map((n) => (
                    <Button key={n} type="button" size="xs" variant={target === n ? 'default' : 'outline'} onClick={() => setTarget(n)}>
                      {n}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="aa-score">Minimum score</Label>
                  <Input id="aa-score" type="number" min={0} max={100} value={minScore} onChange={(e) => setMinScore(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="aa-countries">Countries (optional)</Label>
                  <Input id="aa-countries" value={countries} onChange={(e) => setCountries(e.target.value)} placeholder="IE, NL, DE" />
                </div>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={includeGuessed} onCheckedChange={(c) => setIncludeGuessed(Boolean(c))} className="mt-0.5" />
                <span>
                  Include guessed addresses (careers@, jobs@ …)
                  <span className="block text-xs text-muted-foreground">Off: only addresses found on the posting or website, or verified with the mail server.</span>
                </span>
              </label>

              <div className="rounded-lg border bg-muted p-3 text-sm">
                {preview.isPending ? (
                  <p className="text-muted-foreground">Checking which jobs qualify…</p>
                ) : p ? (
                  <>
                    <p>
                      <strong>{p.eligible}</strong> job{p.eligible === 1 ? '' : 's'} qualify ({p.readyNow} already drafted, {p.needDraft} to draft). This batch applies to <strong>{willApply}</strong>
                      {days ? `, over about ${days} day${days === 1 ? '' : 's'}` : ''} (daily cap {p.dailySendCap}; AI quota allows about {p.draftsAvailableToday} new drafts today).
                    </p>
                    {!p.providerReady ? (
                      <p className="mt-1 text-danger-text">
                        Email is not connected; connect Gmail in{' '}
                        <Link href="/settings/email" className="underline">
                          Settings → Email
                        </Link>{' '}
                        first.
                      </p>
                    ) : null}
                    {p.top.length ? (
                      <ul className="mt-2 grid gap-1 text-xs text-muted-foreground">
                        {p.top.map((t, i) => (
                          <li key={i} className="truncate">
                            {t.score} · {t.title} · {flagEmoji(t.country)} {t.company}
                            {t.ready ? ' · draft ready' : ''}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                ) : null}
              </div>

              <label className="flex items-start gap-2 rounded-lg border border-warning/50 bg-warning-soft p-3 text-sm">
                <Checkbox checked={confirm} onCheckedChange={(c) => setConfirm(Boolean(c))} className="mt-0.5" />
                <span>
                  {continuous
                    ? 'I allow application emails to good matches to be sent from my Gmail automatically, from now on, without approving each one (within the daily cap, send window and company cooldown). I can stop it at any time; anything not yet sent goes back to Review.'
                    : `I allow up to ${willApply} application emails to be sent from my Gmail automatically, without approving each one. I can stop the batch at any time; anything not yet sent goes back to Review.`}
                </span>
              </label>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button disabled={!confirm || start.isPending || !p || (!continuous && p.eligible === 0) || !p.providerReady} onClick={() => start.mutate({ target: continuous ? 1000 : target, continuous, minScore, includeGuessed, countries: countryList, confirmSend: true })}>
                <Rocket className="size-3.5" /> {start.isPending ? 'Starting…' : continuous ? 'Start continuous auto-apply' : `Start auto-apply (${willApply})`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
  )

  const showStatus = batch && !dismissed && (running || (batch.finishedAt && batchQ.dataUpdatedAt - new Date(batch.finishedAt).getTime() < 24 * 3600_000))
  const status = showStatus && batch ? <BatchStatus batch={batch} running={running} onDismiss={() => setDismissed(true)} onStop={() => stop.mutateAsync(undefined).catch(() => null)} stopping={stop.isPending} /> : null
  if (part === 'controls') return controls
  if (part === 'status') return status
  return (
    <div className="flex flex-col items-end gap-2">
      {controls}
      {status}
    </div>
  )
}

/** The latest email batch as one compact strip: progress, why it waits, and the details folded away. */
function BatchStatus({ batch, running, onDismiss, onStop, stopping }: { batch: Batch; running: boolean; onDismiss: () => void; onStop: () => void; stopping: boolean }) {
  const done = batch.sent + batch.queued
  const pct = batch.continuous ? null : Math.min(100, Math.round((done / Math.max(1, batch.target)) * 100))
  const short = !running && !batch.continuous && batch.status === 'COMPLETED' && batch.sent < batch.target
  const title = running ? `Email auto-apply${batch.continuous ? ' · continuous' : ''}` : batch.status === 'COMPLETED' ? 'Email auto-apply finished' : 'Email auto-apply stopped'
  const activity = batch.activity ? batch.activity.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, (iso) => fmtDateTime(iso)) : null
  const mailDown = running && batch.mail && !batch.mail.ready
  const note = mailDown ? `Email is not ready${batch.mail?.reason ? `: ${batch.mail.reason}` : ''}. Sending starts right after you reconnect.` : (activity ?? batch.waitingFor ?? (!running ? batch.note : null))
  const details = (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground">
        Started {fmtAgo(batch.startedAt)}
        {batch.finishedAt ? ` · ended ${fmtAgo(batch.finishedAt)}` : ''} · score {batch.minScore}+{batch.countries.length ? ` · ${batch.countries.join(', ')}` : ''}
        {batch.includeGuessed ? ' · guessed addresses allowed' : ''} · {batch.considered} considered
      </p>
      {short ? (
        <p className="rounded-md bg-warning-soft px-3 py-2 text-warning-text">
          Stopped at {batch.sent} because no more jobs matched. Jobs need a real recruiting address, the score, the visa and salary checks, and no application to that company in the cooldown. Lower the minimum score, widen the countries, or run it continuously.
        </p>
      ) : null}
      {mailDown ? (
        <div className="flex flex-wrap items-center gap-2">
          {batch.mail?.provider === 'gmail' ? (
            <Button size="xs" nativeButton={false} render={<a href="/api/gmail/connect" aria-label="Reconnect Gmail" />}>
              <Mail /> Reconnect Gmail
            </Button>
          ) : null}
          <Button size="xs" variant="outline" nativeButton={false} render={<Link href="/settings/email" />}>
            Email settings
          </Button>
        </div>
      ) : null}
      {batch.upcoming.length || batch.recentSent.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {batch.upcoming.length ? (
            <div className="min-w-0">
              <p className="font-medium text-muted-foreground">{mailDown ? 'Queued, sending once email works again' : 'Queued'}</p>
              <ul className="mt-1 grid gap-1">
                {batch.upcoming.map((a) => (
                  <li key={a.id} className="flex min-w-0 justify-between gap-2">
                    <Link href={`/applications/${a.id}`} className="truncate hover:underline">
                      {flagEmoji(a.job.countryCode)} {a.job.companyName} · {a.job.title}
                    </Link>
                    <span className="shrink-0 text-muted-foreground">{a.scheduledFor ? fmtDateTime(a.scheduledFor) : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {batch.recentSent.length ? (
            <div className="min-w-0">
              <p className="font-medium text-muted-foreground">Latest sent</p>
              <ul className="mt-1 grid gap-1">
                {batch.recentSent.map((a) => (
                  <li key={a.id} className="flex min-w-0 justify-between gap-2">
                    <Link href={`/applications/${a.id}`} className="truncate hover:underline">
                      {flagEmoji(a.job.countryCode)} {a.job.companyName} · {a.job.title}
                    </Link>
                    <span className="shrink-0 text-muted-foreground">{a.sentAt ? fmtAgo(a.sentAt) : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
  return (
    <BatchStrip
      label="Email auto-apply status"
      tone={running ? (mailDown || batch.held ? 'warning' : 'info') : batch.status === 'COMPLETED' ? 'success' : 'muted'}
      title={title}
      stats={[
        { label: batch.continuous ? 'sent' : `of ${batch.target} sent`, value: batch.sent },
        { label: 'queued', value: batch.queued },
        { label: 'drafted', value: batch.drafted },
        ...(batch.held ? [{ label: 'held for review', value: batch.held, tone: 'warning' as const }] : []),
      ]}
      note={note}
      progress={pct}
      onStop={running ? onStop : undefined}
      stopping={stopping}
      stopTitle="Stop email auto-apply?"
      stopDescription="Nothing more is prepared, and every application of the batch not yet sent goes back to Review."
      onDismiss={running ? undefined : onDismiss}
      details={details}
    />
  )
}
