import { db } from '@/lib/db'
import { portalCandidates } from '@/lib/apply/portal-batch'
import { PAUSE_MARK } from './pause-mark'

/**
 * Batch controls for the bot. Pause and resume only touch the running batches' own scheduling fields (the same
 * fields scripts/ops/drain.ts and the batch cards use); no worker is stopped or restarted.
 */

const PAUSE_TEXT = `${PAUSE_MARK} (send /resume to continue)`
const PAUSE_MS = 7 * 86_400_000

export interface PauseOutcome {
  browser: string | null
  email: string | null
}

/** Stops new claims on the running browser batch and the running email batch. */
export async function pauseBatches(now = new Date()): Promise<PauseOutcome> {
  const portal = await db.portalBatch.findFirst({ where: { status: 'RUNNING' }, orderBy: { startedAt: 'asc' } })
  if (portal) await db.portalBatch.update({ where: { id: portal.id }, data: { nextAttemptAt: new Date(now.getTime() + PAUSE_MS), waitingFor: PAUSE_TEXT } })
  const email = await db.applyBatch.findFirst({ where: { status: 'RUNNING' } })
  if (email) await db.applyBatch.update({ where: { id: email.id }, data: { waitingFor: PAUSE_TEXT } })
  return { browser: portal?.id.slice(-6) ?? null, email: email?.id.slice(-6) ?? null }
}

/** Same effect as `scripts/ops/drain.ts resume`: the browser batch claims again. */
export async function resumeBrowser(): Promise<string | null> {
  const batch = await db.portalBatch.findFirst({ where: { status: 'RUNNING' }, orderBy: { startedAt: 'asc' } })
  if (!batch) return null
  await db.portalBatch.update({ where: { id: batch.id }, data: { nextAttemptAt: null, waitingFor: null } })
  return batch.id.slice(-6)
}

/** Clears the Telegram pause on the email batch (a wait written by the batch itself is left alone). */
export async function resumeEmail(): Promise<string | null> {
  const batch = await db.applyBatch.findFirst({ where: { status: 'RUNNING' } })
  if (!batch) return null
  if (batch.waitingFor?.startsWith(PAUSE_MARK)) await db.applyBatch.update({ where: { id: batch.id }, data: { waitingFor: null } })
  return batch.id.slice(-6)
}

export interface PoolReport {
  minScore: number
  eligible: number
  batchRunning: boolean
}

/** How many jobs the browser agent could take right now (the running batch's minimum score, default 60). */
export async function browserPool(): Promise<PoolReport> {
  const batch = await db.portalBatch.findFirst({ where: { status: 'RUNNING' }, orderBy: { startedAt: 'asc' } })
  const minScore = batch?.minScore ?? 60
  const candidates = await portalCandidates({ minScore, countries: [], sites: [] }, 300)
  return { minScore, eligible: candidates.length, batchRunning: Boolean(batch) }
}
