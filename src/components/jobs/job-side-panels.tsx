'use client'

import Link from 'next/link'
import { ArrowUpRight, ExternalLink, FileText } from 'lucide-react'
import { KeyValue } from '@/components/shared/page-header'
import { ListRow, ListRows, Section } from '@/components/shared/section'
import { AppStatusBadge, ChannelBadge, ToneBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import { SOURCE_LABELS, countryName, type SourceId } from '@/lib/domain'
import { flagEmoji, fmtAgo, fmtDate, fmtDateTime, titleCase } from '@/lib/format'
import { isAlreadyApplied, type JobActionMutation } from './job-actions'
import type { JobCompany, JobDetail, JobSourceLink } from './types'

/** The application for this job, or the way to start one. */
export function ApplicationPanel({ job, mutation }: { job: JobDetail; mutation: JobActionMutation }) {
  const app = job.application
  if (!app) {
    return (
      <Section title="Application" description="No application yet. A draft is a tailored email or cover letter you review before anything is sent.">
        <Button size="sm" variant="outline" className="w-full" disabled={mutation.isPending || isAlreadyApplied(job)} onClick={() => mutation.mutate({ action: 'draft' })}>
          <FileText className="size-3.5" /> Draft application
        </Button>
      </Section>
    )
  }
  const selected = app.drafts.find((d) => d.isSelected) ?? app.drafts.find((d) => d.kind === 'initial')
  return (
    <Section title="Application" actions={<AppStatusBadge status={app.status} />}>
      <div className="flex flex-col gap-3">
        <KeyValue
          columns={1}
          items={[
            { label: 'Channel', value: <ChannelBadge channel={app.channel} /> },
            ...(app.toEmail ? [{ label: 'To', value: <span title={app.toEmail}>{app.toEmail}</span> }] : []),
            app.sentAt ? { label: 'Sent', value: fmtDateTime(app.sentAt) } : app.scheduledFor ? { label: 'Scheduled', value: fmtDateTime(app.scheduledFor) } : { label: 'Sent', value: 'not yet' },
            { label: 'Last activity', value: <span title={fmtDateTime(app.lastActivityAt)}>{fmtAgo(app.lastActivityAt)}</span> },
            { label: 'Drafts / messages', value: <span className="tabular-nums">{`${app.drafts.length} / ${app.messages.length}`}</span> },
          ]}
        />
        {selected ? (
          <div className="rounded-md bg-muted p-2.5">
            <p className="text-[11px] font-medium text-muted-foreground">
              Selected draft · v{selected.version}
              {selected.passed ? ' · passed checks' : ''}
            </p>
            <p className="mt-0.5 line-clamp-2 text-sm font-medium text-foreground">{selected.subject}</p>
          </div>
        ) : null}
        <Button size="sm" variant="outline" className="w-full" nativeButton={false} render={<Link href={`/applications/${app.id}`} />}>
          Open application <ArrowUpRight className="size-3.5" />
        </Button>
      </div>
    </Section>
  )
}

/** Where this job was found; several listings of one role are merged into one job. */
export function SourcesPanel({ links }: { links: JobSourceLink[] }) {
  return (
    <Section title="Sources" count={links.length} contentClassName="p-0">
      {links.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">No source links recorded.</p>
      ) : (
        <ListRows>
          {links.map((l) => (
            <ListRow key={`${l.source}:${l.externalId}`} className="items-start">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">{SOURCE_LABELS[l.source as SourceId] ?? l.source}</p>
                <p className="text-xs text-muted-foreground">
                  First {fmtDate(l.firstSeenAt)} · last {fmtDate(l.lastSeenAt)}
                </p>
              </div>
              <a href={l.url} target="_blank" rel="noreferrer noopener" className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Open listing">
                <ExternalLink className="size-4" />
              </a>
            </ListRow>
          ))}
        </ListRows>
      )}
    </Section>
  )
}

/** The employer: sponsor status, its ATS board, careers page and application address. */
export function CompanyPanel({ company }: { company: JobCompany }) {
  return (
    <Section title={company.name} href={`/companies/${company.id}`} hrefLabel="Company">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          {company.knownSponsor ? <ToneBadge tone="success">Known sponsor</ToneBadge> : <ToneBadge tone="muted">Sponsor unknown</ToneBadge>}
          {company.blacklisted ? <ToneBadge tone="danger">Blacklisted</ToneBadge> : null}
        </div>
        <KeyValue
          columns={1}
          items={[
            { label: 'Country', value: company.countryCode ? `${flagEmoji(company.countryCode)} ${countryName(company.countryCode)}` : '-' },
            {
              label: 'ATS board',
              value: company.atsType ? (
                <span title={company.atsSlug ?? undefined}>
                  {titleCase(company.atsType)}
                  {company.lastFetchedAt ? <span className="font-normal text-muted-foreground"> · read {fmtAgo(company.lastFetchedAt)}</span> : null}
                </span>
              ) : (
                'none yet'
              ),
            },
            ...(company.contactEmail ? [{ label: 'Email', value: <span title={company.contactEmail}>{company.contactEmail}</span> }] : []),
          ]}
        />
        {company.lastFetchError ? <p className="rounded-md bg-danger-soft p-2 text-xs wrap-break-word text-danger-text">{company.lastFetchError}</p> : null}
        {company.domain || company.careersUrl ? (
          <div className="flex flex-wrap gap-2">
            {company.domain ? (
              <Button size="sm" variant="outline" nativeButton={false} render={<a href={`https://${company.domain}`} target="_blank" rel="noreferrer noopener" aria-label="Company website" />}>
                <ExternalLink className="size-3.5" /> Website
              </Button>
            ) : null}
            {company.careersUrl ? (
              <Button size="sm" variant="outline" nativeButton={false} render={<a href={company.careersUrl} target="_blank" rel="noreferrer noopener" aria-label="Careers page" />}>
                <ExternalLink className="size-3.5" /> Careers
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Section>
  )
}
