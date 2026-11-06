import Link from 'next/link'
import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * A titled block of a page (plan-ui-redesign.md 4.2). `variant`:
 * - card: bordered surface with a header row (default; most dashboard and detail blocks)
 * - plain: header row and content on the page background (lists that bring their own borders, tables)
 * - inset: muted surface for secondary information (notes, explanations)
 */
export function Section({
  title,
  description,
  actions,
  href,
  hrefLabel = 'View all',
  count,
  variant = 'card',
  children,
  className,
  contentClassName,
  id,
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  /** "View all" link in the header. */
  href?: string
  hrefLabel?: string
  count?: number | null
  variant?: 'card' | 'plain' | 'inset'
  children: ReactNode
  className?: string
  contentClassName?: string
  id?: string
}) {
  const header =
    title || actions || href ? (
      <div className={cn('flex items-start justify-between gap-3', variant === 'card' ? 'border-b px-4 py-3' : 'mb-3', variant === 'inset' && 'mb-2 border-0 px-0 py-0')}>
        <div className="min-w-0">
          {title ? (
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <span className="truncate">{title}</span>
              {count != null ? <span className="rounded-md bg-muted px-1.5 text-xs font-medium text-muted-foreground tabular-nums">{count}</span> : null}
            </h2>
          ) : null}
          {description ? <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          {href ? (
            <Link href={href} className="inline-flex items-center gap-0.5 text-xs font-medium text-primary-text hover:underline">
              {hrefLabel}
              <ChevronRight className="size-3.5" />
            </Link>
          ) : null}
        </div>
      </div>
    ) : null
  if (variant === 'plain')
    return (
      <section id={id} className={className}>
        {header}
        <div className={contentClassName}>{children}</div>
      </section>
    )
  if (variant === 'inset')
    return (
      <section id={id} className={cn('rounded-lg bg-muted/60 p-4', className)}>
        {header}
        <div className={contentClassName}>{children}</div>
      </section>
    )
  return (
    <section id={id} className={cn('min-w-0 overflow-hidden rounded-lg border bg-card shadow-[var(--shadow-card)]', className)}>
      {header}
      <div className={cn('p-4', contentClassName)}>{children}</div>
    </section>
  )
}

/** A divided list inside a Section (rows with hover). Pass `flush` content to the Section (contentClassName="p-0"). */
export function ListRows({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cn('divide-y', className)}>{children}</ul>
}

export function ListRow({ children, href, className }: { children: ReactNode; href?: string; className?: string }) {
  const cls = cn('flex min-w-0 items-center gap-3 px-4 py-3 text-sm', href && 'transition-colors hover:bg-accent/50', className)
  return <li>{href ? <Link href={href} className={cls}>{children}</Link> : <div className={cls}>{children}</div>}</li>
}
