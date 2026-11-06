'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { AppWindow, CheckCheck, ExternalLink, Eye, ImageIcon, KeyRound, ListChecks, Loader2, LogIn, MessageCircleQuestion, MoreHorizontal, PauseCircle, PlayCircle, RotateCcw, Save, Send, ShieldAlert, SkipForward, Sparkles } from 'lucide-react'
import type { NeedsYouQueue, QueueAttempt, QueueQuestion, WallHost } from '@/lib/analytics/queue'
import { api, useApiMutation, useApiQuery } from '@/lib/api/hooks'
import { flagEmoji, fmtAgo, fmtDate, fmtNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmButton } from '@/components/shared/confirm-button'
import { Segmented } from '@/components/shared/filter-bar'
import { EmptyState, PageHeader } from '@/components/shared/page-header'
import { Section } from '@/components/shared/section'
import { SectionSkeleton } from '@/components/shared/skeletons'
import { ScoreBadge, ToneBadge } from '@/components/shared/status-badge'
import { DiagnosisNote, type Diagnosis } from '@/components/applications/diagnosis-note'

/** Dates arrive as ISO strings over the wire. */
type Wire<T> = {
  [K in keyof T]: T[K] extends Date | null ? string | null : T[K] extends Date ? string : T[K]
}
type Attempt = Wire<QueueAttempt>
type Wall = Wire<WallHost>
type Payload = Omit<NeedsYouQueue, 'captcha' | 'waiting' | 'walls'> & {
  captcha: Attempt[]
  waiting: Attempt[]
  walls: Wall[]
}

export const QUEUE_KEY = ['queue']
const INVALIDATE: unknown[][] = [QUEUE_KEY, ['portal-attempts'], ['applications'], ['jobs'], ['inbox'], ['answer-bank'], ['hosts'], ['dashboard']]

/** What only you can do; shared with the sidebar badge and Today. */
export function useNeedsYouQueue() {
  return useApiQuery<Payload>(QUEUE_KEY, '/api/queue', { refetchInterval: 20_000 })
}

type Tab = 'all' | 'captcha' | 'walls' | 'questions' | 'forms'

/** One action, as it appears in the phone sheet: a full-width row; risky ones ask for a second tap. */
interface RowAction {
  key: string
  label: string
  icon: ReactNode
  onRun: () => void
  confirm?: string
  href?: string
  disabled?: boolean
}

function SheetAction({ a, close }: { a: RowAction; close: () => void }) {
  const [armed, setArmed] = useState(false)
  const cls = 'flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50 [&_svg]:size-4 [&_svg]:text-muted-foreground'
  if (a.href)
    return (
      <a href={a.href} target="_blank" rel="noopener noreferrer" className={cls} onClick={close}>
        {a.icon} {a.label}
      </a>
    )
  return (
    <button
      type="button"
      disabled={a.disabled}
      className={cn(cls, armed && 'bg-warning-soft text-warning-text')}
      onClick={() => {
        if (a.confirm && !armed) return setArmed(true)
        a.onRun()
        close()
      }}
    >
      {a.icon} {armed ? a.confirm : a.label}
    </button>
  )
}

/** Phone: the row's actions in a bottom sheet. */
function ActionsSheet({ title, actions }: { title: string; actions: RowAction[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant="outline" className="h-9" aria-label={`Actions for ${title}`} onClick={() => setOpen(true)}>
        <MoreHorizontal /> Actions
      </Button>
      <Drawer open={open} onOpenChange={setOpen}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle className="truncate">{title}</DrawerTitle>
          <DrawerDescription>Choose what to do with this one.</DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col gap-0.5 px-2 pb-2">
          {actions.map((a) => (
            <SheetAction key={a.key} a={a} close={() => setOpen(false)} />
          ))}
        </div>
      </DrawerContent>
      </Drawer>
    </>
  )
}

function JobLine({ a }: { a: Attempt }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <ScoreBadge score={a.job.finalScore} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <Link href={`/applications/${a.applicationId}`} className="block truncate text-sm font-medium hover:underline">
          {flagEmoji(a.job.countryCode)} {a.job.companyName} <span className="font-normal text-muted-foreground">· {a.job.title}</span>
        </Link>
        <p className="truncate font-mono text-[11px] text-muted-foreground">
          {a.host || a.atsType || 'site'} · <span className="font-sans">{fmtAgo(a.finishedAt ?? a.startedAt)}</span>
        </p>
      </div>
    </div>
  )
}

