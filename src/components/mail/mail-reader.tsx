'use client'

import Link from 'next/link'
import { AlarmClock, ArrowLeft, ExternalLink, Reply, ShieldAlert } from 'lucide-react'
import { useApiQuery } from '@/lib/api/hooks'
import { flagEmoji, fmtDate, fmtDateTime } from '@/lib/format'
import { FOLDER_META } from '@/lib/mail/folders'
import type { MailThread, MailThreadMessage } from '@/lib/mail/types'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { DoneButton } from '@/components/inbox/reply-row'
import { ReplyTypeMenu } from '@/components/inbox/reply-type-menu'
import { EmptyState } from '@/components/shared/page-header'
import { AppStatusBadge, ToneBadge } from '@/components/shared/status-badge'
import { SectionSkeleton } from '@/components/shared/skeletons'

function Message({ m }: { m: MailThreadMessage }) {
  const out = m.direction === 'OUTBOUND'
  return (
    <article className={cn('rounded-lg border px-4 py-3', out ? 'bg-surface' : 'bg-card')}>
      <header className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <ToneBadge tone={out ? 'muted' : 'accent'}>{out ? 'You sent' : 'They wrote'}</ToneBadge>
        <span className="min-w-0 truncate">{out ? `To ${m.to}` : m.from}</span>
        <span className="ml-auto whitespace-nowrap">{fmtDateTime(m.at)}</span>
      </header>
      <h3 className="text-foreground mt-2 text-sm font-medium">{m.subject || '(no subject)'}</h3>
      {m.summary ? <p className="text-muted-foreground mt-1 text-xs">{m.summary}</p> : null}
      <p className="text-foreground mt-2 text-sm leading-relaxed whitespace-pre-wrap">{m.body}</p>
    </article>
  )
}

function Banner({ thread }: { thread: MailThread }) {
  if (thread.waitingUntil) {
    return (
      <div className="border-info/30 bg-info-soft text-info-text flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
        <AlarmClock className="mt-0.5 size-4 shrink-0" />
        <p>
          Waiting for the company cooldown. It unlocks on <strong>{fmtDate(thread.waitingUntil)}</strong>;
          after that it goes back to review.
        </p>
      </div>
    )
  }
  if (thread.heldReason) {
    return (
      <div className="border-warning/30 bg-warning-soft text-warning-text flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        <p>
          Held: <strong>{thread.heldReason}</strong>. It does not go out on its own.
        </p>
      </div>
    )
  }
  return null
}

/** Right column: the whole thread of one application, its draft or hold reason, and the next move. */
export function MailReader({ applicationId, onBack }: { applicationId: string | null; onBack: () => void }) {
  const q = useApiQuery<MailThread>(
    ['inbox', 'mail-thread', applicationId],
    applicationId ? `/api/mail/thread/${applicationId}` : null,
  )
  if (!applicationId)
    return (
      <EmptyState
        className="h-full"
        title="Pick a message"
        description="Choose one on the left to read it here."
      />
    )
  if (q.isError) return <EmptyState title="Could not open it" description={q.error.message} />
  const t = q.data?.data
  if (!t) return <SectionSkeleton />
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onBack}
        className="text-primary-text inline-flex w-fit items-center gap-1 text-xs font-medium hover:underline lg:hidden"
      >
        <ArrowLeft className="size-3.5" /> Back to the list
      </button>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-foreground truncate text-base font-semibold">
              {flagEmoji(t.countryCode)} {t.company}
            </h2>
            <p className="text-muted-foreground truncate text-sm">{t.title}</p>
          </div>
          <AppStatusBadge status={t.status} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {t.folders.map((f) => (
            <ToneBadge key={f} tone="neutral">
              {FOLDER_META[f].label}
            </ToneBadge>
          ))}
          {t.latestReplyId ? (
            <ReplyTypeMenu messageId={t.latestReplyId} classification={t.latestReplyClassification} />
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Link
            href={`/applications/${t.applicationId}${t.latestReplyId ? '#reply' : ''}`}
            className={buttonVariants({ size: 'xs', variant: t.latestReplyId ? 'default' : 'outline' })}
          >
            {t.latestReplyId ? <Reply /> : <ExternalLink />} {t.latestReplyId ? 'Reply' : 'Open application'}
          </Link>
          {t.latestReplyId ? (
            <Link
              href={`/applications/${t.applicationId}`}
              className={buttonVariants({ size: 'xs', variant: 'outline' })}
            >
              <ExternalLink /> Application
            </Link>
          ) : null}
          {t.latestReplyId && t.folders.includes('needs-answer') ? (
            <DoneButton messageId={t.latestReplyId} />
          ) : null}
        </div>
      </header>
      <Banner thread={t} />
      {t.notes ? (
        <p className="bg-muted text-muted-foreground rounded-md px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap">
          {t.notes}
        </p>
      ) : null}
      {t.messages.map((m) => (
        <Message key={m.id} m={m} />
      ))}
      {!t.messages.length && t.draft ? (
        <article className="rounded-lg border border-dashed px-4 py-3">
          <header className="text-muted-foreground flex items-center gap-2 text-xs">
            <ToneBadge tone={t.draft.passed ? 'success' : 'warning'}>
              {t.draft.passed ? 'Draft, checked' : 'Draft, not checked'}
            </ToneBadge>
            {t.toEmail ? <span className="truncate">To {t.toEmail}</span> : null}
          </header>
          <h3 className="text-foreground mt-2 text-sm font-medium">{t.draft.subject}</h3>
          <p className="text-foreground mt-2 text-sm leading-relaxed whitespace-pre-wrap">{t.draft.body}</p>
        </article>
      ) : null}
      {!t.messages.length && !t.draft ? (
        <p className="text-muted-foreground text-sm">No message or draft yet.</p>
      ) : null}
    </div>
  )
}
