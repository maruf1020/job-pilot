import { sameCompanyKey } from '@/lib/companies/same-company'
import { db } from '@/lib/db'
import { excludedTitleKeyword, fitsStack, yearsRequired } from '@/lib/pipeline/prefilter'
import { findEmployerLink, NO_FORM_HOSTS } from '@/lib/sources/freehire'
import { gateEnabled, gateReason } from '@/lib/pipeline/quality-gate'
import { enqueuePortalBatchTick } from '@/lib/queue'
import type { AppSettings, PortalSite } from '@/lib/settings/schema'
import { getSettings } from '@/lib/settings/service'
import { agentsBrowserConfig, connectApplyBrowser } from '@/lib/browser/chrome'
import { pacificDayStart, withPreferredKey } from '@/lib/ai/key-pool'
import { runPortalAttempt } from './attempt'
import { canHandOver, handOverToYou } from './handover'
import { alwaysCaptcha, runsInYourChrome, triageKey } from './adapters'
import { hostSkipReason, loadHostStats, normalizeHost, type HostStat } from './hosts'
import { hostOf } from './match'
import { isBlockedHost } from './navigate'
import { formTarget, notAJobPage, type FormTarget } from './urls'
import { titleAllowed } from '@/lib/ranking/rules'
import { loadCandidateContext } from '@/lib/candidate/load'

/**
 * Browser auto-apply batch: best score first, one company at a time (shared cooldown with
 * email applications), daily cap, pause between submissions. Starting a batch in "submit"
 * mode is your permission for its own applications only; Stop ends it.
 */

export interface PortalBatchInput {
  mode: 'fill' | 'submit'
  target: number
  continuous: boolean
  minScore: number
  countries: string[]
  sites: PortalSite[]
}

export interface PortalCandidate {
  jobId: string
  applicationId: string | null
  title: string
  company: string
  companyId: string
  countryCode: string | null
  score: number | null
  target: FormTarget
}

const IN_FLIGHT_PORTAL = ['QUEUED', 'RUNNING', 'AWAITING_REVIEW', 'NEEDS_HUMAN']
/**
 * Postings asking this many years of experience or more are skipped: a few years above the person's own
 * ("10+ years" from someone with 4 only costs a rejection), never below 3 so a fresh profile still applies.
 */
export function maxYearsAsked(yearsExperience: number): number {
  return Math.max(3, Math.floor(yearsExperience) + 3)
}
/** Board-only jobs whose employer link was looked up already (found ones get their URL replaced). */
const linkLookedUp = new Set<string>()
/** Employer-link lookups per candidate search, so a claim never waits long on freehire.me. */
const MAX_LINK_LOOKUPS = 6
/** When nothing else is ready the agents wait anyway, so look up more: 457 board-only jobs once sat unchecked. */
const MAX_LINK_LOOKUPS_IDLE = 20
const DONE_STATUSES = ['QUEUED', 'APPROVED', 'SENT', 'REPLIED', 'INTERVIEW', 'OFFER', 'REJECTED', 'SKIPPED', 'NO_RESPONSE']

/** A company name without its ATS domain or legal form: "instabee.teamtailor.com", "Instabee AB" → "instabee". */
export { companyKey } from '@/lib/companies/same-company'

/** The posting's address without query and trailing slash, for spotting one job listed twice. */
export function postingKey(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    const path = u.pathname.replace(/\/+$/, '')
    // A bare careers home or search page names no job.
    if (path.split('/').filter(Boolean).length < 2) return null
    return `${u.host.replace(/^www\./, '')}${path}`.toLowerCase()
  } catch {
    return null
  }
}

/** The host triage key of a form link ("jobs.lever.co/kpler" on shared systems), as attempts record it. */
function hostKey(url: string): string {
  return triageKey(url) ?? hostOf(url)
}

/** A host where forms rarely end submitted (after a few tries): its jobs go to the back of the list. */
function weakHost(url: string, stats: Map<string, HostStat>): boolean {
  const s = stats.get(normalizeHost(hostKey(url)))
  return !!s && s.attempts >= 3 && s.submitted / s.attempts < 0.2
}