const CLEAN_CHROME_HELP = 'Opens the form in a separate Chrome nothing controls (no automation bar). For Lever "error verifying your application" and Recruitee "Something went wrong": fill it there yourself, then press I submitted it.'
const OPEN_WITH_AI_HELP =
  'Opens the form in your Chrome. The AI fills everything and submits; where it needs you (a CAPTCHA, a sign-in, an answer) the page shows what to do and the AI carries on after you. The tab closes itself when the site confirms.'

/** One click: the form opens in your Chrome and the AI works through it with you. */
function OpenWithAi({ applicationId, size = 'xs', className, label = 'Open with AI', busy }: { applicationId: string; size?: 'xs' | 'sm'; className?: string; label?: string; busy?: boolean }) {
  const open = useApiMutation<void, unknown>(() => api.post(`/api/applications/${applicationId}/portal`, { action: 'submit' }), {
    invalidate: INVALIDATE,
    successMessage: 'Opening in your Chrome: the AI fills it; follow the panel on the page for anything it needs from you',
  })
  return (
    <Button size={size} className={className} onClick={() => open.mutate()} disabled={open.isPending || busy} title={OPEN_WITH_AI_HELP}>
      {open.isPending || busy ? <Loader2 className="animate-spin" /> : <Sparkles />} {busy ? 'Opening...' : label}
    </Button>
  )
}

/** One stopped form with the existing per-application actions (fill again, show tab, I submitted it, skip). */
function AttemptRow({ a, captcha }: { a: Attempt; captcha?: boolean }) {
  const act = useApiMutation<{ action: string; attemptId?: string }, unknown>((v) => api.post(`/api/applications/${a.applicationId}/portal`, v), { invalidate: INVALIDATE })
  const skip = useApiMutation<void, unknown>(() => api.post(`/api/applications/${a.applicationId}/actions`, { action: 'skip' }), { invalidate: INVALIDATE })
  const review = a.status === 'AWAITING_REVIEW'
  const shot = a.screenshots ? `/api/portal-attempts/${a.attemptId}/screenshot?n=${a.screenshots}` : null
  const fillTitle = captcha ? 'Opens the form in your Chrome and fills it; you solve the CAPTCHA and press Submit' : 'The agent fills the form again in your Chrome and stops before Submit'

  const sheet: RowAction[] = [
    review
      ? { key: 'submit', label: 'Submit', icon: <Send />, confirm: 'Tap again to submit', onRun: () => act.mutate({ action: 'submit' }), disabled: act.isPending }
      : { key: 'fill', label: 'Fill only (no Submit)', icon: <RotateCcw />, onRun: () => act.mutate({ action: 'fill' }), disabled: act.isPending },
    ...(a.hasTab ? [{ key: 'focus', label: 'Show tab', icon: <Eye />, onRun: () => act.mutate({ action: 'focus', attemptId: a.attemptId }), disabled: act.isPending }] : []),
    ...(shot ? [{ key: 'shot', label: 'Screenshot', icon: <ImageIcon />, href: shot, onRun: () => undefined }] : []),
    { key: 'clean', label: 'Open in clean Chrome', icon: <AppWindow />, onRun: () => act.mutate({ action: 'open-clean' }), disabled: act.isPending },
    { key: 'done', label: 'I submitted it', icon: <CheckCheck />, confirm: 'Tap again: you submitted it', onRun: () => act.mutate({ action: 'mark-submitted' }) },
    { key: 'skip', label: 'Skip this job', icon: <SkipForward />, confirm: 'Tap again to skip', onRun: () => skip.mutate() },
  ]

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <JobLine a={a} />
      {a.opening ? (
        <p className="text-xs font-medium break-words text-primary">
          {a.opening === 'RUNNING' ? 'Open in your Chrome now: the AI is filling it. Follow the panel on the page.' : 'Waiting to open in your Chrome (one form opens there at a time).'}
        </p>
      ) : null}
      <p className="text-xs break-words text-muted-foreground">{review ? 'Filled and waiting for your check before Submit.' : (a.reason ?? 'The agent stopped and left the form for you.')}</p>
      {review ? null : <DiagnosisNote d={a.diagnosis as Diagnosis | null} compact />}
      {/* Phone: the main action and a sheet with the rest. */}
      <div className="flex gap-2 sm:hidden">
        {review ? null : <OpenWithAi applicationId={a.applicationId} size="sm" className="h-9 flex-1" busy={!!a.opening} />}
        <ActionsSheet title={`${a.job.companyName} · ${a.job.title}`} actions={sheet} />
      </div>
      <div className="hidden flex-wrap gap-1.5 sm:flex">
        {review ? (
          <ConfirmButton size="xs" title={`Submit the application at ${a.job.companyName}?`} description="The agent presses Submit in the filled form (it fills it again the same way if the tab was closed)." confirmLabel="Submit" onConfirm={() => act.mutateAsync({ action: 'submit' }).catch(() => null)}>
            <Send /> Submit
          </ConfirmButton>
        ) : (
          <>
            <OpenWithAi applicationId={a.applicationId} busy={!!a.opening} />
            <Button size="xs" variant="outline" onClick={() => act.mutate({ action: 'fill' })} disabled={act.isPending || !!a.opening} title={fillTitle}>
              <RotateCcw /> Fill only
            </Button>
          </>
        )}
        {a.hasTab ? (
          <Button size="xs" variant="outline" onClick={() => act.mutate({ action: 'focus', attemptId: a.attemptId })} disabled={act.isPending}>
            <Eye /> Show tab
          </Button>
        ) : null}
        {shot ? (
          <Button size="xs" variant="outline" nativeButton={false} render={<a href={shot} target="_blank" rel="noopener noreferrer" />}>
            <ImageIcon /> Screenshot
          </Button>
        ) : null}
        <Button size="xs" variant="outline" onClick={() => act.mutate({ action: 'open-clean' })} disabled={act.isPending} title={CLEAN_CHROME_HELP}>
          <AppWindow /> Clean Chrome
        </Button>
        <ConfirmButton size="xs" variant="ghost" title="Did you submit it yourself?" confirmLabel="Yes" onConfirm={() => act.mutateAsync({ action: 'mark-submitted' }).catch(() => null)}>
          <CheckCheck /> I submitted it
        </ConfirmButton>
        <ConfirmButton size="xs" variant="ghost" title="Skip this job?" confirmLabel="Skip" onConfirm={() => skip.mutateAsync().catch(() => null)}>
          <SkipForward /> Skip
        </ConfirmButton>
      </div>
    </li>
  )
}

