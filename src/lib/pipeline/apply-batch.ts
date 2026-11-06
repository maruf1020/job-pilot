import { requiresOtherLanguage, titleAllowed } from '@/lib/ranking/rules'
import { getAiUsageSummary } from '@/lib/ai/usage'
import { db } from '@/lib/db'
import { autoSendRecipientProblem, isUsableContact } from '@/lib/email/address'
import { verifyMailbox } from '@/lib/email/send'
import { notify } from '@/lib/notifications'
import { getSettings } from '@/lib/settings/service'
import { mapLimit } from '@/lib/utils/semaphore'
import { isPausedFromTelegram } from '@/lib/telegram/pause-mark'
import type { AppSettings } from '@/lib/settings/schema'
import { FORM_FIRST_ATS } from './channel'
import { findCooldownConflict } from './cooldown'
import { evaluateAutoSend, mailProviderReady, sentOrQueuedToday } from './decide'
import { draftApplication } from './draft'
import { fitsStack, prefilterReason } from './prefilter'
import { gateEnabled, gateReason, type GateJob } from './quality-gate'
import { loadCandidateContext } from '@/lib/candidate/load'

/**
 * Auto-apply batches. The user picks how many applications and the rules once; each tick the
 * worker prepares the next ones exactly as for a single application (draft → humanizer →
 * judge) and queues only drafts that pass. Rules applied to every candidate:
 *  - best score first, at least `minScore`, sponsorship not "no", company not blacklisted,
 *  - a usable recipient (found or verified; guessed only when the batch allows it),
 *  - one application per company per location (the best-scoring job) and never within the
 *    company cooldown of an earlier application.
 * The daily send cap, send window and AI quota pace the batch; it simply waits and resumes.
 * While email is not ready (Gmail disconnected) it keeps writing drafts ahead, so sending starts
 * at full speed the moment the mailbox works again.
 */

export const BATCH_MIN = 2
export const BATCH_MAX = 1000
/**
 * Applications taken per round. A tick (scheduled every minute) runs rounds back to back and keeps
 * starting new drafts for TICK_BUDGET_MS, writing `settings.ai.concurrency` drafts at a time (the AI
 * call limit, Settings → AI), so throughput follows the model's speed instead of a fixed number.
 */
export const PER_ROUND = 16
/** Ranked jobs read per query when looking for batch candidates, and how many such pages at most. */
const FRESH_PAGE = 3000
const MAX_FRESH_PAGES = 8
/** How long one tick keeps starting new drafts; drafts already running finish, the next tick carries on. */
export const TICK_BUDGET_MS = 50_000
/** Each fast-mode draft costs one or two model requests (draft + at most one rewrite). */
const QUOTA_PER_DRAFT = 2

export interface TickRoom {
  /** The mailbox can send right now. */
  emailReady: boolean
  /** Daily send cap minus what is sent or queued today. */
  capRoom: number
  /** Applications the batch may still commit (Infinity in continuous mode). */
  targetRoom: number
  /** AI requests left today (primary + lite: fast mode moves to the lite model when primary runs out). */
  aiRoom: number
  perRound?: number
}

/**
 * Which candidates one round takes. With email working: drafts already written first (no AI cost),
 * then new ones, within the round size, the daily cap and the batch target. While email is not
 * ready only new drafts are written, ahead of time, until the batch target (or today's cap) is
 * covered by drafts waiting to go out; the ones already written count against it.
 */
export function pickForTick<T extends { kind: 'draft' | 'ready' }>(candidates: T[], room: TickRoom): T[] {
  const perRound = room.perRound ?? PER_ROUND
  const ready = candidates.filter((c) => c.kind === 'ready')
  const fresh = candidates.filter((c) => c.kind === 'draft').slice(0, Math.floor(room.aiRoom / QUOTA_PER_DRAFT))
  if (room.emailReady) return ready.concat(fresh).slice(0, Math.max(0, Math.min(perRound, room.capRoom, room.targetRoom)))
  const ahead = Math.min(perRound, Math.min(room.capRoom, room.targetRoom) - ready.length)
  return fresh.slice(0, Math.max(0, ahead))
}

