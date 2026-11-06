'use client'

import Link from 'next/link'
import { DataTable, type DataTableColumn, type DataTableFilter } from '@/components/data-table/data-table'
import { ReplyBadge } from '@/components/shared/status-badge'
import { REPLY_CLASSIFICATIONS } from '@/lib/domain'
import { fmtAgo, REPLY_LABEL } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ReplyTypeMenu } from './reply-type-menu'

/** Row shape of GET /api/inbox (EmailMessage + application summary). */
export interface InboxRow {
  id: string
  applicationId: string
  direction: string
  provider: string
  providerMessageId: string
  threadId: string | null
  fromAddress: string
  toAddress: string
  subject: string
  bodyText: string
  sentAt: string | null
  receivedAt: string | null
  classification: string | null
  classificationMeta: { summary?: string } | null
  isRead: boolean
  createdAt: string
  application: {
    id: string
    status: string
    job: { id: string; title: string; companyName: string }
  }
}

function snippet(text: string, max = 120): string {
  const s = text.replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max).trimEnd()}…` : s
}

const FILTERS: DataTableFilter[] = [
  { key: 'classification', label: 'Classification', type: 'select', options: REPLY_CLASSIFICATIONS.map((c) => ({ value: c, label: REPLY_LABEL[c].label })) },
  { key: 'isRead', label: 'Read', type: 'boolean' },
  { key: 'since[gte]', label: 'Since', type: 'date' },
]

const COLUMNS: DataTableColumn<InboxRow>[] = [
  { key: 'classification', header: 'Type', sortKey: 'classification', cell: (r) => (r.direction === 'INBOUND' ? <ReplyTypeMenu messageId={r.id} classification={r.classification} /> : <ReplyBadge classification={r.classification} />) },
  {
    key: 'from',
    header: 'From',
    className: 'max-w-[14rem]',
    cell: (r) => <span className={cn('block truncate text-sm', !r.isRead && 'font-semibold')}>{r.fromAddress}</span>,
  },
  {
    key: 'subject',
    header: 'Subject',
    className: 'max-w-[30rem]',
    cell: (r) => (
      <div className="min-w-0">
        <p className={cn('truncate', !r.isRead && 'font-semibold')}>{r.subject || '(no subject)'}</p>
        <p className="truncate text-xs text-muted-foreground">{snippet(r.bodyText)}</p>
      </div>
    ),
  },
  {
    key: 'application',
    header: 'Application',
    hideBelow: 'lg',
    className: 'max-w-[16rem]',
    cell: (r) => (
      <Link href={`/applications/${r.application.id}`} className="block min-w-0 hover:underline">
        <span className="block truncate text-sm">{r.application.job.title}</span>
        <span className="block truncate text-xs text-muted-foreground">{r.application.job.companyName}</span>
      </Link>
    ),
  },
  {
    key: 'received',
    header: 'Received',
    sortKey: 'receivedAt',
    cell: (r) => <span className="whitespace-nowrap text-xs text-muted-foreground">{fmtAgo(r.receivedAt ?? r.createdAt)}</span>,
  },
]

function MobileCard({ row }: { row: InboxRow }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <ReplyBadge classification={row.classification} />
        <span className="text-xs text-muted-foreground">{fmtAgo(row.receivedAt ?? row.createdAt)}</span>
      </div>
      <p className={cn('truncate text-sm', !row.isRead && 'font-semibold')}>{row.fromAddress}</p>
      <p className={cn('line-clamp-1', !row.isRead && 'font-semibold')}>{row.subject || '(no subject)'}</p>
      <p className="line-clamp-2 text-xs text-muted-foreground">{snippet(row.bodyText)}</p>
      <p className="truncate text-xs text-muted-foreground">
        {row.application.job.title} · {row.application.job.companyName}
      </p>
    </div>
  )
}

export function InboxTable() {
  return (
    <DataTable<InboxRow>
      endpoint="/api/inbox"
      queryKey="inbox"
      columns={COLUMNS}
      filters={FILTERS}
      defaultSort="-receivedAt"
      rowHref={(r) => `/applications/${r.application.id}`}
      renderMobileCard={(r) => <MobileCard row={r} />}
      searchPlaceholder="Search subject, sender or body…"
      emptyTitle="No replies yet"
      emptyDescription="Inbound emails linked to your applications land here."
      refetchInterval={30_000}
    />
  )
}