/** Jobs the agent would apply to next, best first, one per company. */
export async function portalCandidates(input: Pick<PortalBatchInput, 'minScore' | 'countries' | 'sites'>, limit = 20): Promise<PortalCandidate[]> {
  const settings = await getSettings()
  const allowed = new Set<string>(input.sites.length ? input.sites.filter((s) => settings.portal.sites.includes(s)) : settings.portal.sites)
  // Companies already being handled (an email queued, a form waiting for you, an agent run).
  const busy = await db.application.findMany({
    where: { OR: [{ status: { in: ['QUEUED', 'APPROVED'] } }, { portalStatus: { in: IN_FLIGHT_PORTAL } }] },
    select: { job: { select: { companyId: true, companyName: true, countryCode: true } } },
  })
  const perCountry = settings.email.companyCooldownScope === 'company_country'
  const keyOf = (companyId: string, cc: string | null) => (perCountry && cc ? `${companyId}|${cc}` : companyId)
  // One company can sit under two records ("Instabee" and "instabee.teamtailor.com" both got the same
  // job once): the name key and the posting address catch what the company id misses.
  const taken = new Set(busy.flatMap((b) => [keyOf(b.job.companyId, b.job.countryCode), b.job.companyId, `name:${sameCompanyKey(b.job.companyName)}`]))
  // The same role is often listed once per country (Elastic, Nebius): apply to it once.
  const roleKey = (company: string, title: string) => `${sameCompanyKey(company)}|${title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`
  const appliedRoles = await db.application.findMany({
    where: { OR: [{ sentAt: { not: null } }, { portalStatus: { in: [...IN_FLIGHT_PORTAL, 'SUBMITTED'] } }] },
    select: { job: { select: { companyName: true, title: true, url: true } } },
  })
  const roles = new Set(appliedRoles.map((a) => roleKey(a.job.companyName, a.job.title)))
  const postings = new Set(appliedRoles.map((a) => postingKey(a.job.url)).filter((k): k is string => !!k))
  // Up to portal.maxPerCompany different roles per company in companyWindowDays (Stripe, Elastic and
  // Databricks each hold 40-180 fitting jobs; one application a month left most of them untouched).
  const since = new Date(Date.now() - settings.portal.companyWindowDays * 86_400_000)
  const recent = await db.application.findMany({
    where: { OR: [{ sentAt: { gte: since } }, { status: { in: ['QUEUED', 'APPROVED'] } }, { portalStatus: { in: IN_FLIGHT_PORTAL } }] },
    select: { job: { select: { companyId: true, companyName: true } } },
  })
  const perCompany = new Map<string, number>()
  for (const r of recent) {
    perCompany.set(r.job.companyId, (perCompany.get(r.job.companyId) ?? 0) + 1)
    const nk = `name:${sameCompanyKey(r.job.companyName)}`
    perCompany.set(nk, (perCompany.get(nk) ?? 0) + 1)
  }
  const hosts = await loadHostStats()
  const candidate = await loadCandidateContext()
  const maxYears = maxYearsAsked(candidate.yearsExperience)
  const oldest = new Date(Date.now() - settings.search.maxDaysOld * 86_400_000)
  const out: PortalCandidate[] = []
  let lookups = 0
  // Most top-scored jobs fall out below (other stack, cooldown, done): page on until enough are found.
  const PAGE = 300
  for (let skip = 0; out.length < limit; skip += PAGE) {
    const jobs = await db.job.findMany({
      where: {
        status: { in: ['RANKED', 'REVIEW'] },
        finalScore: { gte: input.minScore },
        company: { blacklisted: false },
        ...(input.countries.length ? { countryCode: { in: input.countries } } : {}),
        OR: [{ application: null }, { application: { sentAt: null, status: { notIn: DONE_STATUSES } } }],
        // Applying in a posting's first week converts best; postings older than maxDaysOld are left.
        AND: [{ OR: [{ postedAt: null }, { postedAt: { gte: oldest } }] }],
      },
      orderBy: [{ postedAt: { sort: 'desc', nulls: 'last' } }, { finalScore: 'desc' }],
      skip,
      take: PAGE,
      select: {
        id: true,
        title: true,
        description: true,
        url: true,
        atsType: true,
        companyId: true,
        companyName: true,
        countryCode: true,
        location: true,
        finalScore: true,
        sponsorship: true,
        salaryMin: true,
        salaryMax: true,
        currency: true,
        contactEmailSource: true,
        company: { select: { knownSponsor: true } },
        sourceLinks: { select: { source: true, externalId: true, url: true } },
        // Tries your Chrome refused, held while it was not answering, or cut off by a worker restart are no tries at the form.
        application: { select: { id: true, portalStatus: true, _count: { select: { attempts: { where: { status: { in: ['FAILED', 'CANCELLED'] }, NOT: [{ error: { startsWith: 'Your Chrome' } }, { error: { startsWith: 'Worker restarted' } }, { error: { startsWith: 'Network down' } }] } } } } } },
      },
    })
    for (const j of jobs) {
      if (out.length >= limit) break
      if (j.application && IN_FLIGHT_PORTAL.includes(j.application.portalStatus ?? '')) continue
      // Three tries at the form (two at first): the third runs with the screenshot driver and the fix hints.
      if ((j.application?._count.attempts ?? 0) >= 3) continue
      // Its page said "apply by email": an email draft waits for your approval instead (attempt.ts).
      if (j.contactEmailSource === 'apply-page') continue
      if (roles.has(roleKey(j.companyName, j.title))) continue
      const pk = postingKey(j.url)
      if (pk && postings.has(pk)) continue
      if (!titleAllowed(settings.portal, j.title, settings.search)) continue
      // Ranked before a keyword was added to Settings → Search (iOS, graduate...): still not a fit.
      if (excludedTitleKeyword(j.title, settings.search.excludeTitleKeywords)) continue
      // Your stack (Settings → Browser), e.g. only roles in one language or framework: named in the title or
      // more than other stacks in the description.
      if (!fitsStack(j.title, j.description, settings.portal.stackFocus)) continue
      // Far more years than the person has: those applications only cost a rejection.
      if ((yearsRequired(j.description) ?? 0) >= maxYears) continue
      const k = keyOf(j.companyId, j.countryCode)
      const nameKey = `name:${sameCompanyKey(j.companyName)}`
      if (taken.has(k) || taken.has(j.companyId) || taken.has(nameKey)) continue
      if ((perCompany.get(j.companyId) ?? 0) >= settings.portal.maxPerCompany || (perCompany.get(nameKey) ?? 0) >= settings.portal.maxPerCompany) continue
      // A feed post, company page, careers home or Hacker News thread has no form to fill.
      let target = formTarget(j, j.sourceLinks)
      if (notAJobPage(target.url, j.companyName)) continue
      // Adzuna (region-blocked), Jobicy (CAPTCHA + sign-in), Jooble and Himalayas give the agents no form.
      const boardOnly = NO_FORM_HOSTS.test(hostOf(target.url))
      if (boardOnly && (linkLookedUp.has(j.id) || lookups >= (out.length ? MAX_LINK_LOOKUPS : MAX_LINK_LOOKUPS_IDLE))) continue
      if (!boardOnly && (!allowed.has(target.site) || isBlockedHost(target.url, settings.portal.linkedinEasyApply))) continue
      // A host that keeps failing the same way, or has no usable form, rests (Settings → Browser → hosts).
      if (!boardOnly && hostSkipReason(hostKey(target.url), hosts)) continue
      // Only jobs that can lead to a permit (country known, sponsor evidence where needed, salary floor).
      if (gateEnabled(settings.email) && gateReason(j, { channel: 'form', candidate })) continue
      if (boardOnly) {
        // The employer's own posting of the same job, when freehire.me knows it.
        linkLookedUp.add(j.id)
        lookups++
        const link = await findEmployerLink(j.companyName, j.title)
        if (!link) continue
        await db.job.update({ where: { id: j.id }, data: { url: link } })
        target = formTarget({ url: link, atsType: null }, [])
        if (notAJobPage(link)) continue
        if (!allowed.has(target.site) || isBlockedHost(target.url, settings.portal.linkedinEasyApply) || hostSkipReason(hostKey(target.url), hosts)) continue
      }
      taken.add(k)
      taken.add(nameKey)
      if (pk) postings.add(pk)
      out.push({ jobId: j.id, applicationId: j.application?.id ?? null, title: j.title, company: j.companyName, companyId: j.companyId, countryCode: j.countryCode, score: j.finalScore, target })
    }
    if (jobs.length < PAGE) break
  }
  // Hosts where forms rarely get through go last; the order is otherwise kept (freshest first).
  return [...out.filter((c) => !weakHost(c.target.url, hosts)), ...out.filter((c) => weakHost(c.target.url, hosts))]
}

