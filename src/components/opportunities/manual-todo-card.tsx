'use client'

import Link from 'next/link'
import { ArrowUpRight, CircleAlert, ClipboardCheck, ExternalLink } from 'lucide-react'
import type { TodoItem } from '@/lib/applications/manual-todo'
import { cn } from '@/lib/utils'

/**
 * The highlighted "What you need to do" box: only what the agents cannot do for you,
 * urgent ones first, each a link straight to the place where you do it.
 */
export function ManualTodoCard({ items, className }: { items: TodoItem[]; className?: string }) {
  const urgent = items.filter((i) => i.priority === 'urgent')
  const rest = items.filter((i) => i.priority !== 'urgent')
  return (
    <aside
      aria-labelledby="manual-todo-title"
      className={cn('rounded-xl border-2 border-warning/60 bg-warning-soft p-4 shadow-sm', className)}
    >
      <div className="flex items-center gap-2">
        <ClipboardCheck className="size-5 shrink-0 text-warning-text" aria-hidden />
        <h2 id="manual-todo-title" className="text-base font-semibold text-warning-text">
          What you need to do
        </h2>
        <span className="ml-auto rounded-full bg-warning px-2 py-0.5 text-xs font-semibold text-white tabular-nums">{items.length}</span>
      </div>
      <p className="mt-1 text-xs text-warning-text/80">Only the steps the agents cannot do for you. Everything else runs on its own.</p>
      {items.length ? (
        <ol className="mt-3 flex flex-col gap-2">
          {[...urgent, ...rest].map((it) => (
            <li key={it.id}>
              <Link
                href={it.href}
                target={it.external ? '_blank' : undefined}
                rel={it.external ? 'noreferrer' : undefined}
                className={cn(
                  'group flex items-start gap-2 rounded-lg border bg-background/80 px-3 py-2 transition-colors hover:bg-background',
                  it.priority === 'urgent' ? 'border-warning' : 'border-border',
                )}
              >
                {it.priority === 'urgent' ? <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning-text" aria-label="Urgent" /> : <span className="mt-1.5 size-2 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden />}
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">{it.title}</span>
                  {it.detail ? <span className="mt-0.5 block text-xs leading-snug text-muted-foreground line-clamp-2">{it.detail}</span> : null}
                </span>
                {it.external ? <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden /> : <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden />}
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 text-sm text-warning-text">Nothing needs you right now.</p>
      )}
    </aside>
  )
}