/** Google's real quota can run out before our own count does; the second try then uses the lite model. */
function isQuotaError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'NoKeyAvailableError' || /quota (used up|exhausted)/i.test(err.message))
}

/** Batch status line while the mailbox cannot send (the card shows a reconnect button next to it). */
export function emailNotReadyNote(reason: string | undefined, queued: number, prepared: number, extra = ''): string {
  const waiting = [queued ? `${queued} queued` : '', prepared ? `${prepared} more written and checked` : ''].filter(Boolean).join(' and ')
  return `Email not ready: ${reason ?? 'the mailbox is not connected'}.${waiting ? ` ${waiting}; they go out as soon as it works again.` : ''}${extra}`
}

/** Runs async steps one after another, in the order they are handed in. */
function serial() {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn)
    tail = run.catch(() => undefined)
    return run
  }
}

export interface BatchRules {
  target: number
  /** Keep going after the current matches are used up, applying to new ones as runs find them. */
  continuous?: boolean
  minScore: number
  includeGuessed: boolean
  countries: string[]
}

export class ApplyBatchError extends Error {
  status = 400
  constructor(message: string) {
    super(message)
    this.name = 'ApplyBatchError'
  }
}

function companyKey(settings: AppSettings, companyId: string, countryCode: string | null): string {
  return settings.email.companyCooldownScope === 'company_country' ? `${companyId}:${countryCode ?? ''}` : companyId
}

type Candidate = {
  kind: 'draft' | 'ready'
  jobId: string
  applicationId?: string
  title: string
  companyName: string
  companyId: string
  countryCode: string | null
  score: number
  toEmail: string | null
}

/**
 * Eligible candidates in order: passing drafts already waiting in Review first (no AI cost),
 * then ranked jobs to draft. One per company key; cooldown checked per company.
 */
