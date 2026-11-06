'use client'

import type { getKeyUsage } from '@/lib/ai/usage'
import { useApiQuery } from '@/lib/api/hooks'
import { fmtAgo, fmtNumber } from '@/lib/format'
import { Section } from '@/components/shared/section'
import { SectionSkeleton } from '@/components/shared/skeletons'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type KeyUsage = Awaited<ReturnType<typeof getKeyUsage>>

/** "1.2M" / "34K": token counts get large fast. */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}K`
  return fmtNumber(n)
}

/**
 * Stats > AI > API details: every AI key (any provider) with its calls and tokens per day, week, month and
 * year, and the requests it can still make today. Free tiers cap requests per day per model (not tokens) and
 * paid keys have a daily call cap, so "left" is requests.
 */
export function GeminiKeysPanel() {
  const { data, isPending, isError, error } = useApiQuery<KeyUsage>(['ai-keys', 'usage'], '/api/ai-keys/usage', { refetchInterval: 60_000 })
  const u = data?.data
  if (isPending) return <SectionSkeleton rows={6} />
  if (isError || !u) return <p className="text-sm text-danger-text">{error?.message ?? 'Could not load the key usage'}</p>

  const sum = (pick: (k: KeyUsage['keys'][number]) => number) => u.keys.reduce((a, k) => a + pick(k), 0)
  const leftOf = (k: KeyUsage['keys'][number]) => (k.enabled ? k.left : 0)
  const limitOf = (k: KeyUsage['keys'][number]) => (k.enabled ? k.limit : 0)
  const enabled = u.keys.filter((k) => k.enabled).length

  return (
    <Section
      title="API details"
      description={`${u.keys.length} AI keys (${enabled} on). Quotas reset at each provider's midnight (Google: Pacific time, others: UTC) and limit requests, not tokens, so "Left today" counts requests.`}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Key</TableHead>
            <TableHead className="text-right">Calls today</TableHead>
            <TableHead className="text-right">Tokens today</TableHead>
            <TableHead className="text-right">7 days</TableHead>
            <TableHead className="text-right">30 days</TableHead>
            <TableHead className="text-right">Year</TableHead>
            <TableHead className="text-right">Left today</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {u.keys.map((k) => {
            const exhausted = k.models.filter((m) => m.exhausted).map((m) => m.model)
            const status = !k.enabled
              ? 'Off'
              : k.cooldownUntil
                ? `Resting until ${new Date(k.cooldownUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : exhausted.length
                  ? `Daily limit reached: ${exhausted.join(', ')}`
                  : k.lastUsedAt
                    ? `Used ${fmtAgo(k.lastUsedAt)}`
                    : 'Not used yet'
            return (
              <TableRow key={k.id}>
                <TableCell>
                  <span className="font-medium">{k.label}</span> <span className="text-xs text-muted-foreground">{k.providerLabel}</span> <span className="font-mono text-xs text-muted-foreground">...{k.keyHint.replace(/^[^\w]+/, '')}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtNumber(k.calls)}
                  {k.errors ? <span className="text-xs text-warning-text"> ({fmtNumber(k.errors)} failed)</span> : null}
                </TableCell>
                <TableCell className="text-right tabular-nums" title={`${fmtNumber(k.inputTokens)} in · ${fmtNumber(k.outputTokens)} out`}>
                  {compact(k.totalTokens)}
                </TableCell>
                <TableCell className="text-right tabular-nums" title={`${fmtNumber(k.weekCalls)} calls`}>{compact(k.weekTokens)}</TableCell>
                <TableCell className="text-right tabular-nums" title={`${fmtNumber(k.monthCalls)} calls`}>{compact(k.monthTokens)}</TableCell>
                <TableCell className="text-right tabular-nums" title={`${fmtNumber(k.yearCalls)} calls`}>{compact(k.yearTokens)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtNumber(leftOf(k))}
                  <span className="text-xs text-muted-foreground"> / {fmtNumber(limitOf(k))}</span>
                </TableCell>
                <TableCell className="max-w-56 truncate text-xs text-muted-foreground" title={k.lastError ?? undefined}>
                  {status}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="font-medium">All keys</TableCell>
            <TableCell className="text-right tabular-nums">{fmtNumber(sum((k) => k.calls))}</TableCell>
            <TableCell className="text-right tabular-nums">{compact(sum((k) => k.totalTokens))}</TableCell>
            <TableCell className="text-right tabular-nums">{compact(sum((k) => k.weekTokens))}</TableCell>
            <TableCell className="text-right tabular-nums">{compact(sum((k) => k.monthTokens))}</TableCell>
            <TableCell className="text-right tabular-nums">{compact(sum((k) => k.yearTokens))}</TableCell>
            <TableCell className="text-right tabular-nums">
              {fmtNumber(sum(leftOf))}
              <span className="text-xs text-muted-foreground"> / {fmtNumber(sum(limitOf))}</span>
            </TableCell>
            <TableCell />
          </TableRow>
        </TableFooter>
      </Table>
      <p className="mt-2 text-xs text-muted-foreground">
        Per model today: {u.models.map((m) => `${m} ${fmtNumber(u.keys.reduce((a, k) => a + (k.enabled ? (k.models.find((x) => x.model === m)?.left ?? 0) : 0), 0))} left`).join(' · ')}
      </p>
    </Section>
  )
}
