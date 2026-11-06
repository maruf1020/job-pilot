'use client'

import { ListRow, ListRows, Section } from '@/components/shared/section'
import { JobStatusBadge, ScoreBadge } from '@/components/shared/status-badge'
import { countryName } from '@/lib/domain'
import { flagEmoji, fmtAgo, fmtDate } from '@/lib/format'
import type { CompanyJobRow } from './types'

/** The company's latest jobs with their scores; the full list opens in Jobs filtered to this company. */
export function CompanyJobsCard({ companyId, jobs, total }: { companyId: string; jobs: CompanyJobRow[]; total: number }) {
  const allHref = `/jobs?view=all&filter[companyId]=${encodeURIComponent(companyId)}`
  return (
    <Section
      title="Jobs"
      count={total}
      description={jobs.length < total ? `The latest ${jobs.length} of ${total}` : undefined}
      href={total > jobs.length ? allHref : undefined}
      hrefLabel="All in Jobs"
      contentClassName="p-0"
    >
      {jobs.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">No jobs recorded for this company yet.</p>
      ) : (
        <ListRows>
          {jobs.map((j) => (
            <ListRow key={j.id} href={`/jobs/${j.id}`}>
              <ScoreBadge score={j.score?.finalScore} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{j.title}</p>
                <p className="text-xs text-muted-foreground">
                  <span title={countryName(j.countryCode)}>
                    {flagEmoji(j.countryCode)} {j.countryCode ?? '-'}
                  </span>{' '}
                  · <span title={fmtDate(j.firstSeenAt)}>seen {fmtAgo(j.firstSeenAt)}</span>
                </p>
              </div>
              <div className="shrink-0">
                <JobStatusBadge status={j.status} />
              </div>
            </ListRow>
          ))}
        </ListRows>
      )}
    </Section>
  )
}