export async function eligibleCandidates(rules: Omit<BatchRules, 'target'>, settings: AppSettings, limit: number, exclude: Set<string> = new Set()): Promise<Candidate[]> {
  const countryFilter = rules.countries.length ? { countryCode: { in: rules.countries } } : {}
  const jobWhere = {
    finalScore: { gte: rules.minScore },
    sponsorship: { not: 'no' },
    contactEmail: { not: null },
    // Jobs on form-first systems go through the browser agent, not by email (NOT IN would drop null atsType).
    AND: [{ OR: [{ atsType: null }, { atsType: { notIn: [...FORM_FIRST_ATS] } }] }],
    company: { blacklisted: false },
    ...(rules.includeGuessed ? {} : { OR: [{ contactEmailSource: null }, { contactEmailSource: { not: 'guessed' } }] }),
    ...countryFilter,
  }
  const freshPage = (skip: number) =>
    db.job.findMany({
      where: { status: 'RANKED', application: null, ...jobWhere },
      select: {
        id: true,
        title: true,
        companyName: true,
        companyId: true,
        countryCode: true,
        location: true,
        finalScore: true,
        contactEmail: true,
        description: true,
        requiredLanguages: true,
        remote: true,
        visaFlag: true,
        contactEmailSource: true,
        sponsorship: true,
        salaryMin: true,
        salaryMax: true,
        currency: true,
        company: { select: { domain: true, knownSponsor: true } },
      },
      orderBy: [{ finalScore: 'desc' }, { firstSeenAt: 'desc' }, { id: 'asc' }],
      skip,
      take: FRESH_PAGE,
    })
  const [ready, fresh] = await Promise.all([
    db.application.findMany({
      where: { status: 'REVIEW', channel: 'email', OR: [{ batchId: null }, { batch: { status: { not: 'RUNNING' } } }], drafts: { some: { isSelected: true, passed: true } }, job: jobWhere },
      select: {
        id: true,
        toEmail: true,
        job: { select: { id: true, title: true, description: true, requiredLanguages: true, companyName: true, companyId: true, countryCode: true, location: true, finalScore: true, contactEmailSource: true, sponsorship: true, salaryMin: true, salaryMax: true, currency: true, company: { select: { domain: true, knownSponsor: true } } } },
      },
      orderBy: { job: { finalScore: 'desc' } },
      take: 400,
    }),
    freshPage(0),
  ])
  // Only the company's own mailboxes: a scraped address on another domain is left for you to check.
  const ownsAddress = (email: string | null, companyName: string, domain: string | null, source: string | null) => Boolean(email) && autoSendRecipientProblem(email!, { name: companyName, domain }, source) === null
  // Only jobs that can lead to a permit (country known, sponsor evidence, salary floor).
  const candidate = await loadCandidateContext()
  const gated = (j: GateJob) => gateEnabled(settings.email) && gateReason(j, { candidate }) !== null
  const spoken = candidate.languages.map((l) => l.name)
  const toPool = (readyApps: typeof ready, freshJobs: typeof fresh): Candidate[] =>
    [
      ...readyApps
        .filter((a) => isUsableContact(a.toEmail) && ownsAddress(a.toEmail, a.job.companyName, a.job.company.domain, a.job.contactEmailSource) && !gated(a.job) && fitsStack(a.job.title, a.job.description ?? '', settings.portal.stackFocus) && !requiresOtherLanguage(a.job.requiredLanguages, spoken))
        .map((a) => ({ kind: 'ready' as const, jobId: a.job.id, applicationId: a.id, title: a.job.title, companyName: a.job.companyName, companyId: a.job.companyId, countryCode: a.job.countryCode, score: a.job.finalScore ?? 0, toEmail: a.toEmail })),
      ...freshJobs
        .filter((j) => isUsableContact(j.contactEmail) && ownsAddress(j.contactEmail, j.companyName, j.company.domain, j.contactEmailSource) && !prefilterReason(j, settings.search, candidate).reason && !gated(j) && fitsStack(j.title, j.description ?? '', settings.portal.stackFocus) && !requiresOtherLanguage(j.requiredLanguages, spoken))
        .map((j) => ({ kind: 'draft' as const, jobId: j.id, title: j.title, companyName: j.companyName, companyId: j.companyId, countryCode: j.countryCode, score: j.finalScore ?? 0, toEmail: j.contactEmail })),
    ]
      // The title rule and the stack focus (Settings → Browser) cover emails too: without this check, reading deeper
      // into the ranked list once queued dozens of roles from unrelated fields.
      .filter((c) => titleAllowed(settings.portal, c.title, settings.search))
      .sort((a, b) => b.score - a.score || (a.kind === 'ready' ? -1 : 1))

  const out: Candidate[] = []
  const seen = new Set(exclude)
  // A job with no known country could be anywhere, so it conflicts with every job of that company.
  const companiesSeen = new Set([...exclude].map((k) => k.split(':')[0]))
  const unknownLocationSeen = new Set([...exclude].filter((k) => k.endsWith(':')).map((k) => k.split(':')[0]))
  const cooldownCache = new Map<string, boolean>()
  const mailboxesSeen = new Set<string>()
  // The best-scoring jobs are mostly at companies already applied to (cooldown), on form-first systems or off
  // the title rule: once all of the top 3,000 were blocked while usable jobs lay further down, so the batch
  // found nothing and stopped drafting. Read the ranked list page by page until enough are found.
  let page = fresh
  let pool = toPool(ready, fresh)
  for (let skip = 0; ; ) {
    // A blocked address (it bounced) is held at drafting anyway; picking it each round stalled the email
    // batch on the same three jobs for an hour.
    const addresses = [...new Set(pool.map((c) => (c.toEmail ?? '').trim().toLowerCase()).filter(Boolean))]
    const blockedAddresses = new Set(addresses.length ? (await db.suppressedAddress.findMany({ where: { email: { in: addresses } }, select: { email: true } })).map((r) => r.email) : [])
    await pickFrom(pool, blockedAddresses)
    skip += FRESH_PAGE
    if (out.length >= limit || page.length < FRESH_PAGE || skip >= FRESH_PAGE * MAX_FRESH_PAGES) break
    page = await freshPage(skip)
    pool = toPool([], page)
  }
  return out

  async function pickFrom(pool: Candidate[], blockedAddresses: Set<string>) {
    for (const c of pool) {
      if (out.length >= limit) break
      if (blockedAddresses.has((c.toEmail ?? '').trim().toLowerCase())) continue
      const key = companyKey(settings, c.companyId, c.countryCode)
      if (seen.has(key)) continue
      if (unknownLocationSeen.has(c.companyId)) continue
      if (!c.countryCode && companiesSeen.has(c.companyId)) continue
      const mailbox = (c.toEmail ?? '').toLowerCase()
      if (mailbox && mailboxesSeen.has(mailbox)) continue // one per recipient address, whatever the company
      if (mailbox) mailboxesSeen.add(mailbox)
      seen.add(key) // the first (best-scoring) job per company and location wins; the rest are never considered
      companiesSeen.add(c.companyId)
      if (!c.countryCode) unknownLocationSeen.add(c.companyId)
      const cacheKey = `${key}|${mailbox}`
      let blocked = cooldownCache.get(cacheKey)
      if (blocked === undefined) {
        blocked = Boolean(await findCooldownConflict({ companyId: c.companyId, countryCode: c.countryCode, excludeApplicationId: c.applicationId, toEmail: c.toEmail }, settings.email))
        cooldownCache.set(cacheKey, blocked)
      }
      if (!blocked) out.push(c)
    }
  }
}

