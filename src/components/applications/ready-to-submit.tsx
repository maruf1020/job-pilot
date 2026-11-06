'use client'

import Link from 'next/link'
import { CheckCheck, Eye, FileCheck2, ImageIcon, Send, SkipForward } from 'lucide-react'
import { api, useApiMutation, useApiQuery } from '@/lib/api/hooks'
import { flagEmoji, fmtAgo } from '@/lib/format'
import { Button, buttonVariants } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/page-header'
import { ListRows, Section } from '@/components/shared/section'
import { SectionSkeleton } from '@/components/shared/skeletons'
import { ConfirmButton } from '@/components/shared/confirm-button'
import { ScoreBadge, ToneBadge } from '@/components/shared/status-badge'

interface AttemptRow {
  id: string
  status: 'AWAITING_REVIEW' | 'NEEDS_HUMAN'
  mode: string
  atsType: string | null
  formUrl: string | null
  finalUrl: string | null
  tabId: string | null
  screenshots: string[]
  needsHumanReason: string | null
  questions: Array<{ label: string }> | null
  answers: number
  finishedAt: string | null
  startedAt: string
  application: { id: string; status: string; job: { id: string; title: string; companyName: string; countryCode: string | null; finalScore: number | null; url: string } }
}

const INVALIDATE: unknown[][] = [['portal-attempts'], ['applications'], ['jobs'], ['inbox']]

function Row({ a }: { a: AttemptRow }) {
  const act = useApiMutation<{ action: string; attemptId?: string }, unknown>((v) => api.post(`/api/applications/${a.application.id}/portal`, v), { invalidate: INVALIDATE })
  const skip = useApiMutation<void, unknown>(() => api.post(`/api/applications/${a.application.id}/actions`, { action: 'skip' }), { invalidate: INVALIDATE })
  const shot = a.screenshots.length ? `/api/portal-attempts/${a.id}/screenshot?n=${a.screenshots.length}` : null
  const review = a.status === 'AWAITING_REVIEW'
  return (
    <li className="flex gap-3 px-4 py-3">
      {shot ? (
        <a href={shot} target="_blank" rel="noopener noreferrer" className="hidden h-24 w-32 shrink-0 overflow-hidden rounded-md border bg-muted sm:block" title="Open the screenshot">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shot} alt="" className="h-full w-full object-cover object-top" loading="lazy" />
        </a>
      ) : (
        <div className="hidden h-24 w-32 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground sm:flex">
          <ImageIcon className="size-5" />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <ToneBadge tone={review ? 'accent' : 'warning'}>{review ? 'Filled, waiting for you' : 'Needs you'}</ToneBadge>
          <ScoreBadge score={a.application.job.finalScore} />
          <Link href={`/applications/${a.application.id}`} className="min-w-0 truncate text-sm font-medium hover:underline">
            {flagEmoji(a.application.job.countryCode)} {a.application.job.companyName} · {a.application.job.title}
          </Link>
          <span className="text-xs text-muted-foreground sm:ml-auto">
            {a.atsType ?? 'site'} · {fmtAgo(a.finishedAt ?? a.startedAt)}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {review ? `${a.answers} answers filled. Check them on the application page, then Submit.` : (a.needsHumanReason ?? 'The agent stopped and left the tab open.')}
        </p>
        <div className="flex flex-wrap gap-2">
          {review ? (
            <ConfirmButton size="xs" title={`Submit the application at ${a.application.job.companyName}?`} description="The agent presses Submit in the filled form (it fills it again the same way if the tab was closed)." confirmLabel="Submit" onConfirm={() => act.mutateAsync({ action: 'submit' }).catch(() => null)}>
              <Send /> Submit
            </ConfirmButton>
          ) : (
            <Button size="xs" variant="outline" onClick={() => act.mutate({ action: 'fill' })} disabled={act.isPending}>
              Try again
            </Button>
          )}
          <Button size="xs" variant="outline" onClick={() => act.mutate({ action: 'focus', attemptId: a.id })} disabled={act.isPending}>
            <Eye /> Show tab
          </Button>
          <Link href={`/applications/${a.application.id}`} className={buttonVariants({ size: 'xs', variant: 'outline' })}>
            Answers
          </Link>
          <ConfirmButton size="xs" variant="ghost" title="Did you submit it yourself?" confirmLabel="Yes" onConfirm={() => act.mutateAsync({ action: 'mark-submitted' }).catch(() => null)}>
            <CheckCheck /> I submitted it
          </ConfirmButton>
          <ConfirmButton size="xs" variant="ghost" title="Skip this job?" confirmLabel="Skip" onConfirm={() => skip.mutateAsync().catch(() => null)}>
            <SkipForward /> Skip
          </ConfirmButton>
        </div>
      </div>
    </li>
  )
}

/** Applications page: forms the browser agent filled (press Submit) or could not finish (needs you). */
export function ReadyToSubmit({ showEmpty = false }: { showEmpty?: boolean }) {
  const q = useApiQuery<AttemptRow[]>(['portal-attempts', 'waiting'], '/api/portal-attempts?status=AWAITING_REVIEW,NEEDS_HUMAN', { refetchInterval: 20_000 })
  const rows = q.data?.data ?? []
  if (q.isPending && showEmpty) return <SectionSkeleton />
  if (rows.length === 0 && !showEmpty) return null
  const ready = rows.filter((r) => r.status === 'AWAITING_REVIEW').length
  return (
    <Section
      id="ready"
      className="scroll-mt-20"
      title="Ready to submit"
      count={rows.length}
      description={`${ready} filled and waiting for your Submit${rows.length > ready ? `, ${rows.length - ready} need you` : ''}. Nothing is sent until you press Submit.`}
      contentClassName="p-0"
    >
      {rows.length ? (
        <ListRows>
          {rows.map((a) => (
            <Row key={a.id} a={a} />
          ))}
        </ListRows>
      ) : (
        <EmptyState compact icon={<FileCheck2 />} title="No forms waiting" description="Forms the browser agent fills in review mode, or cannot finish, show up here." className="m-4" />
      )}
    </Section>
  )
}
