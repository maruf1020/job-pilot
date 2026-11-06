import { db } from '@/lib/db'
import type { SourceId } from '@/lib/domain'
import { getSettings } from '@/lib/settings/service'
import { isRunOrphaned } from './run'

/**
 * Continuous search (Settings → Search, or the switch on Runs): the next run starts as soon as the
 * last one ended plus a short pause, and it keeps going until switched off. The scheduled full and
 * board runs still fire; a run already going makes them skip, so nothing runs twice.
 */

export interface ContinuousState {
  enabled: boolean
  /** A run is going and still sends heartbeats. */
  running: boolean
  lastFinishedAt: Date | null
  pauseMinutes: number
}

/** Start the next loop now? Pure, unit-tested. */
export function shouldStartContinuous(s: ContinuousState, now = Date.now()): boolean {
  if (!s.enabled || s.running) return false
  if (!s.lastFinishedAt) return true
  return now - s.lastFinishedAt.getTime() >= s.pauseMinutes * 60_000
}

/** Called every 30 s by the search worker: enqueue the next loop when it is due. True when one was sent. */
export async function continuousTick(start: (sources: SourceId[] | undefined) => Promise<unknown>): Promise<boolean> {
  const settings = await getSettings()
  const c = settings.search.continuous
  if (!c.enabled) return false
  const [active, last] = await Promise.all([
    db.searchRun.findFirst({ where: { status: 'RUNNING' }, orderBy: { startedAt: 'desc' }, select: { status: true, startedAt: true, heartbeatAt: true } }),
    db.searchRun.findFirst({ where: { finishedAt: { not: null } }, orderBy: { finishedAt: 'desc' }, select: { finishedAt: true } }),
  ])
  const due = shouldStartContinuous({ enabled: c.enabled, running: !!active && !isRunOrphaned(active), lastFinishedAt: last?.finishedAt ?? null, pauseMinutes: c.pauseMinutes })
  if (!due) return false
  await start(c.sources.length ? (c.sources as SourceId[]) : undefined)
  return true
}

/** What the Runs page shows for the loop: today's loops, what they found, and the run going now. */
export async function continuousStatus(now = new Date()) {
  const settings = await getSettings()
  const dayStart = new Date(now.getTime() - 24 * 3_600_000)
  const [loops, running] = await Promise.all([
    db.searchRun.findMany({ where: { trigger: 'CONTINUOUS', startedAt: { gte: dayStart } }, select: { totalNew: true, totalRanked: true, status: true } }),
    db.searchRun.findFirst({
      where: { status: 'RUNNING' },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        trigger: true,
        startedAt: true,
        totalFetched: true,
        totalNew: true,
        totalRanked: true,
        sources: { orderBy: { id: 'desc' }, take: 1, select: { source: true, country: true, query: true } },
        logs: { orderBy: { createdAt: 'desc' }, take: 1, select: { message: true, createdAt: true } },
      },
    }),
  ])
  return {
    settings: settings.search.continuous,
    last24h: {
      loops: loops.length,
      newJobs: loops.reduce((a, r) => a + r.totalNew, 0),
      ranked: loops.reduce((a, r) => a + r.totalRanked, 0),
    },
    running: running
      ? {
          id: running.id,
          trigger: running.trigger,
          startedAt: running.startedAt.toISOString(),
          fetched: running.totalFetched,
          newJobs: running.totalNew,
          ranked: running.totalRanked,
          source: running.sources[0] ?? null,
          lastLog: running.logs[0] ? { message: running.logs[0].message, at: running.logs[0].createdAt.toISOString() } : null,
        }
      : null,
  }
}

export type ContinuousStatus = Awaited<ReturnType<typeof continuousStatus>>
