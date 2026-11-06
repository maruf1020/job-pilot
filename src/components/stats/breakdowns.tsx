'use client'

import type { ReactNode } from 'react'
import { countryName, SOURCE_LABELS, type SourceId } from '@/lib/domain'
import { flagEmoji, fmtNumber, titleCase } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Section } from '@/components/shared/section'
import { SectionSkeleton } from '@/components/shared/skeletons'
import { dayLabel, type StatsPayload } from './stats-data'

interface BarRow {
  key: string
  label: ReactNode
  count: number
  note?: ReactNode
}

/**
 * Horizontal bars in one hue: the label on the left, the value at the bar's tip, the share of the
 * whole beside it. Bars are thin with rounded ends and grow from one baseline.
 */
export function BarList({ rows, color = 'var(--chart-1)', total, empty = 'Nothing yet.' }: { rows: BarRow[]; color?: string; total?: number; empty?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  const whole = total ?? rows.reduce((a, r) => a + r.count, 0)
  if (!rows.length || !rows.some((r) => r.count > 0)) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_4.5rem] items-center gap-3 text-sm sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_5rem]">
          <span className="min-w-0 truncate" title={typeof r.label === 'string' ? r.label : undefined}>
            {r.label}
            {r.note ? <span className="ml-1.5 hidden text-xs text-muted-foreground sm:inline">{r.note}</span> : null}
          </span>
          <div className="h-2 min-w-0" aria-hidden>
            <div className="h-full rounded-r-[4px]" style={{ width: `${r.count ? Math.max(1.5, (r.count / max) * 100) : 0}%`, background: color }} />
          </div>
          <span className="text-right tabular-nums">
            <span className="font-medium">{fmtNumber(r.count)}</span>
            {whole ? <span className="ml-1.5 text-xs text-muted-foreground">{Math.round((r.count / whole) * 100)}%</span> : null}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** All time: found, passed your rules, fit, applied, a person replied, a next step. */
export function AllTimeFunnel({ stats, pending }: { stats: StatsPayload | undefined; pending?: boolean }) {
  if (pending || !stats) return <SectionSkeleton rows={6} />
  const max = Math.max(1, ...stats.funnel.map((s) => s.count))
  return (
    <Section title="Funnel, all time" description="Each step with its share of the step before it">
      <ol className="flex flex-col gap-3">
        {stats.funnel.map((s, i) => {
          const prev = i > 0 ? stats.funnel[i - 1].count : 0
          const pct = i > 0 && prev ? Math.round((s.count / prev) * 1000) / 10 : null
          return (
            <li key={s.key} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate">{s.label}</span>
                <span className="shrink-0 tabular-nums">
                  <span className="font-medium">{fmtNumber(s.count)}</span>
                  {pct !== null ? <span className="ml-1.5 text-xs text-muted-foreground">{pct}% of the step before</span> : null}
                </span>
              </div>
              <div className="h-2" aria-hidden>
                <div className="h-full rounded-r-[4px] bg-chart-1" style={{ width: `${Math.max(1, (s.count / max) * 100)}%` }} />
              </div>
            </li>
          )
        })}
      </ol>
    </Section>
  )
}

/** Replies by kind, one count per application: people first, then machines. */
export function RepliesBreakdown({ stats, pending }: { stats: StatsPayload | undefined; pending?: boolean }) {
  if (pending || !stats) return <SectionSkeleton rows={6} />
  const people = stats.replies.filter((r) => r.person && r.count > 0)
  const machines = stats.replies.filter((r) => !r.person)
  const sent = stats.tiles.find((t) => t.key === 'all')!.now.total
  return (
    <Section title="Replies" href="/mail" hrefLabel="Mail" description={`Per application; shares are of the ${fmtNumber(sent)} applications sent`}>
      <div className="flex flex-col gap-5">
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">From people</p>
          <BarList total={sent} rows={people.map((r) => ({ key: r.key, label: r.label, count: r.count, note: r.nextStep ? 'next step' : undefined }))} empty="No replies from people yet." />
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Automatic</p>
          <BarList total={sent} color="var(--chart-5)" rows={machines.map((r) => ({ key: r.key, label: r.label, count: r.count }))} />
        </div>
      </div>
    </Section>
  )
}

const ROUTE_LABEL: Record<string, string> = {
  email: 'Email',
  other: 'Other websites',
  rest: 'Other ATS',
  linkedin: 'LinkedIn Easy Apply',
  smartrecruiters: 'SmartRecruiters',
  bamboohr: 'BambooHR',
  jazzhr: 'JazzHR',
  successfactors: 'SuccessFactors',
  icims: 'iCIMS',
}

