'use client'

import { Activity } from 'lucide-react'
import { useApiQuery } from '@/lib/api/hooks'
import { fmtAgo, fmtDateTime } from '@/lib/format'
import type { LoopStatus } from '@/lib/mail/loops'
import { cn } from '@/lib/utils'
import { ToneBadge } from '@/components/shared/status-badge'

interface LoopsData {
  loops: LoopStatus[]
}

function LoopCell({ l }: { l: LoopStatus }) {
  return (
    <div className="bg-surface min-w-0 rounded-md border px-3 py-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-foreground font-semibold">{l.id}</span>
        <span className="text-muted-foreground">every {l.intervalMin} min</span>
        <ToneBadge tone={l.late ? 'danger' : 'success'} dot className="ml-auto">
          {l.late ? 'Late' : 'On time'}
        </ToneBadge>
      </div>
      <p
        className={cn('mt-1 text-xs', l.late ? 'text-danger-text' : 'text-muted-foreground')}
        title={l.lastRunAt ? fmtDateTime(l.lastRunAt) : undefined}
      >
        {l.lastRunAt ? `Last run ${fmtAgo(l.lastRunAt)}` : 'No run in the log yet'}
      </p>
      {l.text ? (
        <p className="text-foreground mt-0.5 truncate text-xs" title={l.text}>
          {l.text}
        </p>
      ) : null}
    </div>
  )
}

/** The supervisor loops (5, 15 and 30 minutes) from storage/logs/supervisor-rounds.log: last run, age and what it said. */
export function LoopsCard({ className }: { className?: string }) {
  const q = useApiQuery<LoopsData>(['loops'], '/api/mail/loops', { refetchInterval: 30_000 })
  const loops = q.data?.data.loops
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <h2 className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
        <Activity className="size-3.5" /> Loops
      </h2>
      {loops ? (
        <div className="grid gap-2 sm:grid-cols-3">
          {loops.map((l) => (
            <LoopCell key={l.id} l={l} />
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">
          {q.isError ? 'Could not read the loop log.' : 'Reading the loop log...'}
        </p>
      )}
    </div>
  )
}
