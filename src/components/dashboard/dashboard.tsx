'use client'

import { useSyncExternalStore } from 'react'
import Link from 'next/link'
import { Inbox, PlayCircle } from 'lucide-react'
import type { FunnelStep } from '@/lib/analytics/week-funnel'
import { useApiQuery } from '@/lib/api/hooks'
import { fmtAgo, fmtDateTime, fmtDuration, fmtIn, fmtNumber } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { EmptyState, PageHeader } from '@/components/shared/page-header'
import { ListRow, ListRows, Section } from '@/components/shared/section'
import { SectionSkeleton } from '@/components/shared/skeletons'
import { ReplyBadge, RunStatusBadge } from '@/components/shared/status-badge'
import { SyncButton } from '@/components/inbox/sync-button'
import { useNeedsYouQueue } from '@/components/queue/needs-you'
import { SubmittedOverview } from '@/components/stats/stats-page'
import { useStats } from '@/components/stats/stats-data'
import { ActionCenter, type DashboardActions } from './action-center'
import { ApplyEngine, TodaySampleSection } from './apply-engine'
import { EngineStrip } from './engine-strip'
import { NextSteps, NotHiringAbroad, Ongoing } from './insights'
import { Scoreboard } from './scoreboard'
import { WeekFunnel } from './week-funnel'

interface DashboardPayload {
  actions: DashboardActions
  recentReplies: Array<{ id: string; classification: string | null; subject: string; fromAddress: string; receivedAt: string | null; isRead: boolean; application: { id: string; job: { title: string; companyName: string } } }>
  lastRuns: Array<{ id: string; status: string; trigger: string; startedAt: string; durationMs: number | null; totalFetched: number; totalNew: number; totalRanked: number; totalDrafted: number; errorCount: number }>
  weekFunnel: { since: string; steps: FunnelStep[] } | null
}

interface StatusLite {
  running: { startedAt: string } | null
  lastRun: { startedAt: string } | null
  nextRunAt: string | null
}

const noSubscribe = () => () => {}

/** Today (/dashboard): what needs you now, what the engine did, how it is going (plan-ui-redesign.md 6, group A). */
export function Dashboard() {
  const { data, isPending, isError, error } = useApiQuery<DashboardPayload>(['dashboard'], '/api/dashboard', { refetchInterval: 30_000 })
  const status = useApiQuery<StatusLite>(['status'], '/api/status', { refetchInterval: 30_000 })
  const stats = useStats().data?.data
  const queueData = useNeedsYouQueue().data?.data.counts
  // Queue counts come from the shared cache before hydration ends; use them only after mount.
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false)
  const queueTotal = mounted ? queueData?.total : undefined
  const d = data?.data
  // The top bar loads the same status, so it can be cached before hydration ends: header text waits for mount.
  const st = mounted ? status.data?.data : undefined

  const waiting = d ? d.actions.repliesWaiting + (queueTotal ?? d.actions.formsReady) + d.actions.followUpsDue : 0
  const submittedToday = stats?.tiles.find((t) => t.key === 'today')?.now.total ?? null
  const submittedWeek = stats?.tiles.find((t) => t.key === 'week')?.now.total ?? null
  const summary = mounted && d
    ? [
        waiting ? `${fmtNumber(waiting)} thing${waiting === 1 ? '' : 's'} need you` : 'Nothing needs you',
        submittedToday !== null ? `${fmtNumber(submittedToday)} submitted today, ${fmtNumber(submittedWeek)} this week` : null,
      ]
        .filter(Boolean)
        .join('; ') + '.'
    : 'What needs you, what the engine did, and how it is going.'

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Today"
        description={summary}
        meta={
          st ? (
            <>
              <span>{st.running ? `Search running since ${fmtAgo(st.running.startedAt)}` : st.lastRun ? `Last search ${fmtAgo(st.lastRun.startedAt)}` : 'No search yet'}</span>
              {st.nextRunAt && !st.running ? <span>Next {fmtIn(st.nextRunAt)}</span> : null}
            </>
          ) : null
        }
        actions={
          <>
            <SyncButton showLast />
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/runs" />}>
              <PlayCircle /> Runs
            </Button>
          </>
        }
      />

      {isError ? (
        <Section>
          <p className="text-sm font-medium text-danger-text">Today failed to load</p>
          <p className="text-sm text-muted-foreground">{error.message}</p>
        </Section>
      ) : null}

      <ActionCenter actions={d?.actions} queueTotal={queueTotal} pending={isPending} />

      <EngineStrip />

      <SubmittedOverview />

      <div className="grid gap-6 xl:grid-cols-2">
        <NextSteps />
        <Ongoing />
      </div>

      <section aria-labelledby="apply-engine" className="flex flex-col gap-3">
        <h2 id="apply-engine" className="text-sm font-semibold text-foreground">
          Apply engine
        </h2>
        <ApplyEngine />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <WeekFunnel steps={isPending ? undefined : (d?.weekFunnel?.steps ?? null)} />
        <NotHiringAbroad />
      </div>

      <TodaySampleSection />

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Recent replies" href="/mail" contentClassName="p-0">
          {isPending ? (
            <SectionSkeleton rows={4} className="border-0 shadow-none" />
          ) : !d?.recentReplies.length ? (
            <EmptyState compact className="m-4" icon={<Inbox />} title="No replies yet" />
          ) : (
            <ListRows>
              {d.recentReplies.slice(0, 5).map((r) => (
                <ListRow key={r.id} href={`/applications/${r.application.id}`}>
                  <div className="min-w-0 flex-1">
                    <p className={r.isRead ? 'truncate' : 'truncate font-semibold'}>{r.subject || '(no subject)'}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.application.job.companyName} · {r.application.job.title}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <ReplyBadge classification={r.classification} />
                    <span className="text-xs text-muted-foreground">{fmtAgo(r.receivedAt)}</span>
                  </div>
                </ListRow>
              ))}
            </ListRows>
          )}
        </Section>
        <Section title="Last runs" href="/runs" contentClassName="p-0">
          {isPending ? (
            <SectionSkeleton rows={4} className="border-0 shadow-none" />
          ) : !d?.lastRuns.length ? (
            <EmptyState compact className="m-4" icon={<PlayCircle />} title="No runs yet" />
          ) : (
            <ListRows>
              {d.lastRuns.slice(0, 5).map((r) => (
                <ListRow key={r.id} href={`/runs/${r.id}`}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{fmtDateTime(r.startedAt)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {fmtNumber(r.totalNew)} new · {fmtNumber(r.totalRanked)} ranked · {fmtDuration(r.durationMs)}
                      {r.errorCount ? ` · ${r.errorCount} errors` : ''}
                    </p>
                  </div>
                  <RunStatusBadge status={r.status} />
                </ListRow>
              ))}
            </ListRows>
          )}
        </Section>
      </div>

      <Scoreboard />
    </div>
  )
}
