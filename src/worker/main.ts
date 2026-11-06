import os from 'node:os'
import { PgBoss } from 'pg-boss'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { sendDailyDigest } from '@/lib/email/digest'
import { dispatchDueSends } from '@/lib/email/send'
import { markNoResponse, pollReplies, sendDueFollowUps } from '@/lib/email/track'
import { evaluateAutoSend } from '@/lib/pipeline/decide'
import { draftApplication } from '@/lib/pipeline/draft'
import { executeSearchRun, failStaleRuns, RunAlreadyActiveError } from '@/lib/pipeline/run'
import { continuousTick } from '@/lib/pipeline/continuous'
import { tickApplyBatch } from '@/lib/pipeline/apply-batch'
import { failInterruptedContactBatches, runContactBatch } from '@/lib/pipeline/contact-batch'
import { resumeInterruptedBoardRuns, runBoardDiscovery } from '@/lib/sponsors/board-run'
import { runScrapeTarget } from '@/lib/pipeline/scrape-run'
import { enqueuePortalAttempt, ensureQueues, queueConnectionString, QUEUES, type BoardDiscoveryJob, type BrowserControlJob, type ContactBatchJob, type DraftJob, type PortalApplyJob, type ScrapeJob, type SearchRunJob } from '@/lib/queue'
import { notify } from '@/lib/notifications'
import { ensureSettings, getSettings } from '@/lib/settings/service'
import { failInterruptedAttempts, runPortalAttempt } from '@/lib/apply/attempt'
import { queuePortalAttempt } from '@/lib/apply/service'
import type { AttemptMode } from '@/lib/apply/types'
import { pruneStepShots } from '@/lib/apply/files'
import { canHandOver, capBannerTabs, handOverToYou, reopenPausedHandovers, resumeHandovers, sweepFinishedTabs } from '@/lib/apply/handover'
import { browserControl, browserHeartbeat } from '@/lib/apply/control'
import { scanInbox } from '@/lib/apply/inbox-scan'
import { inYourChrome, tickPortalBatch } from '@/lib/apply/portal-batch'
import { checkPortalStatuses } from '@/lib/apply/status-check'
import { isActive, nextTransition, parseActiveWindow } from './active-hours'
import { parseWorkerRole, queuesForRole, runsApplySide, runsSearchSide, runsTelegramPoller, statusRowId, type WorkerRole } from './roles'
import { lightRunSources, syncSchedules } from './scheduler'
import { startTelegramService, stopTelegramService } from '@/lib/telegram/service'

/** Board searches the previous worker was running when it stopped; queued again once the queue is up. */
let boardRunsToResume: Array<{ id: string; resumes: number }> = []

const log = (scope: string) => (message: string, meta?: unknown) => console.log(`[worker:${scope}] ${message}`, meta ?? '')

const VERSION = process.env.npm_package_version ?? 'dev'
/** all (one process, the default) | search | apply: see roles.ts. */
const ROLE: WorkerRole = parseWorkerRole(process.env.WORKER_ROLE)
const TICK_MS = 60_000
/** How long to let running jobs finish before pausing for the night. */
const PAUSE_GRACE_MS = 10 * 60_000

async function registerWorkers(boss: PgBoss, role: WorkerRole) {
  if (runsSearchSide(role)) await registerSearchWorkers(boss)
  if (runsApplySide(role)) await registerApplyWorkers(boss)
}

