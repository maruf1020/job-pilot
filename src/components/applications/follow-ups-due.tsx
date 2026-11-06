'use client'

import Link from 'next/link'
import { useState } from 'react'
import { CalendarCheck, Check, ChevronDown, SkipForward } from 'lucide-react'
import { api, useApiMutation, useApiQuery } from '@/lib/api/hooks'
import { flagEmoji, fmtAgo } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/page-header'
import { Section } from '@/components/shared/section'
import { SectionSkeleton } from '@/components/shared/skeletons'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmButton } from '@/components/shared/confirm-button'
import { ScoreBadge, ToneBadge } from '@/components/shared/status-badge'

interface DueRow {
  applicationId: string
  toEmail: string
  source: string | null
  sentAt: string | null
  daysSinceSent: number
  followUpCount: number
  approved: boolean
  job: { id: string; title: string; companyName: string; countryCode: string | null; finalScore: number | null }
}

const INVALIDATE: unknown[][] = [['follow-ups'], ['applications'], ['dashboard']]
const PREVIEW = 5

/**
 * Applications page: follow-ups that are due. Approving is your permission to send them; they
 * go out in the same thread, inside the daily cap and gaps. Collapsed to a few rows so the
 * applications list stays in reach.
 */
export function FollowUpsDue({ showEmpty = false }: { showEmpty?: boolean }) {
  const q = useApiQuery<DueRow[]>(['follow-ups'], '/api/follow-ups', { refetchInterval: 60_000 })
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState(false)
  const approve = useApiMutation<{ applicationIds: string[] }, unknown>((v) => api.post('/api/follow-ups', { ...v, action: 'approve' }), {
    invalidate: INVALIDATE,
    onSuccess: () => setPicked(new Set()),
  })
  const skip = useApiMutation<{ applicationIds: string[] }, unknown>((v) => api.post('/api/follow-ups', { ...v, action: 'skip' }), { invalidate: INVALIDATE })
  const rows = (q.data?.data ?? []).filter((r) => !r.approved)
  if (q.isPending && showEmpty) return <SectionSkeleton />
  if (rows.length === 0) {
    if (!showEmpty) return null
    return (
      <Section id="follow-ups" title="Follow-ups due" count={0}>
        <EmptyState compact icon={<CalendarCheck />} title="No follow-ups due" description="Emails with no reply after a week show up here for your approval." />
      </Section>
    )
  }
  const selected = rows.filter((r) => picked.has(r.applicationId)).map((r) => r.applicationId)
  const visible = expanded ? rows : rows.slice(0, PREVIEW)
  const allPicked = selected.length === rows.length
  const toggle = (id: string, on: boolean) =>
    setPicked((s) => {
      const n = new Set(s)
      if (on) n.add(id)
      else n.delete(id)
      return n
    })

  return (
    <Section
      id="follow-ups"
      className="scroll-mt-20"
      title="Follow-ups due"
      count={rows.length}
      description={`No reply for ${Math.min(...rows.map((r) => r.daysSinceSent))}+ days, no bounce, the company's own recruiting address, a job you can still get a permit for. Each approved one is written, checked and sent in the same thread with the normal gaps.`}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <ConfirmButton
            size="sm"
            disabled={approve.isPending || selected.length === 0}
            title={`Approve ${selected.length} follow-up${selected.length === 1 ? '' : 's'}?`}
            description="They are written and sent from your mailbox in the same threads, within your daily cap and send window. A reply stops them."
            confirmLabel="Approve and send"
            onConfirm={() => approve.mutateAsync({ applicationIds: selected }).catch(() => null)}
          >
            <Check /> Approve {selected.length || ''}
          </ConfirmButton>
          <Button size="sm" variant="outline" onClick={() => skip.mutate({ applicationIds: selected })} disabled={skip.isPending || selected.length === 0}>
            <SkipForward /> Skip {selected.length || ''}
          </Button>
        </div>
      }
      contentClassName="flex flex-col gap-2"
    >
        <label className="flex w-fit items-center gap-2 px-1 text-xs text-muted-foreground">
          <Checkbox checked={allPicked} onCheckedChange={(c) => setPicked(c ? new Set(rows.map((r) => r.applicationId)) : new Set())} aria-label="Select all follow-ups" />
          Select all {rows.length}
        </label>
        <ul className="divide-y rounded-lg border">
          {visible.map((r) => (
            <li key={r.applicationId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm sm:flex-nowrap">
              <Checkbox checked={picked.has(r.applicationId)} onCheckedChange={(c) => toggle(r.applicationId, Boolean(c))} aria-label={`Select ${r.job.companyName}`} />
              <ScoreBadge score={r.job.finalScore} />
              <Link href={`/applications/${r.applicationId}`} className="min-w-0 flex-1 truncate hover:underline">
                <span className="font-medium">
                  {flagEmoji(r.job.countryCode)} {r.job.companyName}
                </span>
                <span className="text-muted-foreground"> · {r.job.title}</span>
              </Link>
              <span className="hidden max-w-56 truncate text-xs text-muted-foreground lg:inline">{r.toEmail}</span>
              {r.source ? <ToneBadge tone={r.source === 'guessed' ? 'warning' : 'neutral'}>{r.source}</ToneBadge> : null}
              <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                sent {r.sentAt ? fmtAgo(r.sentAt) : '?'}
                {r.followUpCount ? ` · ${r.followUpCount} follow-up` : ''}
              </span>
            </li>
          ))}
        </ul>
        {rows.length > PREVIEW ? (
          <Button size="sm" variant="ghost" className="w-fit" onClick={() => setExpanded((e) => !e)}>
            <ChevronDown className={expanded ? 'rotate-180 transition-transform' : 'transition-transform'} /> {expanded ? 'Show fewer' : `Show all ${rows.length}`}
          </Button>
        ) : null}
    </Section>
  )
}