export async function startPortalBatch(input: PortalBatchInput) {
  const running = await db.portalBatch.findFirst({ where: { status: 'RUNNING' } })
  if (running) throw new Error('A browser auto-apply batch is already running. Stop it first.')
  const batch = await db.portalBatch.create({
    data: { status: 'RUNNING', mode: input.mode, target: input.target, continuous: input.continuous, minScore: input.minScore, countries: input.countries, atsTypes: input.sites },
  })
  await enqueuePortalBatchTick().catch(() => null)
  return batch
}

export async function cancelPortalBatch(id?: string) {
  const batch = id ? await db.portalBatch.findUnique({ where: { id } }) : await db.portalBatch.findFirst({ where: { status: 'RUNNING' } })
  if (!batch || batch.status !== 'RUNNING') return { cancelled: false }
  await db.portalBatch.update({ where: { id: batch.id }, data: { status: 'CANCELLED', cancelRequested: true, finishedAt: new Date(), waitingFor: null } })
  // A running attempt of this batch stops at its next step; queued ones never start.
  await db.portalAttempt.updateMany({ where: { batchId: batch.id, status: { in: ['QUEUED', 'RUNNING'] } }, data: { status: 'CANCELLED', error: 'Batch stopped by you' } })
  return { cancelled: true }
}

