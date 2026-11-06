'use client'

import type { ReactNode } from 'react'
import { ChevronDown, Square, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BadgeTone } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ConfirmButton } from '@/components/shared/confirm-button'
import { StatusDot } from '@/components/shared/status-badge'

/**
 * One compact row per batch (plan-ui-redesign.md 6, Applications): status dot, what it is, the
 * numbers that matter, Stop, and the details folded away. One line on phones, wrapping as needed.
 */
export function BatchStrip({
  tone,
  title,
  stats,
  note,
  progress,
  onStop,
  stopping,
  stopTitle,
  stopDescription,
  onDismiss,
  details,
  label,
}: {
  tone: BadgeTone
  title: ReactNode
  /** Short facts ("12 submitted", "3 need you"); the first is shown bold. */
  stats: Array<{ label: string; value: number | string; tone?: 'warning' | 'danger' | 'success' }>
  /** One line under the row (what it waits for). */
  note?: ReactNode
  /** 0-100 when the batch has a target. */
  progress?: number | null
  onStop?: () => void
  stopping?: boolean
  stopTitle?: string
  stopDescription?: string
  onDismiss?: () => void
  details?: ReactNode
  label: string
}) {
  const body = (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 sm:px-4">
        <StatusDot tone={tone} className={cn(tone === 'info' && 'animate-pulse motion-reduce:animate-none')} />
        <span className="min-w-0 truncate text-sm font-medium text-foreground">{title}</span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {stats.map((s, i) => (
            <span key={s.label} className={cn('whitespace-nowrap tabular-nums', s.tone === 'warning' && 'text-warning-text', s.tone === 'danger' && 'text-danger-text', s.tone === 'success' && 'text-success-text')}>
              <span className={cn(i === 0 && 'font-semibold text-foreground', s.tone && 'font-medium')}>{s.value}</span> {s.label}
            </span>
          ))}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {details ? (
            <CollapsibleTrigger render={<Button size="xs" variant="ghost" className="group" aria-label={`Show ${label} details`} />}>
              Details <ChevronDown className="transition-transform group-data-[panel-open]:rotate-180" />
            </CollapsibleTrigger>
          ) : null}
          {onStop ? (
            <ConfirmButton size="xs" variant="outline" title={stopTitle ?? 'Stop this batch?'} description={stopDescription} confirmLabel="Stop" disabled={stopping} onConfirm={onStop}>
              <Square /> Stop
            </ConfirmButton>
          ) : null}
          {onDismiss ? (
            <Button size="icon-xs" variant="ghost" aria-label="Hide" onClick={onDismiss}>
              <X />
            </Button>
          ) : null}
        </span>
      </div>
      {progress != null ? (
        <div className="h-0.5 w-full bg-muted" aria-hidden>
          <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </div>
      ) : null}
      {note ? <p className="border-t px-3 py-1.5 text-xs text-muted-foreground sm:px-4">{note}</p> : null}
      {details ? <CollapsibleContent className="border-t px-3 py-3 text-xs sm:px-4">{details}</CollapsibleContent> : null}
    </>
  )
  return (
    <section aria-label={label} className="overflow-hidden rounded-lg border bg-card shadow-[var(--shadow-card)]">
      {details ? <Collapsible>{body}</Collapsible> : body}
    </section>
  )
}