async function registerSearchWorkers(boss: PgBoss) {
  await boss.work<SearchRunJob>(QUEUES.searchRun, { pollingIntervalSeconds: 5 }, async (jobs) => {
    for (const job of jobs) {
      const d = job.data ?? { trigger: 'SCHEDULED' as const }
      try {
        const runId = await executeSearchRun(d.trigger ?? 'SCHEDULED', { sources: d.sources, skipDiscovery: d.skipDiscovery, skipDrafts: d.skipDrafts })
        log('search')(`run ${runId} finished`)
      } catch (err) {
        if (err instanceof RunAlreadyActiveError) log('search')('skipped: a run is already active')
        else throw err
      }
    }
  })

  // Light runs between the full ones: company boards and visa-flagged feeds only. A full run in progress wins.
  await boss.work<SearchRunJob>(QUEUES.searchBoards, { pollingIntervalSeconds: 10, batchSize: 1 }, async (jobs) => {
    for (const job of jobs) {
      const sources = job.data?.sources?.length ? job.data.sources : lightRunSources()
      try {
        const runId = await executeSearchRun('SCHEDULED', { sources })
        log('search')(`board run ${runId} finished (${sources.join(', ')})`)
      } catch (err) {
        if (err instanceof RunAlreadyActiveError) log('search')('board run skipped: a run is already active')
        else throw err
      }
    }
  })

  await boss.work<DraftJob>(QUEUES.draftJob, { pollingIntervalSeconds: 3, batchSize: 1 }, async (jobs) => {
    for (const job of jobs) {
      const app = await draftApplication(job.data.jobId, { note: job.data.note, force: job.data.force })
      const decision = await evaluateAutoSend(app.id, job.data.autoQueue ? { force: true, requirePassed: true } : {})
      log('draft')(`${job.data.jobId}: ${app.status} → ${decision.outcome}${decision.reason ? ` (${decision.reason})` : ''}`)
    }
  })

  // A run sends each email at its own second and keeps going while more come due (up to 5 minutes);
  // polling every 2 s starts the next run, or the one queued by a Gmail reconnect, right away.
  await boss.work(QUEUES.mailDispatch, { pollingIntervalSeconds: 2 }, async () => {
    const n = await dispatchDueSends(log('mail'))
    if (n) log('mail')(`sent ${n} queued application(s)`)
  })

  await boss.work(QUEUES.mailPoll, { pollingIntervalSeconds: 15 }, async () => {
    const ml = log('poll')
    try {
      const found = await pollReplies(ml)
      if (found) ml(`recorded ${found} new inbound message(s)`)
    } catch (err) {
      ml(`poll failed: ${err instanceof Error ? err.message : err}`)
    }
    try {
      const f = await sendDueFollowUps(ml)
      if (f) ml(`sent ${f} follow-up(s)`)
    } catch (err) {
      ml(`follow-ups failed: ${err instanceof Error ? err.message : err}`)
    }
    const nr = await markNoResponse()
    if (nr) ml(`marked ${nr} application(s) as NO_RESPONSE`)
  })

  await boss.work(QUEUES.digest, { pollingIntervalSeconds: 30 }, async () => {
    await sendDailyDigest(log('digest'))
  })

  await boss.work<ContactBatchJob>(QUEUES.contactBatch, { pollingIntervalSeconds: 5, batchSize: 1 }, async (jobs) => {
    for (const job of jobs) await runContactBatch(job.data.runId, job.data.includeChecked)
  })

  await boss.work<BoardDiscoveryJob>(QUEUES.boardDiscovery, { pollingIntervalSeconds: 5, batchSize: 1 }, async (jobs) => {
    for (const job of jobs) await runBoardDiscovery(job.data.runId, log('boards'))
  })

  await boss.work(QUEUES.applyBatch, { pollingIntervalSeconds: 2, batchSize: 1 }, async () => {
    await tickApplyBatch(log('apply'))
  })

  await boss.work<ScrapeJob>(QUEUES.scrapeRun, { pollingIntervalSeconds: 5, batchSize: 1 }, async (jobs) => {
    for (const job of jobs) {
      const r = await runScrapeTarget(job.data.targetId, log('scrape'))
      log('scrape')(`${job.data.targetId}: ${r.created} new, ${r.updated} known, visited ${r.visited}`)
    }
  })

  await boss.work(QUEUES.inboxScan, { pollingIntervalSeconds: 15, batchSize: 1 }, async () => {
    try {
      const r = await scanInbox(log('inbox'))
      if (r.matched) log('inbox')(`matched ${r.matched} of ${r.scanned} new message(s) to applications`)
    } catch (err) {
      log('inbox')(`scan failed: ${err instanceof Error ? err.message : err}`)
    }
  })

}

