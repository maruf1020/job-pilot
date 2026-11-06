import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import type { AtsType } from '@/lib/domain'
import { notify } from '@/lib/notifications'
import { getSettings } from '@/lib/settings/service'
import { fetchCompanyBoard } from '@/lib/sources/ats'
import type { SourceContext } from '@/lib/sources/types'
import { Semaphore } from '@/lib/utils/semaphore'
import { BOARD_METHOD_LABEL, bumpAtsCount, bumpMethod, MAX_COMPANIES_PER_RUN, normalizeBoardMode, readAtsCounts, readMethodCounts, type BoardMethodId, type BoardRunPhase, type MethodCounts } from './board-progress'
import { GeminiBreaker, findBoardWithGemini } from './board-gemini'
import { countMatchingJobs, describeRelevance, type BoardRelevance, type RelevanceRules } from './board-relevance'
import {
  boardTakenByOther,
  clearDeadBoard,
  countDiscoveryCompanies,
  findBoard,
  findBoardViaCareers,
  markBoardChecked,
  saveBoard,
  selectDiscoveryCompanies,
  type BoardHit,
  type DiscoveryCompany,
  type FindBoardStats,
} from './boards'
import { createPoliteFetch } from './host-gate'

/**
 * "Find boards" as a tracked run, the way contact discovery is: the Companies page creates a BoardDiscoveryRun
 * row, the worker fills it in as it goes (counters, per-ATS and per-method counts, a live feed of
 * BoardDiscoveryLog lines) and honours Stop, and the page polls it every few seconds.
 *
 * What a run does, per company without a board: slug guesses from its name and domain, then its own careers
 * pages, then (last) Gemini's pointer, each verified against the live ATS. A found board is read once and kept
 * only when it lists a job matching the person's rules; everything else is only counted. Boards that stopped answering are
 * repaired or removed first, and boards never counted get their matching-jobs number last.
 */

export class BoardRunAlreadyRunningError extends Error {
  status = 409
  constructor() {
    super('A board search is already running')
    this.name = 'BoardRunAlreadyRunningError'
  }
}

/** Companies handled at the same time; the per-host gates keep the load on each ATS polite. */
const CONCURRENCY = 24
/** Gemini questions in flight at once (the client rotates every configured key). */
const GEMINI_CONCURRENCY = 6
/** The worker writes its progress this often; Stop is noticed at the same pace. */
const FLUSH_MS = 2000
/** A RUNNING row with no heartbeat for this long is a crashed run (a restarted worker picks it up well before). */
const STALE_AFTER_MS = 2 * 3600_000
/** After this many pick-ups in a row the run is given up (a crash loop). */
const MAX_RESUMES = 5
const LOG_KEEP_DAYS = 14

export type BoardLogLevel = 'found' | 'none' | 'error' | 'dead' | 'info'

export interface BoardLogEntry {
  level: BoardLogLevel
  message: string
  companyName?: string | null
  atsType?: string | null
  atsSlug?: string | null
  relevantJobs?: number | null
}

interface RunRow {
  total: number
  checked: number
  boardsFound: number
  boardsRelevant: number
  relevantJobs: number
  dead: number
  errors: number
  requests: number
  noBoard: number
  perAtsCounts: unknown
  perMethod: unknown
}

/**
 * Collects a run's counters and log lines in memory and writes them every couple of seconds (one UPDATE and one
 * INSERT, however many companies finished in between). Also the place that learns about a Stop request.
 * Public so other tools can report into the same panel.
 */
export class BoardRunReporter {
  total = 0
  checked = 0
  boardsFound = 0
  boardsRelevant = 0
  relevantJobs = 0
  dead = 0
  errors = 0
  requests = 0
  noBoard = 0
  perAts: Record<string, number> = {}
  perMethod: MethodCounts = readMethodCounts(null)
  phase: BoardRunPhase | null = null
  currentCompany: string | null = null
  cancelRequested = false
  private logs: BoardLogEntry[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private flushing: Promise<void> | null = null

  constructor(readonly runId: string, row?: RunRow) {
    if (row) {
      this.total = row.total
      this.checked = row.checked
      this.boardsFound = row.boardsFound
      this.boardsRelevant = row.boardsRelevant
      this.relevantJobs = row.relevantJobs
      this.dead = row.dead
      this.errors = row.errors
      this.requests = row.requests
      this.noBoard = row.noBoard
      this.perAts = readAtsCounts(row.perAtsCounts)
      this.perMethod = readMethodCounts(row.perMethod)
    }
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.flush(), FLUSH_MS)
    this.timer.unref?.()
  }

