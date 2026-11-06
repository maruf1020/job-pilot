import type { Prisma } from '@/generated/prisma/client'
import { NoKeyAvailableError } from '@/lib/ai/key-pool'
import { getAiUsageSummary } from '@/lib/ai/usage'
import { db } from '@/lib/db'
import type { RunTrigger, SourceId } from '@/lib/domain'
import { notify } from '@/lib/notifications'
import { loadCandidateContext } from '@/lib/candidate/load'
import { titleAllowed } from '@/lib/ranking/rules'
import { getSettings } from '@/lib/settings/service'
import { FORM_FIRST_ATS } from './channel'
import { discoverContacts } from './contacts'
import { findCooldownConflict } from './cooldown'
import { evaluateAutoSend } from './decide'
import { registerBoardsFromJobs } from '@/lib/sponsors/board-registry'
import { probeSponsorBoards } from '@/lib/sponsors/boards'
import { deepFetchShortJobs } from './deep-fetch'
import { runDiscovery } from './discover'
import { draftApplication } from './draft'
import { resolveEmployerLinks } from './employer-links'
import { enrichJobs } from './enrich'
import { createRunLogger } from './logger'
import { prefilterReason } from './prefilter'
import { getProfileForPrompt, ProfileMissingError } from './profile'
import { rankJobs } from './rank'

export class RunAlreadyActiveError extends Error {
  status = 409
  constructor() {
    super('A search run is already in progress')
    this.name = 'RunAlreadyActiveError'
  }
}

/** Thrown inside a step when the user pressed "Stop run"; unwinds to the CANCELLED finaliser. */
export class RunCancelledError extends Error {
  constructor() {
    super('Run stopped by user')
    this.name = 'RunCancelledError'
  }
}

const STALE_RUN_MS = 3 * 60 * 60 * 1000
/** A running run whose executing worker has not touched it for this long is considered orphaned. */
export const RUN_HEARTBEAT_STALE_MS = 2 * 60 * 1000
const HEARTBEAT_EVERY_MS = 30 * 1000

/**
 * Worker start-up: whatever is still RUNNING cannot be, because this process was not running
 * it. Runs the user had asked to stop become "Stopped", the rest "Failed".
 */
export async function failStaleRuns(): Promise<number> {
  const now = new Date()
  const cancelled = await db.searchRun.updateMany({
    where: { status: 'RUNNING', cancelRequested: true },
    data: { status: 'CANCELLED', finishedAt: now, errorDetails: { reason: 'Stopped by user; the worker restarted before the run could finish its batch' } },
  })
  const failed = await db.searchRun.updateMany({
    where: { status: 'RUNNING' },
    data: { status: 'FAILED', finishedAt: now, errorDetails: { reason: 'The worker restarted while this run was in progress' } },
  })
  return cancelled.count + failed.count
}

/** True when a RUNNING run has no worker behind it any more (no heartbeat for 2 minutes). */
export function isRunOrphaned(run: { status: string; startedAt: Date; heartbeatAt: Date | null }): boolean {
  if (run.status !== 'RUNNING') return false
  const last = run.heartbeatAt ?? run.startedAt
  return Date.now() - last.getTime() > RUN_HEARTBEAT_STALE_MS
}

/** Ask a run to stop; the worker honours it at the next batch boundary. */
export async function requestRunCancel(runId: string): Promise<void> {
  await db.searchRun.updateMany({ where: { id: runId, status: 'RUNNING' }, data: { cancelRequested: true } })
}

export interface RunOptions {
  /** Restrict discovery to these sources. */
  sources?: SourceId[]
  /** Skip discovery and only process what is already in the DB (e.g. after changing settings). */
  skipDiscovery?: boolean
  /** Skip drafting. */
  skipDrafts?: boolean
}

/**
 * The full pipeline: discover → prefilter → enrich → rank → draft → decide.
 * Every step is independent; failures are counted and the run continues.
 * "Stop run" is checked between steps and between batches inside each step, so a
 * stop never leaves a half-written job: whatever finished stays, the rest waits
 * for the next run.
 */