async function registerApplyWorkers(boss: PgBoss) {
  /**
   * "Target page, context or browser has been closed" while the tab is still open: the Playwright
   * extension lost the tab (its "started debugging" bar was cancelled, or another debugger attached).
   * Run it once more on a fresh tab; a second loss in 15 minutes stays failed.
   */
  const TAB_LOST_RE = /Target page, context or browser has been closed/
  /** LinkedIn Easy Apply only works in your Chrome, where you are signed in. */
  async function needsYourChrome(attemptId: string): Promise<boolean> {
    const a = await db.portalAttempt.findUnique({ where: { id: attemptId }, select: { application: { select: { job: { select: { url: true } } } } } })
    return /linkedin\.com/i.test(a?.application.job.url ?? '')
  }

  async function retryLostTab(attemptId: string, interactive?: boolean) {
    const a = await db.portalAttempt.findUnique({ where: { id: attemptId }, select: { applicationId: true, mode: true } })
    if (!a) return
    const lost = await db.portalAttempt.count({ where: { applicationId: a.applicationId, status: 'FAILED', error: { contains: 'has been closed' }, startedAt: { gte: new Date(Date.now() - 15 * 60_000) } } })
    if (lost > 1) return
    const next = await queuePortalAttempt(a.applicationId, a.mode as AttemptMode, { interactive }).catch((err: unknown) => {
      log('portal')(`could not retry ${attemptId}: ${err instanceof Error ? err.message : err}`)
      return null
    })
    if (next) log('portal')(`${attemptId}: the extension lost the tab; trying once more as ${next.id}`)
  }

  // Browser apply agent. Interactive runs (you sign in, solve a CAPTCHA) and LinkedIn go through your Chrome one at
  // a time; the rest run side by side in the agents' Chrome ("apply on our site" replies waited 2 hours in line
  // behind the account sign-ups).
  await boss.work<PortalApplyJob>(QUEUES.portalApply, { pollingIntervalSeconds: 3, batchSize: 1, localConcurrency: 4 }, async (jobs) => {
    for (const job of jobs) {
      const inYours = job.data.interactive !== false || (await needsYourChrome(job.data.attemptId))
      const run = async () => {
        const r = inYours
          ? await inYourChrome(() => runPortalAttempt(job.data.attemptId, { interactive: job.data.interactive }))
          : await runPortalAttempt(job.data.attemptId, { interactive: false, background: true })
        log('portal')(`${job.data.attemptId}: ${r.status}${r.reason ? ` - ${r.reason}` : ''}`)
        if (r.status === 'NEEDS_HUMAN' && canHandOver(r.reason)) void handOverToYou(job.data.attemptId, log('handover'))
        if (r.status === 'FAILED' && TAB_LOST_RE.test(r.reason ?? '')) await retryLostTab(job.data.attemptId, job.data.interactive)
      }
      // Runs waiting for your Chrome line up on its lock without holding a queue slot, so the background
      // runs are not starved by a row of sign-ups waiting for you (once 1 running, 33 queued).
      if (inYours) void run().catch((err: unknown) => log('portal')(`${job.data.attemptId}: ${err instanceof Error ? err.message : err}`))
      else await run()
    }
  })

  await boss.work(QUEUES.portalBatch, { pollingIntervalSeconds: 10, batchSize: 1 }, async () => {
    await tickPortalBatch(log('portal-batch'))
  })

  await boss.work(QUEUES.portalStatus, { pollingIntervalSeconds: 30, batchSize: 1 }, async () => {
    const n = await checkPortalStatuses(log('portal-status'))
    if (n) log('portal-status')(`updated ${n} application(s) from candidate portals`)
  })

  await boss.work<BrowserControlJob>(QUEUES.browserControl, { pollingIntervalSeconds: 2, batchSize: 1 }, async (jobs) => {
    for (const job of jobs) await browserControl(job.data, log('browser')).catch((err) => log('browser')(`${job.data.action} failed: ${err instanceof Error ? err.message : err}`))
  })
}

/**
 * A worker that has just started cannot have active jobs, so any job still marked
 * "active" belongs to a process that died. Fail them now; otherwise singleton
 * queues (search runs, contact batches) stay blocked until pg-boss expires them.
 */
