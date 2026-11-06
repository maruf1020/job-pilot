import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { BadgeTone } from '@/lib/format'
import { StatusDot } from './status-badge'

export interface TimelineItem {
  id: string
  title: ReactNode
  /** Already formatted time ("2 h ago", "29 Oct 14:05"). */
  time?: ReactNode
  description?: ReactNode
  tone?: BadgeTone
  icon?: ReactNode
}

/** Vertical event list with a rail (application events, run steps, reply history). */
export function Timeline({ items, className, empty }: { items: TimelineItem[]; className?: string; empty?: ReactNode }) {
  if (!items.length) return empty ? <>{empty}</> : null
  return (
    <ol className={cn('relative', className)}>
      {items.map((it, i) => (
        <li key={it.id} className="relative flex gap-3 pb-4 last:pb-0">
          {i < items.length - 1 ? <span aria-hidden className="absolute top-5 bottom-0 left-[7px] w-px bg-border" /> : null}
          <span className="relative mt-1 flex size-[15px] shrink-0 items-center justify-center rounded-full border bg-card">
            {it.icon ? <span className="text-muted-foreground [&_svg]:size-2.5">{it.icon}</span> : <StatusDot tone={it.tone ?? 'muted'} className="size-1.5" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="min-w-0 text-sm font-medium text-foreground">{it.title}</p>
              {it.time ? <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{it.time}</span> : null}
            </div>
            {it.description ? <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{it.description}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  )
}
