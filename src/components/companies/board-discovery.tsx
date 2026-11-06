'use client'

import { useState } from 'react'
import { Radar, Square } from 'lucide-react'
import { api, useApiMutation, useApiQuery } from '@/lib/api/hooks'
import { fmtAgo, fmtDuration, fmtNumber } from '@/lib/format'
import {
  BOARD_ATS_TYPES,
  BOARD_METHODS,
  BOARD_METHOD_LABEL,
  BOARD_MODE_LABEL,
  BOARD_PHASE_LABEL,
  companiesPerMinute,
  etaMs,
  formatEta,
  formatRunEstimate,
  formatSpeed,
  isWorkerSilent,
  MAX_COMPANIES_PER_RUN,
  progressPct,
  workerSilentMs,
  type BoardRunMode,
  type BoardRunPhase,
  type MethodCounts,
} from '@/lib/sponsors/board-progress'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { ToneBadge } from '@/components/shared/status-badge'
import type { BadgeTone } from '@/lib/format'

type RunStatus = 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'FAILED'

interface BoardRun {
  id: string
  status: RunStatus
  mode: BoardRunMode
  phase: BoardRunPhase | null
  limit: number
  total: number
  checked: number
  boardsFound: number
  boardsRelevant: number
  relevantJobs: number
  noBoard: number
  dead: number
  errors: number
  requests: number
  perAtsCounts: Record<string, number>
  perMethod: MethodCounts
  currentCompany: string | null
  error: string | null
  resumes: number
  startedAt: string
  finishedAt: string | null
  lastTickAt: string
}

interface BoardLog {
  id: string
  level: 'found' | 'none' | 'error' | 'dead' | 'info'
  message: string
  companyName: string | null
  atsType: string | null
  atsSlug: string | null
  relevantJobs: number | null
  createdAt: string
}

interface Payload {
  latest: BoardRun | null
  recent: BoardRun[]
  logs: BoardLog[]
  counts: { find: number; repair: number; count: number } | null
}

const RUN_STATUS: Record<RunStatus, { label: string; tone: BadgeTone }> = {
  RUNNING: { label: 'Running', tone: 'info' },
  COMPLETED: { label: 'Done', tone: 'success' },
  CANCELLED: { label: 'Stopped', tone: 'muted' },
  FAILED: { label: 'Failed', tone: 'danger' },
}

const LOG_TONE: Record<BoardLog['level'], BadgeTone> = { found: 'success', none: 'muted', error: 'danger', dead: 'warning', info: 'info' }
/** The panel stays for a day after a run ends, then leaves the page (the dialog still lists the last runs). */
const PANEL_KEEP_MS = 24 * 3600_000

/** Shared state of the board search; the button, the dialog and the panel read the same query. */
function useBoardDiscovery(withCounts: boolean) {
  const params = new URLSearchParams({ logs: '50' })
  if (withCounts) params.set('counts', 'true')
  return useApiQuery<Payload>(['board-discovery'], `/api/companies/discover-boards?${params}`, {
    refetchInterval: (query) => (query.state.data?.data.latest?.status === 'RUNNING' ? 3000 : 30_000),
  })
}