  add(entry: BoardLogEntry): void {
    this.logs.push(entry)
  }

  /** A board was found and read. It counts as found; with matching jobs it is also saved and its jobs add up. `relevance` is null when the board could not be read. */
  boardFound(atsType: string, method: BoardMethodId, relevance: BoardRelevance | null): void {
    this.boardsFound++
    this.perAts = bumpAtsCount(this.perAts, atsType)
    const saved = Boolean(relevance && relevance.matching > 0)
    this.perMethod = bumpMethod(this.perMethod, method, saved)
    if (relevance && saved) {
      this.relevantJobs += relevance.matching
      this.boardsRelevant++
    }
  }

  /** Write counters, the buffered log lines and the heartbeat; learn whether Stop was pressed. Never throws. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing
    const lines = this.logs
    this.logs = []
    this.flushing = (async () => {
      try {
        const row = await db.boardDiscoveryRun.update({
          where: { id: this.runId },
          data: {
            total: this.total,
            checked: this.checked,
            boardsFound: this.boardsFound,
            boardsRelevant: this.boardsRelevant,
            relevantJobs: this.relevantJobs,
            dead: this.dead,
            errors: this.errors,
            requests: this.requests,
            noBoard: this.noBoard,
            perAtsCounts: this.perAts,
            perMethod: this.perMethod as unknown as Prisma.InputJsonValue,
            phase: this.phase,
            currentCompany: this.currentCompany,
            lastTickAt: new Date(),
          },
          select: { cancelRequested: true },
        })
        if (row.cancelRequested) this.cancelRequested = true
        if (lines.length) {
          await db.boardDiscoveryLog.createMany({
            data: lines.map((l) => ({
              runId: this.runId,
              level: l.level,
              message: l.message.slice(0, 400),
              companyName: l.companyName ?? null,
              atsType: l.atsType ?? null,
              atsSlug: l.atsSlug ?? null,
              relevantJobs: l.relevantJobs ?? null,
            })),
          })
        }
      } catch (err) {
        this.logs = [...lines, ...this.logs] // try again next time
        console.error('[boards] could not write progress', err instanceof Error ? err.message : err)
      } finally {
        this.flushing = null
      }
    })()
    return this.flushing
  }

  /** Stop the timer, write everything and close the run. */
  async finish(status: 'COMPLETED' | 'CANCELLED' | 'FAILED', error: string | null = null): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    await this.flushing
    this.currentCompany = null
    await this.flush()
    await db.boardDiscoveryRun.update({ where: { id: this.runId }, data: { status, error, finishedAt: new Date(), currentCompany: null } }).catch((err) => console.error('[boards] could not close run', err))
  }
}

/** Create a run row. The worker picks it up from the queue (or the caller drives it with a BoardRunReporter). */
export async function startBoardRun(opts: { mode?: string; limit: number; total: number; includeChecked?: boolean }) {
  await db.boardDiscoveryLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - LOG_KEEP_DAYS * 86_400_000) } } }).catch(() => undefined)
  return db.boardDiscoveryRun.create({ data: { status: 'RUNNING', mode: opts.mode ?? 'find', limit: opts.limit, total: opts.total, includeChecked: opts.includeChecked ?? false } })
}

/** A run with no heartbeat for hours is a crashed one. */
export async function failStaleBoardRuns(reason = 'The worker stopped while this run was going; start it again (companies already checked are skipped).') {
  const r = await db.boardDiscoveryRun.updateMany({
    where: { status: 'RUNNING', lastTickAt: { lt: new Date(Date.now() - STALE_AFTER_MS) } },
    data: { status: 'FAILED', finishedAt: new Date(), error: reason, currentCompany: null },
  })
  return r.count
}

