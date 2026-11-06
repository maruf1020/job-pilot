import { QUEUES } from '@/lib/queue'

/**
 * WORKER_ROLE splits the worker in two processes so a crash on one side never stops the other:
 * `search` runs searches, drafting, email and the inbox; `apply` runs the browser agents. `all` (the
 * default) is one process doing both, as before.
 */
export const WORKER_ROLES = ['all', 'search', 'apply'] as const
export type WorkerRole = (typeof WORKER_ROLES)[number]

type QueueName = (typeof QUEUES)[keyof typeof QUEUES]

const SEARCH_QUEUES: QueueName[] = [
  QUEUES.searchRun,
  QUEUES.searchBoards,
  QUEUES.draftJob,
  QUEUES.mailDispatch,
  QUEUES.mailPoll,
  QUEUES.applyBatch,
  QUEUES.contactBatch,
  QUEUES.boardDiscovery,
  QUEUES.scrapeRun,
  QUEUES.digest,
  QUEUES.inboxScan,
]

const APPLY_QUEUES: QueueName[] = [QUEUES.portalBatch, QUEUES.portalApply, QUEUES.portalStatus, QUEUES.browserControl]

export function parseWorkerRole(value: string | null | undefined): WorkerRole {
  const v = (value ?? '').trim().toLowerCase()
  return (WORKER_ROLES as readonly string[]).includes(v) ? (v as WorkerRole) : 'all'
}

/** Queues this role works on (and the only ones whose orphaned jobs it may fail at start-up). */
export function queuesForRole(role: WorkerRole): QueueName[] {
  if (role === 'search') return [...SEARCH_QUEUES]
  if (role === 'apply') return [...APPLY_QUEUES]
  return [...SEARCH_QUEUES, ...APPLY_QUEUES]
}

/** Searches, drafting, email, contacts, scraping, the digest and the inbox scan. */
export function runsSearchSide(role: WorkerRole): boolean {
  return role !== 'apply'
}

/** Browser agents: batches, single-job attempts, tab sweeps, hand-overs and the browser heartbeat. */
export function runsApplySide(role: WorkerRole): boolean {
  return role !== 'search'
}

/**
 * WorkerStatus row this role writes. Row 1 is what the status chip reads, so `all` and `search` keep
 * it; the apply process writes row 2 (and the browser field of row 1, which the Browser page reads).
 */
export function statusRowId(role: WorkerRole): number {
  return role === 'apply' ? 2 : 1
}

export function isWorkerRole(value: string): value is WorkerRole {
  return (WORKER_ROLES as readonly string[]).includes(value)
}

/**
 * The Telegram control bot reads updates with long polling, and Telegram allows ONE reader per bot. `all`
 * and `search` run it; `apply` never does, so with the two-process split exactly one process polls.
 */
export function runsTelegramPoller(role: WorkerRole): boolean {
  return role !== 'apply'
}