export function WhereApplied({ stats, pending }: { stats: StatsPayload | undefined; pending?: boolean }) {
  if (pending || !stats) return <SectionSkeleton rows={8} />
  return (
    <Section title="Where applications went" description="By country of the job, and by email or the company's application system">
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Country</p>
          <BarList
            rows={stats.byCountry.map((c) => ({
              key: c.key,
              label: c.key === 'other' ? 'Other countries' : c.key === 'unknown' ? 'Unknown' : `${flagEmoji(c.key)} ${countryName(c.key)}`,
              count: c.count,
            }))}
          />
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">How</p>
          <BarList rows={stats.byRoute.map((r) => ({ key: r.key, label: ROUTE_LABEL[r.key] ?? titleCase(r.key), count: r.count }))} />
        </div>
      </div>
    </Section>
  )
}

export function SourcesList({ stats, pending }: { stats: StatsPayload | undefined; pending?: boolean }) {
  if (pending || !stats) return <SectionSkeleton rows={8} />
  return (
    <Section title="Where jobs come from" href="/runs" hrefLabel="Runs" description="Postings per source, all time (one job can come from several)">
      <BarList
        rows={stats.bySource.map((s) => ({
          key: s.key,
          label: s.key === 'other' ? 'Other sources' : (SOURCE_LABELS[s.key as SourceId] ?? titleCase(s.key)),
          count: s.count,
        }))}
      />
    </Section>
  )
}

const WEEKS = 26
const ROW_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun']
/** Sequential steps of one hue over the muted surface: light to dark in light mode, dark to bright in dark mode. */
const STEP_MIX = [0, 28, 50, 74, 100]

function stepOf(count: number, max: number): number {
  if (!count) return 0
  const r = count / max
  return r <= 0.25 ? 1 : r <= 0.5 ? 2 : r <= 0.75 ? 3 : 4
}

function cellColor(step: number): string {
  return step === 0 ? 'var(--muted)' : `color-mix(in oklch, var(--chart-1) ${STEP_MIX[step]}%, var(--muted))`
}

/** Six months of days, one square each, darker for more applications. */
export function CalendarHeatmap({ stats, pending }: { stats: StatsPayload | undefined; pending?: boolean }) {
  if (pending || !stats) return <SectionSkeleton rows={4} />
  const byDay = new Map(stats.daily.map((d) => [d.day, d.total]))
  const todayDow = (new Date(`${stats.today}T00:00:00Z`).getUTCDay() + 6) % 7
  const firstMonday = shift(stats.today, -todayDow - (WEEKS - 1) * 7)
  const columns = Array.from({ length: WEEKS }, (_, w) => Array.from({ length: 7 }, (_, d) => shift(firstMonday, w * 7 + d)))
  const inView = columns.flat().filter((d) => d <= stats.today)
  const max = Math.max(1, ...inView.map((d) => byDay.get(d) ?? 0))
  const activeDays = inView.filter((d) => (byDay.get(d) ?? 0) > 0).length
  const total = inView.reduce((a, d) => a + (byDay.get(d) ?? 0), 0)

  return (
    <Section title="Every day, last 6 months" description={`${fmtNumber(total)} applications on ${activeDays} days; darker squares are busier days (busiest ${fmtNumber(max)})`}>
      <div className="grid w-fit max-w-full grid-cols-[auto_minmax(0,1fr)] gap-x-2">
        <div />
        <div className="grid gap-[3px] pb-1 text-[10px] text-muted-foreground" style={{ gridTemplateColumns: `repeat(${WEEKS}, minmax(0, 1.125rem))` }} aria-hidden>
          {columns.map((col, i) => {
            const month = col[0].slice(0, 7)
            const prev = i > 0 ? columns[i - 1][0].slice(0, 7) : null
            return (
              <span key={col[0]} className="overflow-visible whitespace-nowrap">
                {month !== prev && i < WEEKS - 2 ? dayLabel(col[0], { month: 'short' }) : ''}
              </span>
            )
          })}
        </div>
        <div className="grid grid-rows-7 gap-[3px] text-[10px] leading-none text-muted-foreground" aria-hidden>
          {ROW_LABELS.map((l, i) => (
            <span key={i} className="flex items-center">
              {l}
            </span>
          ))}
        </div>
        <div className="grid grid-flow-col grid-rows-7 gap-[3px]" style={{ gridTemplateColumns: `repeat(${WEEKS}, minmax(0, 1.125rem))` }} role="img" aria-label={`Applications per day for the last ${WEEKS} weeks: ${fmtNumber(total)} in total on ${activeDays} days.`}>
          {columns.flat().map((d) => {
            const future = d > stats.today
            const n = byDay.get(d) ?? 0
            return (
              <span
                key={d}
                title={future ? undefined : `${dayLabel(d, { weekday: 'short', day: 'numeric', month: 'short' })}: ${fmtNumber(n)} submitted`}
                className={cn('aspect-square w-full rounded-[3px]', d === stats.today && 'ring-1 ring-foreground/50 ring-offset-1 ring-offset-card')}
                style={{ background: future ? 'transparent' : cellColor(stepOf(n, max)) }}
              />
            )
          })}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground" aria-hidden>
        Less
        {STEP_MIX.map((_, i) => (
          <span key={i} className="size-2.5 rounded-[3px]" style={{ background: cellColor(i) }} />
        ))}
        More
      </div>
    </Section>
  )
}

function shift(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}