/**
 * Worker start-up: a RUNNING run was cut off by the restart. It is picked up again (the work already done stays
 * done: companies it checked are skipped) unless it has been restarted too many times. Returns the runs to queue.
 */
export async function resumeInterruptedBoardRuns(): Promise<Array<{ id: string; resumes: number }>> {
  const running = await db.boardDiscoveryRun.findMany({ where: { status: 'RUNNING' }, select: { id: true, resumes: true } })
  const out: Array<{ id: string; resumes: number }> = []
  for (const r of running) {
    if (r.resumes >= MAX_RESUMES) {
      await db.boardDiscoveryRun.update({ where: { id: r.id }, data: { status: 'FAILED', finishedAt: new Date(), currentCompany: null, error: `The worker restarted ${MAX_RESUMES} times while this run was going; start it again.` } })
      continue
    }
    const row = await db.boardDiscoveryRun.update({ where: { id: r.id }, data: { resumes: { increment: 1 }, lastTickAt: new Date() }, select: { id: true, resumes: true } })
    out.push(row)
  }
  return out
}

/** API side: size the run (repair + companies to try + boards to count) and create its row. `limit` null = every company without a board. */
export async function createBoardRun(limit: number | null, includeChecked = false) {
  await failStaleBoardRuns()
  const running = await db.boardDiscoveryRun.findFirst({ where: { status: 'RUNNING' } })
  if (running) throw new BoardRunAlreadyRunningError()
  const [find, repair, count] = await Promise.all([countDiscoveryCompanies('find', includeChecked), countDiscoveryCompanies('repair'), countDiscoveryCompanies('count')])
  const cap = Math.max(1, Math.min(limit ?? find, MAX_COMPANIES_PER_RUN))
  return startBoardRun({ limit: cap, total: Math.min(cap, find) + repair + count, includeChecked })
}

export async function cancelBoardRun(runId?: string) {
  const where = runId ? { id: runId, status: 'RUNNING' } : { status: 'RUNNING' }
  const r = await db.boardDiscoveryRun.updateMany({ where, data: { cancelRequested: true } })
  // No heartbeat for a minute: the worker is not running it, so nobody would ever close it.
  await db.boardDiscoveryRun.updateMany({ where: { ...where, lastTickAt: { lt: new Date(Date.now() - 60_000) } }, data: { status: 'CANCELLED', finishedAt: new Date(), currentCompany: null } })
  return r.count
}

