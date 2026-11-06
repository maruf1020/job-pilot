'use client'

import { AlarmClock, ShieldAlert } from 'lucide-react'
import { flagEmoji, fmtAgo, fmtDate } from '@/lib/format'
import type { MailFolder } from '@/lib/mail/folders'
import type { MailItem } from '@/lib/mail/types'
import { cn } from '@/lib/utils'
import { AppStatusBadge, ReplyBadge, ToneBadge } from '@/components/shared/status-badge'

function Row({
  it,
  folder,
  selected,
  onSelect,
}: {
  it: MailItem
  folder: MailFolder
  selected: boolean
  onSelect: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          'flex w-full flex-col gap-1 px-3 py-2.5 text-left transition-colors',
          selected ? 'bg-primary-soft' : 'hover:bg-accent/50',
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
            {flagEmoji(it.countryCode)} {it.company}
          </span>
          {folder === 'waiting' && it.waitingUntil ? (
            <span
              className="text-muted-foreground shrink-0 text-xs whitespace-nowrap"
              title="The day this company can be applied to again"
            >
              opens {fmtDate(it.waitingUntil, { day: 'numeric', month: 'short' })}
            </span>
          ) : (
            <span className="text-muted-foreground shrink-0 text-xs whitespace-nowrap">{fmtAgo(it.at)}</span>
          )}
        </span>
        <span className="text-foreground truncate text-sm">{it.subject}</span>
        <span className="text-muted-foreground line-clamp-2 text-xs">{it.preview}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          {it.reply ? <ReplyBadge classification={it.reply} /> : <AppStatusBadge status={it.status} />}
          {it.waitingUntil ? (
            <ToneBadge tone="info">
              <AlarmClock className="size-3" /> Cooldown
            </ToneBadge>
          ) : null}
          {it.heldReason ? (
            <ToneBadge tone="warning">
              <ShieldAlert className="size-3" /> {it.heldReason}
            </ToneBadge>
          ) : null}
        </span>
      </button>
    </li>
  )
}

/** Middle column: one folder page. Selecting a row opens it in the reader. */
export function MessageList({
  items,
  folder,
  selectedId,
  onSelect,
}: {
  items: MailItem[]
  folder: MailFolder
  selectedId: string | null
  onSelect: (applicationId: string) => void
}) {
  return (
    <ul className="divide-y">
      {items.map((it) => (
        <Row
          key={it.applicationId}
          it={it}
          folder={folder}
          selected={it.applicationId === selectedId}
          onSelect={() => onSelect(it.applicationId)}
        />
      ))}
    </ul>
  )
}
