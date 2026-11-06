'use client'

import { useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, ChevronDown, Mail } from 'lucide-react'
import { fmtDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/page-header'
import { ReplyBadge } from '@/components/shared/status-badge'
import type { MessageDetail } from './types'

const COLLAPSE_CHARS = 700
const COLLAPSE_LINES = 12

function isLong(text: string): boolean {
  return text.length > COLLAPSE_CHARS || text.split('\n').length > COLLAPSE_LINES
}

function MessageBody({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const long = isLong(text)
  return (
    <div>
      <pre className={cn('whitespace-pre-wrap break-words font-sans text-sm leading-relaxed', long && !open && 'line-clamp-[12]')}>{text}</pre>
      {long ? (
        <Button variant="ghost" size="xs" className="-ml-2 mt-1" onClick={() => setOpen((o) => !o)}>
          <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} /> {open ? 'Show less' : 'Show more'}
        </Button>
      ) : null}
    </div>
  )
}

function MessageItem({ m }: { m: MessageDetail }) {
  const outbound = m.direction === 'OUTBOUND'
  const summary = m.classificationMeta?.summary
  return (
    <li className={cn('flex', outbound ? 'justify-end' : 'justify-start')}>
      <article className={cn('w-full rounded-xl border p-3 sm:w-[92%]', outbound ? 'border-primary/20 bg-primary-soft' : 'bg-card')}>
        <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {outbound ? <ArrowUpRight className="size-3.5 shrink-0" /> : <ArrowDownLeft className="size-3.5 shrink-0" />}
          <span className="min-w-0 truncate">
            <span className="font-medium text-foreground">{m.fromAddress}</span> → {m.toAddress}
          </span>
          <time className="ml-auto whitespace-nowrap">{fmtDateTime(m.sentAt ?? m.receivedAt ?? m.createdAt)}</time>
        </header>
        <p className="mt-1.5 font-medium">{m.subject || '(no subject)'}</p>
        {!outbound ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <ReplyBadge classification={m.classification} />
            {summary ? <span className="text-xs italic text-muted-foreground">{summary}</span> : null}
          </div>
        ) : null}
        <div className="mt-2">
          <MessageBody text={m.bodyText} />
        </div>
      </article>
    </li>
  )
}

export function Thread({ messages }: { messages: MessageDetail[] }) {
  if (messages.length === 0) {
    return <EmptyState icon={<Mail className="size-6" />} title="No messages yet" description="Sent emails and replies will show up here." className="py-8" />
  }
  return (
    <ol className="flex flex-col gap-3">
      {messages.map((m) => (
        <MessageItem key={m.id} m={m} />
      ))}
    </ol>
  )
}
