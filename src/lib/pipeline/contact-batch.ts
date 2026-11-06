import { db } from '@/lib/db'
import { resetVerifyState, isPort25Blocked } from '@/lib/email/verify'
import { notify } from '@/lib/notifications'
import { getSettings } from '@/lib/settings/service'
import { mapLimit } from '@/lib/utils/semaphore'
import { discoverContactForCompany } from './contacts'
import { createRunLogger } from './logger'

export type BatchScope = 'above_threshold' | 'all_ranked' | 'all_companies'
export const BATCH_SCOPES: BatchScope[] = ['above_threshold', 'all_ranked', 'all_companies']

export class BatchAlreadyRunningError extends Error {
  status = 409
  constructor() {
    super('A contact discovery batch is already running')
    this.name = 'BatchAlreadyRunningError'
  }
}

/** Companies the scope would cover: those without an address (or never checked) that have relevant jobs. */
async function companyIdsForScope(scope: BatchScope, includeChecked: boolean): Promise<string[]> {
  const settings = await getSettings()
  const jobFilter =
    scope === 'above_threshold'
      ? { status: { in: ['RANKED', 'REVIEW'] }, contactEmail: null, finalScore: { gte: settings.ranking.draftThreshold } }
      : scope === 'all_ranked'
        ? { status: { in: ['RANKED', 'REVIEW'] }, contactEmail: null }
        : { contactEmail: null }
  const rows = await db.company.findMany({
    where: { blacklisted: false, contactEmail: null, ...(includeChecked ? {} : { contactCheckedAt: null }), jobs: { some: jobFilter } },
    select: { id: true, jobs: { where: jobFilter, select: { finalScore: true }, orderBy: { finalScore: 'desc' }, take: 1 } },
  })
  return rows.sort((a, b) => (b.jobs[0]?.finalScore ?? 0) - (a.jobs[0]?.finalScore ?? 0)).map((r) => r.id)
}

export async function scopeCounts(): Promise<Record<BatchScope, number>> {
  const out = {} as Record<BatchScope, number>
  for (const s of BATCH_SCOPES) out[s] = (await companyIdsForScope(s, false)).length
  return out
}

export async function latestContactBatch() {
  return db.contactDiscoveryRun.findFirst({ orderBy: { startedAt: 'desc' } })
}

const STALE_AFTER_MS = 30 * 60_000

/** A run the worker stopped reporting on (crash, restart) must not block new batches forever. */
export async function failStaleContactBatches(reason = 'The worker stopped while this batch was running; start it again to continue (companies already checked are skipped).') {
  const r = await db.contactDiscoveryRun.updateMany({
    where: { status: 'RUNNING', updatedAt: { lt: new Date(Date.now() - STALE_AFTER_MS) } },
    data: { status: 'FAILED', finishedAt: new Date(), error: reason },
  })
  return r.count
}

/** Worker start-up: whatever was RUNNING cannot be, because this process was not running it. */
export async function failInterruptedContactBatches() {
  const r = await db.contactDiscoveryRun.updateMany({
    where: { status: 'RUNNING' },
    data: { status: 'FAILED', finishedAt: new Date(), error: 'The worker restarted while this batch was running; start it again to continue (companies already checked are skipped).' },
  })
  return r.count
}

/** Create the run row; the worker picks it up from the queue. */
export async function createContactBatch(scope: BatchScope, batchSize = 10, includeChecked = false) {
  await failStaleContactBatches()
  const running = await db.contactDiscoveryRun.findFirst({ where: { status: 'RUNNING' } })
  if (running) throw new BatchAlreadyRunningError()
  const ids = await companyIdsForScope(scope, includeChecked)
  return db.contactDiscoveryRun.create({ data: { scope, batchSize, status: 'RUNNING', total: ids.length } })
}

export async function cancelContactBatch(runId?: string) {
  const r = await db.contactDiscoveryRun.updateMany({ where: runId ? { id: runId } : { status: 'RUNNING' }, data: { cancelRequested: true } })
  return r.count
}

/** Worker side: process the companies batch by batch, updating progress after each company. */
export async function runContactBatch(runId: string, includeChecked = false): Promise<void> {
  const run = await db.contactDiscoveryRun.findUnique({ where: { id: runId } })
  if (!run || run.status !== 'RUNNING') return
  const log = createRunLogger(null, 'contacts')
  resetVerifyState()
  const ids = await companyIdsForScope(run.scope as BatchScope, includeChecked)
  await db.contactDiscoveryRun.update({ where: { id: runId }, data: { total: ids.length } })
  const counters = { processed: 0, found: 0, verified: 0, guessed: 0, jobsUpdated: 0 }
  const flush = () => db.contactDiscoveryRun.update({ where: { id: runId }, data: counters }).catch(() => undefined)
  try {
    for (let i = 0; i < ids.length; i += run.batchSize) {
      const fresh = await db.contactDiscoveryRun.findUnique({ where: { id: runId }, select: { cancelRequested: true } })
      if (fresh?.cancelRequested) {
        await db.contactDiscoveryRun.update({ where: { id: runId }, data: { ...counters, status: 'CANCELLED', finishedAt: new Date() } })
        log.info(`batch cancelled after ${counters.processed}/${ids.length}`)
        return
      }
      const batch = ids.slice(i, i + run.batchSize)
      await mapLimit(batch, 4, async (companyId) => {
        try {
          const r = await discoverContactForCompany(companyId, { log, force: includeChecked })
          if (r.email) counters.found++
          if (r.source === 'verified') counters.verified++
          if (r.source === 'guessed') counters.guessed++
          counters.jobsUpdated += r.jobsUpdated
        } catch (err) {
          log.warn(`company ${companyId}: ${err instanceof Error ? err.message : err}`)
        } finally {
          counters.processed++
        }
      })
      await flush()
      log.info(`batch ${Math.floor(i / run.batchSize) + 1}: ${counters.processed}/${ids.length} companies, ${counters.found} addresses (${counters.verified} verified, ${counters.guessed} guessed)`)
    }
    const note = isPort25Blocked() ? 'Outbound port 25 is blocked on this machine, so mailbox verification was unavailable; guesses stay unverified.' : null
    await db.contactDiscoveryRun.update({ where: { id: runId }, data: { ...counters, status: 'COMPLETED', finishedAt: new Date(), error: note } })
    await notify('run_complete', 'Contact discovery finished', `${counters.found} addresses for ${counters.processed} companies (${counters.verified} verified, ${counters.guessed} guessed); ${counters.jobsUpdated} jobs updated.${note ? ` ${note}` : ''}`, '/jobs?filter[channel]=email')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db.contactDiscoveryRun.update({ where: { id: runId }, data: { ...counters, status: 'FAILED', finishedAt: new Date(), error: message } })
    await notify('error', 'Contact discovery failed', message)
  }
}
