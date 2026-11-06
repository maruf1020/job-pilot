'use client'

import Link from 'next/link'
import { CalendarClock, Hourglass, Reply, Trophy } from 'lucide-react'
import { useApiQuery } from '@/lib/api/hooks'
import type { NextActionKind, OngoingApplication } from '@/lib/applications/ongoing'
import { flagEmoji, fmtAgo, fmtDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/shared/page-header'
import { ListRows, Section } from '@/components/shared/section'
import { SectionSkeleton } from '@/components/shared/skeletons'
import { AppStatusBadge, ChannelBadge } from '@/components/shared/status-badge'

export function useOngoing(limit?: number) {
  return useApiQuery<OngoingApplication[]>(['applications', 'ongoing', limit ?? 'all'], `/api/applications/ongoing${limit ? `?limit=${limit}` : ''}`, { refetchInterval: 60_000 })
}

const ACTION_STYLE: Record<NextActionKind, { icon: typeof Reply; className: string }> = {
  reply: { icon: Reply, className: 'text-warning-text' },
  prepare: { icon: CalendarClock, className: 'text-info-text' },
  offer: { icon: Trophy, className: 'text-success-text' },
  waiting: { icon: Hourglass, className: 'text-muted-foreground' },
}

function Row({ a }: { a: OngoingApplication }) {
  const style = ACTION_STYLE[a.nextAction.kind]
  const Icon = style.icon
  return (
    <li>
      <Link
        href={`/applications/${a.applicationId}${a.nextAction.kind === 'reply' ? '#reply' : ''}`}
        className="grid gap-x-4 gap-y-1.5 px-4 py-3 text-sm transition-colors hover:bg-accent/50 md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,2fr)_5.5rem] md:items-center"
      >
        <span className="min-w-0">
          <span className="block truncate font-medium text-foreground" title={a.company}>
            {flagEmoji(a.countryCode)} {a.company}
          </span>
          <span className="block truncate text-xs text-muted-foreground" title={a.title}>
            {a.title}
          </span>
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <AppStatusBadge status={a.status} />
          <span className="truncate text-xs text-foreground" title={a.stage}>
            {a.stage}
            {a.progress ? <span className="text-muted-foreground tabular-nums"> · {a.progress.done}/{a.progress.total}</span> : null}
          </span>
        </span>
        <span className={cn('flex min-w-0 items-center gap-1.5 text-xs font-medium', style.className)}>
          <Icon className="size-3.5 shrink-0" />
          <span className="truncate" title={a.nextAction.at ? fmtDateTime(a.nextAction.at) : undefined}>
            {a.nextAction.label}
          </span>
        </span>
        <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground md:justify-end">
          <span className="md:hidden">
            <ChannelBadge channel={a.channel} />
          </span>
          <span title={fmtDateTime(a.lastActivityAt)}>{fmtAgo(a.lastActivityAt)}</span>
        </span>
      </Link>
    </li>
  )
}

/**
 * Ongoing applications (plan-ui-redesign.md 7.2): companies that replied, interviews and offers, and
 * every application with a saved hiring process, with the stage you are on and what to do next.
 */
export function OngoingList({ limit, title = 'Ongoing applications', href }: { limit?: number; title?: string; href?: string }) {
  const q = useOngoing(limit)
  if (q.isPending) return <SectionSkeleton />
  const rows = q.data?.data ?? []
  const toReply = rows.filter((r) => r.nextAction.kind === 'reply').length
  return (
    <Section
      title={title}
      count={q.data ? rows.length : null}
      description={rows.length ? `${toReply ? `${toReply} waiting for your reply · ` : ''}newest activity first` : undefined}
      href={href}
      contentClassName="p-0"
    >
      {rows.length ? (
        <>
          <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,2fr)_5.5rem] gap-x-4 border-b bg-muted px-4 py-2 text-xs font-medium text-muted-foreground md:grid">
            <span>Company</span>
            <span>Stage</span>
            <span>Next</span>
            <span className="text-right">Activity</span>
          </div>
          <ListRows>
            {rows.map((a) => (
              <Row key={a.applicationId} a={a} />
            ))}
          </ListRows>
        </>
      ) : (
        <EmptyState compact icon={<Hourglass />} title="Nothing in progress yet" description="Applications move here when a company replies, books an interview or makes an offer." className="m-4" />
      )}
    </Section>
  )
}
