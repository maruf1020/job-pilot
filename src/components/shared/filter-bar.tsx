'use client'

import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export interface FilterChipValue {
  key: string
  label: ReactNode
  value: ReactNode
}

/** One active filter: "Label: value" with a remove button (plan-ui-redesign.md 4.6). */
export function FilterChip({ label, value, onRemove, className }: { label: ReactNode; value: ReactNode; onRemove?: () => void; className?: string }) {
  return (
    <span className={cn('inline-flex h-7 max-w-64 items-center gap-1 rounded-md border bg-card pr-0.5 pl-2 text-xs shadow-[var(--shadow-card)]', !onRemove && 'pr-2', className)}>
      <span className="text-muted-foreground">{label}:</span>
      <span className="truncate font-medium text-foreground">{value}</span>
      {onRemove ? (
        <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Remove filter" onClick={onRemove}>
          <X className="size-3" />
        </button>
      ) : null}
    </span>
  )
}

/** Segmented quick filter (e.g. All / Needs you / Sent), for lists that are not a DataTable. */
export function Segmented<T extends string>({ value, onChange, options, className, size = 'default' }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: ReactNode; count?: number }>; className?: string; size?: 'sm' | 'default' }) {
  return (
    <div role="tablist" className={cn('inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg bg-muted p-0.5 scrollbar-none', className)}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors',
              size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-2.5 text-[13px]',
              on ? 'bg-card text-foreground shadow-[var(--shadow-card)]' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
            {o.count != null ? <span className={cn('tabular-nums text-xs', on ? 'text-muted-foreground' : 'text-muted-foreground/80')}>{o.count}</span> : null}
          </button>
        )
      })}
    </div>
  )
}

/** Active filters as chips with "Clear all". Renders nothing when no filter is set. */
export function FilterBar({ chips, onRemove, onClear, className, children }: { chips: FilterChipValue[]; onRemove?: (key: string) => void; onClear?: () => void; className?: string; children?: ReactNode }) {
  if (!chips.length && !children) return null
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {children}
      {chips.map((c) => (
        <FilterChip key={c.key} label={c.label} value={c.value} onRemove={onRemove ? () => onRemove(c.key) : undefined} />
      ))}
      {chips.length > 1 && onClear ? (
        <Button variant="ghost" size="xs" onClick={onClear}>
          Clear all
        </Button>
      ) : null}
    </div>
  )
}
