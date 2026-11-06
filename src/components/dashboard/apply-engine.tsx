'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ImageIcon, Target } from 'lucide-react'
import type { ApplyMeasures, RateRow, TodaySample } from '@/lib/analytics/apply-engine'
import { useApiQuery } from '@/lib/api/hooks'
import { cn } from '@/lib/utils'
import { flagEmoji, fmtAgo, fmtNumber, titleCase } from '@/lib/format'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState, Metric, MetricGrid } from '@/components/shared/page-header'
import { Section } from '@/components/shared/section'
import { MetricsSkeleton, SectionSkeleton } from '@/components/shared/skeletons'

type Payload = {
  measures: ApplyMeasures
  sample: Omit<TodaySample, 'items'> & {
    items: Array<Omit<TodaySample['items'][number], 'finishedAt'> & { finishedAt: string | null }>
  }
}

const LANE_LABEL: Record<string, string> = {
  ats: 'Known ATS forms',
  other: 'Other websites',
  gated: 'Sign-in / account sites',
  linkedin: 'LinkedIn Easy Apply',
  single: 'Single jobs you started',
  'before lanes': 'Before lanes (history)',
}

export function useApplyEngine() {
  return useApiQuery<Payload>(['dashboard', 'apply-engine'], '/api/dashboard/apply-engine', { refetchInterval: 5 * 60_000 })
}

function Goal({ text, met }: { text: string; met: boolean | null }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Target className="size-3" /> target {text}
      {met ? <span className="text-success-text">· met</span> : null}
    </span>
  )
}

function pctTone(p: number | null): string {
  if (p === null) return 'text-muted-foreground'
  return p < 60 ? 'text-danger-text' : p >= 85 ? 'text-success-text font-medium' : 'font-medium'
}

/** Success per ATS / lane: a table from sm up, compact rows on phones. */
function RateTable({ rows: all, label, keyLabel }: { rows: RateRow[]; label: string; keyLabel: (k: string) => string }) {
  const [more, setMore] = useState(false)
  if (!all.length) return <p className="px-4 py-6 text-center text-sm text-muted-foreground">No attempts in this period.</p>
  const rows = more ? all : all.slice(0, 8)
  return (
    <>
      <ul className="divide-y sm:hidden">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium">{keyLabel(r.key)}</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {fmtNumber(r.submitted)} of {fmtNumber(r.attempts)} · {fmtNumber(r.needsHuman)} need you · {fmtNumber(r.failed)} failed
              </p>
            </div>
            <span className={cn('shrink-0 tabular-nums', pctTone(r.successPct))}>{r.successPct === null ? '-' : `${r.successPct}%`}</span>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">{label}</TableHead>
              <TableHead className="text-right">Tries</TableHead>
              <TableHead className="text-right">Submitted</TableHead>
              <TableHead className="text-right">Success</TableHead>
              <TableHead className="text-right">Needs you</TableHead>
              <TableHead className="text-right">Failed</TableHead>
              <TableHead className="hidden pr-4 text-right 2xl:table-cell">Cancelled</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell className="max-w-48 truncate pl-4">{keyLabel(r.key)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtNumber(r.attempts)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtNumber(r.submitted)}</TableCell>
                <TableCell className={cn('text-right tabular-nums', pctTone(r.successPct))}>{r.successPct === null ? '-' : `${r.successPct}%`}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtNumber(r.needsHuman)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtNumber(r.failed)}</TableCell>
                <TableCell className="hidden pr-4 text-right tabular-nums 2xl:table-cell">{fmtNumber(r.cancelled)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {all.length > 8 ? (
        <button type="button" onClick={() => setMore((m) => !m)} className="w-full border-t px-4 py-2.5 text-left text-xs font-medium text-primary-text hover:bg-accent/50">
          {more ? 'Show fewer' : `Show all ${all.length}`}
        </button>
      ) : null}
    </>
  )
}