function WallRow({ w }: { w: Wall }) {
  const hostAct = useApiMutation<{ action: string }, unknown>(
    (v) => api.post('/api/hosts', { host: w.host, kind: w.kind === 'needs-account' || w.kind === 'sign-in-wall' ? w.kind : undefined, ...v }),
    { invalidate: INVALIDATE },
  )
  const skipped = !!w.skipUntil && new Date(w.skipUntil) > new Date()
  const site = `https://${w.host}`
  // "Open site" opens the first waiting job in your Chrome with the AI and its chat panel: you sign in there
  // and the AI fills and submits the rest (a bare link gave no panel).
  const first = w.examples[0]
  const openFirst = useApiMutation<void, unknown>(() => api.post(`/api/applications/${first!.applicationId}/portal`, { action: 'submit' }), {
    invalidate: INVALIDATE,
    successMessage: 'Opening in your Chrome: sign in there, then the AI fills and submits the rest',
  })
  const sheet: RowAction[] = [
    first
      ? { key: 'open', label: 'Open site with AI', icon: <Sparkles />, onRun: () => openFirst.mutate(), disabled: openFirst.isPending }
      : { key: 'open', label: 'Open site', icon: <ExternalLink />, href: site, onRun: () => undefined },
    { key: 'login', label: w.loggedIn ? 'Not signed in after all' : 'I signed in', icon: <LogIn />, onRun: () => hostAct.mutate({ action: w.loggedIn ? 'logged-out' : 'logged-in' }), disabled: hostAct.isPending },
    skipped
      ? { key: 'clear', label: 'Clear skip', icon: <PlayCircle />, onRun: () => hostAct.mutate({ action: 'clear-skip' }), disabled: hostAct.isPending }
      : { key: 'skip', label: 'Skip host for a week', icon: <PauseCircle />, onRun: () => hostAct.mutate({ action: 'skip-week' }), disabled: hostAct.isPending },
  ]
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="min-w-0 font-mono text-sm font-medium break-all">{w.host}</span>
        <ToneBadge tone={w.kind === 'needs-account' ? 'warning' : 'info'}>{w.kind === 'needs-account' ? 'Needs an account' : 'Sign-in'}</ToneBadge>
        {w.loggedIn ? <ToneBadge tone="success">You signed in</ToneBadge> : null}
        {skipped ? <ToneBadge tone="muted">Skipped until {fmtDate(w.skipUntil)}</ToneBadge> : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {fmtNumber(w.waiting)} waiting{w.attempts ? ` · ${fmtNumber(w.attempts)} tries · ${fmtNumber(w.submitted)} submitted` : ''}
      </p>
      {w.examples.length ? (
        <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {w.examples.map((e) => (
            <li key={e.applicationId} className="flex min-w-0 items-center gap-2">
              <Link href={`/applications/${e.applicationId}`} className="min-w-0 truncate hover:text-foreground hover:underline">
                {e.companyName} · {e.title}
              </Link>
              <OpenWithAi applicationId={e.applicationId} label="Open with AI (you sign in)" className="shrink-0" />
            </li>
          ))}
        </ul>
      ) : null}
      {w.lastReason ? <p className="text-xs break-words text-muted-foreground">{w.lastReason}</p> : null}
      <div className="flex gap-2 sm:hidden">
        <Button size="sm" variant="outline" className="h-9 flex-1" onClick={() => hostAct.mutate({ action: w.loggedIn ? 'logged-out' : 'logged-in' })} disabled={hostAct.isPending}>
          <LogIn /> {w.loggedIn ? 'Signed in' : 'I signed in'}
        </Button>
        <ActionsSheet title={w.host} actions={sheet} />
      </div>
      <div className="hidden flex-wrap gap-1.5 sm:flex">
        {first ? (
          <OpenWithAi applicationId={first.applicationId} label="Open site with AI" />
        ) : (
          <Button size="xs" variant="outline" nativeButton={false} render={<a href={site} target="_blank" rel="noopener noreferrer" />}>
            <ExternalLink /> Open site
          </Button>
        )}
        <Button size="xs" variant={w.loggedIn ? 'ghost' : 'outline'} onClick={() => hostAct.mutate({ action: w.loggedIn ? 'logged-out' : 'logged-in' })} disabled={hostAct.isPending}>
          <LogIn /> {w.loggedIn ? 'Not signed in after all' : 'I signed in'}
        </Button>
        {skipped ? (
          <Button size="xs" variant="ghost" onClick={() => hostAct.mutate({ action: 'clear-skip' })} disabled={hostAct.isPending}>
            <PlayCircle /> Clear skip
          </Button>
        ) : (
          <Button size="xs" variant="ghost" onClick={() => hostAct.mutate({ action: 'skip-week' })} disabled={hostAct.isPending}>
            <PauseCircle /> Skip a week
          </Button>
        )}
      </div>
    </li>
  )
}

