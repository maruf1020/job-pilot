'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ArrowLeft, CheckCheck, ChevronDown, ExternalLink, Send, SkipForward, Undo2 } from 'lucide-react'
import { api, useApiMutation, useApiQuery } from '@/lib/api/hooks'
import { countryName } from '@/lib/domain'
import { flagEmoji, fmtAgo, fmtDateTime, fmtIn, fmtSalary, titleCase } from '@/lib/format'
import type { LintResult } from '@/lib/pipeline/humanize/lint'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmButton } from '@/components/shared/confirm-button'
import { EmptyState, KeyValue, PageHeader } from '@/components/shared/page-header'
import { Section } from '@/components/shared/section'
import { Timeline, type TimelineItem } from '@/components/shared/timeline'
import { AppStatusBadge, ChannelBadge, ScoreBadge, SponsorshipBadge, ToneBadge } from '@/components/shared/status-badge'
import { MarkAppliedDialog, RegenerateDialog } from './action-dialogs'
import { AnswersCard, CoverLetterCard } from './answers-panel'
import { BrowserApplyCard } from './browser-apply-card'
import { ConversationsCard } from './conversations-card'
import { ReplyComposer } from './reply-composer'
import { DraftEditor } from './draft-editor'
import { DraftVersions, FollowUpDrafts } from './draft-versions'
import { FindingsPanel } from './findings-panel'
import { HiringCard } from './hiring-card'
import { isSentLike, nextStepFor, statusLabel } from './helpers'
import { Thread } from './thread'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { CooldownBanner, useCooldownConfirm } from '@/components/shared/cooldown-warning'
import { ANSWER_FIELDS, type ActionResult, type ActionVars, type ApplicationDetail as ApplicationDetailData, type DraftDetail, type PatchVars } from './types'

const INVALIDATE: unknown[][] = [['applications'], ['inbox'], ['dashboard'], ['jobs']]
const REVIEWABLE: readonly string[] = ['DRAFT', 'REVIEW', 'NEEDS_HUMAN']

function BackLink() {
  return (
    <Link href="/applications" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" /> Applications
    </Link>
  )
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-4 w-28" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-7 w-3/4 max-w-lg" />
        <Skeleton className="h-4 w-56" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Skeleton className="h-112 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      </div>
    </div>
  )
}

export function ApplicationDetail({ id }: { id: string }) {
  const query = useApiQuery<ApplicationDetailData>(['applications', id], `/api/applications/${id}`)

  if (query.isPending) return <DetailSkeleton />
  if (query.isError) {
    const notFound = query.error.status === 404
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <EmptyState
          title={notFound ? 'Application not found' : 'Could not load application'}
          description={notFound ? 'It may have been deleted, or the link is wrong.' : query.error.message}
          action={
            notFound ? (
              <Link href="/applications" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                Back to applications
              </Link>
            ) : (
              <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
                Retry
              </Button>
            )
          }
        />
      </div>
    )
  }
  // Keyed by id so local editor state resets when navigating between applications.
  return <LoadedDetail key={query.data.data.id} app={query.data.data} />
}

interface EditorState {
  draftId: string | null
  subject: string
  body: string
}

function initialEditor(app: ApplicationDetailData): EditorState {
  const initial = app.drafts.filter((d) => d.kind === 'initial')
  const pick = initial.find((d) => d.isSelected) ?? initial[0]
  return pick ? { draftId: pick.id, subject: pick.subject, body: pick.body } : { draftId: null, subject: '', body: '' }
}