async function failOrphanedQueueJobs(role: WorkerRole): Promise<number> {
  // Only this role's queues: the other role's process may be running its jobs right now.
  const names = queuesForRole(role).filter((n) => /^[a-z.]+$/.test(n))
  if (!names.length) return 0
  try {
    const list = names.map((n) => `'${n}'`).join(', ')
    const n = await db.$executeRawUnsafe(`UPDATE pgboss.job SET state = 'failed', completed_on = now(), output = '{"reason":"worker restarted"}'::jsonb WHERE state = 'active' AND name IN (${list})`)
    return Number(n)
  } catch {
    return 0 // first start: the pgboss schema does not exist yet
  }
}

async function startBoss(): Promise<PgBoss> {
  const orphaned = await failOrphanedQueueJobs(ROLE)
  if (orphaned) log('queue')(`failed ${orphaned} orphaned active job(s) left by a previous worker`)
  const boss = new PgBoss({ connectionString: queueConnectionString(), schema: 'pgboss' })
  boss.on('error', (err) => console.error('[pg-boss]', err))
  await boss.start()
  await ensureQueues(boss)
  await registerWorkers(boss, ROLE)
  for (const r of boardRunsToResume.splice(0)) await boss.send(QUEUES.boardDiscovery, { runId: r.id } satisfies BoardDiscoveryJob, { singletonKey: `boards-${r.id}-r${r.resumes}` })
  // Poll mail once on every (re)start so a pause never loses a reply window.
  if (runsSearchSide(ROLE)) await boss.send(QUEUES.mailPoll, {}, { singletonKey: 'mail-poll' })
  return boss
}

/**
 * The supervisor, every minute: the every-minute queue jobs must still be created (pg-boss once stopped
 * scheduling for good while the worker looked healthy), and no application may hang far beyond any form.
 * Returns true when the queue has to be restarted.
 */
async function supervise(role: WorkerRole): Promise<boolean> {
  // The every-minute queue this role relies on: mail dispatch for the search side, the batch tick for the apply side.
  const probe = runsSearchSide(role) ? 'mail.dispatch' : (await getSettings()).portal.enabled ? 'portal.batch' : null
  const rows = probe ? await db.$queryRaw<Array<{ age: number | null }>>`select extract(epoch from now() - max(created_on))::float as age from pgboss.job where name = ${probe}` : []
  const age = rows[0]?.age ?? null
  const frozen = age !== null && age > 4 * 60
  if (!runsApplySide(role)) return frozen
  const stuck = await db.portalAttempt.updateMany({
    where: { status: 'RUNNING', startedAt: { lt: new Date(Date.now() - 25 * 60_000) } },
    data: { status: 'FAILED', error: 'Stuck for over 25 minutes; stopped by the supervisor so the agents carry on', finishedAt: new Date() },
  })
  if (stuck.count) {
    log('supervisor')(`stopped ${stuck.count} application(s) stuck for over 25 minutes`)
    await notify('error', 'Supervisor: stuck applications stopped', `${stuck.count} application(s) hung for over 25 minutes and were stopped; the agents carry on.`, '/applications').catch(() => undefined)
  }
  return frozen
}

/** Heartbeat row read by /api/status ("worker asleep until 08:00" vs "worker down"). */
async function writeStatus(state: 'active' | 'sleeping' | 'stopped', nextWakeAt: Date | null) {
  // Only the process that owns the browser looks at it (the search process never touches Chrome).
  const browser = runsApplySide(ROLE) ? await browserHeartbeat().catch(() => null) : null
  const id = statusRowId(ROLE)
  const data = { state, heartbeatAt: new Date(), nextWakeAt, hostname: os.hostname(), version: `${VERSION} (${ROLE})`, ...(browser ? { browser: browser as object } : {}) }
  await db.workerStatus.upsert({ where: { id }, update: data, create: { id, ...data } }).catch((err) => log('status')(`heartbeat failed: ${err instanceof Error ? err.message : err}`))
  // The Browser page reads the browser from row 1; the apply process keeps it current there too.
  if (browser && id !== 1) await db.workerStatus.updateMany({ where: { id: 1 }, data: { browser: browser as object } }).catch(() => undefined)
}

