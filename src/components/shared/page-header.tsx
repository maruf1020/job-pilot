import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Page title row (plan-ui-redesign.md 4.1). Title + one-line description on the left, actions on the
 * right; on phones the actions wrap under the title. `meta` is a small line under the description
 * (counts, last updated), `children` an optional row under it (tabs, filter chips).
 */
export function PageHeader({
  title,
  description,
  actions,
  meta,
  eyebrow,
  children,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  meta?: ReactNode
  eyebrow?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {eyebrow ? <div className="mb-1 text-xs font-medium text-muted-foreground">{eyebrow}</div> : null}
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-[1.375rem]">{title}</h1>
          {description ? <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
          {meta ? <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">{meta}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  )
}

/** Nothing to show: a calm, centred message with one optional action. */
export function EmptyState({ icon, title, description, action, className, compact }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string; compact?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-lg border border-dashed bg-surface text-center', compact ? 'px-4 py-6' : 'px-6 py-12', className)}>
      {icon ? <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">{icon}</div> : null}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export type MetricTone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary'

const METRIC_VALUE_TONE: Record<MetricTone, string> = {
  default: 'text-foreground',
  success: 'text-success-text',
  warning: 'text-warning-text',
  danger: 'text-danger-text',
  info: 'text-info-text',
  primary: 'text-primary-text',
}

/**
 * One number with its label (plan 4.3). `delta` shows a change (positive = up); `href` makes the
 * whole tile a link; `tone` colours the value when the number itself is the signal.
 */
export function Metric({
  label,
  value,
  hint,
  delta,
  deltaLabel,
  tone = 'default',
  icon,
  href,
  className,
}: {
  label: ReactNode
  value: ReactNode
  hint?: ReactNode
  delta?: number | null
  deltaLabel?: ReactNode
  tone?: MetricTone
  icon?: ReactNode
  href?: string
  className?: string
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
        {icon ? <span className="text-muted-foreground [&_svg]:size-4">{icon}</span> : null}
      </div>
      <p className={cn('mt-1.5 text-2xl font-semibold tracking-tight tabular-nums', METRIC_VALUE_TONE[tone])}>{value}</p>
      {delta != null || hint ? (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          {delta != null ? (
            <span className={cn('inline-flex items-center gap-0.5 font-medium tabular-nums', delta > 0 ? 'text-success-text' : delta < 0 ? 'text-danger-text' : 'text-muted-foreground')}>
              {delta > 0 ? <ArrowUpRight className="size-3.5" /> : delta < 0 ? <ArrowDownRight className="size-3.5" /> : null}
              {delta > 0 ? '+' : ''}
              {delta}
              {deltaLabel ? <span className="font-normal text-muted-foreground"> {deltaLabel}</span> : null}
            </span>
          ) : null}
          {hint ? <span className="min-w-0 truncate">{hint}</span> : null}
        </div>
      ) : null}
    </>
  )
  const cls = cn('block min-w-0 rounded-lg border bg-card p-4 shadow-[var(--shadow-card)]', href && 'transition-colors hover:border-border-strong hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring', className)
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}

/** Kept for existing pages; same look as Metric. */
export function Stat({ label, value, hint, className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; className?: string }) {
  return <Metric label={label} value={value} hint={hint} className={className} />
}

/** A grid of metrics that reflows 2 / 3 / 4 / 6 columns by width. */
export function MetricGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4', className)}>{children}</div>
}

/** Label / value pairs. Two columns from sm up; on phones each pair is one row with a divider. */
export function KeyValue({ items, className, columns = 2 }: { items: Array<{ label: ReactNode; value: ReactNode }>; className?: string; columns?: 1 | 2 | 3 }) {
  return (
    <dl className={cn('grid grid-cols-1 gap-x-8 text-sm', columns === 2 && 'sm:grid-cols-2', columns === 3 && 'sm:grid-cols-2 lg:grid-cols-3', className)}>
      {items.map((it, i) => (
        <div key={i} className="flex min-w-0 items-baseline justify-between gap-3 border-b border-dashed py-2 last:border-0 sm:last:border-b sm:[&:nth-last-child(-n+2)]:border-0">
          <dt className="shrink-0 text-muted-foreground">{it.label}</dt>
          <dd className="min-w-0 truncate text-right font-medium text-foreground">{it.value}</dd>
        </div>
      ))}
    </dl>
  )
}
