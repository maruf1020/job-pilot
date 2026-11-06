import { db } from '@/lib/db'
import { leads, type LeadItem } from '@/lib/email/needs-action'
import { enqueueInboxScan, enqueueMailPoll } from '@/lib/queue'

/**
 * "Sync" (plan-ui-redesign.md 7.1): check Gmail now (the reply poll and the inbox scan the worker
 * normally runs every 30 minutes), then say how many companies offered a next step.
 */

/** One company that wants to move forward: its latest next-step reply (interview, interest, a request for details). */
export interface NextStepCompany {
  company: string
  applicationId: string
  messageId: string
  title: string
  countryCode: string | null
  /** INTERVIEW_REQUEST | POSITIVE | NEEDS_INFO */
  classification: string
  /** What they ask (the classifier's summary), else the subject. */
  ask: string
  questions: string[]
  proposedTimes: string[]
  receivedAt: string
  /** You replied after it arrived, or marked it done. */
  answered: boolean
  /** Other roles at the same company with a next step too. */
  otherRoles: number
}

export interface SyncStatus {
  /** When the last reply check finished (ISO), or null when none ran yet. */
  lastSyncAt: string | null
  /** When the last reply check was asked for (ISO). */
  queuedAt: string | null
  /** A reply check or inbox scan is waiting or running in the worker. */
  running: boolean
  nextSteps: {
    /** Companies that offered a next step (answered or not). */
    count: number
    /** Of those, the ones still waiting for your answer. */
    open: number
    items: NextStepCompany[]
  }
}

const companyKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ')

/** One row per company, its most urgent reply first (the input comes sorted: unanswered, interviews, newest). Pure. */
export function groupNextSteps(items: LeadItem[]): NextStepCompany[] {
  const byCompany = new Map<string, NextStepCompany>()
  for (const it of items) {
    const key = companyKey(it.job.companyName)
    const seen = byCompany.get(key)
    if (seen) {
      seen.otherRoles++
      continue
    }
    byCompany.set(key, {
      company: it.job.companyName,
      applicationId: it.applicationId,
      messageId: it.messageId,
      title: it.job.title,
      countryCode: it.job.countryCode,
      classification: it.classification,
      ask: it.summary ?? (it.subject || 'Reply'),
      questions: it.questions,
      proposedTimes: it.proposedTimes,
      receivedAt: it.receivedAt,
      answered: it.answered,
      otherRoles: 0,
    })
  }
  return [...byCompany.values()]
}

interface BossRow {
  name: string
  state: string
  created_on: Date
  completed_on: Date | null
}

const SYNC_QUEUES = ['mail.poll', 'inbox.scan']
const OPEN_STATES = new Set(['created', 'retry', 'active'])

/** Queue a reply check and an inbox scan now (the worker runs them within seconds). */
export async function requestSync(): Promise<{ queuedAt: string }> {
  await Promise.all([enqueueMailPoll(), enqueueInboxScan()])
  return { queuedAt: new Date().toISOString() }
}

/** Whether a check is running, when the last one finished, and the companies that offered a next step. */
export async function syncStatus(): Promise<SyncStatus> {
  const [jobs, hot] = await Promise.all([
    db.$queryRaw<BossRow[]>`SELECT name, state, created_on, completed_on FROM pgboss.job WHERE name = ANY(${SYNC_QUEUES}) ORDER BY created_on DESC LIMIT 20`.catch(() => [] as BossRow[]),
    leads(),
  ])
  const polls = jobs.filter((j) => j.name === 'mail.poll')
  const finished = polls.filter((j) => j.completed_on && j.state === 'completed').map((j) => j.completed_on!.getTime())
  const items = groupNextSteps(hot.nextSteps)
  return {
    lastSyncAt: finished.length ? new Date(Math.max(...finished)).toISOString() : null,
    queuedAt: polls[0]?.created_on ? new Date(polls[0].created_on).toISOString() : null,
    running: jobs.some((j) => OPEN_STATES.has(j.state)),
    nextSteps: { count: items.length, open: items.filter((i) => !i.answered).length, items },
  }
}