const TICK_BUDGET_MS = 20 * 60_000
/** Longest one attempt may hold an agent (the attempt budgets are 6-14 minutes; this catches pages that hang). */
const ATTEMPT_HARD_LIMIT_MS = 18 * 60_000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** True while a tick drives the agents, so the next minute's tick does not start a second set. */
let driving = false

/** Jobs are handed out one at a time, so two agents never take the same company. */
let claimLock: Promise<unknown> = Promise.resolve()
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = claimLock.then(fn, fn)
  claimLock = run.catch(() => undefined)
  return run
}

/** Your own Chrome takes one agent at a time: Playwright stalls on its background tabs. */
let chromeLock: Promise<unknown> = Promise.resolve()
export function inYourChrome<T>(fn: () => Promise<T>): Promise<T> {
  // A run that hangs (your Chrome stops answering when the PC runs out of memory) must not hold every
  // agent behind it: after 12 minutes the next one goes ahead (the batch stalled for 20 minutes once).
  const turn = Promise.race([chromeLock, sleep(12 * 60_000)])
  const run = turn.then(fn, fn)
  chromeLock = run.catch(() => undefined)
  return run
}

/**
 * The hidden Chrome gets CAPTCHAs your own Chrome never sees (Lever's hCaptcha, Workable's Turnstile):
 * a fresh attempt for the same application, to run in your Chrome.
 */
async function retryInYourChrome(attemptId: string, why = 'CAPTCHA'): Promise<string> {
  const old = await db.portalAttempt.update({ where: { id: attemptId }, data: { status: 'CANCELLED', error: `${why} in the hidden browser; tried again in your Chrome` } })
  const fresh = await db.portalAttempt.create({ data: { applicationId: old.applicationId, batchId: old.batchId, mode: old.mode, status: 'QUEUED' } })
  await db.application.update({ where: { id: old.applicationId }, data: { portalStatus: 'QUEUED' } })
  return fresh.id
}

type Claim = { kind: 'run'; batchId: string; attemptId: string; label: string; site: PortalSite; url: string } | { kind: 'wait'; ms: number } | { kind: 'stop' }

