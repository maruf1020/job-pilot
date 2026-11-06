'use client'

import Link from 'next/link'
import { ArrowUpRight, BellRing, CalendarCheck, Check, Handshake, Hourglass } from 'lucide-react'
import { useHydrated } from '@/hooks/use-hydrated'
import { useApiQuery } from '@/lib/api/hooks'
import type { EarlierItem, OpportunitiesData, ProgressItem } from '@/lib/applications/opportunities'
import { flagEmoji, fmtAgo, fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { EmptyState, Metric, MetricGrid, PageHeader } from '@/components/shared/page-header'
import { ListRows, Section } from '@/components/shared/section'
import { SectionSkeleton } from '@/components/shared/skeletons'
import { AppStatusBadge, ReplyBadge, ToneBadge } from '@/components/shared/status-badge'
import { ReplyRow } from '@/components/inbox/reply-row'
import { SyncButton } from '@/components/inbox/sync-button'
import { ManualTodoCard } from './manual-todo-card'

/** The hiring steps as a row of pills: done, the one you are on, and what is still ahead. */
function Stages({ item }: { item: ProgressItem }) {
  if (!item.stages.length) return null
  return (
    <ol className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Hiring steps">
      {item.stages.map((s, i) => (
        <li
          key={`${s.name}-${i}`}
          title={[s.name, s.at ? fmtDate(s.at) : null, s.note].filter(Boolean).join('\n')}
          className={cn(
            'inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
            s.status === 'done' && 'bg-success-soft text-success-text',
            s.status === 'current' && 'bg-primary-soft text-primary-text ring-1 ring-primary/40',
            s.status === 'todo' && 'bg-muted text-muted-foreground',
          )}
        >
          {s.status === 'done' ? <Check className="size-3 shrink-0" aria-hidden /> : s.status === 'current' ? <Hourglass className="size-3 shrink-0" aria-hidden /> : null}
          <span className="truncate">{s.name}</span>
        </li>
      ))}
    </ol>
  )
}

function ProgressRow({ item }: { item: ProgressItem }) {
  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <Link href={`/applications/${item.applicationId}`} className="min-w-0 truncate text-sm font-semibold text-foreground hover:underline" title={`${item.company} · ${item.title}`}>
            {flagEmoji(item.countryCode)} {item.company}
            <span className="hidden font-normal text-muted-foreground sm:inline"> · {item.title}</span>
          </Link>
          <span className="ml-auto shrink-0 text-xs whitespace-nowrap text-muted-foreground">{fmtAgo(item.lastActivityAt)}</span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground sm:hidden">{item.title}</p>
        <Stages item={item} />
        {item.current?.note ? (
          <p className="mt-1.5 text-sm leading-relaxed text-foreground">
            <span className="font-medium">Now: {item.current.name}.</span> {item.current.note}
          </p>
        ) : item.current ? (
          <p className="mt-1.5 text-sm font-medium text-foreground">Now: {item.current.name}</p>
        ) : null}
        {item.lastReply ? (
          <p className="mt-1.5 flex min-w-0 items-start gap-2 text-xs text-muted-foreground">
            <span className="shrink-0">
              <ReplyBadge classification={item.lastReply.classification} />
            </span>
            <span className="min-w-0 line-clamp-2">
              {item.lastReply.summary} <span className="whitespace-nowrap">({fmtAgo(item.lastReply.receivedAt)})</span>
            </span>
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:max-w-[16rem] sm:justify-end">
        <AppStatusBadge status={item.status} />
        {item.quietDays != null ? (
          <ToneBadge tone={item.quietDays >= 7 ? 'warning' : 'muted'}>
            {item.quietDays === 0 ? 'You wrote today' : `Waiting ${item.quietDays} day${item.quietDays === 1 ? '' : 's'}`}
          </ToneBadge>
        ) : null}
        <Link href={`/applications/${item.applicationId}`} className={buttonVariants({ size: 'xs', variant: 'outline' })}>
          <ArrowUpRight /> Open
        </Link>
      </div>
    </li>
  )
}

/** What came after their interest, in a few words. */
const OUTCOME: Record<string, string> = {
  REJECTION: 'Said no afterwards',
  LOCATION_ISSUE: 'Location is the issue',
  APPLY_VIA_PORTAL: 'Asked you to apply on their site',
  WRONG_RECIPIENT: 'Sent you to another team',
}

function EarlierRow({ item }: { item: EarlierItem }) {
  return (
    <li className="flex flex-col gap-3 px-4 py-3 opacity-90 sm:flex-row sm:items-start sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <Link href={`/applications/${item.applicationId}`} className="min-w-0 truncate text-sm font-semibold text-foreground hover:underline" title={`${item.company} · ${item.title}`}>
            {flagEmoji(item.countryCode)} {item.company}
            <span className="hidden font-normal text-muted-foreground sm:inline"> · {item.title}</span>
          </Link>
          <span className="ml-auto shrink-0 text-xs whitespace-nowrap text-muted-foreground">{fmtAgo(item.interest.receivedAt)}</span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground sm:hidden">{item.title}</p>
        <p className="mt-1.5 flex min-w-0 items-start gap-2 text-xs text-muted-foreground">
          <span className="shrink-0">
            <ReplyBadge classification={item.interest.classification} />
          </span>
          <span className="min-w-0 line-clamp-2">{item.interest.summary}</span>
        </p>
        {item.outcome ? (
          <p className="mt-1.5 flex min-w-0 items-start gap-2 text-xs text-muted-foreground">
            <span className="shrink-0">
              <ReplyBadge classification={item.outcome.classification} />
            </span>
            <span className="min-w-0 line-clamp-2">
              {item.outcome.summary} <span className="whitespace-nowrap">({fmtAgo(item.outcome.receivedAt)})</span>
            </span>
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:max-w-[16rem] sm:justify-end">
        <ToneBadge tone={item.outcome?.classification === 'REJECTION' || item.status === 'REJECTED' ? 'muted' : 'warning'}>
          {item.outcome ? (OUTCOME[item.outcome.classification] ?? 'Changed since') : item.status === 'REJECTED' ? 'Rejected' : 'No answer needed now'}
        </ToneBadge>
        <Link href={`/applications/${item.applicationId}`} className={buttonVariants({ size: 'xs', variant: 'outline' })}>
          <ArrowUpRight /> Open
        </Link>
      </div>
    </li>
  )
}

/** Only the important ones: who wants you now, and every hiring process under way. */
export function OpportunitiesView() {
  const q = useApiQuery<OpportunitiesData>(['opportunities'], '/api/opportunities', { refetchInterval: 30_000 })
  const hydrated = useHydrated()
  const data = hydrated ? q.data?.data : undefined
  // Interviews and offers get their own list; the rest of the processes stay under In progress.
  const interviews = data?.inProgress.filter((p) => p.status === 'INTERVIEW' || p.status === 'OFFER') ?? []
  const otherProgress = data?.inProgress.filter((p) => p.status !== 'INTERVIEW' && p.status !== 'OFFER') ?? []
  const quiet = data?.inProgress.filter((p) => (p.quietDays ?? 0) >= 7).length ?? 0

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Opportunities"
        description="Who wants you and what is in progress. Answer the first list the same day; check the second for anyone who went quiet."
        meta={
          data ? (
            <span>
              {data.yourMove.length + data.inProgress.length + data.earlier.length} companies showed interest · {data.yourMove.length + data.inProgress.length} still open
              {quiet ? ` · ${quiet} quiet for a week or more (a polite nudge helps)` : ''}
            </span>
          ) : null
        }
        actions={<SyncButton showLast />}
      />
      {!data ? (
        q.isError ? <EmptyState title="Could not load opportunities" description={q.error.message} /> : <SectionSkeleton />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          {/* What only you can do: top right on wide screens, first on phones. */}
          <ManualTodoCard items={data.todo ?? []} className="lg:sticky lg:top-20 lg:order-2 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto" />
          <div className="flex min-w-0 flex-col gap-6 lg:order-1">
          <MetricGrid>
            <Metric label="Want you now" icon={<Handshake />} value={data.yourMove.length} hint={data.yourMove.length ? 'waiting for your answer' : 'all answered'} href="#want-you" />
            <Metric label="Interviews and offers" icon={<CalendarCheck />} value={interviews.length} hint="at interview or offer stage" href="#interviews" />
            <Metric label="In progress" icon={<Hourglass />} value={otherProgress.length} hint="other hiring steps under way" href="#in-progress" />
            <Metric label="Showed interest earlier" icon={<BellRing />} value={data.earlier.length} hint="closed or changed since" href="#earlier" />
          </MetricGrid>

          <Section
            id="want-you"
            className="scroll-mt-20"
            title="Who wants you"
            count={data.yourMove.length}
            description="Interview requests, interest and questions you have not answered yet, most important first."
            contentClassName="p-0"
          >
            {data.yourMove.length ? (
              <ListRows>
                {data.yourMove.map((it) => (
                  <ReplyRow key={it.messageId} it={it} kind="lead" />
                ))}
              </ListRows>
            ) : (
              <EmptyState compact icon={<Handshake />} title="Every company is answered" description="When someone asks for an interview, shows interest or asks for details, they show up here first." className="m-4" />
            )}
          </Section>

          <Section
            id="interviews"
            className="scroll-mt-20"
            title="Interviews and offers"
            count={interviews.length}
            description="Companies at the interview or offer stage: the step you are on, their last reply and how long they have been quiet. Offers come first."
            contentClassName="p-0"
          >
            {interviews.length ? (
              <ListRows>
                {interviews.map((p) => (
                  <ProgressRow key={p.applicationId} item={p} />
                ))}
              </ListRows>
            ) : (
              <EmptyState compact icon={<CalendarCheck />} title="No interviews yet" description="When a company invites you to an interview or a test, it shows up here." className="m-4" />
            )}
          </Section>

          <Section
            id="in-progress"
            className="scroll-mt-20"
            title="In progress"
            count={otherProgress.length}
            description="Other companies you are moving forward with (documents asked, review under way): the step you are on and how long they have been quiet."
            contentClassName="p-0"
          >
            {otherProgress.length ? (
              <ListRows>
                {otherProgress.map((p) => (
                  <ProgressRow key={p.applicationId} item={p} />
                ))}
              </ListRows>
            ) : (
              <EmptyState compact icon={<Hourglass />} title="Nothing else in progress" description="After you answer a company, it moves here so you can follow it through." className="m-4" />
            )}
          </Section>

          {data.earlier.length ? (
            <Section
              id="earlier"
              className="scroll-mt-20"
              title="Showed interest earlier"
              count={data.earlier.length}
              description="Companies that wrote back with interest, where something came after it: a no, a location problem or “apply on our site”. Kept so none of them is forgotten."
              contentClassName="p-0"
            >
              <ListRows>
                {data.earlier.map((e) => (
                  <EarlierRow key={e.applicationId} item={e} />
                ))}
              </ListRows>
            </Section>
          ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
