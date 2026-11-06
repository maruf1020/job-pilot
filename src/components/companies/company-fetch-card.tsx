'use client'

import { useState } from 'react'
import { DownloadCloud } from 'lucide-react'
import { KeyValue } from '@/components/shared/page-header'
import { Section } from '@/components/shared/section'
import { Button } from '@/components/ui/button'
import { api, useApiMutation } from '@/lib/api/hooks'
import { fmtAgo, fmtDateTime, fmtDuration, fmtNumber, titleCase } from '@/lib/format'
import type { CompanyBase, FetchBoardResult } from './types'

const BOARD_SOURCE: Record<string, string> = {
  'job-link': 'from a job link',
  register: 'from a sponsor register',
  probe: 'found by probing ATS sites',
  curated: 'curated list',
  manual: 'entered by hand',
}

/** The company's ATS board: which one, how it was found, when it was last read, and a manual read. */
export function CompanyFetchCard({ company }: { company: CompanyBase }) {
  const [last, setLast] = useState<FetchBoardResult | null>(null)
  const fetchBoard = useApiMutation<void, FetchBoardResult>(() => api.post(`/api/companies/${company.id}/fetch`), {
    invalidate: [['companies'], ['jobs']],
    onSuccess: (data) => setLast(data),
  })
  const configured = Boolean(company.atsType && company.atsSlug)

  return (
    <Section title="ATS board" description={configured ? undefined : 'No board yet. Set an ATS type and slug in the profile, or let the board finder look for one.'}>
      <div className="flex flex-col gap-3 text-sm">
        {configured ? (
          <KeyValue
            columns={1}
            items={[
              { label: 'System', value: titleCase(company.atsType!) },
              { label: 'Board', value: <span className="font-mono text-xs" title={company.atsSlug ?? undefined}>{company.atsSlug}</span> },
              { label: 'Found', value: company.boardSource ? (BOARD_SOURCE[company.boardSource] ?? company.boardSource) : 'before sources were recorded' },
              {
                label: 'Last read',
                value: <span title={company.lastFetchedAt ? fmtDateTime(company.lastFetchedAt) : undefined}>{company.lastFetchedAt ? fmtAgo(company.lastFetchedAt) : 'never'}</span>,
              },
            ]}
          />
        ) : company.boardCheckedAt ? (
          <p className="text-xs text-muted-foreground">Board finder last looked {fmtAgo(company.boardCheckedAt)} and found nothing.</p>
        ) : null}

        {company.lastFetchError ? (
          <div role="alert" className="rounded-md border border-destructive/30 bg-danger-soft p-2.5 text-xs text-danger-text">
            <p className="font-medium">Last read failed</p>
            <p className="mt-0.5 wrap-break-word">{company.lastFetchError}</p>
          </div>
        ) : null}

        {last ? (
          <p className="rounded-md bg-muted p-2.5 text-xs text-muted-foreground tabular-nums">
            {fmtNumber(last.fetched)} roles found · {fmtNumber(last.created)} new · {fmtNumber(last.updated)} updated · {fmtNumber(last.requests)} request{last.requests === 1 ? '' : 's'} · {fmtDuration(last.ms)}
          </p>
        ) : null}

        <Button size="sm" variant="outline" className="w-full" disabled={!configured || fetchBoard.isPending} onClick={() => fetchBoard.mutate()}>
          <DownloadCloud className="size-3.5" /> {fetchBoard.isPending ? 'Reading the board…' : 'Read the board now'}
        </Button>
      </div>
    </Section>
  )
}
