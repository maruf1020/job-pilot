import { PgBoss } from 'pg-boss'
import { env } from '@/lib/env'
import type { RunTrigger, SourceId } from '@/lib/domain'

export const QUEUES = {
  searchRun: 'search.run',
  /** Light runs between the full ones: company boards and the visa-flagged feeds only. */
  searchBoards: 'search.boards',
  draftJob: 'draft.job',
  mailDispatch: 'mail.dispatch',
  mailPoll: 'mail.poll',
  digest: 'digest.daily',
  scrapeRun: 'scrape.run',
  contactBatch: 'contacts.batch',
  /** "Find public job boards" runs from the Companies page (progress lives in BoardDiscoveryRun). */
  boardDiscovery: 'boards.discover',
  applyBatch: 'apply.batch',
  portalApply: 'portal.apply',
  portalBatch: 'portal.batch',
  portalStatus: 'portal.status',
  inboxScan: 'inbox.scan',
  browserControl: 'browser.control',
} as const

/** One browser-agent attempt (single job). */
export interface PortalApplyJob {
  attemptId: string
  /** You started it and may be watching: the agent waits for you to solve a CAPTCHA. */
  interactive?: boolean
}

/** Things only the worker can do with the apply browser (it owns the DevTools connection). */
export interface BrowserControlJob {
  action: 'open' | 'focus' | 'close-tab'
  attemptId?: string
  url?: string
}

export interface ScrapeJob {
  targetId: string
}

export interface BoardDiscoveryJob {
  runId: string
}

export interface ContactBatchJob {
  runId: string
  includeChecked?: boolean
}

export interface SearchRunJob {
  trigger: RunTrigger
  /** A light run (boards and visa-flagged feeds only), scheduled between the full runs. */
  light?: boolean
  sources?: SourceId[]
  skipDiscovery?: boolean
  skipDrafts?: boolean
}
export interface DraftJob {
  jobId: string
  note?: string | null
  force?: boolean
  /** Queue for sending as soon as the draft passes the checks (bulk "draft & queue"). */
  autoQueue?: boolean
}

/** Idempotent queue creation; called by the worker and lazily by the web side. */
export async function ensureQueues(boss: PgBoss): Promise<void> {
  await boss.createQueue(QUEUES.searchRun, { policy: 'singleton', retryLimit: 0, expireInSeconds: 3 * 3600 })
  await boss.createQueue(QUEUES.searchBoards, { policy: 'singleton', retryLimit: 0, expireInSeconds: 2 * 3600 })
  await boss.createQueue(QUEUES.draftJob, { policy: 'standard', retryLimit: 1, retryDelay: 30, expireInSeconds: 20 * 60 })
  await boss.createQueue(QUEUES.mailDispatch, { policy: 'singleton', retryLimit: 0, expireInSeconds: 10 * 60 })
  await boss.createQueue(QUEUES.mailPoll, { policy: 'singleton', retryLimit: 0, expireInSeconds: 20 * 60 })
  await boss.createQueue(QUEUES.digest, { policy: 'singleton', retryLimit: 1, expireInSeconds: 10 * 60 })
  await boss.createQueue(QUEUES.scrapeRun, { policy: 'singleton', retryLimit: 0, expireInSeconds: 60 * 60 })
  await boss.createQueue(QUEUES.applyBatch, { policy: 'singleton', retryLimit: 0, expireInSeconds: 30 * 60 })
  await boss.createQueue(QUEUES.contactBatch, { policy: 'singleton', retryLimit: 0, expireInSeconds: 3 * 60 * 60 })
  await boss.createQueue(QUEUES.boardDiscovery, { policy: 'singleton', retryLimit: 0, expireInSeconds: 6 * 60 * 60 })
  await boss.createQueue(QUEUES.portalApply, { policy: 'standard', retryLimit: 0, expireInSeconds: 20 * 60 })
  await boss.createQueue(QUEUES.portalBatch, { policy: 'singleton', retryLimit: 0, expireInSeconds: 30 * 60 })
  await boss.createQueue(QUEUES.portalStatus, { policy: 'singleton', retryLimit: 0, expireInSeconds: 60 * 60 })
  await boss.createQueue(QUEUES.inboxScan, { policy: 'singleton', retryLimit: 0, expireInSeconds: 15 * 60 })
  await boss.createQueue(QUEUES.browserControl, { policy: 'standard', retryLimit: 0, expireInSeconds: 5 * 60 })
}

