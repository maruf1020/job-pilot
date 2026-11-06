'use client'

import Link from 'next/link'
import { Bot, CalendarClock, CheckCheck, ExternalLink, Loader2, Reply, Sparkles, UserRound } from 'lucide-react'
import { api, useApiMutation } from '@/lib/api/hooks'
import { LOCATION_REPLY_INSTRUCTION } from '@/lib/domain'
import { flagEmoji, fmtAgo, fmtDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button, buttonVariants } from '@/components/ui/button'
import { ToneBadge } from '@/components/shared/status-badge'
import { ReplyTypeMenu } from './reply-type-menu'
import type { ReplyItem } from './types'

const INVALIDATE: unknown[][] = [['inbox'], ['applications'], ['dashboard'], ['opportunities']]
/** "Apply on our site" and "wrong team": the next move is their form. */
const PORTAL = new Set(['APPLY_VIA_PORTAL', 'WRONG_RECIPIENT'])

export type ReplyRowKind = 'needs' | 'lead' | 'location'

function LeadState({ it }: { it: ReplyItem }) {
  if (it.answered) return <ToneBadge tone="muted">Answered</ToneBadge>
  if (it.hasDraft) return <ToneBadge tone="info">Draft ready</ToneBadge>
  return <ToneBadge tone="warning">Your move</ToneBadge>
}

function OpenLink({ it, label, primary }: { it: ReplyItem; label: string; primary?: boolean }) {
  return (
    <Link href={`/applications/${it.applicationId}#reply`} className={buttonVariants({ size: 'xs', variant: primary ? 'default' : 'outline' })}>
      <Reply /> {label}
    </Link>
  )
}

/** "Done": you dealt with this reply, so it leaves the needs-answer lists. */
export function DoneButton({ messageId }: { messageId: string }) {
  const done = useApiMutation<void, unknown>(() => api.patch(`/api/inbox/${messageId}`, { handled: true }), { invalidate: INVALIDATE, successMessage: 'Marked as done' })
  return (
    <Button size="xs" variant="ghost" onClick={() => done.mutate()} disabled={done.isPending}>
      <CheckCheck /> Done
    </Button>
  )
}

/** "Location is the issue": draft a polite reply that asks about other roles (you review it before it goes out). */
export function DraftLocationReply({ applicationId, messageId, answered, hasDraft }: { applicationId: string; messageId: string; answered?: boolean; hasDraft?: boolean }) {
  const draft = useApiMutation<void, unknown>(() => api.post(`/api/applications/${applicationId}/actions`, { action: 'draft-reply', messageId, instruction: LOCATION_REPLY_INSTRUCTION }), {
    invalidate: INVALIDATE,
    successMessage: 'Reply drafted: open it to review and send',
  })
  if (answered || hasDraft) {
    return (
      <Link href={`/applications/${applicationId}#reply`} className={buttonVariants({ size: 'xs', variant: hasDraft && !answered ? 'default' : 'outline' })}>
        <Reply /> {answered ? 'Open' : 'Review and send'}
      </Link>
    )
  }
  return (
    <Button size="xs" onClick={() => draft.mutate()} disabled={draft.isPending}>
      {draft.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Draft reply
    </Button>
  )
}

function ApplyInBrowser({ it }: { it: ReplyItem }) {
  const fill = useApiMutation<void, unknown>(() => api.post(`/api/applications/${it.applicationId}/portal`, { action: 'fill' }), { invalidate: INVALIDATE, successMessage: 'The agent is filling their form; it stops before Submit' })
  return (
    <Button size="xs" variant="outline" onClick={() => fill.mutate()} disabled={fill.isPending}>
      <Bot /> Apply in browser
    </Button>
  )
}

/**
 * One reply in the inbox lists: who, what they want, how old, and the next move. `kind` picks the
 * actions: needs (reply / apply on their site / done), lead (next steps), location (draft a reply).
 */
export function ReplyRow({ it, kind }: { it: ReplyItem; kind: ReplyRowKind }) {
  const answered = kind !== 'needs' && it.answered
  const primaryLabel = answered ? 'Open' : it.classification === 'INTERVIEW_REQUEST' ? 'Book it' : 'Reply'
  return (
    <li className={cn('flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:gap-4', answered && 'opacity-75')}>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0">
            <ReplyTypeMenu messageId={it.messageId} classification={it.classification} />
          </span>
          <Link href={`/applications/${it.applicationId}`} className="min-w-0 truncate text-sm font-medium text-foreground hover:underline" title={`${it.job.companyName} · ${it.job.title}`}>
            {flagEmoji(it.job.countryCode)} {it.job.companyName}
            <span className="hidden font-normal text-muted-foreground sm:inline"> · {it.job.title}</span>
          </Link>
          <span className="ml-auto shrink-0 text-xs whitespace-nowrap text-muted-foreground" title={fmtDateTime(it.receivedAt)}>
            {fmtAgo(it.receivedAt)}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground sm:hidden">{it.job.title}</p>
        <p className="mt-1.5 text-sm leading-relaxed text-foreground">{it.summary ?? (it.subject || '(no subject)')}</p>
        {it.questions.length ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {it.questions.map((q) => (
              <ToneBadge key={q} tone="neutral" className="h-auto max-w-full py-0.5 whitespace-normal">
                {q}
              </ToneBadge>
            ))}
          </div>
        ) : null}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {it.proposedTimes.length ? (
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="size-3.5" /> {it.proposedTimes.join(' · ')}
            </span>
          ) : null}
          {it.contact ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <UserRound className="size-3.5 shrink-0" />
              <span className="truncate">
                {it.contact.name}
                {it.contact.role ? `, ${it.contact.role}` : ''}
                {it.contact.email ? ` (${it.contact.email})` : ''}
              </span>
            </span>
          ) : (
            <span className="min-w-0 truncate">{it.from}</span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:max-w-[16rem] sm:justify-end">
        {kind !== 'needs' ? <LeadState it={it} /> : null}
        {kind === 'location' ? (
          <DraftLocationReply applicationId={it.applicationId} messageId={it.messageId} answered={it.answered} hasDraft={it.hasDraft} />
        ) : (
          <>
            {PORTAL.has(it.classification) ? (
              <>
                {it.applyUrl ? (
                  <a href={it.applyUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ size: 'xs', variant: 'outline' })}>
                    <ExternalLink /> Their link
                  </a>
                ) : null}
                <ApplyInBrowser it={it} />
              </>
            ) : null}
            <OpenLink it={it} label={primaryLabel} primary={!answered} />
          </>
        )}
        {!answered ? <DoneButton messageId={it.messageId} /> : null}
      </div>
    </li>
  )
}
