'use client'

import type { ChartConfig } from '@/components/ui/chart'
import type { Split, StatsPayload, Via } from '@/lib/analytics/stats'
import { useApiQuery } from '@/lib/api/hooks'

export type { StatsPayload }

/** Application numbers for Today and Stats; one request, refreshed every minute. */
export function useStats() {
  return useApiQuery<StatsPayload>(['dashboard', 'stats'], '/api/dashboard/stats', { refetchInterval: 60_000 })
}

/** How an application went out, in stack order (bottom first) and with its fixed chart slot. */
export const VIA_ORDER: Via[] = ['agent', 'email', 'manual']

export const VIA_LABEL: Record<Via, string> = {
  agent: 'Browser agent',
  email: 'Email',
  manual: 'By hand',
}

export const viaConfig = {
  agent: { label: VIA_LABEL.agent, color: 'var(--chart-1)' },
  email: { label: VIA_LABEL.email, color: 'var(--chart-2)' },
  manual: { label: VIA_LABEL.manual, color: 'var(--chart-3)' },
} satisfies ChartConfig

export const RANGES = [
  { days: 14, label: '14 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
] as const
export type RangeDays = (typeof RANGES)[number]['days']

/** "27 Oct" for a local day key (the key is already in the user's timezone, so format it as UTC). */
export function dayLabel(day: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string {
  return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`))
}

export function weekLabel(monday: string): string {
  return `Week of ${dayLabel(monday)}`
}

export function sumSplits(rows: Split[]): Split {
  return rows.reduce((a, r) => ({ total: a.total + r.total, agent: a.agent + r.agent, email: a.email + r.email, manual: a.manual + r.manual }), { total: 0, agent: 0, email: 0, manual: 0 })
}

/** Percent change, rounded; null when there is nothing to compare with. */
export function pctChange(now: number, before: number): number | null {
  if (!before) return null
  return Math.round(((now - before) / before) * 100)
}

/** The running total after each value, starting from `base`. */
export function runningTotal(base: number, values: number[]): number[] {
  const out: number[] = []
  let run = base
  for (const v of values) out.push((run += v))
  return out
}