/** Apply-engine measures (plan-apply-all.md section 5): waste, coverage, and success per ATS and lane. Daily counts live in Stats. */
export function ApplyEngine() {
  const { data, isPending, isError, error } = useApplyEngine()
  const d = data?.data
  const m = d?.measures

  if (isError) return <Section title="Apply engine"><p className="text-sm text-danger-text">{error.message}</p></Section>
  if (isPending || !m)
    return (
      <div className="flex flex-col gap-3">
        <MetricsSkeleton count={3} />
        <SectionSkeleton rows={4} />
      </div>
    )

  return (
    <div className="flex flex-col gap-4">
      <MetricGrid className="md:grid-cols-3 xl:grid-cols-3">
        <Metric
          label="Wasted attempts"
          value={m.waste.share === null ? '-' : `${m.waste.share}%`}
          tone={m.waste.share !== null && m.waste.share >= 30 ? 'warning' : 'default'}
          hint={<Goal text="under 15%" met={m.waste.share === null ? null : m.waste.share < 15} />}
        />
        <Metric
          label="Applied in 7 days"
          value={m.coverage.share === null ? '-' : `${m.coverage.share}%`}
          hint={<Goal text="80%" met={m.coverage.share === null ? null : m.coverage.share >= 80} />}
        />
        <Metric label="Replies over a day" value={fmtNumber(m.repliesOver24h)} tone={m.repliesOver24h > 0 ? 'warning' : 'default'} hint={<Goal text="0" met={m.repliesOver24h === 0} />} href="/mail" />
      </MetricGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Wasted attempts" description={`Stopped for reasons that are not the form, last ${m.days} days · ${fmtNumber(m.waste.wasted)} of ${fmtNumber(m.waste.attempts)}`}>
          {m.waste.byCategory.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">None.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {m.waste.byCategory.map((c) => {
                const pct = m.waste.attempts ? Math.round((c.count / m.waste.attempts) * 100) : 0
                return (
                  <li key={c.category} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate">{c.label}</span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{fmtNumber(c.count)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-warning" style={{ width: `${Math.max(2, pct)}%` }} />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>
        <Section title="Success per lane" description="The apply lanes; older attempts have no lane" contentClassName="p-0">
          <RateTable rows={m.byLane} label="Lane" keyLabel={(k) => LANE_LABEL[k] ?? titleCase(k)} />
        </Section>
      </div>
      <Section title="Success per ATS" description="Submitted out of tries that ended submitted, needing you or failed; target 85%" contentClassName="p-0">
        <RateTable rows={m.byFamily} label="ATS" keyLabel={(k) => (k === 'other' ? 'Other websites' : titleCase(k))} />
      </Section>
    </div>
  )
}

/** Spot check: random submissions of the last 24 hours with every answer the agent gave. */
export function TodaySampleSection() {
  const { data, isPending } = useApplyEngine()
  const sample = data?.data.sample
  return (
    <Section
      title="Today's sample"
      count={sample ? sample.items.length : null}
      description={sample ? `Random submissions of the last 24 hours (of ${fmtNumber(sample.total)}). Fix a wrong answer in Settings → Browser → Your answers so it never repeats.` : undefined}
      contentClassName="p-0"
    >
      {isPending || !sample ? (
        <SectionSkeleton rows={3} className="border-0 shadow-none" />
      ) : !sample.items.length ? (
        <EmptyState compact className="m-4" title="No submissions in the last 24 hours" />
      ) : (
        <ul className="divide-y">
          {sample.items.map((s) => (
            <li key={s.id}>
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-accent/50 [&::-webkit-details-marker]:hidden">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {flagEmoji(s.countryCode)} {s.company} <span className="font-normal text-muted-foreground">· {s.title}</span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {titleCase(s.family)} · {fmtAgo(s.finishedAt)} · {s.fields.length} answers
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-primary-text group-open:hidden">Show answers</span>
                  <span className="hidden shrink-0 text-xs text-muted-foreground group-open:inline">Hide</span>
                </summary>
                <div className="flex flex-col gap-3 border-t bg-muted/40 px-4 py-3">
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Link href={`/applications/${s.applicationId}`} className="inline-flex h-7 items-center rounded-md border bg-card px-2.5 font-medium hover:bg-accent">
                      Application
                    </Link>
                    {Array.from({ length: Math.min(s.screenshots, 4) }, (_, i) => (
                      <a
                        key={i}
                        href={`/api/portal-attempts/${s.id}/screenshot?n=${i + 1}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-7 items-center gap-1 rounded-md border bg-card px-2.5 hover:bg-accent"
                      >
                        <ImageIcon className="size-3.5" /> Screenshot {i + 1}
                      </a>
                    ))}
                  </div>
                  {s.fields.length ? (
                    <dl className="grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[minmax(0,14rem)_1fr]">
                      {s.fields.slice(0, 40).map((f, i) => (
                        <div key={i} className="contents">
                          <dt className="truncate text-muted-foreground" title={f.label}>
                            {f.label}
                          </dt>
                          <dd className="min-w-0 break-words">
                            {f.value || <span className="text-muted-foreground">(empty)</span>}
                            {f.source ? <span className="text-muted-foreground"> · {f.source}</span> : null}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="text-xs text-muted-foreground">No answers were recorded for this form.</p>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
