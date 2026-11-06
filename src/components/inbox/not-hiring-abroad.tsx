'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Globe2, MapPinOff } from 'lucide-react'
import { useApiQuery } from '@/lib/api/hooks'
import type { NotHiringAbroad } from '@/lib/insights/not-hiring-abroad'
import { flagEmoji, fmtAgo, fmtDateTime } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/page-header'
import { ListRows, Section } from '@/components/shared/section'
import { SectionSkeleton } from '@/components/shared/skeletons'
import { ToneBadge } from '@/components/shared/status-badge'
import { DraftLocationReply } from './reply-row'

const PREVIEW = 25

export function useNotHiringAbroad() {
  return useApiQuery<NotHiringAbroad>(['inbox', 'not-hiring-abroad'], '/api/insights/not-hiring-abroad', { refetchInterval: 5 * 60_000 })
}

/** Reason labels that the employer said itself (the rest is only "outside your countries"). */
const tone = (label: string) => (label === 'Outside your target countries' ? ('muted' as const) : label === 'No sponsorship stated (outside Europe)' ? ('neutral' as const) : ('warning' as const))

/**
 * Inbox tab "Not hiring from abroad" (plan-ui-redesign.md 7.3): the replies that turned down only
 * the location (with the polite reply that asks about other roles), and the companies whose postings
 * rule out a candidate who needs a visa.
 */
export function NotHiringAbroadPanel() {
  const q = useNotHiringAbroad()
  const [all, setAll] = useState(false)
  if (q.isPending) return <SectionSkeleton />
  const d = q.data?.data
  if (!d) return <EmptyState compact title="Could not load this list" description={q.error?.message} />
  const companies = all ? d.companies : d.companies.slice(0, PREVIEW)
  return (
    <div className="flex flex-col gap-6">
      <Section
        title="They said location is the issue"
        count={d.replies.length}
        description="Not a no to your skills: they cannot hire or sponsor in your country for this role. A short reply asking about other roles or teams often opens a door; you review it before it goes out."
        contentClassName="p-0"
      >
        {d.replies.length ? (
          <ListRows>
            {d.replies.map((r) => (
              <li key={r.messageId} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <Link href={`/applications/${r.applicationId}`} className="min-w-0 truncate text-sm font-medium hover:underline" title={`${r.company} · ${r.title}`}>
                      {flagEmoji(r.countryCode)} {r.company}
                      <span className="hidden font-normal text-muted-foreground sm:inline"> · {r.title}</span>
                    </Link>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground" title={fmtDateTime(r.receivedAt)}>
                      {fmtAgo(r.receivedAt)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground sm:hidden">{r.title}</p>
                  <p className="mt-1.5 text-sm leading-relaxed">{r.sentence}</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
                  {r.replied ? <ToneBadge tone="muted">Answered</ToneBadge> : r.hasDraft ? <ToneBadge tone="info">Draft ready</ToneBadge> : <ToneBadge tone="warning">Your move</ToneBadge>}
                  <DraftLocationReply applicationId={r.applicationId} messageId={r.messageId} answered={r.replied} hasDraft={r.hasDraft} />
                </div>
              </li>
            ))}
          </ListRows>
        ) : (
          <EmptyState compact icon={<MapPinOff />} title="No location replies" description="Replies that turn down only your location or sponsorship show up here." className="m-4" />
        )}
      </Section>

      <Section
        title="Companies that do not take candidates from abroad"
        count={d.totals.companies}
        description={`${d.totals.jobs.toLocaleString()} postings were set aside because they ask for existing work rights, refuse sponsorship, or are in a country you did not switch on. Companies that said it themselves come first.`}
        contentClassName="p-0"
      >
        {d.companies.length ? (
          <>
            <ListRows>
              {companies.map((c) => (
                <li key={c.companyId} className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <Link href={`/companies/${c.companyId}`} className="block truncate text-sm font-medium hover:underline">
                      {c.company}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground" title={c.sampleTitles.join(' · ')}>
                      {c.sampleTitles.join(' · ')}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    {c.reasons.slice(0, 2).map((r) => (
                      <ToneBadge key={r.label} tone={tone(r.label)}>
                        {r.label}
                        {c.reasons.length > 1 ? ` · ${r.count}` : ''}
                      </ToneBadge>
                    ))}
                    <span className="w-24 text-right text-xs text-muted-foreground tabular-nums">
                      {c.jobs} {c.jobs === 1 ? 'posting' : 'postings'}
                    </span>
                    <span className="hidden w-20 text-right text-xs text-muted-foreground lg:inline" title={fmtDateTime(c.lastSeenAt)}>
                      {fmtAgo(c.lastSeenAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ListRows>
            {d.companies.length > PREVIEW ? (
              <div className="border-t px-4 py-2">
                <Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)}>
                  {all ? 'Show fewer' : `Show all ${d.companies.length}`}
                  {!all && d.totals.companies > d.companies.length ? ` (of ${d.totals.companies})` : ''}
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <EmptyState compact icon={<Globe2 />} title="No company ruled you out" description="Postings that ask for existing work rights or refuse sponsorship are listed here per company." className="m-4" />
        )}
      </Section>
    </div>
  )
}
