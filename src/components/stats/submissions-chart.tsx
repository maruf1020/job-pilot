'use client'

import { useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import type { Split } from '@/lib/analytics/stats'
import { fmtNumber } from '@/lib/format'
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Section } from '@/components/shared/section'
import { SectionSkeleton } from '@/components/shared/skeletons'
import { dayLabel, RANGES, type RangeDays, runningTotal, type StatsPayload, sumSplits, VIA_LABEL, VIA_ORDER, viaConfig, weekLabel } from './stats-data'

type View = 'day' | 'week' | 'total'

const VIEWS: Array<{ key: View; label: string }> = [
  { key: 'day', label: 'Per day' },
  { key: 'week', label: 'Per week' },
  { key: 'total', label: 'Running total' },
]

const totalConfig = { total: { label: 'Applications in total', color: 'var(--chart-1)' } } satisfies ChartConfig

const foundConfig = {
  found: { label: 'Jobs found', color: 'var(--chart-1)' },
  fit: { label: 'Fit jobs', color: 'var(--chart-2)' },
} satisfies ChartConfig

/** One toggle row: filters sit together above the chart, never inside it. */
export function Segmented<T extends string | number>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: ReadonlyArray<{ key: T; label: string }>; label: string }) {
  return (
    <ToggleGroup
      value={[String(value)]}
      onValueChange={(vals) => {
        const hit = options.find((o) => String(o.key) === vals[0])
        if (hit) onChange(hit.key)
      }}
      variant="outline"
      size="sm"
      spacing={0}
      aria-label={label}
    >
      {options.map((o) => (
        <ToggleGroupItem key={String(o.key)} value={String(o.key)} className="px-2.5 text-xs">
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

export function RangeToggle({ value, onChange }: { value: RangeDays; onChange: (v: RangeDays) => void }) {
  return <Segmented value={value} onChange={onChange} options={RANGES.map((r) => ({ key: r.days, label: r.label }))} label="Time range" />
}

const axisTick = { fontSize: 11 }

/**
 * Applications submitted, stacked by how they went out (browser agent, email, by hand), per day or
 * per week, or as a running total. `range` may be controlled by the page (Stats) or kept here (Today).
 */
export function SubmissionsChart({ stats, pending, range: rangeProp, onRangeChange, actions }: { stats: StatsPayload | undefined; pending?: boolean; range?: RangeDays; onRangeChange?: (r: RangeDays) => void; actions?: React.ReactNode }) {
  const [view, setView] = useState<View>('day')
  const [ownRange, setOwnRange] = useState<RangeDays>(30)
  const range = rangeProp ?? ownRange
  const setRange = onRangeChange ?? setOwnRange

  if (pending || !stats) return <SectionSkeleton rows={5} />

  const days = stats.daily.slice(-range)
  const weeks = stats.weekly
  const inRange = view === 'week' ? sumSplits(weeks) : sumSplits(days)
  const allTotal = stats.tiles.find((t) => t.key === 'all')!.now.total
  const cumulative = runningTotal(allTotal - sumSplits(days).total, days.map((d) => d.total)).map((total, i) => ({ day: days[i].day, total }))
  const barData: Array<Split & { x: string; day?: string; week?: string }> = view === 'week' ? weeks.map((w) => ({ x: w.week, ...w })) : days.map((d) => ({ x: d.day, ...d }))
  const rows = view === 'week' ? weeks.map((w) => ({ key: w.week, label: weekLabel(w.week), ...w })) : days.map((d) => ({ key: d.day, label: dayLabel(d.day, { weekday: 'short', day: 'numeric', month: 'short' }), ...d }))
  const span = view === 'week' ? `the last ${weeks.length} weeks` : `the last ${range} days`

  return (
    <Section
      title="Applications submitted"
      description={
        view === 'total'
          ? `${fmtNumber(allTotal)} in total; ${fmtNumber(inRange.total)} of them in ${span}`
          : `${fmtNumber(inRange.total)} in ${span}: ${fmtNumber(inRange.agent)} by the browser agent, ${fmtNumber(inRange.email)} by email, ${fmtNumber(inRange.manual)} by hand`
      }
      actions={actions}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented value={view} onChange={setView} options={VIEWS} label="Chart view" />
        {view !== 'week' && !rangeProp ? <RangeToggle value={range} onChange={setRange} /> : null}
      </div>

      {view === 'total' ? (
        <ChartContainer config={totalConfig} className="aspect-auto h-60 w-full sm:h-72">
          <AreaChart data={cumulative} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} tickFormatter={(v) => dayLabel(String(v))} tick={axisTick} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} tick={axisTick} />
            <ChartTooltip cursor={{ stroke: 'var(--border-strong)' }} content={<ChartTooltipContent labelFormatter={(_v, p) => dayLabel(String(p?.[0]?.payload?.day ?? ''), { weekday: 'short', day: 'numeric', month: 'short' })} />} />
            <Area type="monotone" dataKey="total" stroke="var(--color-total)" strokeWidth={2} fill="var(--color-total)" fillOpacity={0.1} activeDot={{ r: 4, stroke: 'var(--card)', strokeWidth: 2 }} isAnimationActive={false} />
          </AreaChart>
        </ChartContainer>
      ) : (
        <ChartContainer config={viaConfig} className="aspect-auto h-60 w-full sm:h-72">
          <BarChart data={barData} margin={{ left: 0, right: 4, top: 8, bottom: 0 }} barCategoryGap="18%">
            <CartesianGrid vertical={false} />
            <XAxis dataKey="x" tickLine={false} axisLine={false} tickMargin={8} minTickGap={view === 'week' ? 16 : 24} tickFormatter={(v) => dayLabel(String(v))} tick={axisTick} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} tick={axisTick} />
            <ChartTooltip
              cursor={{ fill: 'var(--accent)', opacity: 0.5 }}
              content={
                <ChartTooltipContent
                  labelFormatter={(_v, p) => {
                    const row = p?.[0]?.payload as { day?: string; week?: string; total?: number } | undefined
                    if (!row) return ''
                    const when = row.week ? weekLabel(row.week) : dayLabel(row.day ?? '', { weekday: 'short', day: 'numeric', month: 'short' })
                    return `${when} · ${fmtNumber(row.total ?? 0)} in total`
                  }}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            {VIA_ORDER.map((v, i) => (
              <Bar
                key={v}
                dataKey={v}
                stackId="via"
                fill={`var(--color-${v})`}
                // The card colour around each segment is the 2px gap between stacked pieces.
                stroke="var(--card)"
                strokeWidth={2}
                radius={i === VIA_ORDER.length - 1 ? [4, 4, 0, 0] : 0}
                maxBarSize={24}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ChartContainer>
      )}

      <details className="group mt-3 rounded-md border">
        <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-primary-text hover:bg-accent/50 [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">Show as table</span>
          <span className="hidden group-open:inline">Hide table</span>
        </summary>
        <div className="max-h-80 overflow-auto border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-3">{view === 'week' ? 'Week' : 'Day'}</TableHead>
                {VIA_ORDER.map((v) => (
                  <TableHead key={v} className="text-right">
                    {VIA_LABEL[v]}
                  </TableHead>
                ))}
                <TableHead className="pr-3 text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...rows].reverse().map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="whitespace-nowrap pl-3">{r.label}</TableCell>
                  {VIA_ORDER.map((v) => (
                    <TableCell key={v} className="text-right tabular-nums">
                      {fmtNumber(r[v])}
                    </TableCell>
                  ))}
                  <TableCell className="pr-3 text-right font-medium tabular-nums">{fmtNumber(r.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </details>
    </Section>
  )
}

/** Jobs the search found per day, and how many of them were a fit (same unit, one axis). */
export function FoundChart({ stats, pending, range }: { stats: StatsPayload | undefined; pending?: boolean; range: RangeDays }) {
  if (pending || !stats) return <SectionSkeleton rows={5} />
  const days = stats.daily.slice(-range)
  const found = days.reduce((a, d) => a + d.found, 0)
  const fit = days.reduce((a, d) => a + d.fit, 0)
  return (
    <Section title="Jobs found" description={`${fmtNumber(found)} new postings in the last ${range} days; ${fmtNumber(fit)} scored ${stats.fitThreshold} or more`}>
      <ChartContainer config={foundConfig} className="aspect-auto h-60 w-full">
        <LineChart data={days} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} tickFormatter={(v) => dayLabel(String(v))} tick={axisTick} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={44} tick={axisTick} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}K` : String(v))} />
          <ChartTooltip cursor={{ stroke: 'var(--border-strong)' }} content={<ChartTooltipContent labelFormatter={(_v, p) => dayLabel(String(p?.[0]?.payload?.day ?? ''), { weekday: 'short', day: 'numeric', month: 'short' })} />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Line type="monotone" dataKey="found" stroke="var(--color-found)" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: 'var(--card)', strokeWidth: 2 }} isAnimationActive={false} />
          <Line type="monotone" dataKey="fit" stroke="var(--color-fit)" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: 'var(--card)', strokeWidth: 2 }} isAnimationActive={false} />
        </LineChart>
      </ChartContainer>
    </Section>
  )
}