/** LinkedIn goes one job at a time, with pauses and a daily cap: it is your account, in your Chrome. */
async function linkedInSlotFree(settings: AppSettings): Promise<boolean> {
  if (!settings.portal.linkedinEasyApply) return false
  const li = { application: { job: { url: { contains: 'linkedin.com/jobs/view' } } } }
  if (await db.portalAttempt.count({ where: { ...li, status: { in: ['QUEUED', 'RUNNING'] } } })) return false
  const today = await db.portalAttempt.count({ where: { ...li, status: 'SUBMITTED', finishedAt: { gte: pacificDayStart() } } })
  if (today >= settings.portal.linkedinDailyCap) return false
  const last = await db.portalAttempt.findFirst({ where: { ...li, finishedAt: { not: null } }, orderBy: { finishedAt: 'desc' }, select: { finishedAt: true } })
  if (!last?.finishedAt) return true
  // A random gap between the two settings, fixed per application so it does not change between checks (human pace).
  const min = settings.portal.linkedinGapMinutes
  const max = Math.max(min, settings.portal.linkedinGapMaxMinutes)
  const frac = (Math.floor(last.finishedAt.getTime() / 1000) % 997) / 997
  return Date.now() - last.finishedAt.getTime() >= (min + frac * (max - min)) * 60_000
}

/** The next job for an agent, or why there is none. Runs under the claim lock. */
/**
 * Each agent works its own kind of site first, so they spread over the boards instead of all taking
 * the top jobs of one: agent 1 Greenhouse, 2 Ashby, 3 Lever/Workable, 4 SmartRecruiters/Personio/Teamtailor
 * and LinkedIn Easy Apply (SmartRecruiters and LinkedIn run in your Chrome, one at a time), 5 Recruitee and
 * company career pages, 6-8 company career pages. An empty lane takes any job.
 */
const LANES: Array<(site: PortalSite) => boolean> = [
  (s) => s === 'greenhouse',
  (s) => s === 'ashby',
  (s) => s === 'lever' || s === 'workable',
  (s) => s === 'smartrecruiters' || s === 'personio' || s === 'teamtailor' || s === 'linkedin',
  (s) => s === 'recruitee' || s === 'other',
  (s) => s === 'other',
  (s) => s === 'other',
  (s) => s === 'other',
]

/** Which apply lane an attempt belongs to (the scoreboard compares them). */
function laneOf(site: PortalSite): string {
  return site === 'linkedin' ? 'linkedin' : site === 'other' ? 'other' : 'ats'
}

