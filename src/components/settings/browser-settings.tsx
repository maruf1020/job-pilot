'use client'

import { useState } from 'react'
import { Eye, EyeOff, Globe, Inbox, KeyRound, Loader2, RefreshCw, Save, Trash2 } from 'lucide-react'
import { api, useApiMutation, useApiQuery } from '@/lib/api/hooks'
import { fmtAgo } from '@/lib/format'
import { PORTAL_SITES, type PortalConfig, type PortalSite } from '@/lib/settings/schema'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmButton } from '@/components/shared/confirm-button'
import { ToneBadge } from '@/components/shared/status-badge'
import { Field, NumberInput, SectionCard, SwitchRow } from './fields'
import { TagInput } from './tag-input'
import { SaveBar, SettingsError, SettingsLoading, useSettingsSection } from './settings-form'

// ---------------------------------------------------------------------------
// Browser status
// ---------------------------------------------------------------------------

interface BrowserInfo {
  worker: { state: string; heartbeatAt: string } | null
  browser: {
    state: 'running' | 'stopped' | 'unavailable'
    port: number
    profileDir: string
    chromePath: string | null
    chromeKind: string | null
    version: string | null
    tabs: Array<{ id: string; url: string; title: string }>
    checkedAt: string
    message?: string
  } | null
  waitingQuestions: number
  accounts: number
  needsYou: number
}

export function BrowserStatusCard() {
  const q = useApiQuery<BrowserInfo>(['browser'], '/api/browser', { refetchInterval: 15_000 })
  const act = useApiMutation<{ action: 'open' | 'scan-inbox' | 'check-portals'; url?: string }, unknown>((v) => api.post('/api/browser', v), { invalidate: [['browser']] })
  const [url, setUrl] = useState('')
  const b = q.data?.data.browser
  // Compared with the time of this response (pure during render), not the clock.
  const workerOk = q.data?.data.worker && q.dataUpdatedAt - new Date(q.data.data.worker.heartbeatAt).getTime() < 3 * 60_000
  return (
    <SectionCard
      title="Apply browser"
      description="A Chrome window with its own saved profile. Log in to sites and install extensions there once; the agent and Chrome DevTools MCP (server apply-browser) use the same browser."
      action={
        <Button size="sm" onClick={() => act.mutate({ action: 'open' })} disabled={act.isPending || !workerOk}>
          <Globe /> Open browser
        </Button>
      }
    >
      {q.isPending ? (
        <p className="text-sm text-muted-foreground">Checking…</p>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <ToneBadge tone={b?.state === 'running' ? 'success' : b?.state === 'stopped' ? 'muted' : 'danger'}>{b?.state === 'running' ? 'Open' : b?.state === 'stopped' ? 'Closed' : 'Not found'}</ToneBadge>
            {!workerOk ? <ToneBadge tone="danger">Worker not running (npm run worker)</ToneBadge> : null}
            {b?.version ? <span className="text-xs text-muted-foreground">{b.version}</span> : null}
            {b ? <span className="text-xs text-muted-foreground">· checked {fmtAgo(b.checkedAt)}</span> : null}
          </div>
          {b?.message ? <p className="text-danger-text">{b.message}</p> : null}
          {b ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Profile folder</dt>
              <dd className="truncate font-mono" title={b.profileDir}>
                {b.profileDir}
              </dd>
              <dt className="text-muted-foreground">DevTools</dt>
              <dd className="font-mono">http://127.0.0.1:{b.port}</dd>
              <dt className="text-muted-foreground">Chrome</dt>
              <dd className="truncate font-mono" title={b.chromePath ?? ''}>
                {b.chromePath ?? '—'}
              </dd>
              <dt className="text-muted-foreground">Open tabs</dt>
              <dd>{b.tabs.length}</dd>
            </dl>
          ) : null}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (url.trim()) act.mutate({ action: 'open', url: url.trim() })
            }}
          >
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Open a page in it, e.g. a Workday or LinkedIn login" className="h-8 text-sm" type="url" />
            <Button size="sm" variant="outline" type="submit" disabled={!url.trim() || act.isPending || !workerOk}>
              Open page
            </Button>
          </form>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => act.mutate({ action: 'scan-inbox' })} disabled={act.isPending || !workerOk}>
              <Inbox /> Scan inbox now
            </Button>
            <Button size="sm" variant="outline" onClick={() => act.mutate({ action: 'check-portals' })} disabled={act.isPending || !workerOk}>
              <RefreshCw /> Check portal statuses
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            You can also open it from a terminal with <code className="rounded bg-muted px-1">npm run browser</code>. Indeed and Xing are never automated (their rules forbid bots); LinkedIn only with Easy Apply turned on below.
          </p>
        </div>
      )}
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Agent settings (Settings.portal)
// ---------------------------------------------------------------------------

