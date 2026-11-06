'use client'

import { Infinity as InfinityIcon, Loader2, Radar } from 'lucide-react'
import type { ContinuousStatus } from '@/lib/pipeline/continuous'
import { api, useApiMutation, useApiQuery } from '@/lib/api/hooks'
import { SOURCE_IDS, SOURCE_LABELS, type SourceId } from '@/lib/domain'
import { fmtAgo, fmtNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import { Section } from '@/components/shared/section'
import { StatusDot } from '@/components/shared/status-badge'
import { NumberInput } from '@/components/settings/fields'
import type { SettingsPayload } from '@/components/settings/settings-form'

type Continuous = ContinuousStatus['settings']

const INVALIDATE: unknown[][] = [['settings'], ['runs', 'continuous'], ['runs'], ['status']]

/**
 * Continuous search (Runs page): one switch keeps searching, run after run, until it is switched off.
 * The chips choose where it searches (none ticked = every source switched on in Settings → Search).
 */
export function ContinuousSearch() {
  const status = useApiQuery<ContinuousStatus>(['runs', 'continuous'], '/api/runs/continuous', { refetchInterval: 10_000 })
  const settings = useApiQuery<SettingsPayload>(['settings'], '/api/settings')
  const save = useApiMutation<Continuous, SettingsPayload>((c) => api.patch<SettingsPayload>('/api/settings', { search: { continuous: c } }), { invalidate: INVALIDATE, silent: true })
  const s = status.data?.data
  const c = s?.settings
  const sources = settings.data?.data.search.sources as Record<string, { enabled?: boolean } | undefined> | undefined
  // Sources switched on in Settings → Search; company boards and your own pages are always offered.
  const offered = SOURCE_IDS.filter((id) => id === 'ats' || id === 'scrape' || sources?.[id]?.enabled)
  const picked = new Set<SourceId>(c?.sources ?? [])
  const update = (patch: Partial<Continuous>) => c && save.mutate({ ...c, ...patch })
  const toggle = (id: SourceId) => {
    const next = new Set(picked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    update({ sources: [...next] })
  }
  const running = s?.running
  const where = running?.source ? `${SOURCE_LABELS[running.source.source as SourceId] ?? running.source.source}${running.source.country ? ` (${running.source.country})` : ''}` : null

  return (
    <Section
      title={
        <span className="inline-flex items-center gap-2">
          <InfinityIcon className="size-4 text-muted-foreground" /> Continuous search
        </span>
      }
      description="Searches again as soon as a run ends, until you switch it off. Pick where it looks; none picked means every source that is on in Settings → Search."
      actions={
        <div className="flex items-center gap-2">
          {save.isPending ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
          <Switch checked={!!c?.enabled} disabled={!c || save.isPending} onCheckedChange={(on) => update({ enabled: on })} aria-label="Continuous search" />
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5 rounded-md border bg-muted/40 px-3 py-2.5 text-sm">
          {running ? (
            <>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <StatusDot tone="success" label="searching" />
                <span className="font-medium">Searching now</span>
                {where ? <span className="text-muted-foreground">· {where}</span> : null}
                <span className="text-muted-foreground">
                  · started {fmtAgo(running.startedAt)} · {fmtNumber(running.fetched)} fetched · {fmtNumber(running.newJobs)} new · {fmtNumber(running.ranked)} ranked
                </span>
              </p>
              {running.lastLog ? <p className="truncate text-xs text-muted-foreground">{running.lastLog.message}</p> : null}
            </>
          ) : (
            <p className="flex items-center gap-2">
              <StatusDot tone={c?.enabled ? 'warning' : 'muted'} label={c?.enabled ? 'waiting' : 'off'} />
              {c?.enabled ? `Between loops: the next one starts within ${c.pauseMinutes ? `${c.pauseMinutes} minute${c.pauseMinutes === 1 ? '' : 's'}` : 'a minute'}.` : 'Off: searches run on the schedule only.'}
            </p>
          )}
          {s ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Radar className="size-3.5" /> Last 24 hours: {fmtNumber(s.last24h.loops)} continuous loop{s.last24h.loops === 1 ? '' : 's'}, {fmtNumber(s.last24h.newJobs)} new jobs, {fmtNumber(s.last24h.ranked)} ranked
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">Where to search {picked.size ? `(${picked.size} picked)` : '(all sources that are on)'}</p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sources for continuous search">
            {offered.map((id) => {
              const on = picked.has(id)
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={on}
                  disabled={!c || save.isPending}
                  onClick={() => toggle(id)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-60',
                    on ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-foreground hover:bg-accent',
                  )}
                >
                  {SOURCE_LABELS[id] ?? id}
                </button>
              )
            })}
            {picked.size ? (
              <button type="button" onClick={() => update({ sources: [] })} className="rounded-full px-2.5 py-1 text-xs text-primary-text hover:underline">
                Use all
              </button>
            ) : null}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          Pause between loops
          <NumberInput integer min={0} max={120} value={c?.pauseMinutes ?? 2} onValueChange={(n) => update({ pauseMinutes: n })} className="w-20" aria-label="Pause between loops in minutes" />
          minutes
        </label>
      </div>
    </Section>
  )
}