/** What the page polls: the latest run, the last few runs, the live feed of the latest and (optionally) how many companies a run would cover. */
export async function boardRunOverview(opts: { logs?: number; recent?: number; counts?: boolean; includeChecked?: boolean } = {}) {
  await failStaleBoardRuns()
  const recent = await db.boardDiscoveryRun.findMany({ orderBy: { startedAt: 'desc' }, take: Math.max(1, Math.min(opts.recent ?? 8, 30)) })
  const latest = recent[0] ?? null
  const logs = latest ? await db.boardDiscoveryLog.findMany({ where: { runId: latest.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: Math.max(0, Math.min(opts.logs ?? 50, 200)) }) : []
  let counts: { find: number; repair: number; count: number } | null = null
  if (opts.counts) {
    const [find, repair, count] = await Promise.all([countDiscoveryCompanies('find', opts.includeChecked ?? false), countDiscoveryCompanies('repair'), countDiscoveryCompanies('count')])
    counts = { find, repair, count }
  }
  return { latest: latest && serializeRun(latest), recent: recent.map(serializeRun), logs, counts }
}

function serializeRun<T extends { perAtsCounts: unknown; perMethod: unknown }>(r: T) {
  return { ...r, perAtsCounts: readAtsCounts(r.perAtsCounts), perMethod: readMethodCounts(r.perMethod) }
}

/**
 * The rules a found board is measured against: the profession and target titles (Settings -> Search),
 * the allowed levels and skill focus (Settings -> Browser). Lead titles count when a lead level is allowed.
 */
export function relevanceRulesFrom(settings: {
  portal: { stackFocus: string[]; seniority?: string[] }
  search?: { profession?: string | null; targetTitles?: string[] }
}): RelevanceRules {
  const seniority = settings.portal.seniority ?? []
  return {
    stackFocus: settings.portal.stackFocus,
    allowLead: !seniority.length || seniority.some((s) => s === 'lead' || s === 'staff'),
    profession: settings.search?.profession ?? null,
    targetTitles: settings.search?.targetTitles ?? [],
    seniority,
  }
}

interface RunEnv {
  rules: RelevanceRules
  ctx: SourceContext
  fetch: typeof fetch
  maxDaysOld: number
  breaker: GeminiBreaker
  geminiSlots: Semaphore
  geminiPausedLogged: boolean
  /** Gemini lookups made so far in this run; capped so a run over 20,000 companies cannot use up the day's Gemini budget. */
  geminiCalls: number
}

/** Gemini lookups one run may make (the other methods have no such limit). */
export const GEMINI_CALLS_PER_RUN = Number(process.env.BOARD_GEMINI_CAP ?? 300)

/** Read a board once and count the jobs that match the person's rules. */
async function readAndCount(c: Pick<DiscoveryCompany, 'id' | 'name'>, hit: Pick<BoardHit, 'atsType' | 'atsSlug'>, env: RunEnv, rep: BoardRunReporter): Promise<BoardRelevance> {
  const ref = { id: c.id, name: c.name, atsType: hit.atsType as AtsType, atsSlug: hit.atsSlug, knownSponsor: false }
  const r = await fetchCompanyBoard(ref, env.ctx, env.maxDaysOld)
  rep.requests += r.requests
  return countMatchingJobs(r.jobs, env.rules)
}

/**
 * One company through the three methods, in order. The first board that lists a matching job is saved; a board
 * with none is remembered (counted as "board, no matching jobs") while the next method looks for a better one.
 */
async function processCompany(c: DiscoveryCompany, phase: BoardRunPhase, env: RunEnv, rep: BoardRunReporter): Promise<void> {
  rep.currentCompany = c.name
  const stats: FindBoardStats = { requests: 0, failures: 0 }
  const tried = new Set<string>()
  let zero: { hit: BoardHit; relevance: BoardRelevance | null; error: string | null } | null = null
  let saved: { hit: BoardHit; relevance: BoardRelevance } | null = null
  let geminiDomain: string | null = null
  try {
    // Returns true when this hit is a saved board; otherwise remembers it and lets the next method try.
    const consider = async (hit: BoardHit | null): Promise<boolean> => {
      if (!hit) return false
      const key = `${hit.atsType}:${hit.atsSlug}`
      if (tried.has(key) || (await boardTakenByOther(hit, c.id))) return false
      tried.add(key)
      let relevance: BoardRelevance | null = null
      let error: string | null = null
      try {
        relevance = await readAndCount(c, hit, env, rep)
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
        rep.errors++
      }
      if (relevance && relevance.matching > 0) {
        saved = { hit, relevance }
        return true
      }
      zero ??= { hit, relevance, error }
      return false
    }

    let done = await consider(await findBoard(c.name, c.domain, env.fetch, 16, stats, { skipSlow: true }))
    if (!done) done = await consider(await findBoardViaCareers(c.domain, env.fetch, stats))
    if (!done && !env.breaker.open && env.geminiCalls < GEMINI_CALLS_PER_RUN) {
      const release = await env.geminiSlots.acquire()
      try {
        env.geminiCalls++
        if (env.geminiCalls === GEMINI_CALLS_PER_RUN) rep.add({ level: 'info', message: `Gemini lookups stopped for the rest of this run (cap of ${GEMINI_CALLS_PER_RUN} reached); slug guesses and careers pages carry on` })
        rep.requests++
        const g = await findBoardWithGemini(c.name, c.domain, env.fetch, stats)
        env.breaker.ok()
        geminiDomain = g.domain
        // A domain Gemini named gives the careers-page method something to read when the company had none.
        if (!g.hit && !c.domain && g.domain) done = await consider(await findBoardViaCareers(g.domain, env.fetch, stats))
        else done = await consider(g.hit)
      } catch (err) {
        env.breaker.fail()
        if (env.breaker.open && !env.geminiPausedLogged) {
          env.geminiPausedLogged = true
          rep.add({ level: 'info', message: `Gemini lookups paused for the rest of this run: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}` })
        }
      } finally {
        release()
      }
    }
    rep.requests += stats.requests

    const s = saved as { hit: BoardHit; relevance: BoardRelevance } | null
    const z = zero as { hit: BoardHit; relevance: BoardRelevance | null; error: string | null } | null
    if (s) {
      await saveBoard(c.id, s.hit, s.relevance.matching, c.domain ? null : geminiDomain)
      const method = s.hit.via ?? 'slug'
      rep.boardFound(s.hit.atsType, method, s.relevance)
      const label = phase === 'repair' ? `${c.name}: repaired, now ${s.hit.atsType}/${s.hit.atsSlug}` : `${c.name}: ${s.hit.atsType}/${s.hit.atsSlug}`
      rep.add({ level: 'found', companyName: c.name, atsType: s.hit.atsType, atsSlug: s.hit.atsSlug, relevantJobs: s.relevance.matching, message: `${label}, ${describeRelevance(s.relevance)} (${BOARD_METHOD_LABEL[method].toLowerCase()})` })
    } else if (z) {
      const method = z.hit.via ?? 'slug'
      rep.boardFound(z.hit.atsType, method, z.relevance)
      const why = z.relevance ? describeRelevance(z.relevance) : `reading it failed: ${(z.error ?? '').slice(0, 100)}`
      if (phase === 'repair') {
        await clearDeadBoard(c, 'had no matching jobs')
        rep.dead++
      } else await markBoardChecked(c.id)
      rep.add({
        level: 'found',
        companyName: c.name,
        atsType: z.hit.atsType,
        atsSlug: z.hit.atsSlug,
        relevantJobs: z.relevance ? 0 : null,
        message: `${c.name}: ${z.hit.atsType}/${z.hit.atsSlug}, ${why}, not saved (${BOARD_METHOD_LABEL[method].toLowerCase()})`,
      })
    } else if (phase === 'repair') {
      await clearDeadBoard(c)
      rep.dead++
      rep.add({ level: 'dead', companyName: c.name, atsType: c.atsType, atsSlug: c.atsSlug, message: `${c.name}: ${c.atsType}/${c.atsSlug} stopped answering and no other board was found, removed` })
    } else {
      await markBoardChecked(c.id)
      rep.noBoard++
      const allFailed = stats.requests > 0 && stats.failures === stats.requests
      rep.add({ level: 'none', companyName: c.name, message: allFailed ? `${c.name}: no board found, every request failed (network?)` : `${c.name}: no board found (${stats.requests} requests: slug guesses, careers page${env.breaker.open ? '' : ', Gemini'})` })
    }
  } catch (err) {
    rep.errors++
    rep.add({ level: 'error', companyName: c.name, message: `${c.name}: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}` })
  } finally {
    rep.checked++
  }
}

/** A board that is already in use: only its matching-jobs number is stored (the board stays either way). */
async function countCompany(c: DiscoveryCompany, env: RunEnv, rep: BoardRunReporter, tally: { withJobs: number; without: number }): Promise<void> {
  rep.currentCompany = c.name
  try {
    const relevance = await readAndCount(c, { atsType: c.atsType as AtsType, atsSlug: c.atsSlug ?? '' }, env, rep)
    await db.company.update({ where: { id: c.id }, data: { boardMatchingJobs: relevance.matching, boardMatchedAt: new Date() } })
    if (relevance.matching > 0) tally.withJobs++
    else tally.without++
  } catch (err) {
    rep.errors++
    rep.add({ level: 'error', companyName: c.name, message: `${c.name}: could not read ${c.atsType}/${c.atsSlug}: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}` })
  } finally {
    rep.checked++
  }
}

async function runPhase<T>(items: T[], rep: BoardRunReporter, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const lane = async () => {
    while (!rep.cancelRequested) {
      const item = items[next++]
      if (item === undefined) return
      await work(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, lane))
}

/** Runs this process is working on: a queue job and the job that re-queues it after a restart must not both run it. */
const activeRuns = new Set<string>()

/** Worker side: repair, find, count, reporting live, until done or Stop. A restarted run carries on where it was. */
export async function runBoardDiscovery(runId: string, log: (m: string) => void = () => undefined): Promise<void> {
  if (activeRuns.has(runId)) return
  activeRuns.add(runId)
  try {
    await runBoardDiscoveryOnce(runId, log)
  } finally {
    activeRuns.delete(runId)
  }
}

async function runBoardDiscoveryOnce(runId: string, log: (m: string) => void): Promise<void> {
  const run = await db.boardDiscoveryRun.findUnique({ where: { id: runId } })
  if (!run || run.status !== 'RUNNING') return
  if (!normalizeBoardMode(run.mode)) {
    const rep = new BoardRunReporter(runId, run)
    await rep.finish('FAILED', `Mode "${run.mode}" cannot be run by the worker`)
    return
  }
  const rep = new BoardRunReporter(runId, run)
  rep.start()
  try {
    const settings = await getSettings()
    const polite = createPoliteFetch()
    const env: RunEnv = {
      rules: relevanceRulesFrom(settings),
      ctx: { search: settings.search, env: {}, fetch: polite, log: () => undefined },
      fetch: polite,
      maxDaysOld: settings.search.maxDaysOld,
      breaker: new GeminiBreaker(),
      geminiSlots: new Semaphore(GEMINI_CONCURRENCY),
      geminiPausedLogged: false,
      geminiCalls: 0,
    }
    // A run picked up again skips what it already did (companies it checked have a newer boardCheckedAt than its start).
    const resumeBefore = run.resumes > 0 || run.checked > 0 ? run.startedAt : undefined
    const repair = await selectDiscoveryCompanies('repair', MAX_COMPANIES_PER_RUN, false, resumeBefore)
    const counting = await selectDiscoveryCompanies('count', MAX_COMPANIES_PER_RUN, false, resumeBefore)
    const findLeft = resumeBefore ? Math.max(0, run.total - run.checked - repair.length - counting.length) : run.limit
    const find = await selectDiscoveryCompanies('find', findLeft, run.includeChecked, resumeBefore)
    rep.total = rep.checked + repair.length + find.length + counting.length
    rep.add({
      level: 'info',
      message: `${resumeBefore ? 'Carrying on' : 'Starting'}: ${repair.length} boards to repair, ${find.length} compan${find.length === 1 ? 'y' : 'ies'} to find a board for, ${counting.length} boards to count; ${CONCURRENCY} at a time`,
    })
    log(`board discovery ${runId}: repair ${repair.length}, find ${find.length}, count ${counting.length}`)

    if (repair.length) {
      rep.phase = 'repair'
      await runPhase(repair, rep, (c) => processCompany(c, 'repair', env, rep))
    }
    if (find.length && !rep.cancelRequested) {
      rep.phase = 'find'
      await runPhase(find, rep, (c) => processCompany(c, 'find', env, rep))
    }
    if (counting.length && !rep.cancelRequested) {
      rep.phase = 'count'
      const tally = { withJobs: 0, without: 0 }
      await runPhase(counting, rep, (c) => countCompany(c, env, rep, tally))
      rep.add({ level: 'info', message: `Counted ${tally.withJobs + tally.without} existing boards: ${tally.withJobs} have matching jobs, ${tally.without} have none (kept)` })
    }

    const stopped = rep.cancelRequested
    rep.add({ level: 'info', message: stopped ? `Stopped after ${rep.checked} of ${rep.total}` : `Finished: ${rep.noBoard} without a board, ${rep.boardsFound - rep.boardsRelevant} boards without matching jobs, ${rep.boardsRelevant} saved` })
    await rep.finish(stopped ? 'CANCELLED' : 'COMPLETED')
    log(`board discovery ${runId}: ${rep.checked} checked, ${rep.boardsRelevant} saved, ${rep.relevantJobs} matching jobs`)
    if (!stopped) {
      await notify('run_complete', 'Board search finished', `${rep.boardsRelevant} boards saved with ${rep.relevantJobs} matching jobs; ${rep.noBoard} companies without a board, ${rep.boardsFound - rep.boardsRelevant} boards without matching jobs${rep.dead ? `, ${rep.dead} dead removed` : ''}.`, '/companies')
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    rep.add({ level: 'error', message })
    await rep.finish('FAILED', message)
    await notify('error', 'Board search failed', message)
  }
}
