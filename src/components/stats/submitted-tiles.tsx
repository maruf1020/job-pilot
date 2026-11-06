'use client'

import { ArrowDownRight, ArrowUpRight, Flame, Inbox, Search, Sparkles, Trophy, TrendingUp } from 'lucide-react'
import type { PeriodTile } from '@/lib/analytics/stats'
import { cn } from '@/lib/utils'
import { fmtNumber } from '@/lib/format'
import { Metric, MetricGrid } from '@/components/shared/page-header'
import { MetricsSkeleton } from '@/components/shared/skeletons'
import { dayLabel, runningTotal, type StatsPayload, VIA_LABEL, VIA_ORDER, viaConfig } from './stats-data'

const TILE: Record<PeriodTile['key'], { label: string; before: string | null; spark: string }> = {
  today: { label: 'Submitted today', before: 'vs yesterday by now', spark: 'last 14 days' },
  week: { label: 'This week', before: 'vs last week by now', spark: 'last 12 weeks' },
  month: { label: 'This month', before: 'vs last month by now', spark: 'last 6 months' },
  all: { label: 'All time', before: null, spark: 'running total, last 12 weeks' },
}

/** A 12-ish point trend line: past points in the quiet ink, the current period as an accent dot. */
function Sparkline({ values, label }: { values: number[]; label: string }) {
  const w = 120
  const h = 32
  const pad = 4
  const max = Math.max(1, ...values)
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0
  const pts = values.map((v, i) => [pad + i * step, h - pad - (v / max) * (h - pad * 2)] as const)
  const last = pts.at(-1)
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="hidden h-8 w-28 shrink-0 overflow-visible sm:block" role="img" aria-label={`${label}: ${values.join(', ')}`}>
      <title>{`${label}: ${values.map((v) => fmtNumber(v)).join(', ')}`}</title>
      <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="var(--muted-foreground)" strokeOpacity={0.45} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {last ? <circle cx={last[0]} cy={last[1]} r={4} fill="var(--chart-1)" stroke="var(--card)" strokeWidth={2} /> : null}
    </svg>
  )
}

function sparkFor(key: PeriodTile['key'], s: StatsPayload): number[] {
  if (key === 'today') return s.daily.slice(-14).map((d) => d.total)
  if (key === 'week') return s.weekly.slice(-12).map((w) => w.total)
  if (key === 'month') {
    const months = new Map<string, number>()
    for (const d of s.daily) months.set(d.day.slice(0, 7), (months.get(d.day.slice(0, 7)) ?? 0) + d.total)
    return [...months.values()].slice(-6)
  }
  // Running total at the end of each of the last 12 weeks.
  const weeks = s.weekly.slice(-12)
  const inWeeks = weeks.reduce((a, w) => a + w.total, 0)
  return runningTotal(s.tiles.find((t) => t.key === 'all')!.now.total - inWeeks, weeks.map((w) => w.total))
}

function Delta({ now, before, label }: { now: number; before: number; label: string }) {
  const diff = now - before
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1 text-xs">
      <span className={cn('inline-flex items-center gap-0.5 font-medium', diff > 0 ? 'text-success-text' : diff < 0 ? 'text-danger-text' : 'text-muted-foreground')}>
        {diff > 0 ? <ArrowUpRight className="size-3.5" /> : diff < 0 ? <ArrowDownRight className="size-3.5" /> : null}
        {diff > 0 ? '+' : ''}
        {fmtNumber(diff)}
      </span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  )
}

/** Who sent them: a coloured dot beside each count (the dot carries the series, the text stays ink). */
export function ViaSplit({ split, className }: { split: { agent: number; email: number; manual: number }; className?: string }) {
  return (
    <ul className={cn('flex flex-col gap-x-3 gap-y-1 text-xs text-muted-foreground sm:flex-row sm:flex-wrap', className)}>
      {VIA_ORDER.map((v) => (
        <li key={v} className="inline-flex items-center gap-1.5">
          <span className="size-2 shrink-0 rounded-full" style={{ background: viaConfig[v].color }} aria-hidden />
          <span className="font-medium text-foreground">{fmtNumber(split[v])}</span> {VIA_LABEL[v].toLowerCase()}
        </li>
      ))}
    </ul>
  )
}

/** Submitted today, this week, this month and all time, in your timezone, each with its trend. */
export function SubmittedTiles({ stats, pending }: { stats: StatsPayload | undefined; pending?: boolean }) {
  if (pending || !stats) return <MetricsSkeleton count={4} className="xl:grid-cols-4" />
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {stats.tiles.map((t) => {
        const meta = TILE[t.key]
        return (
          <div key={t.key} className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-3 shadow-[var(--shadow-card)] sm:p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-muted-foreground">{meta.label}</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{fmtNumber(t.now.total)}</p>
              </div>
              <Sparkline values={sparkFor(t.key, stats)} label={`${meta.label}, ${meta.spark}`} />
            </div>
            {t.before && meta.before ? (
              <Delta now={t.now.total} before={t.before.total} label={meta.before} />
            ) : (
              <span className="text-xs text-muted-foreground">{stats.firstSentAt ? `since ${dayLabel(stats.firstSentAt.slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' })}` : 'nothing sent yet'}</span>
            )}
            <ViaSplit split={t.now} className="border-t pt-2" />
          </div>
        )
      })}
    </div>
  )
}

/** The second row: pace, best day, streak, replies, next steps and today's search. */
export function Highlights({ stats, pending }: { stats: StatsPayload | undefined; pending?: boolean }) {
  if (pending || !stats) return <MetricsSkeleton count={6} />
  const h = stats.highlights
  return (
    <MetricGrid className="xl:grid-cols-6">
      <Metric label="Daily average" icon={<TrendingUp />} value={fmtNumber(h.avgPerDay7)} hint="last 7 days" />
      <Metric label="Best day" icon={<Trophy />} value={fmtNumber(h.bestDay?.count ?? 0)} hint={h.bestDay ? dayLabel(h.bestDay.day, { weekday: 'short', day: 'numeric', month: 'short' }) : 'none yet'} />
      <Metric label="Streak" icon={<Flame />} value={`${h.streak.current} ${h.streak.current === 1 ? 'day' : 'days'}`} hint={`best ${h.streak.best} in a row`} />
      <Metric label="People replied" icon={<Inbox />} value={fmtNumber(h.personReplies)} hint={h.replyRate === null ? undefined : `${h.replyRate}% of sent`} href="/mail" />
      <Metric label="Next steps" icon={<Sparkles />} value={fmtNumber(h.nextSteps)} tone={h.nextSteps ? 'success' : 'default'} hint={`${fmtNumber(h.interviews)} interviews · ${fmtNumber(h.offers)} offers`} href="/mail" />
      <Metric label="Jobs found today" icon={<Search />} value={fmtNumber(h.foundToday)} hint={`${fmtNumber(h.fitToday)} fit (score ${stats.fitThreshold}+)`} href="/jobs" />
    </MetricGrid>
  )
}