/** "Find boards" header action: one optional number and Start. Progress shows in BoardDiscoveryStatus. */
export function BoardDiscoveryButton() {
  const [open, setOpen] = useState(false)
  const [limitText, setLimitText] = useState('')
  const q = useBoardDiscovery(open)
  const start = useApiMutation((body: { limit?: number }) => api.post('/api/companies/discover-boards', body), {
    invalidate: [['board-discovery'], ['companies']],
    onSuccess: () => setOpen(false),
  })
  const running = q.data?.data.latest?.status === 'RUNNING'
  const counts = q.data?.data.counts ?? null
  const asked = Math.floor(Number(limitText))
  const limit = Number.isFinite(asked) && asked > 0 ? Math.min(asked, MAX_COMPANIES_PER_RUN) : null
  const toFind = counts ? (limit === null ? counts.find : Math.min(limit, counts.find)) : null
  const planned = counts && toFind !== null ? toFind + counts.repair + counts.count : null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline" disabled={running || q.isPending}>
            <Radar className="size-4" /> {running ? 'Finding boards…' : 'Find boards'}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Find boards</DialogTitle>
          <DialogDescription>
            Looks for each company&apos;s public job board: slug guesses from its name, then its own careers page, then Gemini as the last fallback, each checked against the live board. A board is saved only when it lists a job that
            matches you (developer title, your stack, Europe or remote); everything else is just counted. Boards that stopped answering are repaired first.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="bd-limit">How many companies to try</Label>
            <Input
              id="bd-limit"
              type="number"
              min={1}
              max={MAX_COMPANIES_PER_RUN}
              placeholder={counts ? `All ${fmtNumber(counts.find)}` : 'All'}
              value={limitText}
              onChange={(e) => setLimitText(e.target.value)}
            />
          </div>
          <p className="rounded-lg border bg-muted/40 p-2.5 text-xs text-muted-foreground tabular-nums">
            {planned === null ? (
              'Counting companies…'
            ) : toFind === 0 && planned === 0 ? (
              'Every company was tried in the last 14 days. Nothing to do right now.'
            ) : (
              <>
                {fmtNumber(toFind)} compan{toFind === 1 ? 'y' : 'ies'} to try
                {counts && counts.repair > 0 ? `, ${fmtNumber(counts.repair)} failing board${counts.repair === 1 ? '' : 's'} to repair` : ''}. About{' '}
                <strong className="font-medium text-foreground">{formatRunEstimate(planned)}</strong>. It runs in the background, keeps going if you close this page and carries on after a restart; the panel shows the real speed and time left.
              </>
            )}
          </p>
        </div>
        <RunsList runs={(q.data?.data.recent ?? []).slice(0, 5)} title="Last runs" />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={start.isPending || planned === 0} onClick={() => start.mutate(limit === null ? {} : { limit })}>
            {start.isPending ? 'Starting…' : 'Find boards'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Live panel of the running (or recently finished) board search, under the page header. Nothing otherwise. */
export function BoardDiscoveryStatus() {
  const q = useBoardDiscovery(false)
  const stop = useApiMutation(() => api.delete('/api/companies/discover-boards'), { invalidate: [['board-discovery']] })
  const latest = q.data?.data.latest ?? null
  const logs = q.data?.data.logs ?? []
  const recent = q.data?.data.recent ?? []
  const running = latest?.status === 'RUNNING'
  // Compared against the time the data arrived (stable per render) rather than the wall clock.
  const now = q.dataUpdatedAt
  const fresh = latest && !running && latest.finishedAt && now - new Date(latest.finishedAt).getTime() < PANEL_KEEP_MS
  if (!latest || !(running || fresh)) return null

  const end = running ? now : new Date(latest.finishedAt ?? now).getTime()
  const perMin = companiesPerMinute(latest.checked, latest.startedAt, end)
  const eta = running ? etaMs(latest.checked, latest.total, perMin) : null
  const pct = progressPct(latest.checked, latest.total)
  const status = RUN_STATUS[latest.status]
  const silent = running && isWorkerSilent(latest.lastTickAt, now)
  const noMatch = Math.max(0, latest.boardsFound - latest.boardsRelevant)

  return (
    <div className="rounded-lg border bg-card p-3 text-sm shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-medium">Find boards</span>
          <ToneBadge tone={status.tone} dot>
            {status.label}
          </ToneBadge>
          <span className="text-muted-foreground tabular-nums">
            {fmtNumber(latest.checked)} / {fmtNumber(latest.total)} companies{latest.mode !== 'find' ? ` · ${BOARD_MODE_LABEL[latest.mode] ?? latest.mode}` : ''}
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

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4 lg:grid-cols-5">
        <Stat label="Saved (matching jobs)" value={fmtNumber(latest.boardsRelevant)} />
        <Stat label="Matching jobs" value={fmtNumber(latest.relevantJobs)} />
        <Stat label="Board, no matching jobs" value={fmtNumber(noMatch)} hint="not saved" dim={noMatch === 0} />
        <Stat label="No board found" value={fmtNumber(latest.noBoard)} dim={latest.noBoard === 0} />
        <Stat label="Dead removed" value={fmtNumber(latest.dead)} dim={latest.dead === 0} />
        <Stat label="Errors" value={fmtNumber(latest.errors)} dim={latest.errors === 0} danger={latest.errors > 0} />
        <Stat label="Requests" value={fmtNumber(latest.requests)} />
        <Stat label="Speed" value={formatSpeed(perMin).replace(' per min', '')} hint="companies per min" />
        <Stat label={running ? 'Time left' : 'Took'} value={running ? formatEta(eta).replace('about ', '') : fmtDuration(end - new Date(latest.startedAt).getTime())} />
        {latest.resumes > 0 ? <Stat label="Picked up again" value={`${latest.resumes}x`} hint="after a restart" /> : null}
      </dl>

      <div className="mt-3 grid gap-2">
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Boards found per method">
          <span className="text-xs text-muted-foreground">Found by</span>
          {BOARD_METHODS.map((m) => {
            const c = latest.perMethod[m]
            return (
              <span key={m} className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs tabular-nums', c.found > 0 ? 'border-primary/30 bg-primary-soft text-primary-text' : 'text-muted-foreground')}>
                {BOARD_METHOD_LABEL[m]}
                <strong className={cn('font-semibold', c.found === 0 && 'font-normal')}>{c.found}</strong>
                <span className="text-muted-foreground">({c.saved} saved)</span>
              </span>
            )
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Boards found per applicant-tracking system">
          <span className="text-xs text-muted-foreground">Board type</span>
          {BOARD_ATS_TYPES.map((t) => {
            const n = latest.perAtsCounts[t] ?? 0
            return (
              <span key={t} className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs tabular-nums', n > 0 ? 'border-primary/30 bg-primary-soft text-primary-text' : 'text-muted-foreground')}>
                {t}
                <strong className={cn('font-semibold', n === 0 && 'font-normal')}>{n}</strong>
              </span>
            )
          })}
        </div>
      </div>

      {running ? (
        <p className="mt-2 truncate text-xs text-muted-foreground">
          {latest.phase ? `${BOARD_PHASE_LABEL[latest.phase]}: ` : ''}
          {latest.currentCompany ? (
            <>
              <span className="font-medium text-foreground">{latest.currentCompany}</span>
            </>
          ) : (
            'starting…'
          )}
        </p>
      ) : null}
      {silent ? (
        <p className="mt-1 text-xs text-warning-text">
          No update for {fmtDuration(workerSilentMs(latest.lastTickAt, now))}. The worker may not be running (start it with npm run workers:ensure); the run carries on from where it was once the worker is back.
        </p>
      ) : null}
      {latest.error ? <p className="mt-1 text-xs text-warning-text">{latest.error}</p> : null}

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>Live feed (last {logs.length})</span>
          {running ? <span aria-hidden>updates every 3 s</span> : null}
        </div>
        <ul className="max-h-56 overflow-y-auto rounded-md border bg-muted/30 text-xs" aria-label="Live feed">
          {logs.length === 0 ? <li className="p-2 text-muted-foreground">Nothing yet.</li> : null}
          {logs.map((l) => (
            <li key={l.id} className="flex items-start gap-2 border-b px-2 py-1 last:border-b-0">
              <span className="w-16 shrink-0 text-muted-foreground tabular-nums">{new Date(l.createdAt).toLocaleTimeString('en-GB')}</span>
              <ToneBadge tone={LOG_TONE[l.level]} className="shrink-0">
                {l.level}
              </ToneBadge>
              <span className="min-w-0 flex-1 break-words">{l.message}</span>
              {l.level === 'found' && l.relevantJobs === 0 ? (
                <ToneBadge tone="warning" className="shrink-0">
                  no matching jobs
                </ToneBadge>
              ) : null}
              {l.level === 'found' && l.relevantJobs ? (
                <ToneBadge tone="success" className="shrink-0">
                  {l.relevantJobs} matching
                </ToneBadge>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted-foreground">Last runs ({recent.length})</summary>
        <RunsList runs={recent} />
      </details>
    </div>
  )
}

function Stat({ label, value, hint, dim, danger }: { label: string; value: string; hint?: string; dim?: boolean; danger?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className={cn('text-base font-semibold tabular-nums', dim && 'font-normal text-muted-foreground', danger && 'text-danger-text')}>
        {value}
        {hint ? <span className="ml-1 text-xs font-normal text-muted-foreground">{hint}</span> : null}
      </dd>
    </div>
  )
}

/** Compact history of earlier runs. */
function RunsList({ runs, title }: { runs: BoardRun[]; title?: string }) {
  if (runs.length === 0) return null
  return (
    <div className="grid gap-1">
      {title ? <p className="text-xs font-medium text-muted-foreground">{title}</p> : null}
      <ul className="divide-y rounded-md border text-xs">
        {runs.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-2 py-1.5">
            <ToneBadge tone={RUN_STATUS[r.status].tone} dot>
              {RUN_STATUS[r.status].label}
            </ToneBadge>
            <span className="text-muted-foreground">{fmtAgo(r.startedAt)}</span>
            <span className="tabular-nums text-muted-foreground">
              {fmtNumber(r.checked)} / {fmtNumber(r.total)} checked
            </span>
            <span className="tabular-nums">
              {fmtNumber(r.boardsRelevant)} saved, {fmtNumber(r.relevantJobs)} matching jobs, {fmtNumber(r.noBoard)} without a board
              {r.dead ? `, ${fmtNumber(r.dead)} dead` : ''}
              {r.errors ? `, ${fmtNumber(r.errors)} errors` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
