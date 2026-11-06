import fs from 'node:fs'
import path from 'node:path'
import { db } from '@/lib/db'
import { invalidateCandidateContext } from '@/lib/candidate/load'

/**
 * "Remove my data": deletes everything about the owner of this install and keeps the shared
 * knowledge, so the database (and the folder) can be handed to someone else, who then starts at
 * /setup like a new install.
 *
 * Deleted: the account, profile, CVs, photo, applications (emails, drafts, form attempts, events),
 * batches, job scores, inbox and notifications, saved form answers, site logins, Gmail connection,
 * AI and service keys with their usage, search runs, settings (back to defaults), and the files
 * under storage/ that hold personal data (CV copies, cover letters, screenshots, browser profiles,
 * logs, caches).
 *
 * Kept: companies (blacklist and notes cleared), jobs (status back to NEW, scores removed), their
 * source links, job boards and scrape targets, sponsor registers, banned phrases, site profiles
 * (login state cleared), site lessons, bounced addresses, board-discovery history.
 */

export interface RemovalReport {
  deleted: Record<string, number>
  reset: Record<string, number>
  files: string[]
  kept: Record<string, number>
}

/** Folders and files under storage/ that hold personal data. Lessons and knowledge live in the DB. */
export const PERSONAL_STORAGE = [
  'apply-files',
  'apply-shots',
  'photo.jpg',
  'photo.jpeg',
  'photo.png',
  'chrome-profile',
  'chrome-profile-agents',
  'browser',
  'logs',
  'backups',
  'telegram-offset.json',
  'telegram-fit-cache.json',
  'site-playbooks.jsonl',
  'fix-lessons.jsonl',
]

function storageRoot(): string {
  return path.resolve(process.cwd(), 'storage')
}

/** Removes the personal files under storage/ (never anything outside it). */
export function removePersonalFiles(root = storageRoot()): string[] {
  const removed: string[] = []
  for (const name of PERSONAL_STORAGE) {
    const target = path.resolve(root, name)
    if (!target.startsWith(root + path.sep)) continue
    if (!fs.existsSync(target)) continue
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 3 })
      removed.push(name)
    } catch {
      // A Chrome profile still open by a browser cannot be removed on Windows: reported, not fatal.
      removed.push(`${name} (could not remove: close the browser and run it again)`)
    }
  }
  return removed
}

/** Cancels queued and running background jobs so nothing keeps working on the removed data. */
async function purgeQueues(): Promise<number> {
  try {
    const rows = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
      `WITH c AS (UPDATE pgboss.job SET state = 'cancelled', completed_on = now() WHERE state IN ('created', 'retry', 'active') RETURNING 1) SELECT count(*)::bigint AS n FROM c`,
    )
    return Number(rows[0]?.n ?? 0)
  } catch {
    // pg-boss tables do not exist yet (the worker never ran): nothing to cancel.
    return 0
  }
}

/**
 * Deletes the owner's data and keeps the shared knowledge. Runs in one transaction for the
 * database part; files are removed afterwards.
 */
export async function removeOwnerData(opts: { files?: boolean } = {}): Promise<RemovalReport> {
  const deleted: Record<string, number> = {}
  const reset: Record<string, number> = {}

  // Stop the batches first, so a worker tick in the middle never sends anything.
  await db.applyBatch.updateMany({ where: { status: 'RUNNING' }, data: { status: 'CANCELLED' } })
  await db.portalBatch.updateMany({ where: { status: 'RUNNING' }, data: { status: 'CANCELLED' } })
  await db.searchRun.updateMany({ where: { status: 'RUNNING' }, data: { cancelRequested: true } })
  deleted.queuedJobs = await purgeQueues()

  await db.$transaction(
    async (tx) => {
      // Applications cascade to drafts, email messages, form attempts and the timeline.
      deleted.applications = (await tx.application.deleteMany({})).count
      deleted.applyBatches = (await tx.applyBatch.deleteMany({})).count
      deleted.portalBatches = (await tx.portalBatch.deleteMany({})).count
      deleted.jobScores = (await tx.jobScore.deleteMany({})).count
      reset.jobs = (await tx.job.updateMany({ data: { status: 'NEW', filterReason: null, finalScore: null } })).count
      deleted.inboxMessages = (await tx.inboxMessage.deleteMany({})).count
      deleted.notifications = (await tx.notification.deleteMany({})).count
      deleted.answers = (await tx.answerBank.deleteMany({})).count
      deleted.siteLogins = (await tx.portalAccount.deleteMany({})).count
      deleted.oauthTokens = (await tx.oAuthToken.deleteMany({})).count
      deleted.aiUsage = (await tx.aiUsage.deleteMany({})).count
      deleted.aiKeys = (await tx.aiKey.deleteMany({})).count
      deleted.serviceKeys = (await tx.serviceKey.deleteMany({})).count
      deleted.resumes = (await tx.resumeFile.deleteMany({})).count
      deleted.profile = (await tx.candidateProfile.deleteMany({})).count
      deleted.searchRuns = (await tx.searchRun.deleteMany({})).count
      deleted.sourceCursors = (await tx.sourceCursor.deleteMany({})).count
      deleted.apiQuota = (await tx.apiQuota.deleteMany({})).count
      deleted.settings = (await tx.settings.deleteMany({})).count
      reset.companies = (await tx.company.updateMany({ where: { OR: [{ blacklisted: true }, { notes: { not: null } }] }, data: { blacklisted: false, notes: null } })).count
      reset.siteProfiles = (await tx.hostProfile.updateMany({ where: { OR: [{ loggedIn: true }, { notes: { not: null } }] }, data: { loggedIn: false, notes: null } })).count
      deleted.manualSuppressions = (await tx.suppressedAddress.deleteMany({ where: { source: 'manual' } })).count
      reset.bounces = (await tx.suppressedAddress.updateMany({ where: { applicationId: { not: null } }, data: { applicationId: null } })).count
      deleted.users = (await tx.user.deleteMany({})).count
    },
    { timeout: 10 * 60_000, maxWait: 30_000 },
  )
  invalidateCandidateContext()

  const files = opts.files === false ? [] : removePersonalFiles()
  const [companies, jobs, boards, sponsors, lessons, sites] = await Promise.all([
    db.company.count(),
    db.job.count(),
    db.scrapeTarget.count(),
    db.sponsorRegister.count(),
    db.siteLesson.count(),
    db.hostProfile.count(),
  ])
  return { deleted, reset, files, kept: { companies, jobs, boards, sponsors, lessons, sites } }
}

/** Everything about the owner as JSON, offered as a download before the removal. */
export async function exportOwnerData() {
  const [user, profile, answers, applications, settings, siteLogins, keys] = await Promise.all([
    db.user.findFirst({ select: { username: true, name: true, email: true, createdAt: true, onboardedAt: true } }),
    db.candidateProfile.findUnique({ where: { id: 1 } }),
    db.answerBank.findMany({ where: { answer: { not: null } }, select: { question: true, answer: true, kind: true, options: true } }),
    db.application.findMany({
      select: {
        id: true,
        status: true,
        channel: true,
        createdAt: true,
        sentAt: true,
        job: { select: { title: true, companyName: true, url: true, countryCode: true } },
        events: { select: { type: true, message: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    db.settings.findUnique({ where: { id: 1 } }),
    db.portalAccount.findMany({ select: { host: true, email: true, status: true } }),
    db.aiKey.findMany({ select: { label: true, provider: true, keyHint: true } }),
  ])
  return { exportedAt: new Date().toISOString(), user, profile, answers, applications, settings, siteLogins, aiKeys: keys }
}