function QuestionRow({ q }: { q: QueueQuestion }) {
  const [value, setValue] = useState('')
  const save = useApiMutation<{ answer: string }, unknown>((v) => api.patch(`/api/answer-bank/${q.id}`, v), { invalidate: INVALIDATE, successMessage: 'Saved; every form that asks it uses this answer' })
  const long = q.kind === 'textarea'
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <p className="text-sm font-medium break-words">{q.question}</p>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {q.timesSeen ? `asked ${q.timesSeen}×` : 'needed'}
          {q.lastCompany ? ` · last: ${q.lastCompany}` : ''}
        </span>
      </div>
      {q.options.length ? (
        <div className="flex flex-wrap gap-1.5">
          {q.options.slice(0, 20).map((o, i) => (
            <Button key={`${i}-${o}`} type="button" size="xs" variant={value === o ? 'default' : 'outline'} onClick={() => setValue(o)}>
              {o}
            </Button>
          ))}
        </div>
      ) : null}
      <div className="flex items-start gap-2">
        {long ? (
          <Textarea value={value} onChange={(e) => setValue(e.target.value)} className="min-h-16 text-sm" placeholder="Your answer" aria-label={q.question} />
        ) : (
          <Input value={value} onChange={(e) => setValue(e.target.value)} className="h-9 text-sm sm:h-8" placeholder="Your answer" aria-label={q.question} />
        )}
        <Button size="sm" className="h-9 sm:h-8" disabled={!value.trim() || save.isPending} onClick={() => save.mutate({ answer: value })}>
          <Save /> Save
        </Button>
      </div>
    </li>
  )
}

