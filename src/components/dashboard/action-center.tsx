'use client'

import Link from 'next/link'
import { CalendarCheck, ListChecks, MailWarning, PenLine, Reply } from 'lucide-react'
import { fmtNumber } from '@/lib/format'
import { Metric, MetricGrid } from '@/components/shared/page-header'
import { MetricsSkeleton } from '@/components/shared/skeletons'

export interface DashboardActions {
  repliesWaiting: number
  interviewRequests: number
  oldestReplyDays: number
  quietThreads: number
  formsReady: number
  followUpsDue: number
  draftsToReview: number
  sendingEnabled: boolean
}

/** The first block of Today: what only you can move forward, each a link to where it is done. */
export function ActionCenter({ actions, queueTotal, pending }: { actions?: DashboardActions; queueTotal?: number; pending: boolean }) {
  if (pending || !actions) return <MetricsSkeleton count={4} />
  const a = actions
  const replyHint = a.repliesWaiting
    ? [a.interviewRequests ? `${a.interviewRequests} interview request${a.interviewRequests === 1 ? '' : 's'}` : null, a.oldestReplyDays ? `oldest ${a.oldestReplyDays} d` : 'arrived today'].filter(Boolean).join(' · ')
    : a.quietThreads
      ? `${a.quietThreads} quiet thread${a.quietThreads === 1 ? '' : 's'}`
      : 'All answered'
  const queue = queueTotal ?? a.formsReady
  return (
    <div className="flex flex-col gap-2">
      <MetricGrid>
        <Metric
          label="Replies to answer"
          value={fmtNumber(a.repliesWaiting)}
          hint={replyHint}
          tone={a.interviewRequests ? 'danger' : a.repliesWaiting ? 'warning' : 'default'}
          icon={<Reply />}
          href="/mail"
        />
        <Metric
          label="Forms waiting"
          value={fmtNumber(queue)}
          hint={queue ? 'CAPTCHAs, sign-ins, questions' : 'Nothing waiting'}
          tone={queue ? 'warning' : 'default'}
          icon={<ListChecks />}
          href="/queue"
        />
        <Metric
          label="Follow-ups due"
          value={fmtNumber(a.followUpsDue)}
          hint={a.followUpsDue ? 'A week without an answer' : 'None due'}
          tone={a.followUpsDue ? 'warning' : 'default'}
          icon={<CalendarCheck />}
          href="/applications?view=followups"
        />
        <Metric
          label="Drafts to review"
          value={fmtNumber(a.draftsToReview)}
          hint={a.draftsToReview ? 'Held by a check or a limit' : 'No drafts waiting'}
          tone={a.draftsToReview ? 'warning' : 'default'}
          icon={<PenLine />}
          href="/applications?view=drafts"
        />
      </MetricGrid>
      {!a.sendingEnabled ? (
        <Link href="/settings/email" className="inline-flex w-fit items-center gap-1.5 text-xs text-warning-text hover:underline">
          <MailWarning className="size-3.5" /> Email sending is paused in Settings → Email; queued emails wait.
        </Link>
      ) : null}
    </div>
  )
}
