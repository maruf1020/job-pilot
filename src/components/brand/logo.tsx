import { cn } from '@/lib/utils'

/**
 * The Job Pilot mark: a solid accent tile with an arrow leaving a bracket (an application going
 * out). Flat, one colour, follows the theme through the accent token.
 */
export function LogoMark({ size = 32, className, title = 'Job Pilot' }: { size?: number; className?: string; title?: string }) {
  return (
    <span
      role="img"
      aria-label={title}
      className={cn('inline-flex shrink-0 items-center justify-center rounded-[28%] bg-primary text-primary-foreground', className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 24 24" width={Math.round(size * 0.62)} height={Math.round(size * 0.62)} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2" />
        <path d="M11 12h9" />
        <path d="m16.5 8.5 3.5 3.5-3.5 3.5" />
      </svg>
    </span>
  )
}

/** Mark + wordmark, for headers. */
export function Logo({ size = 32, className, subtitle }: { size?: number; className?: string; subtitle?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark size={size} />
      <span className="grid text-left leading-tight">
        <span className="truncate font-semibold tracking-tight">Job Pilot</span>
        {subtitle ? <span className="truncate text-xs text-muted-foreground">{subtitle}</span> : null}
      </span>
    </span>
  )
}