export async function executeSearchRun(trigger: RunTrigger, opts: RunOptions = {}): Promise<string> {
  const active = await db.searchRun.findFirst({ where: { status: 'RUNNING', startedAt: { gte: new Date(Date.now() - STALE_RUN_MS) } }, select: { id: true, status: true, startedAt: true, heartbeatAt: true } })
  if (active && !isRunOrphaned(active)) throw new RunAlreadyActiveError()
  if (active) {
    // Left behind by a crashed worker: close it so the new run can start.
    await db.searchRun.update({ where: { id: active.id }, data: { status: 'FAILED', finishedAt: new Date(), errorDetails: { reason: 'No heartbeat from the worker; closed when the next run started' } } })
  }

  const run = await db.searchRun.create({ data: { trigger, status: 'RUNNING', heartbeatAt: new Date() } })
  const log = createRunLogger(run.id)
  const started = Date.now()
  const counters = { fetched: 0, created: 0, duplicates: 0, filtered: 0, enriched: 0, ranked: 0, drafted: 0, queued: 0, errors: 0 }
  const errorDetails: Array<{ step: string; message: string }> = []

  // Cancellation flag, re-read from the database at most every few seconds; the same
  // check doubles as the run's heartbeat so an orphaned run can be told apart from a live one.
  let cancelled = false
  let lastCancelCheck = 0
  let lastHeartbeat = Date.now()
  const isCancelled = async (): Promise<boolean> => {
    if (cancelled) return true
    if (Date.now() - lastCancelCheck < 3000) return false
    lastCancelCheck = Date.now()
    const row = await db.searchRun.findUnique({ where: { id: run.id }, select: { cancelRequested: true } })
    cancelled = Boolean(row?.cancelRequested)
    if (Date.now() - lastHeartbeat > HEARTBEAT_EVERY_MS) {
      lastHeartbeat = Date.now()
      await db.searchRun.update({ where: { id: run.id }, data: { heartbeatAt: new Date() } }).catch(() => undefined)
    }
    return cancelled
  }
  const heartbeatTimer = setInterval(() => {
    lastHeartbeat = Date.now()
    void db.searchRun.update({ where: { id: run.id }, data: { heartbeatAt: new Date() } }).catch(() => undefined)
  }, HEARTBEAT_EVERY_MS)
  const checkCancel = async () => {
    if (await isCancelled()) throw new RunCancelledError()
  }

  const step = async (name: string, fn: () => Promise<void>) => {
    await checkCancel()
    try {
      await fn()
    } catch (err) {
      if (err instanceof RunCancelledError) throw err
      counters.errors++
      const message = err instanceof Error ? err.message : String(err)
      errorDetails.push({ step: name, message })
      log.error(`${name} failed: ${message}`)
    }
    await log.flush()
    await checkCancel()
  }

  const counterData = () => ({
    totalFetched: counters.fetched,
    totalNew: counters.created,
    totalDuplicates: counters.duplicates,
    totalFiltered: counters.filtered,
    totalEnriched: counters.enriched,
    totalRanked: counters.ranked,
    totalDrafted: counters.drafted,
    totalQueued: counters.queued,
    errorCount: counters.errors,
    errorDetails: errorDetails.length ? (errorDetails as unknown as Prisma.InputJsonValue) : undefined,
  })

  try {
    const settings = await getSettings()
    log.info(`Run started (${trigger})`, { sources: opts.sources, interval: settings.searchIntervalMinutes })

    // 1. Discover
    let newJobIds: string[] = []
    if (!opts.skipDiscovery) {
      await step('discover', async () => {
        const r = await runDiscovery(run.id, settings, log, opts.sources, isCancelled)
        newJobIds = r.newJobIds
        counters.fetched = r.fetched
        counters.created = r.created
        counters.duplicates = r.duplicates
        counters.errors += r.errors
        log.info(`Discovery: ${r.fetched} fetched, ${r.created} new, ${r.duplicates} already known, ${r.blacklisted} blacklisted`)
      })
    }

    // 1b. Deep-fetch snippet-only listings with the browser (full text + emails)
    if (!opts.skipDiscovery) {
      await step('deep-fetch', async () => {
        await deepFetchShortJobs(settings, log)
      })
    }

    // 1c. Company boards: the boards this run's job links name, and on full runs a monthly probe for known
    // sponsors without one (plan-apply-all.md 8.2). The next run reads those boards as the main fresh source.
    if (!opts.skipDiscovery) {
      await step('boards', async () => {
        if (newJobIds.length) await registerBoardsFromJobs({ jobIds: newJobIds, log: (m) => log.info(m) })
        if (!opts.sources) {
          const p = await probeSponsorBoards({ limit: 60, log: (m) => log.info(`Board probe: ${m}`) })
          if (p.checked) log.info(`Board probe: ${p.checked} known sponsor(s) without a board checked, ${p.found} board(s) found`)
        }
      })
    }

    // 2. Prefilter every NEW job (not just this run's, so settings changes apply)
    const candidateIds: string[] = []
    // Work rights and languages decide the visa and language checks; an empty profile keeps them strict.
    const candidate = await loadCandidateContext().catch(() => null)
    await step('prefilter', async () => {
      const fresh = await db.job.findMany({ where: { status: 'NEW' }, select: { id: true, title: true, companyName: true, description: true, countryCode: true, location: true, remote: true, visaFlag: true } })
      for (const j of fresh) {
        const { reason, language } = prefilterReason(j, settings.search, candidate)
        if (reason) {
          await db.job.update({ where: { id: j.id }, data: { status: 'FILTERED', filterReason: reason, language } })
          counters.filtered++
        } else {
          if (language) await db.job.update({ where: { id: j.id }, data: { language } })
          candidateIds.push(j.id)
        }
      }
      log.info(`Prefilter: ${counters.filtered} dropped, ${candidateIds.length} kept`)
    })

    // 3. Enrich (cap per run so a huge first import cannot burn the quota)
    const toEnrich = candidateIds.slice(0, settings.search.maxJobsPerRun)
    let enrichedIds: string[] = []
    await step('enrich', async () => {
      const unenriched = await db.job.findMany({ where: { id: { in: toEnrich }, enrichedAt: null }, select: { id: true } })
      const r = await enrichJobs(unenriched.map((j) => j.id), settings, log, isCancelled)
      counters.enriched = r.enriched
      counters.errors += r.errors
      enrichedIds = (await db.job.findMany({ where: { id: { in: toEnrich }, enrichedAt: { not: null } }, select: { id: true } })).map((j) => j.id)
      log.info(`Enrich: ${r.enriched} enriched, ${r.errors} errors`)
    })

    // 4. Rank
    let profileOk = true
    await step('rank', async () => {
      let profile
      try {
        profile = await getProfileForPrompt()
      } catch (err) {
        if (err instanceof ProfileMissingError) {
          profileOk = false
          log.warn('No candidate profile yet; skipping ranking and drafting. Upload your resume in Settings → Profile.')
          return
        }
        throw err
      }
      const r = await rankJobs(enrichedIds, settings, profile, log, isCancelled)
      counters.ranked = r.ranked
      counters.errors += r.errors
      log.info(`Rank: ${r.ranked} ranked, ${r.excluded} excluded by rules, ${r.errors} errors`)
    })

    // 4a. Employer forms for good board-only postings (Adzuna, Jooble...), so the apply batch can reach them.
    if (profileOk) {
      await step('employer-links', async () => {
        await resolveEmployerLinks({ limit: 150, log: (m) => log.info(m), shouldStop: isCancelled })
      })
    }

    // 4b. Contact discovery for high-scoring jobs without an address
    if (profileOk) {
      await step('contacts', async () => {
        await discoverContacts(settings, log, isCancelled)
      })
    }

    // 5. Draft + decide
    if (profileOk && !opts.skipDrafts && settings.ranking.maxDraftsPerRun > 0) {
      await step('draft', async () => {
        const usage = await getAiUsageSummary()
        // A draft costs roughly draft + judge (+ up to 2 rewrite rounds) on the primary-class models.
        const quotaCap = Math.max(0, Math.floor(usage.primaryRemaining / 4))
        const limit = Math.min(settings.ranking.maxDraftsPerRun, quotaCap)
        if (limit === 0) {
          log.warn(`Drafting skipped: remaining daily quota on the drafting models is ${usage.primaryRemaining} requests`)
          return
        }
        const candidates = await db.job.findMany({
          where: {
            status: 'RANKED',
            application: null,
            score: { finalScore: { gte: settings.ranking.draftThreshold } },
            company: { blacklisted: false },
            // Form-first systems (Greenhouse, Ashby, Lever, Workable) are applied to through the browser agent.
            AND: [{ OR: [{ atsType: null }, { atsType: { notIn: [...FORM_FIRST_ATS] } }] }],
          },
          orderBy: [{ score: { finalScore: 'desc' } }, { firstSeenAt: 'desc' }],
          // Over-fetch: companies in cooldown and second jobs at the same company are skipped below.
          take: limit * 4,
          select: { id: true, title: true, companyName: true, companyId: true, countryCode: true, location: true, description: true, remote: true, visaFlag: true, contactEmail: true },
        })
        // Jobs ranked before a filter rule existed (e.g. "propulsion engineer") are re-checked against today's rules.
        for (const c of candidates) {
          const { reason } = prefilterReason(c, settings.search, candidate)
          if (reason) await db.job.update({ where: { id: c.id }, data: { status: 'FILTERED', filterReason: reason } })
        }
        const stale = new Set(candidates.filter((c) => prefilterReason(c, settings.search, candidate).reason).map((c) => c.id))
        // The title rule covers the run's own drafts too (an off-title email once went out through here).
        const offTitle = (t: string) => !titleAllowed(settings.portal, t, settings.search)
        candidates.splice(0, candidates.length, ...candidates.filter((c) => !stale.has(c.id) && !offTitle(c.title)))
        if (stale.size) log.info(`Drafting: ${stale.size} ranked job(s) no longer pass the filters and were set aside`)
        log.info(`Drafting ${candidates.length} applications (threshold ${settings.ranking.draftThreshold}, limit ${limit})`)
        // One application per company (per country) per cooldown window: never spend a draft on a job
        // that could not be sent anyway, and draft only the best-scoring job per company per run.
        const draftedThisRun = new Set<string>()
        let drafts = 0
        let skippedCooldown = 0
        for (const c of candidates) {
          if (drafts >= limit) break
          const key = settings.email.companyCooldownScope === 'company_country' ? `${c.companyId}:${c.countryCode ?? ''}` : c.companyId
          if (draftedThisRun.has(key)) continue
          if (await findCooldownConflict({ companyId: c.companyId, countryCode: c.countryCode, toEmail: c.contactEmail }, settings.email)) {
            skippedCooldown++
            continue
          }
          const existingDraft = await db.application.findFirst({ where: { status: { in: ['REVIEW', 'NEEDS_HUMAN', 'DRAFT'] }, job: { companyId: c.companyId, ...(settings.email.companyCooldownScope === 'company_country' && c.countryCode ? { countryCode: c.countryCode } : {}) } }, select: { id: true } })
          if (existingDraft) {
            skippedCooldown++
            continue
          }
          draftedThisRun.add(key)
          drafts++
          if (await isCancelled()) {
            log.info('Drafting stopped by user; remaining jobs are drafted on the next run')
            break
          }
          const left = (await getAiUsageSummary()).primaryRemaining
          if (left < 3) {
            log.warn(`Drafting stopped: only ${left} primary-model requests left today; remaining jobs are drafted on the next run`)
            break
          }
          try {
            const app = await draftApplication(c.id, { log })
            counters.drafted++
            const decision = await evaluateAutoSend(app.id)
            if (decision.outcome === 'queued') {
              counters.queued++
              log.info(`Queued: ${c.title} at ${c.companyName} for ${decision.scheduledFor?.toISOString()}`)
            } else log.info(`Review: ${c.title} at ${c.companyName} (${decision.reason})`)
          } catch (err) {
            if (err instanceof NoKeyAvailableError) {
              log.info('Drafting: daily AI quota used up; remaining jobs are drafted on the next run')
              break
            }
            counters.errors++
            log.warn(`Draft failed for ${c.title} at ${c.companyName}: ${err instanceof Error ? err.message : err}`)
          }
        }
        if (skippedCooldown) log.info(`Drafting: skipped ${skippedCooldown} job(s) at companies already applied to or with a draft waiting (cooldown ${settings.email.companyCooldownDays} days)`)
      })
    }

    clearInterval(heartbeatTimer)
    const status = counters.errors > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED'
    await db.searchRun.update({
      where: { id: run.id },
      data: { status, finishedAt: new Date(), durationMs: Date.now() - started, ...counterData() },
    })
    log.info(`Run ${status} in ${Math.round((Date.now() - started) / 1000)}s`, counters)
    await log.flush()
    await notify(
      'run_complete',
      `Search run ${status === 'COMPLETED' ? 'completed' : 'completed with errors'}`,
      `${counters.created} new jobs, ${counters.ranked} ranked, ${counters.drafted} drafted, ${counters.queued} queued`,
      `/runs/${run.id}`,
    )
    return run.id
  } catch (err) {
    clearInterval(heartbeatTimer)
    if (err instanceof RunCancelledError) {
      log.info(`Run stopped by user after ${Math.round((Date.now() - started) / 1000)}s; everything finished so far is kept`, counters)
      await log.flush()
      await db.searchRun.update({
        where: { id: run.id },
        data: { status: 'CANCELLED', finishedAt: new Date(), durationMs: Date.now() - started, ...counterData() },
      })
      await notify('run_complete', 'Search run stopped', `${counters.created} new jobs, ${counters.ranked} ranked, ${counters.drafted} drafted before the stop`, `/runs/${run.id}`)
      return run.id
    }
    const message = err instanceof Error ? err.message : String(err)
    log.error(`Run failed: ${message}`)
    await log.flush()
    await db.searchRun.update({
      where: { id: run.id },
      data: { status: 'FAILED', finishedAt: new Date(), durationMs: Date.now() - started, errorCount: counters.errors + 1, errorDetails: [{ step: 'run', message }] as unknown as Prisma.InputJsonValue },
    })
    await notify('error', 'Search run failed', message, `/runs/${run.id}`)
    throw err
  }
}
