'use client'

import { CalendarClock, Globe2, MessageSquareReply } from 'lucide-react'
import type { OngoingApplication } from '@/lib/applications/ongoing'
import type { NotHiringAbroad as NotHiringAbroadPayload } from '@/lib/insights/not-hiring-abroad'
import { useApiQuery } from '@/lib/api/hooks'
import { useSyncStatus } from '@/components/inbox/sync-button'
import { flagEmoji, fmtAgo, fmtNumber } from '@/lib/format'
import { EmptyState } from '@/components/shared/page-header'
import { ListRow, ListRows, Section } from '@/components/shared/section'
import { SectionSkeleton } from '@/components/shared/skeletons'
import { ReplyBadge, ToneBadge } from '@/components/shared/status-badge'

/** Today's sections on the Inbox and Applications APIs (plan-ui-redesign.md 7.1-7.3). */

/** 7.1: companies that offered a next step (interview, interest, a question), most urgent first. */
export function NextSteps() {
  const q = useSyncStatus()
  const ns = q.data?.data.nextSteps
  return (
    <Section
      title="Next steps from companies"
      count={ns ? ns.count : null}
      description={ns ? (ns.open ? `${ns.open} still wait for your answer` : 'Interview requests, interest and questions from companies') : undefined}
      href="/mail?tab=next-steps"
      contentClassName="p-0"
    >
      {q.isPending ? (
        <SectionSkeleton rows={3} className="border-0 shadow-none" />
      ) : q.isError ? (
        <p className="px-4 py-6 text-center text-sm text-danger-text">{q.error.message}</p>
      ) : !ns?.items.length ? (
        <EmptyState compact className="m-4" icon={<MessageSquareReply />} title="No next steps yet" description="Sync checks Gmail now; replies that offer an interview or ask for details show here." />
      ) : (
        <ListRows>
          {ns.items.slice(0, 6).map((it) => (
            <ListRow key={it.messageId} href={`/applications/${it.applicationId}`}>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate font-medium">
                    {flagEmoji(it.countryCode)} {it.company}
                  </span>
                  <ReplyBadge classification={it.classification} />
                  {it.answered ? <ToneBadge tone="muted">Answered</ToneBadge> : null}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {it.title}
                  {it.ask ? ` · ${it.ask}` : ''}
                </p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground" title={it.receivedAt}>
                {fmtAgo(it.receivedAt)}
              </span>
            </ListRow>
          ))}
        </ListRows>
      )}
    </Section>
  )
}

/** 7.2: applications in progress with their stage and the next thing to do. */
export function Ongoing() {
  const q = useApiQuery<OngoingApplication[]>(['applications', 'ongoing', 'top'], '/api/applications/ongoing?limit=5', { refetchInterval: 5 * 60_000 })
  const rows = q.data?.data
  return (
    <Section title="Ongoing applications" description="Companies you are in a process with" href="/applications?view=ongoing" contentClassName="p-0">
      {q.isPending ? (
        <SectionSkeleton rows={3} className="border-0 shadow-none" />
      ) : q.isError ? (
        <p className="px-4 py-6 text-center text-sm text-danger-text">{q.error.message}</p>
      ) : !rows?.length ? (
        <EmptyState compact className="m-4" icon={<CalendarClock />} title="Nothing in progress yet" description="Applications that got a reply, an interview or an offer appear here with their next step." />
      ) : (
        <ListRows>
          {rows.map((r) => (
            <ListRow key={r.applicationId} href={`/applications/${r.applicationId}`} className="flex-wrap gap-y-1.5 sm:flex-nowrap">
              <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                <p className="truncate font-medium">
                  {flagEmoji(r.countryCode)} {r.company}
                  <span className="font-normal text-muted-foreground"> · {r.title}</span>
                </p>
                <p className={r.nextAction.kind === 'waiting' ? 'truncate text-xs text-muted-foreground' : 'truncate text-xs font-medium text-warning-text'}>{r.nextAction.label}</p>
              </div>
              <ToneBadge tone="accent">{r.stage}</ToneBadge>
              <span className="shrink-0 text-xs text-muted-foreground">{fmtAgo(r.lastActivityAt)}</span>
            </ListRow>
          ))}
        </ListRows>
      )}
    </Section>
  )
}

/** 7.3 compact: companies that cannot hire from abroad (location replies and work-rights postings). */
export function NotHiringAbroad() {
  const q = useApiQuery<NotHiringAbroadPayload>(['insights', 'not-hiring-abroad'], '/api/insights/not-hiring-abroad', { refetchInterval: 10 * 60_000 })
  const d = q.data?.data
  const top = d ? [...d.companies].sort((a, b) => b.jobs - a.jobs).slice(0, 5) : []
  return (
    <Section title="Not hiring from abroad" description="Replies that turned down only your location, and companies whose postings ask for existing work rights" href="/mail?tab=not-hiring-abroad">
      {q.isPending ? (
        <div className="h-20 animate-pulse rounded-md bg-muted" />
      ) : q.isError ? (
        <p className="text-sm text-danger-text">{q.error.message}</p>
      ) : !d || (!d.totals.replies && !d.totals.companies) ? (
        <p className="text-sm text-muted-foreground">No location refusals so far.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>
              <span className="font-semibold tabular-nums">{fmtNumber(d.totals.replies)}</span> <span className="text-muted-foreground">location replies</span>
            </span>
            <span>
              <span className="font-semibold tabular-nums">{fmtNumber(d.totals.companies)}</span> <span className="text-muted-foreground">companies, {fmtNumber(d.totals.jobs)} postings</span>
            </span>
          </div>
          {top.length ? (
            <ul className="flex flex-col gap-1.5 text-sm">
              {top.map((c) => (
                <li key={c.companyId} className="flex min-w-0 items-center gap-2">
                  <Globe2 className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">{c.company}</span>
                  <span className="hidden min-w-0 truncate text-xs text-muted-foreground md:inline">{c.reason}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{fmtNumber(c.jobs)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </Section>
  )
}
