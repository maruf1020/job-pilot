'use client'

import Link from 'next/link'
import { Activity, Loader2, PauseCircle, Zap } from 'lucide-react'
import { useApiQuery } from '@/lib/api/hooks'
import { fmtAgo, fmtIn } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export interface StatusPayload {
  running: { id: string; startedAt: string; sourcesDone: number } | null
  lastRun: { id: string; status: string; startedAt: string; finishedAt: string | null; totalNew: number; totalDrafted: number } | null
  nextRunAt: string | null
  searchEnabled: boolean
  cron: string
  quota: { totalCalls: number; remainingDaily: number; keys: Array<{ label: string; usedToday: number; rpdLimit: number; enabled: boolean; cooldownUntil: string | null }> }
  unreadNotifications: number
  awaitingReview: number
  nextSendAt: string | null
  sendingEnabled?: boolean
  googleSearch?: { used: number; limit: number }
  workerAlive: boolean
  worker?: { state: 'active' | 'sleeping' | 'down' | 'unknown'; heartbeatAt: string | null; nextWakeAt: string | null; hostname: string | null }
  /** The browser-agent process, when the worker runs as two processes; null = one process does both. */
  applyWorker?: { state: 'active' | 'sleeping' | 'down' | 'unknown'; heartbeatAt: string | null; nextWakeAt: string | null; hostname: string | null } | null
}

export function useStatus() {
  return useApiQuery<StatusPayload>(['status'], '/api/status', { refetchInterval: 15_000 })
}

export function StatusChip() {
  const { data } = useStatus()
  const s = data?.data
  if (!s) return null
  const running = Boolean(s.running)
  const label = running ? 'Running…' : !s.searchEnabled ? 'Search paused' : `Next run ${fmtIn(s.nextRunAt)}`
  const Icon = running ? Loader2 : !s.searchEnabled ? PauseCircle : Activity
  const anyDown = s.worker?.state === 'down' || s.applyWorker?.state === 'down'
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            href={running && s.running ? `/runs/${s.running.id}` : '/runs'}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium',
              running ? 'border-info/40 bg-info-soft text-info-text' : 'text-muted-foreground hover:bg-muted',
            )}
          />
        }
      >
        <Icon className={cn('size-3.5', running && 'animate-spin')} />
        {anyDown ? <span className="size-2 rounded-full bg-destructive" aria-label="A worker is down" /> : null}
        <span className="hidden sm:inline">{label}</span>
        <span className="hidden items-center gap-1 border-l pl-1.5 lg:inline-flex">
          <Zap className="size-3" /> {s.quota.remainingDaily}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        <div className="space-y-1 text-xs">
          <p>{label}</p>
          {s.lastRun ? (
            <p>
              Last run {fmtAgo(s.lastRun.startedAt)}: {s.lastRun.status.toLowerCase().replace(/_/g, ' ')}, {s.lastRun.totalNew} new, {s.lastRun.totalDrafted} drafted
            </p>
          ) : null}
          <p>AI quota left today: {s.quota.remainingDaily} requests across {s.quota.keys.filter((k) => k.enabled).length} keys</p>
          {s.googleSearch ? (
            <p>
              Google search calls today: {s.googleSearch.used} / {s.googleSearch.limit} (hard cap)
            </p>
          ) : null}
          {s.sendingEnabled === false ? <p className="text-warning-text">Sending paused: nothing goes out until you allow it in Settings → Email</p> : s.nextSendAt ? <p>Next email {fmtIn(s.nextSendAt)}</p> : null}
          {s.worker?.state === 'sleeping' ? (
            <p className="text-muted-foreground">Worker paused{s.worker.nextWakeAt ? `, resumes ${fmtIn(s.worker.nextWakeAt)}` : ''}</p>
          ) : s.worker?.state === 'down' ? (
            <p className="text-destructive">Worker down{s.worker.heartbeatAt ? ` (last seen ${fmtAgo(s.worker.heartbeatAt)})` : ''}</p>
          ) : !s.workerAlive ? (
            <p className="text-destructive">Worker queue unreachable</p>
          ) : null}
          {s.applyWorker?.state === 'down' ? (
            <p className="text-destructive">Apply worker down{s.applyWorker.heartbeatAt ? ` (last seen ${fmtAgo(s.applyWorker.heartbeatAt)})` : ''}: browser applications have stopped</p>
          ) : s.applyWorker?.state === 'sleeping' ? (
            <p className="text-muted-foreground">Apply worker paused{s.applyWorker.nextWakeAt ? `, resumes ${fmtIn(s.applyWorker.nextWakeAt)}` : ''}</p>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
