import { getAiUsageSummary } from '@/lib/ai/usage'
import { ok, route } from '@/lib/api/response'
import { db } from '@/lib/db'
import { queueHealth } from '@/lib/queue'
import { apiQuotaUsage } from '@/lib/quota'
import { getSettings } from '@/lib/settings/service'
import { intervalToCron } from '@/worker/scheduler'

/** GET /api/status → top-bar status chip: current/last run, next run, queue, quota, unread. */
export const GET = route(async () => {
  const [settings, running, lastRun, queue, usage, unread, awaiting, queuedSends, worker, applyWorker] = await Promise.all([
    getSettings(),
    db.searchRun.findFirst({ where: { status: 'RUNNING' }, orderBy: { startedAt: 'desc' }, include: { _count: { select: { sources: true } } } }),
    db.searchRun.findFirst({ where: { status: { not: 'RUNNING' } }, orderBy: { startedAt: 'desc' } }),
    queueHealth(),
    getAiUsageSummary(),
    db.notification.count({ where: { readAt: null } }),
    db.application.count({ where: { status: { in: ['REVIEW', 'NEEDS_HUMAN'] } } }),
    db.application.findFirst({ where: { status: 'QUEUED' }, orderBy: { scheduledFor: 'asc' }, select: { scheduledFor: true } }),
    db.workerStatus.findUnique({ where: { id: 1 } }),
    // Row 2 exists only when the worker runs as two processes (WORKER_ROLE=search and WORKER_ROLE=apply).
    db.workerStatus.findUnique({ where: { id: 2 } }),
  ])
  const workerState = workerStateOf(worker)
  const applyState = applyWorker ? workerStateOf(applyWorker) : null
  const lastScheduled = await db.searchRun.findFirst({ where: { trigger: 'SCHEDULED' }, orderBy: { startedAt: 'desc' }, select: { startedAt: true } })
  const base = lastScheduled?.startedAt ?? lastRun?.startedAt ?? new Date()
  const nextRunAt = settings.searchEnabled ? new Date(base.getTime() + settings.searchIntervalMinutes * 60_000) : null
  return ok({
    running: running ? { id: running.id, startedAt: running.startedAt, sourcesDone: running._count.sources } : null,
    lastRun: lastRun ? { id: lastRun.id, status: lastRun.status, startedAt: lastRun.startedAt, finishedAt: lastRun.finishedAt, totalNew: lastRun.totalNew, totalDrafted: lastRun.totalDrafted } : null,
    nextRunAt,
    searchEnabled: settings.searchEnabled,
    cron: intervalToCron(settings.searchIntervalMinutes),
    queue,
    quota: { totalCalls: usage.totalCalls, remainingDaily: usage.remainingDaily, keys: usage.keys.map((k) => ({ label: k.label, usedToday: k.usedToday, rpdLimit: k.rpdLimit, enabled: k.enabled, cooldownUntil: k.cooldownUntil })) },
    unreadNotifications: unread,
    awaitingReview: awaiting,
    nextSendAt: queuedSends?.scheduledFor ?? null,
    sendingEnabled: settings.email.sendingEnabled,
    googleSearch: await apiQuotaUsage('google_cse'),
    // Before the first heartbeat ever (older deployments) fall back to "the queue is reachable".
    workerAlive: worker ? workerState === 'active' : !('error' in (queue as object)),
    worker: { state: workerState, heartbeatAt: worker?.heartbeatAt ?? null, nextWakeAt: worker?.nextWakeAt ?? null, hostname: worker?.hostname ?? null },
    applyWorker: applyWorker ? { state: applyState, heartbeatAt: applyWorker.heartbeatAt, nextWakeAt: applyWorker.nextWakeAt, hostname: applyWorker.hostname } : null,
  })
})

/** A heartbeat older than 3 minutes means the worker process is gone (it ticks every minute while active). */
function workerStateOf(row: { state: string; heartbeatAt: Date } | null): 'active' | 'sleeping' | 'down' | 'unknown' {
  if (!row) return 'unknown'
  if (row.state === 'sleeping') return 'sleeping'
  return row.state === 'active' && Date.now() - row.heartbeatAt.getTime() < 3 * 60_000 ? 'active' : 'down'
}