const SITE_LABEL: Record<PortalSite, string> = {
  greenhouse: 'Greenhouse',
  ashby: 'Ashby',
  lever: 'Lever',
  workable: 'Workable',
  smartrecruiters: 'SmartRecruiters',
  recruitee: 'Recruitee',
  teamtailor: 'Teamtailor',
  personio: 'Personio',
  workday: 'Workday (creates an account per company)',
  linkedin: 'LinkedIn Easy Apply (your Chrome, see below)',
  other: 'Company career pages',
}

const SENIORITY_OPTIONS: Array<{ value: PortalConfig['seniority'][number]; label: string }> = [
  { value: 'junior', label: 'Junior / graduate' },
  { value: 'mid', label: 'Mid' },
  { value: 'senior', label: 'Senior' },
  { value: 'lead', label: 'Lead' },
  { value: 'staff', label: 'Staff / principal' },
  { value: 'manager', label: 'Manager / head' },
]

export function BrowserAgentForm() {
  const form = useSettingsSection('portal')
  if (form.isPending) return <SettingsLoading />
  if (form.isError || !form.value) return <SettingsError error={form.error} onRetry={() => void form.refetch()} />
  const v: PortalConfig = form.value
  const set = form.set
  return (
    <div className="flex flex-col gap-4">
      <SectionCard title="Browser agent" description="How the agent applies on application websites.">
        <SwitchRow label="Browser apply on" help="Single-job buttons, browser auto-apply batches and portal status checks." checked={v.enabled} onCheckedChange={(c) => set({ enabled: c })} />
        <SwitchRow label="Show the parallel agents in a window" help="Their own Chrome window (not yours) so you can watch them; it meets fewer CAPTCHAs than the hidden mode. Takes effect when their browser next starts." checked={v.agentsWindow} onCheckedChange={(c) => set({ agentsWindow: c })} />
        <SwitchRow
          label="Target titles only"
          help="Batches and drafts only take titles that fit your target titles or profession (Settings → Search), e.g. design roles for a designer."
          checked={v.targetTitlesOnly ?? false}
          onCheckedChange={(c) => set({ targetTitlesOnly: c })}
        />
        <Field label="Levels" htmlFor="portal-seniority" help="Title levels the agent may apply to. None ticked = any level; titles without a level word always pass.">
          <div id="portal-seniority" className="flex flex-wrap gap-x-4 gap-y-2">
            {SENIORITY_OPTIONS.map((o) => {
              const levels = v.seniority ?? []
              const checked = levels.includes(o.value)
              return (
                <label key={o.value} className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox checked={checked} onCheckedChange={(c) => set({ seniority: c ? [...new Set([...levels, o.value])] : levels.filter((x) => x !== o.value) })} aria-label={o.label} />
                  {o.label}
                </label>
              )
            })}
          </div>
        </Field>
        <Field label="Skill focus" htmlFor="portal-stack" help="Batches only apply to jobs whose title or description names one of these. Empty = any.">
          <TagInput id="portal-stack" value={v.stackFocus} onChange={(stackFocus) => set({ stackFocus })} placeholder="e.g. python" normalize={(s) => s.toLowerCase()} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Agents at once" htmlFor="portal-agents" help="Each agent uses its own Gemini key. Above 1 they work in their own browser, never in your window.">
            <NumberInput id="portal-agents" integer min={1} max={12} value={v.parallelAgents} onValueChange={(n) => set({ parallelAgents: n })} />
          </Field>
          <Field label="Automatic submissions per day" htmlFor="portal-cap" help="Batches stop here; your own Submit clicks do not count.">
            <NumberInput id="portal-cap" integer min={1} max={1000} value={v.maxSubmissionsPerDay} onValueChange={(n) => set({ maxSubmissionsPerDay: n })} />
          </Field>
          <Field label="Pause between submissions (seconds)" htmlFor="portal-gap-min">
            <div className="flex items-center gap-2">
              <NumberInput id="portal-gap-min" integer min={5} max={3600} value={v.gapSeconds.min} onValueChange={(n) => set({ gapSeconds: { ...v.gapSeconds, min: n } })} aria-label="Minimum pause" />
              <span className="text-xs text-muted-foreground">to</span>
              <NumberInput integer min={5} max={7200} value={v.gapSeconds.max} onValueChange={(n) => set({ gapSeconds: { ...v.gapSeconds, max: n } })} aria-label="Maximum pause" />
            </div>
          </Field>
          <Field label="Tabs kept open for you" htmlFor="portal-tabs" help="Older review tabs close; their answers are kept.">
            <NumberInput id="portal-tabs" integer min={1} max={30} value={v.maxOpenTabs} onValueChange={(n) => set({ maxOpenTabs: n })} />
          </Field>
          <Field label="Wait for you to solve a CAPTCHA (minutes)" htmlFor="portal-captcha" help="Only when you started the job yourself. 0 = stop at once.">
            <NumberInput id="portal-captcha" integer min={0} max={30} value={v.captchaWaitMinutes} onValueChange={(n) => set({ captchaWaitMinutes: n })} />
          </Field>
          <Field label="Applications per company" htmlFor="portal-per-company" help="Different roles only; the same title is never applied to twice. Email keeps one per company.">
            <div className="flex items-center gap-2">
              <NumberInput id="portal-per-company" integer min={1} max={10} value={v.maxPerCompany} onValueChange={(n) => set({ maxPerCompany: n })} aria-label="Applications per company" />
              <span className="shrink-0 text-xs text-muted-foreground">in</span>
              <NumberInput integer min={0} max={180} value={v.companyWindowDays} onValueChange={(n) => set({ companyWindowDays: n })} aria-label="Days" />
              <span className="shrink-0 text-xs text-muted-foreground">days</span>
            </div>
          </Field>
          <Field label="Skip a host after this many same failures" htmlFor="portal-skip-host" help="In a row, for the same reason; it rests for a week (see Hosts). CAPTCHA hosts go to your queue instead.">
            <NumberInput id="portal-skip-host" integer min={1} max={20} value={v.skipHostAfterFails} onValueChange={(n) => set({ skipHostAfterFails: n })} />
          </Field>
        </div>
        <SwitchRow label="CV variants" help="Upload the CV version that fits the title instead of your main CV, once the variants exist and you approved them." checked={v.cvVariants} onCheckedChange={(c) => set({ cvVariants: c })} />
        <SwitchRow label="Cover letter" help="Paste or upload a tailored cover letter when the form has a field for one (one AI call per job)." checked={v.coverLetter} onCheckedChange={(c) => set({ coverLetter: c })} />
        <SwitchRow label="Screenshots" help="Keep a screenshot of each filled form and confirmation page." checked={v.screenshots} onCheckedChange={(c) => set({ screenshots: c })} />
        <SwitchRow label="Read application emails" help="Match new Gmail messages from application sites and companies to your applications (confirmation, rejection, interview)." checked={v.inboxScan} onCheckedChange={(c) => set({ inboxScan: c })} />
        <SwitchRow label="Check candidate portals daily" help="Open Workday 'My applications' pages and update statuses." checked={v.statusCheck} onCheckedChange={(c) => set({ statusCheck: c })} />
      </SectionCard>

      <SectionCard title="Sites" description="Where the agent may apply.">
        <div className="grid gap-2 sm:grid-cols-2">
          {PORTAL_SITES.map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={v.sites.includes(s)}
                onCheckedChange={(c) => set({ sites: c ? [...new Set([...v.sites, s])] : v.sites.filter((x) => x !== s) })}
              />
              {SITE_LABEL[s]}
            </label>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="LinkedIn Easy Apply" description="Applies to LinkedIn Easy Apply jobs in your own Chrome, where you are signed in. LinkedIn's rules forbid automation and fast applying can restrict the account, so it goes one job at a time with pauses.">
        <SwitchRow label="Apply with LinkedIn Easy Apply" help="Batches include LinkedIn jobs (turn on the LinkedIn source in Settings → Sources to find them). Runs in your Chrome, never the hidden browser." checked={v.linkedinEasyApply} onCheckedChange={(c) => set({ linkedinEasyApply: c })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="LinkedIn applications per day" htmlFor="portal-li-cap">
            <NumberInput id="portal-li-cap" integer min={1} max={60} value={v.linkedinDailyCap} onValueChange={(n) => set({ linkedinDailyCap: n })} />
          </Field>
          <Field label="Minutes between LinkedIn applications" htmlFor="portal-li-gap" help="A random gap between the two numbers, so the pace looks like a person.">
            <div className="flex items-center gap-2">
              <NumberInput id="portal-li-gap" min={0} max={120} value={v.linkedinGapMinutes} onValueChange={(n) => set({ linkedinGapMinutes: n })} aria-label="Minimum minutes" />
              <span className="text-xs text-muted-foreground">to</span>
              <NumberInput min={0} max={240} value={v.linkedinGapMaxMinutes} onValueChange={(n) => set({ linkedinGapMaxMinutes: n })} aria-label="Maximum minutes" />
            </div>
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Browser" description="Leave empty to use Google Chrome (or Playwright's Chromium).">
        <SwitchRow
          label="Use my Chrome"
          help='Open the agent&apos;s tabs in the Chrome window you already have open (your logins come along) instead of starting a separate apply browser. In Chrome, tick "Allow remote debugging" at chrome://inspect/#remote-debugging and allow the connection when Chrome asks.'
          checked={v.useMyChrome}
          onCheckedChange={(c) => set({ useMyChrome: c })}
        />
        <div className={`grid gap-4 sm:grid-cols-3 ${v.useMyChrome ? 'opacity-50' : ''}`}>
          <Field label="Chrome path" htmlFor="portal-path">
            <Input id="portal-path" value={v.browserPath} onChange={(e) => set({ browserPath: e.target.value })} placeholder="auto" className="font-mono text-xs" spellCheck={false} />
          </Field>
          <Field label="Profile folder" htmlFor="portal-profile" help="Logins, cookies and extensions live here.">
            <Input id="portal-profile" value={v.profileDir} onChange={(e) => set({ profileDir: e.target.value })} className="font-mono text-xs" spellCheck={false} />
          </Field>
          <Field label="DevTools port" htmlFor="portal-port">
            <NumberInput id="portal-port" integer min={1024} max={65535} value={v.debugPort} onValueChange={(n) => set({ debugPort: n })} />
          </Field>
        </div>
      </SectionCard>
      <SaveBar dirty={form.dirty} saving={form.saving} onSave={form.save} onDiscard={form.discard} error={form.saveError} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Answer bank
// ---------------------------------------------------------------------------

interface BankRow {
  id: string
  key: string
  question: string
  answer: string | null
  kind: string
  options: string[]
  source: string
  timesSeen: number
  lastCompany: string | null
  lastSeenAt: string
  createdAt: string
}

const WEEK_MS = 7 * 86_400_000
/** Answers the AI wrote on its own in the last week: the ones worth a look. */
function isRecentAi(r: BankRow, now: number): boolean {
  return r.source === 'ai' && now - new Date(r.createdAt).getTime() <= WEEK_MS
}

function AnswerRow({ row }: { row: BankRow }) {
  const [value, setValue] = useState(row.answer ?? '')
  const save = useApiMutation<{ answer: string | null }, BankRow>((v) => api.patch(`/api/answer-bank/${row.id}`, v), { invalidate: [['answer-bank'], ['browser']] })
  const del = useApiMutation<void, unknown>(() => api.delete(`/api/answer-bank/${row.id}`), { invalidate: [['answer-bank']] })
  const dirty = value !== (row.answer ?? '')
  const long = row.kind === 'textarea' || (row.answer?.length ?? 0) > 80
  return (
    <div className="flex flex-col gap-1.5 border-b py-2.5 last:border-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="min-w-0 text-sm font-medium wrap-break-word">{row.question}</p>
        <span className="text-[11px] text-muted-foreground">
          {row.answer === null ? <span className="font-medium text-danger-text">waiting for you</span> : row.answer === '' ? 'left blank' : row.source === 'ai' ? 'answered by AI, check it' : row.source}
          {row.timesSeen ? ` · asked ${row.timesSeen}×` : ''}
          {row.lastCompany ? ` · last: ${row.lastCompany}` : ''}
        </span>
      </div>
      {row.options.length ? (
        <div className="flex flex-wrap gap-1.5">
          {row.options.slice(0, 20).map((o, i) => (
            <Button key={`${i}-${o}`} type="button" size="xs" variant={value === o ? 'default' : 'outline'} className="h-auto min-h-6 max-w-full shrink py-1 text-left whitespace-normal" onClick={() => setValue(o)}>
              {o}
            </Button>
          ))}
        </div>
      ) : null}
      <div className="flex items-start gap-2">
        {long ? (
          <Textarea value={value} onChange={(e) => setValue(e.target.value)} className="min-h-16 text-sm" placeholder="Your answer" />
        ) : (
          <Input value={value} onChange={(e) => setValue(e.target.value)} className="h-8 text-sm" placeholder={row.answer === null ? 'Your answer' : ''} />
        )}
        <Button size="sm" variant={dirty ? 'default' : 'outline'} disabled={!dirty || save.isPending} onClick={() => save.mutate({ answer: value })} aria-label="Save answer">
          <Save />
        </Button>
        {!row.key.startsWith('std:') ? (
          <ConfirmButton size="sm" variant="ghost" title="Forget this question?" description="The agent asks the AI (or you) again next time it sees it." confirmLabel="Forget" onConfirm={() => del.mutateAsync()} aria-label="Forget">
            <Trash2 />
          </ConfirmButton>
        ) : null}
      </div>
    </div>
  )
}

export function AnswerBankCard() {
  const q = useApiQuery<{ standard: BankRow[]; questions: BankRow[]; waiting: BankRow[] }>(['answer-bank'], '/api/answer-bank')
  const [filter, setFilter] = useState('')
  const [view, setView] = useState<'all' | 'ai7'>('all')
  const [limit, setLimit] = useState(50)
  const [now] = useState(() => Date.now())
  const data = q.data?.data
  const match = (r: BankRow) => !filter || `${r.question} ${r.answer ?? ''}`.toLowerCase().includes(filter.toLowerCase())
  const recentAi = data ? data.questions.filter((r) => isRecentAi(r, now)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : []
  return (
    <SectionCard
      title="Your answers"
      description="What the agent puts in application forms. Your details come from your profile and CV; questions met on forms are saved here and reused everywhere. Answer the ones waiting for you."
    >
      {q.isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : data ? (
        <div className="flex flex-col gap-4">
          {data.waiting.length ? (
            <div className="rounded-lg border border-destructive/30 bg-danger-soft p-3">
              <p className="mb-1 text-sm font-medium">Waiting for you ({data.waiting.length})</p>
              {data.waiting.map((r) => (
                <AnswerRow key={`w-${r.id}-${r.answer ?? ''}`} row={r} />
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search answers" className="h-8 max-w-sm text-sm" />
            <div className="flex gap-1" role="group" aria-label="Which answers">
              <Button type="button" size="xs" variant={view === 'all' ? 'default' : 'outline'} onClick={() => setView('all')} aria-pressed={view === 'all'}>
                All
              </Button>
              <Button type="button" size="xs" variant={view === 'ai7' ? 'default' : 'outline'} onClick={() => setView('ai7')} aria-pressed={view === 'ai7'}>
                AI answers, last 7 days ({recentAi.length})
              </Button>
            </div>
          </div>
          {view === 'ai7' ? (
            <div>
              <p className="text-xs text-muted-foreground">Answers the AI wrote by itself this week and saved for every later form. Fix a wrong one here, or forget it so the question is asked again.</p>
              {recentAi.filter(match).length === 0 ? <p className="py-2 text-sm text-muted-foreground">None.</p> : null}
              {recentAi
                .filter(match)
                .slice(0, limit)
                .map((r) => (
                  <AnswerRow key={`ai-${r.id}-${r.answer ?? ''}`} row={r} />
                ))}
              {recentAi.filter(match).length > limit ? (
                <Button type="button" size="xs" variant="outline" className="mt-2" onClick={() => setLimit((n) => n + 50)}>
                  Show 50 more
                </Button>
              ) : null}
            </div>
          ) : (
          <>
          <details open>
            <summary className="cursor-pointer text-sm font-medium">Your details ({data.standard.length})</summary>
            <div className="mt-1">
              {data.standard.filter(match).map((r) => (
                <AnswerRow key={`${r.id}-${r.answer ?? ''}`} row={r} />
              ))}
            </div>
          </details>
          <details open={data.questions.length > 0 && data.questions.length <= 40}>
            <summary className="cursor-pointer text-sm font-medium">Questions from forms ({data.questions.length})</summary>
            <div className="mt-1">
              {data.questions.length === 0 ? <p className="py-2 text-sm text-muted-foreground">None yet. They appear as the agent fills forms.</p> : null}
              {data.questions.filter(match).map((r) => (
                <AnswerRow key={`${r.id}-${r.answer ?? ''}`} row={r} />
              ))}
            </div>
          </details>
          </>
          )}
        </div>
      ) : null}
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Site accounts (Workday)
// ---------------------------------------------------------------------------

interface AccountRow {
  id: string
  host: string
  email: string
  status: string
  statusUrl: string | null
  lastLoginAt: string | null
  lastError: string | null
  createdAt: string
}

function AccountItem({ a }: { a: AccountRow }) {
  const [password, setPassword] = useState<string | null>(null)
  const reveal = useApiMutation<void, { password: string }>(() => api.get(`/api/portal-accounts/${a.id}`), { silent: true, onSuccess: (d) => setPassword(d.password) })
  const del = useApiMutation<void, unknown>(() => api.delete(`/api/portal-accounts/${a.id}`), { invalidate: [['portal-accounts'], ['browser']] })
  return (
    <div className="flex flex-col gap-1 border-b py-2.5 text-sm last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{a.host}</span>
        <ToneBadge tone={a.status === 'active' ? 'success' : a.status === 'unverified' ? 'warning' : 'danger'}>{a.status}</ToneBadge>
      </div>
      <p className="text-xs text-muted-foreground">
        {a.email} · created {fmtAgo(a.createdAt)}
        {a.lastLoginAt ? ` · last sign-in ${fmtAgo(a.lastLoginAt)}` : ''}
        {a.lastError ? ` · ${a.lastError}` : ''}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="xs" variant="outline" onClick={() => (password ? setPassword(null) : reveal.mutate())} disabled={reveal.isPending}>
          {reveal.isPending ? <Loader2 className="animate-spin" /> : password ? <EyeOff /> : <Eye />} {password ? 'Hide password' : 'Show password'}
        </Button>
        {password ? <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs select-all">{password}</code> : null}
        {a.statusUrl ? (
          <a href={a.statusUrl} target="_blank" rel="noopener noreferrer" className="text-xs underline">
            My applications
          </a>
        ) : null}
        <ConfirmButton size="xs" variant="ghost" title={`Forget the login for ${a.host}?`} description="The agent will create a new account (or ask you) next time it applies there." confirmLabel="Forget" onConfirm={() => del.mutateAsync()}>
          <Trash2 /> Forget
        </ConfirmButton>
      </div>
    </div>
  )
}

export function PortalAccountsCard() {
  const q = useApiQuery<AccountRow[]>(['portal-accounts'], '/api/portal-accounts')
  const rows = q.data?.data ?? []
  return (
    <SectionCard title="Site accounts" description="Logins the agent created or uses (one per Workday company site). Passwords are stored encrypted.">
      {q.isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <KeyRound className="size-4" /> None yet.
        </p>
      ) : (
        rows.map((a) => <AccountItem key={a.id} a={a} />)
      )}
    </SectionCard>
  )
}