export async function previewBatch(rules: Omit<BatchRules, 'target'>) {
  const settings = await getSettings()
  const candidates = await eligibleCandidates(rules, settings, BATCH_MAX)
  const usage = await getAiUsageSummary()
  // Fast mode moves to the lite model once the primary quota is used up, so both count.
  const draftsPerDay = Math.max(1, Math.floor((usage.primaryRemaining + usage.liteRemaining) / QUOTA_PER_DRAFT))
  return {
    eligible: candidates.length,
    readyNow: candidates.filter((c) => c.kind === 'ready').length,
    needDraft: candidates.filter((c) => c.kind === 'draft').length,
    top: candidates.slice(0, 8).map((c) => ({ title: c.title, company: c.companyName, country: c.countryCode, score: c.score, ready: c.kind === 'ready' })),
    dailySendCap: settings.email.dailySendCap,
    draftsAvailableToday: draftsPerDay,
    cooldownDays: settings.email.companyCooldownDays,
    providerReady: (await mailProviderReady()).ready,
  }
}

export async function startBatch(rules: BatchRules) {
  if (!rules.continuous && (rules.target < BATCH_MIN || rules.target > BATCH_MAX)) throw new ApplyBatchError(`Choose between ${BATCH_MIN} and ${BATCH_MAX} applications`)
  const running = await db.applyBatch.findFirst({ where: { status: 'RUNNING' } })
  if (running) throw new ApplyBatchError('An auto-apply batch is already running; stop it first')
  const provider = await mailProviderReady()
  if (!provider.ready) throw new ApplyBatchError(`Email is not ready: ${provider.reason}`)
  // A stored Gmail token can be long dead (Google ends "Testing" connections after 7 days); one
  // cheap call finds out now instead of at the first send, after the drafts are written.
  const live = await verifyMailbox()
  if (!live.ready) throw new ApplyBatchError(`Email is not ready: ${live.reason}`)
  return db.applyBatch.create({ data: { status: 'RUNNING', target: rules.continuous ? BATCH_MAX : rules.target, continuous: Boolean(rules.continuous), minScore: rules.minScore, includeGuessed: rules.includeGuessed, countries: rules.countries } })
}

/** Stop: nothing more is prepared, and every application of the batch not yet sent goes back to Review. */
export async function cancelBatch(id?: string) {
  const batch = id ? await db.applyBatch.findUnique({ where: { id } }) : await db.applyBatch.findFirst({ where: { status: 'RUNNING' } })
  if (!batch || batch.status !== 'RUNNING') return { cancelled: false, unqueued: 0 }
  const unqueued = await db.application.updateMany({ where: { batchId: batch.id, status: { in: ['QUEUED', 'APPROVED'] }, sentAt: null }, data: { status: 'REVIEW', scheduledFor: null, batchId: null, lastActivityAt: new Date() } })
  await db.applyBatch.update({ where: { id: batch.id }, data: { status: 'CANCELLED', cancelRequested: true, finishedAt: new Date(), waitingFor: null, note: `Stopped by you; ${unqueued.count} queued application(s) moved back to Review` } })
  return { cancelled: true, unqueued: unqueued.count }
}

