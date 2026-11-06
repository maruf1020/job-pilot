'use client'

import type { FunnelStep } from '@/lib/analytics/week-funnel'
import { fmtNumber } from '@/lib/format'
import { Section } from '@/components/shared/section'

/** The last 7 days as a horizontal funnel: found, fit, applied, replied, next step (plan 7.4). */
export function WeekFunnel({ steps }: { steps: FunnelStep[] | null | undefined }) {
  const max = Math.max(1, ...(steps ?? []).map((s) => s.count))
  return (
    <Section title="This week" description="Activity in the last 7 days; each step shows its share of the one before">
      {!steps ? (
        <p className="text-sm text-muted-foreground">Not available.</p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {steps.map((s, i) => (
            <li key={s.key} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-3 text-sm">
              <span className="truncate text-muted-foreground">{s.label}</span>
              <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div className="h-full rounded-full" style={{ width: `${Math.max(1.5, (s.count / max) * 100)}%`, background: `var(--chart-${i === 4 ? 4 : 1})`, opacity: i === 4 ? 1 : 1 - i * 0.12 }} />
              </div>
              <span className="w-24 text-right tabular-nums">
                <span className="font-medium">{fmtNumber(s.count)}</span>
                {s.pctOfPrev !== null ? <span className="ml-1.5 text-xs text-muted-foreground">{s.pctOfPrev}%</span> : null}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  )
}