async function claimNext(log: (m: string) => void, slot?: number): Promise<Claim> {
  const batch = await db.portalBatch.findFirst({ where: { status: 'RUNNING' }, orderBy: { startedAt: 'asc' } })
  if (!batch || batch.cancelRequested) return { kind: 'stop' }
  // Set when the AI quota or the browser needs a break; every agent waits.
  if (batch.nextAttemptAt && batch.nextAttemptAt > new Date()) return { kind: 'wait', ms: batch.nextAttemptAt.getTime() - Date.now() }

  const settings = await getSettings()
  const inFlight = await db.portalAttempt.count({ where: { batchId: batch.id, status: { in: ['QUEUED', 'RUNNING'] } } })
  const done = batch.mode === 'submit' ? batch.submitted : batch.submitted + batch.awaitingReview
  if (!batch.continuous && done >= batch.target) {
    if (!inFlight) {
      await db.portalBatch.update({ where: { id: batch.id }, data: { status: 'COMPLETED', finishedAt: new Date(), waitingFor: null, note: `Reached the target of ${batch.target}` } })
      log(`batch ${batch.id.slice(-6)} completed`)
    }
    return { kind: 'stop' }
  }
  // Jobs other agents are still on may reach the target; do not start more than needed.
  if (!batch.continuous && done + inFlight >= batch.target) return { kind: 'stop' }
  if (batch.mode === 'submit') {
    const today = await db.portalAttempt.count({ where: { status: 'SUBMITTED', batchId: { not: null }, finishedAt: { gte: pacificDayStart() } } })
    if (today + inFlight >= settings.portal.maxSubmissionsPerDay) {
      await db.portalBatch.update({ where: { id: batch.id }, data: { waitingFor: `Daily limit of ${settings.portal.maxSubmissionsPerDay} automatic submissions reached; continues tomorrow`, lastTickAt: new Date() } })
      return { kind: 'stop' }
    }
  }

  // LinkedIn runs one at a time with a gap. Ask for the other sites while it waits: the top 30 were once all
  // LinkedIn, so agents 2-10 sat idle with 207 jobs eligible.
  const linkedInOk = await linkedInSlotFree(settings)
  const sites = (batch.atsTypes as PortalSite[]).filter((s) => s !== 'linkedin' || linkedInOk)
  const usable = await portalCandidates({ minScore: batch.minScore, countries: batch.countries, sites }, 30)
  const lane = slot === undefined ? null : LANES[slot % LANES.length]
  const next = (lane ? usable.find((c) => lane(c.target.site)) : undefined) ?? usable[0]
  if (!next) {
    // A continuous batch keeps its agents: they look again in a minute (the LinkedIn gap ends, a search adds
    // jobs). Stopping left 7 of 8 agents idle until the 20-minute tick ended, with jobs waiting.
    if (batch.continuous) {
      if (!inFlight) await db.portalBatch.update({ where: { id: batch.id }, data: { waitingFor: linkedInOk ? 'Waiting for new matching jobs from the next search run' : 'No matching jobs right now (LinkedIn also pauses between applications); waiting for the next search run', lastTickAt: new Date() } })
      return { kind: 'wait', ms: 60_000 }
    }
    if (inFlight) return { kind: 'stop' }
    await db.portalBatch.update({ where: { id: batch.id }, data: { status: 'COMPLETED', finishedAt: new Date(), waitingFor: null, note: 'No more matching jobs' } })
    return { kind: 'stop' }
  }

  const app =
    next.applicationId !== null
      ? await db.application.findUniqueOrThrow({ where: { id: next.applicationId } })
      : await db.application.create({ data: { jobId: next.jobId, channel: next.target.ats ? 'ats' : 'portal', status: 'DRAFT' } })
  const attempt = await db.portalAttempt.create({ data: { applicationId: app.id, batchId: batch.id, mode: batch.mode, status: 'QUEUED', lane: laneOf(next.target.site), host: normalizeHost(hostKey(next.target.url)) || null } })
  // QUEUED marks the company busy, so the next claim skips it.
  await db.application.update({ where: { id: app.id }, data: { portalStatus: 'QUEUED' } })
  await db.portalBatch.update({ where: { id: batch.id }, data: { considered: { increment: 1 }, waitingFor: null, lastTickAt: new Date() } })
  return { kind: 'run', batchId: batch.id, attemptId: attempt.id, label: `${next.title} at ${next.company} (${next.target.site})`, site: next.target.site, url: next.target.url }
}

/** One agent: take a job, apply, pause, repeat until the tick budget, the target or the jobs run out. */
const RECYCLE_MS = 20 * 60_000
let nextRecycle = Date.now() + RECYCLE_MS
let backgroundRuns = 0
let recycling: Promise<void> | null = null

/** Close the background agents' browser; the next form launches a fresh one. One agent does it, the others wait. */
function recycleBackgroundBrowser(log: (m: string) => void): Promise<void> {
  recycling ??= (async () => {
    try {
      const settings = await getSettings()
      const conn = await connectApplyBrowser(agentsBrowserConfig(settings.portal), { launch: false, reuseOnly: true }).catch(() => null)
      if (conn) {
        await conn.browser.close().catch(() => undefined)
        log('closed the background browser to free memory; the next form opens a fresh one')
      }
    } finally {
      nextRecycle = Date.now() + RECYCLE_MS
      recycling = null
    }
  })()
  return recycling
}