/** Keep counters in line with what actually happened to the batch's applications. */
async function refreshCounters(batchId: string) {
  const groups = await db.application.groupBy({ by: ['status'], where: { batchId }, _count: { _all: true } })
  const n = (statuses: string[]) => groups.filter((g) => statuses.includes(g.status)).reduce((a, g) => a + g._count._all, 0)
  const sent = await db.application.count({ where: { batchId, sentAt: { not: null } } })
  await db.applyBatch.update({ where: { id: batchId }, data: { queued: n(['QUEUED', 'APPROVED']), sent } })
  return { queued: n(['QUEUED', 'APPROVED']), sent }
}

/**
 * One worker tick for the running batch: rounds of "pick the next applications, write the drafts in
 * parallel, queue each one the moment it is ready", back to back until TICK_BUDGET_MS is used up.
 * While email is not ready, passing drafts wait in Review instead, and the first round after the
 * mailbox works again queues them without any AI cost.
 */
export async function tickApplyBatch(log: (m: string) => void = console.log, budgetMs = TICK_BUDGET_MS): Promise<void> {
  const deadline = Date.now() + budgetMs
  // A round that finds nothing to do, is stopped or only fails ends the tick at once.
  while ((await tickRound(log, deadline)) && Date.now() < deadline) {
    // next round
  }
}