export async function enqueuePortalAttempt(data: PortalApplyJob): Promise<string | null> {
  const boss = await getBoss()
  return boss.send(QUEUES.portalApply, data, { singletonKey: `portal-${data.attemptId}` })
}

export async function enqueuePortalBatchTick(): Promise<string | null> {
  const boss = await getBoss()
  return boss.send(QUEUES.portalBatch, {}, { singletonKey: 'portal-batch' })
}

export async function enqueueInboxScan(): Promise<string | null> {
  const boss = await getBoss()
  return boss.send(QUEUES.inboxScan, {}, { singletonKey: 'inbox-scan' })
}

export async function enqueuePortalStatusCheck(): Promise<string | null> {
  const boss = await getBoss()
  return boss.send(QUEUES.portalStatus, {}, { singletonKey: 'portal-status' })
}

export async function enqueueBrowserControl(data: BrowserControlJob): Promise<string | null> {
  const boss = await getBoss()
  return boss.send(QUEUES.browserControl, data)
}

export async function enqueueScrape(targetId: string): Promise<string | null> {
  const boss = await getBoss()
  return boss.send(QUEUES.scrapeRun, { targetId } satisfies ScrapeJob, { singletonKey: `scrape-${targetId}` })
}

export async function enqueueContactBatch(data: ContactBatchJob): Promise<string | null> {
  const boss = await getBoss()
  return boss.send(QUEUES.contactBatch, data, { singletonKey: `contacts-${data.runId}` })
}

export async function enqueueBoardDiscovery(data: BoardDiscoveryJob): Promise<string | null> {
  const boss = await getBoss()
  return boss.send(QUEUES.boardDiscovery, data, { singletonKey: `boards-${data.runId}` })
}

/** pg-boss needs a direct connection: PgBouncer-style pooled URLs (Neon "-pooler") break its session features. */
export function queueConnectionString(): string {
  return env.DIRECT_DATABASE_URL ?? env.DATABASE_URL
}

const g = globalThis as unknown as { __jobFinderBoss?: Promise<PgBoss> }

/** Web-side client: sends jobs only (no workers, no maintenance). The worker must be running to process them. */
export function getBoss(): Promise<PgBoss> {
  if (!g.__jobFinderBoss) {
    g.__jobFinderBoss = (async () => {
      const boss = new PgBoss({ connectionString: queueConnectionString(), schema: 'pgboss', supervise: false, schedule: false, max: 2 })
      boss.on('error', (err) => console.error('[pg-boss/web]', err))
      await boss.start()
      await ensureQueues(boss)
      return boss
    })().catch((err) => {
      g.__jobFinderBoss = undefined
      throw err
    })
  }
  return g.__jobFinderBoss
}

export async function enqueueSearchRun(data: SearchRunJob): Promise<string | null> {
  const boss = await getBoss()
  return boss.send(QUEUES.searchRun, data, { singletonKey: 'search-run' })
}

export async function enqueueDraft(data: DraftJob): Promise<string | null> {
  const boss = await getBoss()
  return boss.send(QUEUES.draftJob, data, { singletonKey: `draft-${data.jobId}` })
}

export async function enqueueMailPoll(): Promise<string | null> {
  const boss = await getBoss()
  return boss.send(QUEUES.mailPoll, {}, { singletonKey: 'mail-poll' })
}

export async function enqueueMailDispatch(): Promise<string | null> {
  const boss = await getBoss()
  return boss.send(QUEUES.mailDispatch, {}, { singletonKey: 'mail-dispatch' })
}

export async function enqueueDigest(): Promise<string | null> {
  const boss = await getBoss()
  return boss.send(QUEUES.digest, {}, { singletonKey: 'digest' })
}

/** Worker liveness: the worker writes a heartbeat every 30s into pg-boss's job table via a schedule; the web reads queue sizes. */
export async function queueHealth() {
  try {
    const boss = await getBoss()
    const names = Object.values(QUEUES)
    const rows = await Promise.all(names.map((n) => boss.getQueue(n)))
    return rows.map((q, i) => ({ name: names[i], queued: q?.queuedCount ?? 0, active: q?.activeCount ?? 0, deferred: q?.deferredCount ?? 0 }))
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

export async function enqueueApplyBatchTick(): Promise<string | null> {
  const boss = await getBoss()
  return boss.send(QUEUES.applyBatch, {}, { singletonKey: 'apply-batch' })
}