function Group({ id, icon, title, count, description, children }: { id: string; icon: ReactNode; title: string; count: number; description: string; children: ReactNode }) {
  return (
    <Section
      id={id}
      className="scroll-mt-20"
      title={
        <span className="inline-flex items-center gap-2 [&_svg]:size-4 [&_svg]:text-muted-foreground">
          {icon} {title}
        </span>
      }
      count={count}
      description={description}
      contentClassName="p-0"
    >
      {count === 0 ? <p className="px-4 py-4 text-sm text-muted-foreground">Nothing here.</p> : <ul className="divide-y">{children}</ul>}
    </Section>
  )
}

/** /queue: everything only you can do, grouped so it can be cleared in one sitting. */
export function NeedsYouView() {
  const q = useNeedsYouQueue()
  const d = q.data?.data
  const [tab, setTab] = useState<Tab>('all')
  const show = (t: Tab) => tab === 'all' || tab === t
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Needs you"
        description={d ? (d.counts.total ? `${fmtNumber(d.counts.total)} things only you can do: CAPTCHAs, sign-ins, questions and forms to finish.` : 'Nothing waits for you.') : 'CAPTCHAs, sign-ins, questions and forms only you can finish.'}
        actions={
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/hosts" />}>
            <ListChecks /> Hosts
          </Button>
        }
      >
        {d && d.counts.total ? (
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: 'all', label: 'All', count: d.counts.total },
              { value: 'captcha', label: 'CAPTCHA', count: d.counts.captcha },
              { value: 'walls', label: 'Sign-in & accounts', count: d.counts.walls },
              { value: 'questions', label: 'Questions', count: d.counts.questions },
              { value: 'forms', label: 'Forms to finish', count: d.counts.waiting },
            ]}
          />
        ) : null}
      </PageHeader>

      {q.isError ? (
        <Section>
          <p className="text-sm text-danger-text">{q.error.message}</p>
        </Section>
      ) : q.isPending || !d ? (
        <div className="flex flex-col gap-6">
          <SectionSkeleton rows={3} />
          <SectionSkeleton rows={2} />
        </div>
      ) : d.counts.total === 0 ? (
        <EmptyState icon={<CheckCheck />} title="Nothing waits for you" description="New CAPTCHA forms, sign-in walls and questions appear here as the agents meet them." />
      ) : (
        <>
          {show('captcha') ? (
            <Group id="captcha" icon={<ShieldAlert />} title="CAPTCHA forms" count={d.captcha.length} description="Stopped at a CAPTCHA (the AI never solves them). Open with AI opens the form in your Chrome and fills it; you solve the CAPTCHA and the AI submits by itself. The panel on the page says what is left.">
              {d.captcha.map((a) => (
                <AttemptRow key={a.attemptId} a={a} captcha />
              ))}
            </Group>
          ) : null}
          {show('walls') ? (
            <Group id="walls" icon={<KeyRound />} title="Sign-in and account walls" count={d.walls.length} description="Open with AI on a job below: when the site asks you to sign in, do it in that tab and the AI carries on (it never types passwords). Or sign in once and press I signed in so batches try again.">
              {d.walls.map((w) => (
                <WallRow key={w.host} w={w} />
              ))}
            </Group>
          ) : null}
          {show('questions') ? (
            <Group id="questions" icon={<MessageCircleQuestion />} title="Questions only you can answer" count={d.questions.length} description="Required questions the agent could not answer truthfully from your profile. Answer once; every form that asks it uses your answer.">
              {d.questions.map((qq) => (
                <QuestionRow key={qq.id} q={qq} />
              ))}
            </Group>
          ) : null}
          {show('forms') ? (
            <Group id="forms" icon={<ListChecks />} title="Forms to finish" count={d.waiting.length} description="Filled for your check, or stopped for another reason (shown on each).">
              {d.waiting.map((a) => (
                <AttemptRow key={a.attemptId} a={a} />
              ))}
            </Group>
          ) : null}
        </>
      )}
    </div>
  )
}