function LoadedDetail({ app }: { app: ApplicationDetailData }) {
  const isEmail = app.channel === 'email'
  const sent = isSentLike(app)
  const initialDrafts = app.drafts.filter((d) => d.kind === 'initial')
  const followUps = app.drafts.filter((d) => d.kind === 'follow_up')

  const [editor, setEditor] = useState<EditorState>(() => initialEditor(app))
  const [checkResult, setCheckResult] = useState<LintResult | null>(null)
  const [busyDraftId, setBusyDraftId] = useState<string | null>(null)
  const [toEmail, setToEmail] = useState(app.toEmail ?? '')
  const [notes, setNotes] = useState(app.notes ?? '')

  const editorDraft = initialDrafts.find((d) => d.id === editor.draftId) ?? null
  const editorDirty = editorDraft ? editor.subject !== editorDraft.subject || editor.body !== editorDraft.body : editor.subject.length > 0 || editor.body.length > 0

  const patch = useApiMutation<PatchVars, ApplicationDetailData>((vars) => api.patch<ApplicationDetailData>(`/api/applications/${app.id}`, vars), {
    invalidate: INVALIDATE,
    successMessage: 'Saved',
  })

  const act = useApiMutation<ActionVars, ActionResult>((vars) => api.post<ActionResult>(`/api/applications/${app.id}/actions`, vars), {
    invalidate: INVALIDATE,
    successMessage: (data, env) => {
      if (data?.scheduledFor) return `Queued for ${fmtDateTime(data.scheduledFor)}`
      if (data?.selected) return 'Version selected'
      if (data?.status) return `Now: ${statusLabel(data.status)}`
      return env.message
    },
  })

  const check = useApiMutation<ActionVars, LintResult>((vars) => api.post<LintResult>(`/api/applications/${app.id}/actions`, vars), {
    successMessage: (d) => (d.passed ? 'No blocking issues' : `${d.errors.length} blocking issue${d.errors.length === 1 ? '' : 's'}`),
    onSuccess: (d) => setCheckResult(d),
  })

  const save = useApiMutation<ActionVars, { draft: DraftDetail; lint: LintResult }>((vars) => api.post<{ draft: DraftDetail; lint: LintResult }>(`/api/applications/${app.id}/actions`, vars), {
    invalidate: INVALIDATE,
    successMessage: (d) => `Saved v${d.draft.version}`,
    onSuccess: (d) => {
      setEditor({ draftId: d.draft.id, subject: d.draft.subject, body: d.draft.body })
      setCheckResult(null)
    },
  })

  /** Errors are already toasted by useApiMutation; swallow the rejection so dialogs can close. */
  const run = (vars: ActionVars) => act.mutateAsync(vars).catch(() => null)
  const cooldownGuard = useCooldownConfirm(app.cooldown)

  const loadDraft = (d: DraftDetail) => {
    setEditor({ draftId: d.id, subject: d.subject, body: d.body })
    setCheckResult(null)
  }
  const selectDraft = async (d: DraftDetail) => {
    setBusyDraftId(d.id)
    try {
      const r = await run({ action: 'select-draft', draftId: d.id })
      if (r) loadDraft(d)
    } finally {
      setBusyDraftId(null)
    }
  }

  const info: string[] = []
  if (app.scheduledFor && !app.sentAt) info.push(`Queued for ${fmtDateTime(app.scheduledFor)} (${fmtIn(app.scheduledFor)})`)
  if (app.sentAt) info.push(`Sent ${fmtDateTime(app.sentAt)}`)
  if (app.repliedAt) info.push(`Replied ${fmtDateTime(app.repliedAt)}`)
  if (info.length === 0) info.push(`Created ${fmtAgo(app.createdAt)}`)
  info.push(`Last activity ${fmtAgo(app.lastActivityAt)}`)

  const findingsLint = checkResult ?? editorDraft?.lintResult ?? null
  const findingsJudge = checkResult ? null : (editorDraft?.judgeResult ?? null)
  const findingsExternal = checkResult ? null : (editorDraft?.externalAiScore ?? null)
  const findingsDescription = checkResult ? 'Result of the last Check on the editor text (not saved).' : editorDraft ? `Stored findings for v${editorDraft.version}.` : 'Run Check to lint what you wrote.'

  const markApplied = !isEmail && !sent ? <MarkAppliedDialog onConfirm={async (note) => cooldownGuard.guard((ignoreCooldown) => void run({ action: 'mark-applied', note: note || undefined, ignoreCooldown }))} /> : null

  const actions = (
    <div className="flex flex-wrap gap-2">
      {cooldownGuard.dialog}
      {isEmail && REVIEWABLE.includes(app.status) ? (
        <Button size="sm" onClick={() => cooldownGuard.guard((ignoreCooldown) => act.mutate({ action: 'approve', ignoreCooldown }))} disabled={act.isPending}>
          <CheckCheck /> Approve &amp; queue
        </Button>
      ) : null}
      {isEmail && !sent && app.status !== 'SKIPPED' ? (
        <ConfirmButton
          size="sm"
          variant={REVIEWABLE.includes(app.status) ? 'outline' : 'default'}
          title="Send this application now?"
          description={`Sends ${editorDraft ? `v${editorDraft.version}` : 'the selected draft'} to ${app.toEmail ?? 'the recipient'} immediately, outside the usual send window.${editorDirty ? ' Unsaved edits in the editor are not included.' : ''}`}
          confirmLabel="Send now"
          onConfirm={() => cooldownGuard.guard((ignoreCooldown) => void run({ action: 'send-now', draftId: editorDraft?.id, ignoreCooldown }))}
        >
          <Send /> Send now
        </ConfirmButton>
      ) : null}
      {app.status === 'QUEUED' ? (
        <Button size="sm" variant="outline" onClick={() => act.mutate({ action: 'unqueue' })} disabled={act.isPending}>
          <Undo2 /> Unqueue
        </Button>
      ) : null}
      {!sent ? <RegenerateDialog onConfirm={(note) => run({ action: 'regenerate', note: note || undefined })} /> : null}
      {markApplied}
      {!sent && app.status !== 'SKIPPED' ? (
        <ConfirmButton
          size="sm"
          variant="ghost"
          title="Skip this job?"
          description="Marks the application and the job as skipped. You can still regenerate later if you change your mind."
          confirmLabel="Skip"
          onConfirm={() => run({ action: 'skip' })}
        >
          <SkipForward /> Skip
        </ConfirmButton>
      ) : null}
    </div>
  )

  const answersKey = ANSWER_FIELDS.map((f) => String(app.answers?.[f.key] ?? '')).join('|')

  const timeline: Array<{ label: string; at: string | null; hint?: string }> = [
    { label: 'Created', at: app.createdAt },
    { label: 'Scheduled', at: app.scheduledFor },
    { label: 'Sent', at: app.sentAt },
    { label: 'Follow-up due', at: app.followUpDueAt, hint: app.followUpDueAt && !app.followUpSentAt ? fmtIn(app.followUpDueAt) : undefined },
    { label: 'Follow-up sent', at: app.followUpSentAt },
    { label: 'Replied', at: app.repliedAt },
  ]

  const job = app.job
  const score = job.score

  // The draft (email) or cover letter and answers (forms): first before sending, folded away after.
  const workSection = isEmail ? (
    <>
      <Card id="draft" className="scroll-mt-20">
        <CardHeader>
          <CardTitle>Draft</CardTitle>
          <CardDescription>
            {editorDraft
              ? `Editing v${editorDraft.version} · ${editorDraft.generatedBy ?? 'unknown'}${editorDraft.isSelected ? ' · selected for sending' : ''}`
              : 'No version loaded. Write one and save it.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DraftEditor
            subject={editor.subject}
            body={editor.body}
            onSubjectChange={(v) => setEditor((s) => ({ ...s, subject: v }))}
            onBodyChange={(v) => setEditor((s) => ({ ...s, body: v }))}
            onCheck={() => check.mutate({ action: 'lint', subject: editor.subject, body: editor.body })}
            onSave={() => save.mutate({ action: 'save-draft', subject: editor.subject, body: editor.body })}
            checking={check.isPending}
            saving={save.isPending}
            dirty={editorDirty}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card size="sm">
          <CardHeader>
            <CardTitle>Versions</CardTitle>
            <CardDescription>Newest first. &ldquo;Use this&rdquo; picks the version that gets sent.</CardDescription>
          </CardHeader>
          <CardContent>
            <DraftVersions drafts={initialDrafts} editorDraftId={editor.draftId} onLoad={loadDraft} onUse={(d) => void selectDraft(d)} busyDraftId={busyDraftId} />
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>Findings</CardTitle>
            <CardDescription>{findingsDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <FindingsPanel lint={findingsLint} judge={findingsJudge} externalAiScore={findingsExternal} />
          </CardContent>
        </Card>
      </div>

      <FollowUpDrafts drafts={followUps} />
    </>
  ) : (
    <>
      <CoverLetterCard key={app.coverLetter ?? ''} value={app.coverLetter} onSave={(text) => patch.mutateAsync({ coverLetter: text }).catch(() => null)} saving={patch.isPending} />
      <AnswersCard
        key={answersKey}
        answers={app.answers}
        jobUrl={job.url}
        onSave={(answers) => patch.mutateAsync({ answers }).catch(() => null)}
        saving={patch.isPending}
        markApplied={markApplied}
      />
    </>
  )

  // Applying on their website still makes sense after an email, until it has been done there.
  const appliedOnSite = app.portalStatus === 'SUBMITTED' || app.submittedVia === 'agent' || app.submittedVia === 'manual'
  const askedForSite = app.messages.some((m) => m.direction === 'INBOUND' && (m.classification === 'APPLY_VIA_PORTAL' || m.classification === 'WRONG_RECIPIENT'))
  const showBrowserApply = !sent || !isEmail || askedForSite || Boolean(app.portalStatus)

  // Answering their reply, applying on their site, and the conversation so far.
  const followThrough = (
    <>
    <ReplyComposer app={app} />

    {showBrowserApply ? (
      <div id="browser-apply" className="scroll-mt-20">
        <BrowserApplyCard applicationId={app.id} appliedOnSite={appliedOnSite} cooldown={app.cooldown} />
      </div>
    ) : null}

    <Card>
      <CardHeader>
        <CardTitle>Thread</CardTitle>
        <CardDescription>
          {app.messages.length} message{app.messages.length === 1 ? '' : 's'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Thread messages={app.messages} />
      </CardContent>
    </Card>

    <ConversationsCard applicationId={app.id} company={app.job.companyName} conversations={app.conversations ?? []} invalidate={INVALIDATE} />
    </>
  )

  const next = nextStepFor(app)
  const activity: TimelineItem[] = (app.events ?? []).map((e) => ({
    id: e.id,
    title: e.message,
    time: fmtDateTime(e.createdAt),
    tone: e.type === 'submitted' || e.type === 'confirmation' ? 'success' : e.type === 'needs_human' ? 'warning' : 'muted',
  }))

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={
          <span>
            <span className="mr-1">{flagEmoji(job.countryCode)}</span>
            {job.companyName}
            {job.countryCode ? ` · ${countryName(job.countryCode)}` : ''}
            {job.location ? ` · ${job.location}` : ''}
            {job.remote ? ' · Remote' : ''}
          </span>
        }
        title={
          <Link href={`/jobs/${job.id}`} className="hover:underline">
            {job.title}
          </Link>
        }
        meta={
          <>
            <span className="flex flex-wrap items-center gap-1.5">
              <AppStatusBadge status={app.status} />
              <ChannelBadge channel={app.channel} />
              <ScoreBadge score={score?.finalScore} />
            </span>
            <span>{info.join(' · ')}</span>
          </>
        }
        actions={actions}
      />
      <CooldownBanner cooldown={app.cooldown} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Main column: what to do next comes first. Before sending that is the draft; after it, the reply and the thread. */}
        <div className="flex min-w-0 flex-col gap-6">
          <NextStepCard next={next} />

          {/* Recipient: editable until it is sent */}
          {sent || !isEmail ? null : (
            <form
              className="flex flex-col gap-1.5 sm:max-w-lg"
              onSubmit={(e) => {
                e.preventDefault()
                patch.mutate({ toEmail: toEmail.trim() ? toEmail.trim() : null })
              }}
            >
              <Label htmlFor="to-email">To</Label>
              <div className="flex gap-2">
                <Input id="to-email" type="email" value={toEmail} onChange={(e) => setToEmail(e.target.value)} placeholder="recruiter@company.com" />
                <Button type="submit" variant="outline" disabled={patch.isPending || toEmail.trim() === (app.toEmail ?? '')}>
                  Save
                </Button>
              </div>
            </form>
          )}

          {sent ? (
            <>
              {followThrough}
              <Collapsible>
                <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-lg border bg-card px-4 py-3 text-left text-sm font-medium shadow-[var(--shadow-card)] hover:bg-accent">
                  <span>
                    {isEmail ? 'The email you sent, its versions and checks' : 'Cover letter and answers'}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">for reference</span>
                  </span>
                  <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[panel-open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-4 flex flex-col gap-4">{workSection}</CollapsibleContent>
              </Collapsible>
            </>
          ) : (
            <>
              {workSection}
              {followThrough}
            </>
          )}
        </div>

        {/* Side column: facts and history */}
        <aside className="flex min-w-0 flex-col gap-6">
          <Section title="Job">
            <div className="flex flex-col gap-3 text-sm">
              <div className="flex flex-wrap items-center gap-1.5">
                <ScoreBadge score={score?.finalScore} />
                <SponsorshipBadge level={job.sponsorship} />
                {job.company.knownSponsor ? <ToneBadge tone="success">Known sponsor</ToneBadge> : null}
                {job.company.blacklisted ? <ToneBadge tone="danger">Blacklisted</ToneBadge> : null}
              </div>
              {score?.hook ? <p className="rounded-md bg-muted px-2.5 py-2 text-xs italic">&ldquo;{score.hook}&rdquo;</p> : null}
              {job.mustHaveSkills.length > 0 ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Must-have skills</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {job.mustHaveSkills.map((s) => (
                      <Badge key={s} variant="outline">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
              <KeyValue
                columns={1}
                items={[
                  { label: 'Salary', value: fmtSalary(job.salaryMin, job.salaryMax, job.currency) },
                  { label: 'Seniority', value: job.seniority ? titleCase(job.seniority) : '—' },
                  { label: 'Contact', value: <span title={job.contactEmail ?? undefined}>{job.contactEmail ?? '—'}</span> },
                ]}
              />
              <div className="flex flex-wrap gap-2">
                <Link href={`/jobs/${job.id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  Job details
                </Link>
                <a href={job.url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                  <ExternalLink /> Posting
                </a>
              </div>
            </div>
          </Section>

          <HiringCard hiring={app.hiring} />

          <Section title="Key dates">
            <KeyValue
              columns={1}
              items={timeline.map((t) => ({
                label: t.label,
                value: t.at ? (
                  <span title={t.hint}>
                    {fmtDateTime(t.at)}
                    {t.hint ? <span className="font-normal text-muted-foreground"> · {t.hint}</span> : null}
                  </span>
                ) : (
                  <span className="font-normal text-muted-foreground">—</span>
                ),
              }))}
            />
          </Section>

          {activity.length ? (
            <Section title="Activity" count={activity.length}>
              <Timeline items={activity} />
            </Section>
          ) : null}

          <Section title="Notes">
            <div className="flex flex-col gap-2">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="min-h-24 text-sm"
                maxLength={5000}
                placeholder="Anything worth remembering about this application."
                aria-label="Notes"
              />
              <Button size="sm" variant="outline" className="self-end" disabled={patch.isPending || notes === (app.notes ?? '')} onClick={() => patch.mutate({ notes: notes.trim() ? notes : null })}>
                Save notes
              </Button>
            </div>
          </Section>
        </aside>
      </div>
    </div>
  )
}

const NEXT_BORDER: Record<string, string> = {
  warning: 'border-l-warning',
  info: 'border-l-info',
  success: 'border-l-success',
  danger: 'border-l-destructive',
  accent: 'border-l-primary',
  neutral: 'border-l-border-strong',
  muted: 'border-l-border-strong',
}

/** What to do now, in one line, with a jump to the block that does it. */
function NextStepCard({ next }: { next: ReturnType<typeof nextStepFor> }) {
  return (
    <section aria-label="Next action" className={cn('flex flex-col gap-3 rounded-lg border border-l-4 bg-card p-4 shadow-[var(--shadow-card)] sm:flex-row sm:items-center', NEXT_BORDER[next.tone])}>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-muted-foreground">Next action</p>
        <p className="mt-0.5 text-sm font-semibold text-foreground">{next.title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{next.description}</p>
      </div>
      {next.anchor ? (
        <a href={`#${next.anchor}`} className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'w-fit shrink-0')}>
          Go there
        </a>
      ) : null}
    </section>
  )
}