async function main() {
  const l = log('main')
  l(`starting role "${ROLE}" (node ${process.version}, env ${env.NODE_ENV}, host ${os.hostname()}, v${VERSION})`)
  const window = parseActiveWindow(env.WORKER_ACTIVE_HOURS, env.WORKER_ACTIVE_DAYS)
  if (window) l(`active hours ${env.WORKER_ACTIVE_HOURS} on days ${env.WORKER_ACTIVE_DAYS ?? 'all'} (${env.TZ}); the queue pauses outside them`)

  await ensureSettings()
  // AI keys are not copied from .env here (a wipe of the owner's data would bring them back); Settings > AI keys has "Import from .env".
  // Each role cleans up only what it runs: the other process may be busy with its own work.
  if (runsSearchSide(ROLE)) {
    const stale = await failStaleRuns()
    if (stale) l(`marked ${stale} stale run(s) as FAILED`)
    const staleBatches = await failInterruptedContactBatches()
    if (staleBatches) l(`marked ${staleBatches} interrupted contact batch(es) as FAILED`)
    // A board search cut off by the restart carries on from where it was (queued again once the queue is up).
    boardRunsToResume = await resumeInterruptedBoardRuns()
    if (boardRunsToResume.length) l(`board search: ${boardRunsToResume.length} interrupted run(s) will carry on`)
  }
  if (runsApplySide(ROLE)) {
    const staleAttempts = await failInterruptedAttempts()
    if (staleAttempts.count) l(`marked ${staleAttempts.count} interrupted browser attempt(s) as FAILED`)
    // Restarts are routine (code roll-outs, the supervisor), so a form cut off mid-way gets one more try.
    let retried = 0
    for (const a of staleAttempts.retry) {
      const viaSite = await db.emailMessage.count({ where: { applicationId: a.applicationId, classification: 'APPLY_VIA_PORTAL' } })
      if (await queuePortalAttempt(a.applicationId, a.mode as AttemptMode, { interactive: viaSite === 0 }).catch(() => null)) retried++
    }
    if (retried) l(`retrying ${retried} attempt(s) cut off by the restart`)
    // A restart can drop the queue job of an attempt still marked QUEUED (9 once sat idle). Send them
    // again; the per-attempt singleton key skips any that still have a live job.
    const waiting = await db.portalAttempt.findMany({ where: { status: 'QUEUED', batchId: null }, select: { id: true, applicationId: true } })
    let resent = 0
    for (const a of waiting) {
      const viaSite = await db.emailMessage.count({ where: { applicationId: a.applicationId, classification: 'APPLY_VIA_PORTAL' } })
      if (await enqueuePortalAttempt({ attemptId: a.id, interactive: viaSite === 0 }).catch(() => null)) resent++
    }
    if (resent) l(`re-queued ${resent} browser attempt(s) that lost their queue job`)
  }

  let boss: PgBoss | null = null
  // Every 20 s while active: job tabs that now show a confirmation are recorded and closed.
  let sweeps = 0
  setInterval(() => {
    if (!boss || !runsApplySide(ROLE)) return
    // Every 5 minutes: forms whose tab closed untouched open again in your Chrome.
    if (++sweeps % 15 === 0) {
      void reopenPausedHandovers(log('handover')).catch(() => undefined)
      void capBannerTabs(log('tabs')).catch(() => undefined)
    }
    // Every 6 hours (and soon after a start): Gemini step screenshots older than a week go.
    if (sweeps % 1080 === 3) {
      const n = pruneStepShots(7)
      if (n) log('tabs')(`deleted ${n} Gemini step screenshot(s) older than 7 days`)
    }
    void sweepFinishedTabs(log('tabs'))
      .then((n) => {
        if (n) log('tabs')(`recorded and closed ${n} finished tab(s)`)
      })
      .catch(() => undefined)
  }, 20_000)
  // Every 30 s: continuous search starts the next loop once the last run ended (plus its pause).
  let continuousBusy = false
  setInterval(() => {
    if (!boss || !runsSearchSide(ROLE) || continuousBusy) return
    continuousBusy = true
    const b = boss
    void continuousTick((sources) => b.send(QUEUES.searchRun, { trigger: 'CONTINUOUS', ...(sources ? { sources } : {}) } satisfies SearchRunJob, { singletonKey: 'search-run' }))
      .then((sent) => {
        if (sent) log('search')('continuous search: next loop queued')
      })
      .catch((err: unknown) => log('search')(`continuous search: ${err instanceof Error ? err.message : err}`))
      .finally(() => {
        continuousBusy = false
      })
  }, 30_000)
  let lastSettingsAt: Date | null = null
  let busy = false
  let stopping = false

  // Schedules live in Settings; re-sync when they change (and after every restart of the queue).
  const resync = async (b: PgBoss) => {
    try {
      const s = await db.settings.findUnique({ where: { id: 1 }, select: { updatedAt: true } })
      if (!s) return
      if (lastSettingsAt && s.updatedAt.getTime() === lastSettingsAt.getTime()) return
      lastSettingsAt = s.updatedAt
      const summary = await syncSchedules(b, ROLE)
      log('schedule')(`synced: ${summary}`)
    } catch (err) {
      log('schedule')(`sync failed: ${err instanceof Error ? err.message : err}`)
    }
  }

  const tick = async () => {
    if (busy || stopping) return
    busy = true
    try {
      const now = new Date()
      const active = isActive(window, now, env.TZ)
      const next = window ? nextTransition(window, now, env.TZ) : null
      if (active && !boss) {
        boss = await startBoss()
        lastSettingsAt = null
        await resync(boss)
        await writeStatus('active', next)
        l(next ? `ready, active until ${next.toISOString()}` : 'ready')
        // Forms that were waiting for you in your browser are watched again.
        if (runsApplySide(ROLE)) void resumeHandovers(log('handover')).catch(() => undefined)
      } else if (!active && boss) {
        l(`outside active hours, pausing until ${next!.toISOString()} (letting running jobs finish)`)
        await writeStatus('sleeping', next)
        const b = boss
        boss = null
        await b.stop({ graceful: true, timeout: PAUSE_GRACE_MS })
        await db.$disconnect().catch(() => undefined)
        l('paused; database connections closed')
      } else if (boss) {
        if (await supervise(ROLE).catch(() => false)) {
          log('supervisor')('the job queue stopped scheduling work; restarting it')
          const b = boss
          boss = null
          await b.stop({ graceful: true, timeout: 30_000 }).catch(() => undefined)
          boss = await startBoss()
          lastSettingsAt = null
          await notify('error', 'Supervisor: job queue restarted', 'The queue had stopped scheduling work (searches, sending, browser agents). It was restarted and carries on.', '/dashboard').catch(() => undefined)
        }
        await writeStatus('active', next)
        await resync(boss)
      }
      // !active && !boss: sleeping, touch nothing so a serverless database can suspend.
    } catch (err) {
      l(`tick failed: ${err instanceof Error ? err.message : err}`)
    } finally {
      busy = false
    }
  }

  await tick()
  if (!boss && window) {
    const wake = nextTransition(window, new Date(), env.TZ)
    l(`outside active hours, sleeping until ${wake.toISOString()}`)
    await writeStatus('sleeping', wake)
    await db.$disconnect().catch(() => undefined)
  }
  const timer = setInterval(() => void tick(), TICK_MS)

  // Two-way Telegram bot: one long-polling reader per bot, so only the role that owns it starts it. It does not
  // touch the database until a command runs, so it also answers while the queue sleeps outside the active hours.
  if (runsTelegramPoller(ROLE)) {
    if (await startTelegramService(log('telegram'))) l('Telegram control bot started (long polling)')
    else l('Telegram control bot off (TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are not both set)')
  }

  const shutdown = async (signal: string) => {
    l(`${signal} received, stopping…`)
    stopping = true
    stopTelegramService()
    clearInterval(timer)
    try {
      await writeStatus('stopped', null)
      if (boss) await boss.stop({ graceful: true, timeout: 30_000 })
    } finally {
      await db.$disconnect().catch(() => undefined)
      process.exit(0)
    }
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((err) => {
  console.error('[worker] fatal', err)
  process.exit(1)
})