async function tickRound(log: (m: string) => void, deadline: number): Promise<boolean> {
  const batch = await db.applyBatch.findFirst({ where: { status: 'RUNNING' } })
  if (!batch) return false
  // Paused from Telegram (/pause): no new claims until /resume clears the mark. Nothing else changes.
  if (isPausedFromTelegram(batch.waitingFor)) return false
  const settings = await getSettings()
  const setWaiting = (waitingFor: string | null) => db.applyBatch.update({ where: { id: batch.id }, data: { waitingFor, lastTickAt: new Date() } })
  const tag = `batch ${batch.id.slice(-6)}`

  const { queued, sent } = await refreshCounters(batch.id)
  const committed = queued + sent
  const provider = await mailProviderReady()
  if (!batch.continuous && committed >= batch.target) {
    if (queued === 0) {
      await db.applyBatch.update({ where: { id: batch.id }, data: { status: 'COMPLETED', finishedAt: new Date(), waitingFor: null, note: `All ${sent} applications sent` } })
      await notify('run_complete', 'Auto-apply batch finished', `${sent} applications sent`, '/applications')
    } else await setWaiting(provider.ready ? `${queued} application(s) waiting for the send window` : emailNotReadyNote(provider.reason, queued, 0))
    return false
  }

  const todayCount = await sentOrQueuedToday()
  if (todayCount >= settings.email.dailySendCap) {
    await setWaiting(`Daily send cap of ${settings.email.dailySendCap} reached; continues tomorrow`)
    return false
  }
  const capRoom = settings.email.dailySendCap - todayCount
  const targetRoom = batch.continuous ? Infinity : batch.target - committed

  const alreadyInBatch = await db.application.findMany({ where: { batchId: batch.id }, select: { job: { select: { companyId: true, countryCode: true } } } })
  const exclude = new Set(alreadyInBatch.map((a) => companyKey(settings, a.job.companyId, a.job.countryCode)))
  const rules = { minScore: batch.minScore, includeGuessed: batch.includeGuessed, countries: batch.countries }
  // Drafting ahead looks as far down the list as the batch can still use, to count the drafts already waiting.
  const candidates = await eligibleCandidates(rules, settings, provider.ready ? PER_ROUND * 3 : Math.min(BATCH_MAX, Math.min(capRoom, targetRoom) + PER_ROUND), exclude)
  if (candidates.length === 0 && batch.continuous) {
    // Continuous mode never finishes on its own: new matches arrive with every search run.
    await setWaiting(
      !provider.ready
        ? emailNotReadyNote(provider.reason, queued, 0)
        : queued
          ? `${queued} application(s) waiting for the send window; looking for new matches after each search run`
          : 'Waiting for new matching jobs from the next search run',
    )
    return false
  }
  if (candidates.length === 0) {
    const note = committed === 0 ? 'No eligible jobs for these rules' : `Only ${committed} eligible application(s) found for these rules`
    if (queued === 0) {
      await db.applyBatch.update({ where: { id: batch.id }, data: { status: 'COMPLETED', finishedAt: new Date(), waitingFor: null, note } })
      await notify('run_complete', 'Auto-apply batch finished', note, '/applications')
    } else await setWaiting(provider.ready ? `${note}; ${queued} still waiting for the send window` : emailNotReadyNote(provider.reason, queued, 0))
    return false
  }

  // Room left: the batch target, the daily send cap and the AI quota.
  const usage = await getAiUsageSummary()
  const aiRoom = usage.primaryRemaining + usage.liteRemaining
  const preparedBefore = provider.ready ? 0 : candidates.filter((c) => c.kind === 'ready').length
  const picked = pickForTick(candidates, { emailReady: provider.ready, capRoom, targetRoom, aiRoom })
  if (picked.length === 0) {
    const quotaLeft = aiRoom >= QUOTA_PER_DRAFT
    await setWaiting(provider.ready ? 'Waiting for the daily AI quota to reset (drafting resumes automatically)' : emailNotReadyNote(provider.reason, queued, preparedBefore, quotaLeft ? '' : ' More drafts wait for the daily AI quota.'))
    return false
  }
  const names = picked.map((c) => c.companyName).join(', ')
  await setWaiting(provider.ready ? `Writing and checking ${picked.length} application(s) in parallel: ${names}` : `${emailNotReadyNote(provider.reason, queued, preparedBefore)} Meanwhile writing and checking ${picked.length} more: ${names}`)
  log(`${tag}: ${provider.ready ? 'preparing' : 'email not ready, drafting ahead'} ${picked.length}: ${picked.map((c) => `${c.companyName} (${c.score})`).join(', ')}`)

  let stopped = false
  let prepared = 0
  /** Drafts written plus applications queued or kept: another round only makes sense after some. */
  let progress = 0
  const hold = async (applicationId: string, c: Candidate, reason: string) => {
    // Kept for you to review; it no longer belongs to the batch so the batch cannot send it later.
    // Counted once: the same 15 drafts held on every tick once showed "477 held".
    const before = await db.application.findUnique({ where: { id: applicationId }, select: { notes: true } })
    const again = before?.notes?.startsWith('Auto-apply held this one:') ?? false
    await db.application.update({ where: { id: applicationId }, data: { batchId: null, notes: `Auto-apply held this one: ${reason}` } })
    if (!again) await db.applyBatch.update({ where: { id: batch.id }, data: { held: { increment: 1 }, considered: { increment: 1 } } })
    log(`${tag}: held ${c.title} at ${c.companyName}: ${reason}`)
  }
  // One at a time, so every send time is spaced from the one queued before it.
  const inOrder = serial()
  const queueOrKeep = (applicationId: string, c: Candidate, passed: boolean) =>
    inOrder(async () => {
      const fresh = await db.applyBatch.findUnique({ where: { id: batch.id }, select: { cancelRequested: true, status: true } })
      if (!fresh || fresh.cancelRequested || fresh.status !== 'RUNNING') return void (stopped = true)
      // Checked per application: a reconnect in the middle of a tick takes effect at once.
      if (!(await mailProviderReady()).ready) {
        if (!passed) return hold(applicationId, c, 'Draft did not pass the humanizer')
        prepared++
        progress++
        log(`${tag}: ${c.title} at ${c.companyName} (score ${c.score}) is written and checked; it goes out once email works`)
        return
      }
      await db.application.update({ where: { id: applicationId }, data: { batchId: batch.id } })
      // Same rules as a manual approval, and the draft must have passed the checks.
      const decision = await evaluateAutoSend(applicationId, { force: true, requirePassed: true })
      if (decision.outcome !== 'queued') return hold(applicationId, c, decision.reason ?? 'did not pass')
      progress++
      log(`${tag}: queued ${c.title} at ${c.companyName} (score ${c.score}) for ${decision.scheduledFor?.toISOString()}`)
      await db.applyBatch.update({ where: { id: batch.id }, data: { considered: { increment: 1 } } })
    })

  const draft = async (c: Candidate) => {
    try {
      return await draftApplication(c.jobId, { fast: true })
    } catch (err) {
      if (!isQuotaError(err)) throw err
      // The models that ran out are marked now, so the second try uses the next one (lite at the end).
      log(`${tag}: ${c.companyName}: ${err instanceof Error ? err.message : err}; trying the next model`)
      const app = await draftApplication(c.jobId, { fast: true })
      await db.application.updateMany({ where: { id: app.id, notes: { startsWith: 'Draft failed:' } }, data: { notes: null } })
      return app
    }
  }

  // Drafts are written in parallel (each one is independent); drafts already written are queued at once.
  await mapLimit(picked, Math.max(1, settings.ai.concurrency), async (c) => {
    if (stopped) return
    if (c.kind === 'ready') return queueOrKeep(c.applicationId!, c, true)
    // New drafts start only within the tick's time budget; the rest wait for the next tick.
    if (Date.now() > deadline) return
    let app: Awaited<ReturnType<typeof draftApplication>>
    try {
      app = await draft(c)
      progress++
      await db.applyBatch.update({ where: { id: batch.id }, data: { drafted: { increment: 1 } } })
    } catch (err) {
      log(`${tag}: draft failed for ${c.title} at ${c.companyName}: ${err instanceof Error ? err.message : err}`)
      await db.applyBatch.update({ where: { id: batch.id }, data: { held: { increment: 1 }, considered: { increment: 1 } } })
      return
    }
    await queueOrKeep(app.id, c, app.status === 'REVIEW' && Boolean(app.drafts[0]?.passed))
  })
  if (stopped) return false
  const after = await refreshCounters(batch.id)
  const now = await mailProviderReady()
  await setWaiting(now.ready ? null : emailNotReadyNote(now.reason, after.queued, preparedBefore + prepared))
  // Another round only when this one got somewhere: an AI outage must not burn through the whole
  // list, and an application held again and again must not keep the tick spinning.
  return progress > 0
}