async function agentLoop(slot: number, agents: number, started: number, log: (m: string) => void): Promise<void> {
  const tag = agents > 1 ? ` agent ${slot + 1}` : ''
  // Staggered starts: the agents do not all open a page in the same second.
  await sleep(slot * 5_000)
  while (Date.now() - started < TICK_BUDGET_MS) {
    // Every 20 minutes the background browser closes and starts fresh (its memory grows). No new
    // forms are taken meanwhile; the running ones finish first.
    if (agents > 1 && Date.now() >= nextRecycle) {
      if (backgroundRuns > 0) {
        await sleep(5_000)
        continue
      }
      await recycleBackgroundBrowser(log)
    }
    const claim = await exclusive(() => claimNext(log, slot))
    if (claim.kind === 'stop') return
    if (claim.kind === 'wait') {
      if (claim.ms > TICK_BUDGET_MS - (Date.now() - started)) return
      await sleep(claim.ms)
      continue
    }
    log(`batch ${claim.batchId.slice(-6)}${tag}: ${claim.label}`)
    // LinkedIn needs your signed-in Chrome; SmartRecruiters, Lever, Personio and Welcome to the Jungle wall or
    // challenge the hidden browser every time (adapters' preferYourChrome); everything else runs hidden.
    const background = agents > 1 && claim.site !== 'linkedin' && claim.site !== 'smartrecruiters' && !runsInYourChrome(claim.url)
    // A page that never answers (seen in your Chrome) must not hold the agent: after the hard limit it
    // moves on and the attempt is closed; the hung promise is left to the supervisor.
    const run = (id: string, hidden: boolean) =>
      Promise.race([
        runPortalAttempt(id, { interactive: false, background: hidden }),
        sleep(ATTEMPT_HARD_LIMIT_MS).then(async () => {
          await db.portalAttempt.updateMany({ where: { id, status: { in: ['QUEUED', 'RUNNING'] } }, data: { status: 'FAILED', error: 'Worker restarted: the page stopped answering; the agent moved on', finishedAt: new Date() } }).catch(() => undefined)
          return { status: 'FAILED', reason: 'The page stopped answering; the agent moved on' } as Awaited<ReturnType<typeof runPortalAttempt>>
        }),
      ])
    let attemptId = claim.attemptId
    let outcome: Awaited<ReturnType<typeof runPortalAttempt>>
    if (background) {
      backgroundRuns++
      try {
        outcome = await run(attemptId, true)
      } finally {
        backgroundRuns--
      }
    } else outcome = await inYourChrome(() => run(attemptId, false))
    // A CAPTCHA, a sign-in wall (your Chrome is signed in to Google, LinkedIn, Indeed...), a bot block
    // ("403 Forbidden") or a Submit that silently did nothing (invisible bot checks): your own Chrome often passes.
    if (background && outcome.status === 'NEEDS_HUMAN' && !alwaysCaptcha(claim.url) && /captcha|linkedin|sign in|log in|sign-in|\b403\b|forbidden|access denied|bot detection|access (is )?(temporarily )?restricted|^pressed submit|does not contain an apply button/i.test(outcome.reason ?? '')) {
      const why = /captcha/i.test(outcome.reason ?? '') ? 'CAPTCHA' : /linkedin/i.test(outcome.reason ?? '') ? 'LinkedIn sign-in' : /sign in|log in|sign-in/i.test(outcome.reason ?? '') ? 'sign-in' : /^pressed submit/i.test(outcome.reason ?? '') ? 'unconfirmed Submit' : 'blocked page'
      log(`batch ${claim.batchId.slice(-6)}${tag}: ${why} in the hidden browser, trying again in your Chrome`)
      attemptId = await retryInYourChrome(attemptId, why)
      outcome = await inYourChrome(() => run(attemptId, false))
    }
    log(`batch ${claim.batchId.slice(-6)}${tag}: ${outcome.status}${outcome.reason ? ` - ${outcome.reason}` : ''}`)
    // The form opens in your browser for you to finish; the agent moves on meanwhile.
    if (outcome.status === 'NEEDS_HUMAN' && canHandOver(outcome.reason)) void handOverToYou(attemptId, log)
    const pauseSec = await recordOutcome(claim.batchId, outcome)
    // That batch ended (stopped or replaced): take the next job from a newer batch, if any.
    if (pauseSec === null) continue
    await sleep(pauseSec * 1000)
  }
}

