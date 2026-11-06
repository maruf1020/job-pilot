'use client'

import { useState } from 'react'
import { Target } from 'lucide-react'
import type { Dimension, GroupStats, ScoreboardPayload } from '@/lib/analytics/conversion'
import { useApiQuery } from '@/lib/api/hooks'
import { countryName } from '@/lib/domain'
import { cn } from '@/lib/utils'
import { flagEmoji, fmtNumber } from '@/lib/format'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Segmented } from '@/components/shared/filter-bar'
import { Metric, MetricGrid } from '@/components/shared/page-header'
import { Section } from '@/components/shared/section'
import { MetricsSkeleton } from '@/components/shared/skeletons'

const DIMENSION_LABEL: Record<Dimension, string> = {
  channel: 'Channel',
  region: 'Region',
  country: 'Country',
  addressSource: 'Address',
  scoreBand: 'Score',
  month: 'Month',
  sentBy: 'Sent by',
  promptVersion: 'Prompt',
}

const KEY_LABEL: Record<string, string> = {
  email: 'Email',
  form: 'Company form',
  posting: 'From the posting',
  website: 'Company website',
  company: 'Company website',
  verified: 'Verified by the mail server',
  search: 'Web search',
  guessed: 'Guessed',
  manual: 'Typed by you',
  batch: 'Auto-apply batch',
  auto: 'Auto-send / bounce retry',
  you: 'You',
}

const REGION_LABEL: Record<string, string> = {
  EU: 'Europe (EU/EEA)',
  UK: 'United Kingdom',
  CA: 'Canada',
  AU: 'Australia',
  US: 'United States',
  NZ: 'New Zealand',
  remote: 'Remote',
  unknown: 'Unknown',
  other: 'Other',
}

function keyLabel(dim: Dimension, key: string): string {
  if (dim === 'country') return key === 'unknown' ? 'Unknown' : `${flagEmoji(key)} ${countryName(key)}`
  if (dim === 'region') return REGION_LABEL[key] ?? key
  return KEY_LABEL[key] ?? key
}

function rateText(g: GroupStats): string {
  return g.tooEarly ? 'too early' : `${g.rate}%`
}

function TargetHint({ target, met }: { target: string; met: boolean | null }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Target className="size-3" /> target {target}
      {met ? <span className="text-success-text">· met</span> : null}
    </span>
  )
}

/** Genuine replies per channel, region, country, address source and more (plan-big.md 1.7). */
export function Scoreboard() {
  const { data, isPending, isError, error } = useApiQuery<ScoreboardPayload>(['dashboard', 'scoreboard'], '/api/dashboard/scoreboard', { refetchInterval: 5 * 60_000 })
  const [dim, setDim] = useState<Dimension>('channel')
  const s = data?.data

  return (
    <Section
      title="Reply scoreboard"
      description="Interview, positive and needs-info replies from a person, per delivered application, judged 7 days after sending. Groups under 50 deliveries say too early."
    >
      {isError ? (
        <p className="text-sm text-danger-text">{error.message}</p>
      ) : isPending || !s ? (
        <MetricsSkeleton count={4} />
      ) : (
        <div className="flex flex-col gap-4">
          <MetricGrid className="xl:grid-cols-3 2xl:grid-cols-6">
            <Metric
              label="Email genuine replies"
              value={rateText(s.measures.genuineRate.email)}
              hint={<TargetHint target="4%" met={s.measures.genuineRate.email.rate === null ? null : s.measures.genuineRate.email.rate >= 4} />}
            />
            <Metric
              label="Form genuine replies"
              value={rateText(s.measures.genuineRate.form)}
              hint={<TargetHint target="5%" met={s.measures.genuineRate.form.rate === null ? null : s.measures.genuineRate.form.rate >= 5} />}
            />
            <Metric label="Interview requests" value={fmtNumber(s.measures.interviews)} tone={s.measures.interviews ? 'success' : 'default'} hint={<TargetHint target="3" met={s.measures.interviews >= 3} />} />
            <Metric label="Form applications" value={fmtNumber(s.measures.formApplications)} hint={<TargetHint target="60+" met={s.measures.formApplications >= 60} />} />
            <Metric
              label="Bounces, last 7 days"
              value={`${s.measures.bounceRate7d.rate}%`}
              tone={s.measures.bounceRate7d.rate >= 5 ? 'danger' : 'default'}
              hint={`${s.measures.bounceRate7d.bounced} of ${s.measures.bounceRate7d.sent} · target under 2%`}
            />
            <Metric
              label="Applied within 7 days"
              value={s.measures.appliedWithin7d === null ? '-' : `${s.measures.appliedWithin7d}%`}
              hint={<TargetHint target="50%" met={s.measures.appliedWithin7d === null ? null : s.measures.appliedWithin7d >= 50} />}
            />
          </MetricGrid>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {fmtNumber(s.overall.sent)} sends judged · {fmtNumber(s.pending)} newer than 7 days not judged yet
            </p>
            <Segmented size="sm" value={dim} onChange={setDim} options={(Object.keys(DIMENSION_LABEL) as Dimension[]).map((d) => ({ value: d, label: DIMENSION_LABEL[d] }))} />
          </div>

          {s.groups[dim].length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No sends older than 7 days yet.</p>
          ) : (
            <>
              <ul className="divide-y rounded-lg border sm:hidden">
                {s.groups[dim].map((g) => (
                  <li key={g.key} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{keyLabel(dim, g.key)}</p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {fmtNumber(g.genuine)} genuine of {fmtNumber(g.delivered)} delivered · {fmtNumber(g.interviews)} interviews
                      </p>
                    </div>
                    <span className={cn('shrink-0 tabular-nums', g.tooEarly ? 'text-xs text-muted-foreground' : 'font-medium')}>{rateText(g)}</span>
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto rounded-lg border sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-3">{DIMENSION_LABEL[dim]}</TableHead>
                      <TableHead className="text-right">Sent</TableHead>
                      <TableHead className="text-right">Delivered</TableHead>
                      <TableHead className="text-right">Genuine</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="hidden text-right md:table-cell">Redirects</TableHead>
                      <TableHead className="hidden text-right md:table-cell">Rejections</TableHead>
                      <TableHead className="hidden text-right lg:table-cell">Bounced</TableHead>
                      <TableHead className="pr-3 text-right">Interviews</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {s.groups[dim].map((g) => (
                      <TableRow key={g.key}>
                        <TableCell className="max-w-48 truncate pl-3">{keyLabel(dim, g.key)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtNumber(g.sent)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtNumber(g.delivered)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtNumber(g.genuine)}</TableCell>
                        <TableCell className={cn('text-right tabular-nums', g.tooEarly ? 'text-muted-foreground' : 'font-medium')}>{rateText(g)}</TableCell>
                        <TableCell className="hidden text-right tabular-nums md:table-cell">{fmtNumber(g.redirects)}</TableCell>
                        <TableCell className="hidden text-right tabular-nums md:table-cell">{fmtNumber(g.rejections)}</TableCell>
                        <TableCell className="hidden text-right tabular-nums lg:table-cell">{fmtNumber(g.bounced)}</TableCell>
                        <TableCell className="pr-3 text-right tabular-nums">{fmtNumber(g.interviews)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>
      )}
    </Section>
  )
}
