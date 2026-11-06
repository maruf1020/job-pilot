'use client'

import Link from 'next/link'
import { MessageSquare } from 'lucide-react'
import { DataTable, type DataTableColumn, type DataTableFilter } from '@/components/data-table/data-table'
import { AppStatusBadge, ChannelBadge, ScoreBadge } from '@/components/shared/status-badge'
import { APPLICATION_STATUSES, APPLY_CHANNELS } from '@/lib/domain'
import { APP_STATUS_LABEL, flagEmoji, fmtAgo } from '@/lib/format'
import { channelLabel, whenLabel } from './helpers'
import type { ApplicationListRow } from './types'

const FILTERS: DataTableFilter[] = [
  { key: 'status', label: 'Status', type: 'select', options: APPLICATION_STATUSES.map((s) => ({ value: s, label: APP_STATUS_LABEL[s].label })) },
  { key: 'channel', label: 'Channel', type: 'select', options: APPLY_CHANNELS.map((c) => ({ value: c, label: channelLabel(c) })) },
  { key: 'country', label: 'Country', type: 'text', placeholder: 'e.g. DE' },
  { key: 'sentSince[gte]', label: 'Sent since', type: 'date' },
]

const COLUMNS: DataTableColumn<ApplicationListRow>[] = [
  { key: 'status', header: 'Status', sortKey: 'status', cell: (r) => <AppStatusBadge status={r.status} /> },
  {
    key: 'job',
    header: 'Job',
    className: 'max-w-[24rem]',
    cell: (r) => (
      <div className="min-w-0">
        <Link href={`/applications/${r.id}`} className="line-clamp-1 font-medium hover:underline">
          {r.job.title}
        </Link>
        <p className="truncate text-xs text-muted-foreground">
          <span className="mr-1">{flagEmoji(r.job.countryCode)}</span>
          {r.job.companyName}
        </p>
      </div>
    ),
  },
  { key: 'score', header: 'Score', sortKey: 'score', hideBelow: 'lg', cell: (r) => <ScoreBadge score={r.job.score?.finalScore} /> },
  { key: 'channel', header: 'Channel', hideBelow: 'lg', cell: (r) => <ChannelBadge channel={r.channel} /> },
  { key: 'when', header: 'When', sortKey: 'sentAt', hideBelow: 'md', cell: (r) => <span className="whitespace-nowrap text-xs">{whenLabel(r)}</span> },
  {
    key: 'activity',
    header: 'Activity',
    sortKey: 'lastActivityAt',
    cell: (r) => <span className="whitespace-nowrap text-xs text-muted-foreground">{fmtAgo(r.lastActivityAt)}</span>,
  },
  {
    key: 'messages',
    header: 'Msgs',
    hideBelow: 'xl',
    align: 'right',
    cell: (r) => (
      <span className="inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
        <MessageSquare className="size-3.5" />
        {r._count.messages}
      </span>
    ),
  },
]

function MobileCard({ row }: { row: ApplicationListRow }) {
  const draft = row.drafts[0]
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <AppStatusBadge status={row.status} />
        <ScoreBadge score={row.job.score?.finalScore} />
      </div>
      <p className="line-clamp-2 font-medium leading-snug">{row.job.title}</p>
      <p className="truncate text-xs text-muted-foreground">
        <span className="mr-1">{flagEmoji(row.job.countryCode)}</span>
        {row.job.companyName}
      </p>
      <p className="text-xs text-muted-foreground">
        {whenLabel(row)} · {fmtAgo(row.lastActivityAt)}
      </p>
      {draft ? <p className="truncate text-xs italic text-muted-foreground">{draft.subject}</p> : null}
    </div>
  )
}

export function ApplicationsTable({ extraParams, emptyTitle, emptyDescription }: { extraParams?: Record<string, string>; emptyTitle?: string; emptyDescription?: string } = {}) {
  return (
    <DataTable<ApplicationListRow>
      endpoint="/api/applications"
      queryKey="applications"
      columns={COLUMNS}
      filters={FILTERS}
      defaultSort="-lastActivityAt"
      rowHref={(r) => `/applications/${r.id}`}
      renderMobileCard={(r) => <MobileCard row={r} />}
      searchPlaceholder="Search title or company…"
      extraParams={extraParams}
      emptyTitle={emptyTitle ?? 'No applications yet'}
      emptyDescription={emptyDescription ?? 'Applications show up here once a job has been drafted.'}
    />
  )
}
