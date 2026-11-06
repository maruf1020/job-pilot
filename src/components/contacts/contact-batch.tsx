'use client'

import { useState } from 'react'
import { Mail, Square } from 'lucide-react'
import { api, useApiMutation, useApiQuery } from '@/lib/api/hooks'
import { fmtAgo } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { ToneBadge } from '@/components/shared/status-badge'

type Scope = 'above_threshold' | 'all_ranked' | 'all_companies'

interface BatchRun {
  id: string
  status: 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'FAILED'
  scope: Scope
  batchSize: number
  total: number
  processed: number
  found: number
  verified: number
  guessed: number
  jobsUpdated: number
  error: string | null
  startedAt: string
  finishedAt: string | null
}

interface Payload {
  latest: BatchRun | null
  counts: Record<Scope, number> | null
}

const SCOPES: Array<{ value: Scope; label: string; help: string }> = [
  { value: 'above_threshold', label: 'Jobs above the draft threshold', help: 'Companies of ranked jobs that score high enough to be drafted. Fastest and cheapest.' },
  { value: 'all_ranked', label: 'All ranked jobs', help: 'Every company with a ranked job and no address yet.' },
  { value: 'all_companies', label: 'All companies', help: 'Every company in the database without an address, including seeded sponsors.' },
]

/** Shared state of the contact batch; the button and the status strip read the same query. */
function useContactBatch(withCounts: boolean) {
  return useApiQuery<Payload>(['contact-batch'], `/api/contacts/batch?counts=${withCounts ? 'true' : 'false'}`, {
    refetchInterval: (query) => (query.state.data?.data.latest?.status === 'RUNNING' ? 3000 : 30_000),
  })
}

/**
 * "Find contact emails" header action. Each company is looked up once (website crawl, Gemini, Google,
 * verified guesses) and the address is copied to its jobs. The progress shows in ContactBatchStatus.
 */
export function ContactBatchButton({ variant = 'outline' }: { variant?: 'default' | 'outline' }) {
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<Scope>('above_threshold')
  const [batchSize, setBatchSize] = useState(10)
  const [includeChecked, setIncludeChecked] = useState(false)
  const q = useContactBatch(open)
  const start = useApiMutation((body: { scope: Scope; batchSize: number; includeChecked: boolean }) => api.post('/api/contacts/batch', body), {
    invalidate: [['contact-batch'], ['jobs'], ['companies']],
    onSuccess: () => setOpen(false),
  })
  const counts = q.data?.data.counts ?? null
  const running = q.data?.data.latest?.status === 'RUNNING'

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant={running ? 'outline' : variant} disabled={running || q.isPending}>
            <Mail className="size-4" /> {running ? 'Finding emails…' : 'Find contact emails'}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Find contact emails for job applications</DialogTitle>
          <DialogDescription>
            Looks up each company once: its website (careers, contact, imprint pages, obfuscated addresses), Gemini web search and knowledge, Google search when configured, then verified pattern guesses. Found
            addresses are copied to the company&apos;s jobs. Runs in the background, batch by batch.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {SCOPES.map((s) => (
            <label key={s.value} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-checked:border-primary has-checked:bg-primary-soft/50">
              <input type="radio" name="scope" className="mt-1 accent-[var(--primary)]" checked={scope === s.value} onChange={() => setScope(s.value)} />
              <span className="grid gap-0.5">
                <span className="text-sm font-medium">
                  {s.label}
                  {counts ? <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">{counts[s.value]} compan{counts[s.value] === 1 ? 'y' : 'ies'}</span> : null}
                </span>
                <span className="text-xs text-muted-foreground">{s.help}</span>
              </span>
            </label>
          ))}
          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="cb-batch">Companies per batch</Label>
              <Input id="cb-batch" type="number" min={1} max={50} value={batchSize} onChange={(e) => setBatchSize(Math.max(1, Math.min(50, Number(e.target.value) || 10)))} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={includeChecked} onCheckedChange={(c) => setIncludeChecked(Boolean(c))} /> Re-check companies looked up before
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={start.isPending} onClick={() => start.mutate({ scope, batchSize, includeChecked })}>
            {start.isPending ? 'Starting…' : 'Start'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Progress of the running (or just finished) contact batch, shown under the page header. Nothing otherwise. */
export function ContactBatchStatus() {
  const q = useContactBatch(false)
  const stop = useApiMutation(() => api.delete('/api/contacts/batch'), { invalidate: [['contact-batch']] })
  const latest = q.data?.data.latest ?? null
  const running = latest?.status === 'RUNNING'
  // Compared against the time the data arrived (stable per render) rather than the wall clock.
  const recent = latest && !running && latest.finishedAt && q.dataUpdatedAt - new Date(latest.finishedAt).getTime() < 30 * 60_000
  if (!latest || !(running || recent)) return null
  const pct = latest.total > 0 ? Math.round((latest.processed / latest.total) * 100) : 0
  return (
    <div className="rounded-lg border bg-card p-3 text-sm shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-medium">Contact emails</span>
          <ToneBadge tone={running ? 'info' : latest.status === 'COMPLETED' ? 'success' : latest.status === 'CANCELLED' ? 'muted' : 'danger'} dot>
            {running ? 'Running' : latest.status === 'COMPLETED' ? 'Done' : latest.status === 'CANCELLED' ? 'Stopped' : 'Failed'}
          </ToneBadge>
          <span className="text-muted-foreground tabular-nums">
            {latest.processed} / {latest.total} companies · {SCOPES.find((s) => s.value === latest.scope)?.label ?? latest.scope}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{running ? `started ${fmtAgo(latest.startedAt)}` : `finished ${fmtAgo(latest.finishedAt)}`}</span>
          {running ? (
            <Button size="xs" variant="ghost" onClick={() => stop.mutate(undefined)} disabled={stop.isPending}>
              <Square className="size-3" /> Stop
            </Button>
          ) : null}
        </div>
      </div>
      <Progress value={pct} className="mt-2" />
      <p className="mt-2 text-xs text-muted-foreground">
        {latest.found} address{latest.found === 1 ? '' : 'es'} found · {latest.verified} verified mailbox{latest.verified === 1 ? '' : 'es'} · {latest.guessed} guessed · {latest.jobsUpdated} job
        {latest.jobsUpdated === 1 ? '' : 's'} updated
        {latest.error ? <span className="block text-warning-text">{latest.error}</span> : null}
      </p>
    </div>
  )
}

/** Button and progress together (kept for callers that want both in one place). */
export function ContactBatchPanel() {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <ContactBatchButton variant="default" />
      </div>
      <ContactBatchStatus />
    </div>
  )
}
