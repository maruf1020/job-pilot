'use client'

import Link from 'next/link'
import { AlertTriangle, ArrowLeft, SearchX } from 'lucide-react'
import { CooldownBanner } from '@/components/shared/cooldown-warning'
import { EmptyState, PageHeader } from '@/components/shared/page-header'
import { SectionSkeleton } from '@/components/shared/skeletons'
import { AppStatusBadge, ChannelBadge, JobStatusBadge, SponsorshipBadge, ToneBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useApiQuery } from '@/lib/api/hooks'
import { countryName } from '@/lib/domain'
import { flagEmoji, fmtAgo, fmtDate, titleCase } from '@/lib/format'
import { JobActions, useJobActionMutation } from './job-actions'
import { JobDescriptionCard } from './job-description-card'
import { JobDetailsCard } from './job-details-card'
import { JobScoreCard, SponsorshipCard } from './job-score-card'
import { ApplicationPanel, CompanyPanel, SourcesPanel } from './job-side-panels'
import type { JobDetail as JobDetailData } from './types'

function JobDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-16" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-6">
          <SectionSkeleton rows={6} />
          <SectionSkeleton rows={4} />
        </div>
        <div className="flex flex-col gap-6">
          <SectionSkeleton rows={3} />
          <SectionSkeleton rows={3} />
        </div>
      </div>
    </div>
  )
}

function JobMeta({ job }: { job: JobDetailData }) {
  const where = job.location ?? (job.countryCode ? countryName(job.countryCode) : null)
  return (
    <>
      <Link href={`/companies/${job.companyId}`} className="font-medium text-foreground hover:underline">
        {job.companyName}
      </Link>
      {where ? (
        <span>
          {flagEmoji(job.countryCode)} {where}
        </span>
      ) : null}
      <span title={job.postedAt ? fmtDate(job.postedAt) : undefined}>{job.postedAt ? `Posted ${fmtAgo(job.postedAt)}` : 'Posting date unknown'}</span>
      <span title={fmtDate(job.firstSeenAt)}>First seen {fmtAgo(job.firstSeenAt)}</span>
    </>
  )
}

export function JobDetailView({ id }: { id: string }) {
  const query = useApiQuery<JobDetailData>(['jobs', id], `/api/jobs/${id}`)
  const mutation = useJobActionMutation(id)

  if (query.isPending) return <JobDetailSkeleton />
  if (query.isError) {
    const notFound = query.error.status === 404
    return (
      <EmptyState
        icon={<SearchX />}
        title={notFound ? 'Job not found' : 'Could not load this job'}
        description={notFound ? 'It may have been removed, or the link is wrong.' : query.error.message}
        action={
          notFound ? (
            <Button variant="outline" nativeButton={false} render={<Link href="/jobs" />}>
              <ArrowLeft className="size-4" /> Back to jobs
            </Button>
          ) : (
            <Button variant="outline" onClick={() => void query.refetch()}>
              Retry
            </Button>
          )
        }
      />
    )
  }

  const job = query.data.data
  return (
    // Bottom padding on phones keeps the content clear of the sticky action bar.
    <div className="flex flex-col gap-6 pb-16 md:pb-0">
      {/* Five actions do not fit beside a long title, so they get their own row under it. */}
      <PageHeader title={job.title} meta={<JobMeta job={job} />}>
        <div className="flex flex-wrap gap-1.5">
          <JobStatusBadge status={job.status} />
          {job.application ? <AppStatusBadge status={job.application.status} /> : null}
          <SponsorshipBadge level={job.sponsorship} />
          <ChannelBadge channel={job.applyChannel} />
          {job.remote ? <ToneBadge tone="info">Remote</ToneBadge> : null}
          {job.seniority && job.seniority !== 'unknown' ? <ToneBadge tone="neutral">{titleCase(job.seniority)}</ToneBadge> : null}
        </div>
        {job.filterReason ? (
          <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning-text">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              <span className="font-medium">Filtered out:</span> {job.filterReason}
            </span>
          </p>
        ) : null}
        <CooldownBanner cooldown={job.cooldown} />
        <JobActions job={job} mutation={mutation} />
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <JobScoreCard score={job.score} />
          <SponsorshipCard job={job} />
          <JobDetailsCard job={job} />
          <JobDescriptionCard description={job.description} />
        </div>
        <aside className="flex min-w-0 flex-col gap-6">
          <ApplicationPanel job={job} mutation={mutation} />
          <CompanyPanel company={job.company} />
          <SourcesPanel links={job.sourceLinks} />
        </aside>
      </div>
    </div>
  )
}
