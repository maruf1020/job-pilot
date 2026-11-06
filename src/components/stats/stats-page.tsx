'use client'

import { useState } from 'react'
import Link from 'next/link'
import { BarChart3 } from 'lucide-react'
import { fmtAgo } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shared/page-header'
import { Section } from '@/components/shared/section'
import { AllTimeFunnel, CalendarHeatmap, RepliesBreakdown, SourcesList, WhereApplied } from './breakdowns'
import { GeminiSection } from './gemini-section'
import { type RangeDays, useStats } from './stats-data'
import { FoundChart, RangeToggle, SubmissionsChart } from './submissions-chart'
import { Highlights, SubmittedTiles } from './submitted-tiles'

/** Stats (/stats): every number about applying, in your timezone. */
export function StatsPage() {
  const { data, isPending, isError, error } = useStats()
  const [range, setRange] = useState<RangeDays>(30)
  const s = data?.data

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Stats"
        description="How many applications went out, how they went, where to, what came back, and what the AI did."
        meta={s ? <span>Days in {s.timezone} · updated {fmtAgo(s.generatedAt)}</span> : null}
        actions={<RangeToggle value={range} onChange={setRange} />}
      />

      {isError ? (
        <Section>
          <p className="text-sm font-medium text-danger-text">Stats failed to load</p>
          <p className="text-sm text-muted-foreground">{error.message}</p>
        </Section>
      ) : null}

      <SubmittedTiles stats={s} pending={isPending} />
      <Highlights stats={s} pending={isPending} />

      <SubmissionsChart stats={s} pending={isPending} range={range} onRangeChange={setRange} />

      <div className="grid gap-6 lg:grid-cols-2">
        <FoundChart stats={s} pending={isPending} range={range} />
        <AllTimeFunnel stats={s} pending={isPending} />
      </div>

      <CalendarHeatmap stats={s} pending={isPending} />

      <div className="grid gap-6 lg:grid-cols-2">
        <RepliesBreakdown stats={s} pending={isPending} />
        <SourcesList stats={s} pending={isPending} />
      </div>

      <WhereApplied stats={s} pending={isPending} />

      <GeminiSection />
    </div>
  )
}

/** Today's block: the four counts and the submissions chart, with a way to the full Stats page. */
export function SubmittedOverview() {
  const { data, isPending } = useStats()
  const s = data?.data
  return (
    <section aria-labelledby="your-numbers" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="your-numbers" className="text-sm font-semibold text-foreground">
          Applications
        </h2>
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/stats" />}>
          <BarChart3 /> All stats
        </Button>
      </div>
      <SubmittedTiles stats={s} pending={isPending} />
      <SubmissionsChart stats={s} pending={isPending} />
    </section>
  )
}