/**
 * Worker tick (every minute): runs the batch for up to ~20 minutes with `parallelAgents`
 * agents at once, each tied to its own Gemini key.
 */
export async function tickPortalBatch(log: (m: string) => void): Promise<void> {
  if (driving) return
  const batch = await db.portalBatch.findFirst({ where: { status: 'RUNNING' } })
  if (!batch || batch.cancelRequested) return
  // Runs started by hand share your Chrome with the agents through inYourChrome(); the hidden browser is free.
  driving = true
  try {
    const settings = await getSettings()
    const agents = Math.max(1, Math.min(12, settings.portal.parallelAgents))
    const started = Date.now()
    // Never wait forever for an agent stuck on a dead page: the next tick starts fresh agents.
    await Promise.race([Promise.all(Array.from({ length: agents }, (_, slot) => withPreferredKey(slot, () => agentLoop(slot, agents, started, log)))), sleep(TICK_BUDGET_MS + ATTEMPT_HARD_LIMIT_MS)])
  } finally {
    driving = false
  }
}

/** Count an attempt's outcome on its batch; returns the agent's pause in seconds, or null when the batch ended. */
async function recordOutcome(batchId: string, outcome: Awaited<ReturnType<typeof runPortalAttempt>>): Promise<number | null> {
  const settings = await getSettings()
  const gap = settings.portal.gapSeconds
  const pauseSec = outcome.status === 'SUBMITTED' ? gap.min + Math.random() * Math.max(0, gap.max - gap.min) : 5 + Math.random() * 10
  const data: Parameters<typeof db.portalBatch.update>[0]['data'] = { lastTickAt: new Date() }
  switch (outcome.status) {
    case 'SUBMITTED':
      data.submitted = { increment: 1 }
      break
    case 'AWAITING_REVIEW':
      data.awaitingReview = { increment: 1 }
      break
    case 'NEEDS_HUMAN':
      data.needsHuman = { increment: 1 }
      break
    case 'CANCELLED':
      data.skipped = { increment: 1 }
      break
    default:
      data.failed = { increment: 1 }
  }
  // These pause every agent (claimNext waits on nextAttemptAt).
  if (outcome.code === 'quota') {
    data.waitingFor = 'AI quota used up; trying again in 30 minutes'
    data.nextAttemptAt = new Date(Date.now() + 30 * 60_000)
  } else if (outcome.code === 'browser') {
    data.waitingFor = `Apply browser problem: ${outcome.reason?.slice(0, 200)}`
    data.nextAttemptAt = new Date(Date.now() + 5 * 60_000)
  }
  const fresh = await db.portalBatch.findUnique({ where: { id: batchId }, select: { status: true } })
  if (fresh?.status !== 'RUNNING') return null
  await db.portalBatch.update({ where: { id: batchId }, data })
  return pauseSec
}

/** Latest batch for the UI, with the attempts it made. */
export async function latestPortalBatch() {
  const batch = await db.portalBatch.findFirst({ orderBy: { startedAt: 'desc' } })
  if (!batch) return null
  const all = await db.portalAttempt.findMany({
    where: { batchId: batch.id },
    orderBy: { startedAt: 'desc' },
    select: {
      id: true,
      status: true,
      needsHumanReason: true,
      error: true,
      startedAt: true,
      finishedAt: true,
      application: { select: { id: true, sentAt: true, job: { select: { title: true, companyName: true, countryCode: true } } } },
    },
  })
  // One row per job, its latest attempt; a job applied to since (a re-run, or you) shows as submitted.
  const seen = new Set<string>()
  const rows = all
    .filter((a) => !seen.has(a.application.id) && !!seen.add(a.application.id))
    .map((a) => (a.application.sentAt && a.status !== 'SUBMITTED' ? { ...a, status: 'SUBMITTED' as typeof a.status, needsHumanReason: null } : a))
  const count = (s: string) => rows.filter((r) => r.status === s).length
  return { batch: { ...batch, submitted: count('SUBMITTED'), needsHuman: count('NEEDS_HUMAN') }, attempts: rows.slice(0, 30) }
}
