'use client'

import Link from 'next/link'
import { useState } from 'react'
import { BookOpen, Bot, Gauge, KeyRound, ScanSearch, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GeminiKeysPanel } from './gemini-keys-panel'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import type { FailureCategory } from '@/lib/ai/schemas'
import type { GeminiStats } from '@/lib/analytics/gemini'
import { useApiQuery } from '@/lib/api/hooks'
import { AI_TASK_LABEL, type AiTask } from '@/lib/domain'
import { fmtAgo, fmtNumber } from '@/lib/format'
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { DiagnosisNote, FAILURE_LABEL, type Diagnosis } from '@/components/applications/diagnosis-note'
import { Metric, MetricGrid } from '@/components/shared/page-header'
import { Section } from '@/components/shared/section'
import { MetricsSkeleton, SectionSkeleton } from '@/components/shared/skeletons'
import { BarList } from './breakdowns'
import { dayLabel } from './stats-data'

const SLOT_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)']

function taskLabel(task: string): string {
  return task === 'other' ? 'Everything else' : (AI_TASK_LABEL[task as AiTask] ?? task)
}

/** Stats > AI: what the AI did, how the screenshot form driver is doing, and what it learned. */
export function GeminiSection() {
  const [showKeys, setShowKeys] = useState(false)
  const { data, isPending, isError, error } = useApiQuery<GeminiStats>(['dashboard', 'gemini'], '/api/dashboard/gemini', { refetchInterval: 60_000 })
  const g = data?.data

  const config: ChartConfig = Object.fromEntries([...(g?.tasks ?? []).map((t, i) => [t, { label: taskLabel(t), color: SLOT_COLORS[i] }]), ['other', { label: taskLabel('other'), color: 'var(--chart-5)' }]])
  const series = [...(g?.tasks ?? []), 'other']
  const fortnight = g ? g.perDay.reduce((a, d) => a + d.total, 0) : 0
  const driverRate = g && g.driver.runs ? Math.round((g.driver.submitted / g.driver.runs) * 100) : null

  return (
    <section aria-labelledby="gemini" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="gemini" className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Bot className="size-4 text-muted-foreground" /> AI
        </h2>
        <div className="flex items-center gap-3">
          <Button size="sm" variant="outline" aria-expanded={showKeys} onClick={() => setShowKeys((v) => !v)}>
            <Gauge /> {showKeys ? 'Hide API details' : 'API details'}
          </Button>
          <Link href="/settings/ai" className="inline-flex items-center gap-1 text-xs font-medium text-primary-text hover:underline">
            <KeyRound className="size-3.5" /> Keys and limits
          </Link>
        </div>
      </div>

      {showKeys ? <GeminiKeysPanel /> : null}

      {isError ? <p className="text-sm text-danger-text">{error.message}</p> : null}

      {isPending || !g ? (
        <MetricsSkeleton count={4} />
      ) : (
        <MetricGrid>
          <Metric label="AI calls today" icon={<Sparkles />} value={fmtNumber(g.today.calls)} hint={`${fmtNumber(g.today.errors)} errors · since the quota day began`} tone={g.today.errors > g.today.calls * 0.1 ? 'warning' : 'default'} />
          <Metric label="Requests left today" icon={<KeyRound />} value={fmtNumber(g.today.remaining)} hint={`across ${g.today.keys} keys`} href="/settings/ai" />
          <Metric
            label="Forms the screenshot driver finished"
            icon={<ScanSearch />}
            value={driverRate === null ? '-' : `${driverRate}%`}
            hint={`${fmtNumber(g.driver.submitted)} of ${fmtNumber(g.driver.runs)} it took over, last 7 days`}
          />
          <Metric label="Lessons learned" icon={<BookOpen />} value={fmtNumber(g.playbook.lessons)} hint={`${fmtNumber(g.playbook.siteKinds)} kinds of site · ${fmtNumber(g.playbook.lessons7d)} new this week · ${fmtNumber(g.playbook.fixHints)} fix hints`} />
        </MetricGrid>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        {isPending || !g ? (
          <SectionSkeleton rows={5} className="lg:col-span-3" />
        ) : (
          <Section className="lg:col-span-3" title="AI calls per day" description={`${fmtNumber(fortnight)} calls in the last 14 days, by what they were for`}>
            <ChartContainer config={config} className="aspect-auto h-60 w-full">
              <BarChart data={g.perDay} margin={{ left: 0, right: 4, top: 8, bottom: 0 }} barCategoryGap="18%">
                <CartesianGrid vertical={false} />
                <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={(v) => dayLabel(String(v))} tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} tick={{ fontSize: 11 }} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}K` : String(v))} />
                <ChartTooltip
                  cursor={{ fill: 'var(--accent)', opacity: 0.5 }}
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_v, p) => {
                        const row = p?.[0]?.payload as { day?: string; total?: number; errors?: number } | undefined
                        return row?.day ? `${dayLabel(row.day, { weekday: 'short', day: 'numeric', month: 'short' })} · ${fmtNumber(row.total ?? 0)} calls, ${fmtNumber(row.errors ?? 0)} errors` : ''
                      }}
                    />
                  }
                />
                <ChartLegend content={<ChartLegendContent />} />
                {series.map((t, i) => (
                  <Bar key={t} dataKey={t} stackId="task" fill={`var(--color-${t})`} stroke="var(--card)" strokeWidth={2} radius={i === series.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={24} isAnimationActive={false} />
                ))}
              </BarChart>
            </ChartContainer>
          </Section>
        )}
        {isPending || !g ? (
          <SectionSkeleton rows={5} className="lg:col-span-2" />
        ) : (
          <Section className="lg:col-span-2" title="Today, by task" href="/settings/ai" hrefLabel="Details" description="AI calls since the quota day began">
            <BarList rows={g.today.byTask.map((t) => ({ key: t.task, label: taskLabel(t.task), count: t.calls }))} empty="No calls yet today." />
          </Section>
        )}
      </div>

      {isPending || !g ? (
        <SectionSkeleton rows={4} />
      ) : (
        <Section title="Why forms stopped, last 7 days" href="/queue" hrefLabel="Needs you" description="The AI looks at a screenshot of where each form stopped and says what blocked it and how to get past it next time">
          {g.stopped.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No readings yet. Each form that stops from now on gets one.</p>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              <BarList rows={g.stopped.map((s) => ({ key: s.key, label: FAILURE_LABEL[s.key as FailureCategory]?.label ?? 'Other', count: s.count }))} />
              <ul className="flex flex-col gap-2">
                {g.recent.map((r) => (
                  <li key={r.attemptId}>
                    <Link href={`/applications/${r.applicationId}`} className="block rounded-md hover:bg-accent/40">
                      <p className="truncate px-1 text-xs font-medium">
                        {r.company} <span className="font-normal text-muted-foreground">· {r.title} · {fmtAgo(r.finishedAt)}</span>
                      </p>
                      <DiagnosisNote d={r.diagnosis as Diagnosis} compact className="mt-1" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}
    </section>
  )
}