/** Latest batch plus what it is doing right now, in plain words, for the progress card. */
export async function latestBatch() {
  const batch = await db.applyBatch.findFirst({ orderBy: { startedAt: 'desc' } })
  if (!batch) return null
  const upcoming = await db.application.findMany({
    where: { batchId: batch.id, status: 'QUEUED' },
    orderBy: { scheduledFor: 'asc' },
    take: 8,
    select: { id: true, scheduledFor: true, toEmail: true, job: { select: { title: true, companyName: true, countryCode: true } } },
  })
  const recentSent = await db.application.findMany({
    where: { batchId: batch.id, sentAt: { not: null } },
    orderBy: { sentAt: 'desc' },
    take: 5,
    select: { id: true, sentAt: true, job: { select: { title: true, companyName: true, countryCode: true } } },
  })
  // While it runs, the card offers a reconnect button when the mailbox cannot send.
  const mail = batch.status === 'RUNNING' ? { ...(await mailProviderReady()), provider: (await getSettings()).email.provider } : null
  let activity = batch.waitingFor
  if (mail && !mail.ready && !activity) activity = emailNotReadyNote(mail.reason, batch.queued, 0)
  if (batch.status === 'RUNNING' && !activity) {
    const usage = await getAiUsageSummary()
    const nextSend = upcoming[0]?.scheduledFor ?? null
    const parts: string[] = []
    if (nextSend && nextSend.getTime() > Date.now()) parts.push(`next email goes out at ${nextSend.toISOString()}`)
    if (usage.primaryRemaining + usage.liteRemaining < QUOTA_PER_DRAFT) parts.push('new drafts wait for the daily AI quota to reset')
    else parts.push('preparing the next applications every few minutes')
    activity = parts.join('; ')
  }
  return { ...batch, activity, upcoming, recentSent, mail }
}
