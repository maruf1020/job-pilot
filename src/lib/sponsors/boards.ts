import { db } from '@/lib/db'
import type { AtsType } from '@/lib/domain'
import { atsBoardUrl, parseJoinCompanyPage } from '@/lib/sources/ats'
import { mapLimit } from '@/lib/utils/semaphore'
import { collectCareersBoards } from './careers-discovery'

/**
 * Find a company's public job board by trying the usual ATS APIs with a few slug guesses
 * derived from its name and domain. Cheap (a handful of GETs per company) and safe:
 * a board only counts when the API answers with at least one job.
 */

const UA = 'job-pilot/1.0 (+personal job search)'

type Probe = {
  type: AtsType
  url: (slug: string) => string
  ok: (json: unknown) => boolean
  /** Company name as the API reports it, when it does (used to reject slug collisions). */
  companyName?: (json: unknown) => string | null
  /** How to read the answer (default: JSON). JOIN has no API: its job list is embedded in the company page. */
  read?: (res: Response) => Promise<unknown>
}

const PROBES: Probe[] = [
  { type: 'greenhouse', url: (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`, ok: (j) => Array.isArray((j as { jobs?: unknown[] })?.jobs) && ((j as { jobs: unknown[] }).jobs.length ?? 0) > 0 },
  { type: 'lever', url: (s) => `https://api.lever.co/v0/postings/${s}?mode=json&limit=1`, ok: (j) => Array.isArray(j) && j.length > 0 },
  { type: 'ashby', url: (s) => `https://api.ashbyhq.com/posting-api/job-board/${s}`, ok: (j) => Array.isArray((j as { jobs?: unknown[] })?.jobs) && (j as { jobs: unknown[] }).jobs.length > 0 },
  {
    type: 'workable',
    url: (s) => `https://www.workable.com/api/accounts/${s}?details=false`,
    ok: (j) => Array.isArray((j as { jobs?: unknown[] })?.jobs) && (j as { jobs: unknown[] }).jobs.length > 0,
    companyName: (j) => (j as { name?: string })?.name ?? null,
  },
  {
    type: 'smartrecruiters',
    url: (s) => `https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=1`,
    ok: (j) => ((j as { totalFound?: number })?.totalFound ?? 0) > 0,
    companyName: (j) => (j as { content?: Array<{ company?: { name?: string } }> })?.content?.[0]?.company?.name ?? null,
  },
  {
    type: 'recruitee',
    url: (s) => `https://${s}.recruitee.com/api/offers/`,
    ok: (j) => Array.isArray((j as { offers?: unknown[] })?.offers) && (j as { offers: unknown[] }).offers.length > 0,
    companyName: (j) => (j as { offers?: Array<{ company_name?: string }> })?.offers?.[0]?.company_name ?? null,
  },
  // Verified live (synthesia, makers, breezy, join): an unknown slug answers HTML or 404, never an empty list.
  { type: 'bamboohr', url: (s) => `https://${s}.bamboohr.com/careers/list`, ok: (j) => Array.isArray((j as { result?: unknown[] })?.result) && (j as { result: unknown[] }).result.length > 0 },
  {
    type: 'breezy',
    url: (s) => `https://${s}.breezy.hr/json`,
    ok: (j) => Array.isArray(j) && j.length > 0,
    companyName: (j) => (j as Array<{ company?: { name?: string } }>)?.[0]?.company?.name ?? null,
  },
  { type: 'pinpoint', url: (s) => `https://${s}.pinpointhq.com/postings.json`, ok: (j) => Array.isArray((j as { data?: unknown[] })?.data) && (j as { data: unknown[] }).data.length > 0 },
  {
    type: 'join',
    url: (s) => `https://join.com/companies/${s}`,
    read: async (res) => parseJoinCompanyPage(await res.text()),
    ok: (j) => ((j as { jobs?: unknown[] } | null)?.jobs?.length ?? 0) > 0,
    companyName: (j) => (j as { name?: string | null } | null)?.name ?? null,
  },
]

const readAnswer = (probe: Probe, res: Response): Promise<unknown> => (probe.read ? probe.read(res) : res.json())

/**
 * Does this exact board exist and list at least one job? Returns the company name the API reports (or
 * null when the API does not name it), or undefined when there is no live board. Used to verify boards
 * suggested by Gemini before they become sources.
 */
export async function probeBoard(type: AtsType, slug: string, fetchImpl: typeof fetch = globalThis.fetch): Promise<string | null | undefined> {
  const probe = PROBES.find((p) => p.type === type)
  if (!probe || !/^[a-z0-9][a-z0-9_-]{1,80}$/i.test(slug)) return undefined
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetchImpl(probe.url(slug), { headers: { 'user-agent': UA, accept: 'application/json' }, signal: controller.signal })
    if (!res.ok) return undefined
    const json = await readAnswer(probe, res)
    if (!probe.ok(json)) return undefined
    return probe.companyName?.(json) ?? null
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

function nameTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/\./g, '') // "T.E.S" → "tes"
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !/^(the|and|ltd|limited|inc|llc|plc|gmbh|group|company|corp|co)$/.test(w))
}

/** Same company? A shared distinctive word (or one name containing the other) is enough. */
export function namesMatch(a: string, b: string): boolean {
  const ta = nameTokens(a)
  const tb = nameTokens(b)
  if (!ta.length || !tb.length) return false
  const ja = ta.join('')
  const jb = tb.join('')
  return ja.includes(jb) || jb.includes(ja) || ta.some((w) => tb.includes(w))
}

/** Slug guesses in order of likelihood: "Acme Technologies Ltd" + acme.io → acmetechnologies, acme-technologies, acme. */
export function slugCandidates(name: string, domain?: string | null): string[] {
  const clean = name
    .toLowerCase()
    .replace(/\((?:[^)]*)\)/g, ' ')
    .replace(/\b(ltd|limited|inc|llc|llp|lp|plc|gmbh|ag|se|nv|bv|b\.v\.|sa|sas|srl|spa|kg|ug|aps|asa|oyj|oy|ab|as|ltda|pty|co|corp|corporation|company|group|holdings?|international|europe|ireland|uk)\b/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const words = clean.split(' ').filter(Boolean)
  const out: string[] = []
  const push = (s: string) => {
    if (s && s.length >= 2 && !out.includes(s)) out.push(s)
  }
  if (domain)
    push(
      domain
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .split(/[./]/)[0],
    )
  push(words.join(''))
  push(words.join('-'))
  if (words.length > 1) push(words[0])
  if (words.length > 2) push(words.slice(0, 2).join(''))
  return out.filter((s) => /^[a-z0-9-]+$/.test(s)).slice(0, 4)
}

/** How a board was found: slug guesses, the company's careers page, or a verified pointer from Gemini. */
export type BoardMethod = 'slug' | 'careers' | 'gemini'

export interface BoardHit {
  atsType: AtsType
  atsSlug: string
  careersUrl: string
  via?: BoardMethod
}

/** Optional counters the finders fill in, so a run can show how many requests it cost. */
export interface FindBoardStats {
  requests: number
  /** Requests that failed at the network level (timeout, DNS, reset) rather than answering "no such board". */
  failures: number
}

/** Slow hosts (Workable rate-limits an address with a Cloudflare 1015 after a burst; JOIN serves whole pages): tried one by one, only when every fast probe missed. */
const SLOW_TYPES: AtsType[] = ['workable', 'join']
const SLOW_PROBES = PROBES.filter((p) => SLOW_TYPES.includes(p.type))
/** Probes to fast hosts run together. */
const FAST_PROBES = PROBES.filter((p) => !SLOW_TYPES.includes(p.type))

/** One probe of one slug: true when the board answers with jobs (and, where the API names the company, it is this company). */
async function tryProbe(probe: Probe, slug: string, name: string, fetchImpl: typeof fetch, stats: FindBoardStats): Promise<boolean> {
  stats.requests++
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetchImpl(probe.url(slug), { headers: { 'user-agent': UA, accept: 'application/json' }, signal: controller.signal })
    if (!res.ok) return false
    const json = await readAnswer(probe, res)
    if (!probe.ok(json)) return false
    const reported = probe.companyName?.(json) ?? null
    return !(reported && !namesMatch(name, reported)) // a different company owns this slug
  } catch {
    stats.failures++
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** Method 1: slug guesses from the company's name and domain against the usual ATS APIs. */
export async function findBoard(
  name: string,
  domain: string | null | undefined,
  fetchImpl: typeof fetch = globalThis.fetch,
  maxRequests = 24,
  stats?: FindBoardStats,
  /** skipSlow: leave out the rate-limited hosts (Workable). A whole run of 24 lanes queues behind them (22,000 companies once ran at 1.5 a minute). */
  opts: { skipSlow?: boolean } = {},
): Promise<BoardHit | null> {
  const domainSlug = domain
    ? domain
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .split(/[./]/)[0]
    : null
  // Very short slugs ("tes", "imc") collide with unrelated companies unless they come from the company's own domain.
  const slugs = slugCandidates(name, domain).filter((s) => s.length >= 4 || s === domainSlug)
  const local: FindBoardStats = stats ?? { requests: 0, failures: 0 }
  const startedAt = local.requests
  const hit = (type: AtsType, slug: string): BoardHit => ({ atsType: type, atsSlug: slug, careersUrl: atsBoardUrl(type, slug), via: 'slug' })
  for (const slug of slugs) {
    if (local.requests - startedAt >= maxRequests) break
    const fast = await Promise.all(FAST_PROBES.map((p) => tryProbe(p, slug, name, fetchImpl, local)))
    const i = fast.findIndex(Boolean)
    if (i >= 0) return hit(FAST_PROBES[i].type, slug)
    if (local.requests - startedAt >= maxRequests) break
    for (const probe of opts.skipSlow ? [] : SLOW_PROBES) {
      if (local.requests - startedAt >= maxRequests) break
      if (await tryProbe(probe, slug, name, fetchImpl, local)) return hit(probe.type, slug)
    }
  }
  return null
}

/**
 * A board the company's own pages point at, verified: boards whose API can be probed must answer with jobs;
 * Personio, Teamtailor and Workday ones are checked when the board is read afterwards.
 */
export async function verifiedBoardRef(ref: { atsType: AtsType; slug: string }, via: BoardMethod, fetchImpl: typeof fetch, stats: FindBoardStats): Promise<BoardHit | null> {
  if (PROBES.some((p) => p.type === ref.atsType)) {
    stats.requests++
    if ((await probeBoard(ref.atsType, ref.slug, fetchImpl)) === undefined) return null
  }
  return { atsType: ref.atsType, atsSlug: ref.slug, careersUrl: atsBoardUrl(ref.atsType, ref.slug), via }
}

/** Method 2: the company's own website. Its careers page (and home page, sitemap) usually links to or embeds the board. */
export async function findBoardViaCareers(domain: string | null | undefined, fetchImpl: typeof fetch = globalThis.fetch, stats?: FindBoardStats): Promise<BoardHit | null> {
  if (!domain) return null
  const local: FindBoardStats = stats ?? { requests: 0, failures: 0 }
  const refs = await collectCareersBoards(domain, fetchImpl, local).catch(() => [])
  for (const ref of refs.slice(0, 3)) {
    const hit = await verifiedBoardRef(ref, 'careers', fetchImpl, local)
    if (hit) return hit
  }
  return null
}

/**
 * Look for the boards of known sponsors that have none yet, a few dozen per search run, each
 * company at most once a month (boardCheckedAt). Found boards become the company's main feed.
 */
export async function probeSponsorBoards(opts: { limit?: number; log?: (m: string) => void } = {}): Promise<{ checked: number; found: number }> {
  const monthAgo = new Date(Date.now() - 30 * 86_400_000)
  const companies = await db.company.findMany({
    where: { knownSponsor: true, atsType: null, blacklisted: false, OR: [{ boardCheckedAt: null }, { boardCheckedAt: { lt: monthAgo } }] },
    select: { id: true, name: true, domain: true },
    orderBy: [{ jobs: { _count: 'desc' } }, { name: 'asc' }],
    take: Math.min(opts.limit ?? 60, 300),
  })
  let found = 0
  await mapLimit(companies, 4, async (c) => {
    const hit = await findBoard(c.name, c.domain).catch(() => null)
    const taken = hit ? await db.company.findFirst({ where: { atsType: hit.atsType, atsSlug: hit.atsSlug }, select: { id: true } }) : null
    if (hit && !taken) {
      await db.company.update({ where: { id: c.id }, data: { atsType: hit.atsType, atsSlug: hit.atsSlug, careersUrl: hit.careersUrl, boardSource: 'probe', boardCheckedAt: new Date(), lastFetchError: null } })
      found++
      opts.log?.(`${c.name}: board ${hit.atsType}/${hit.atsSlug}`)
    } else {
      await db.company.update({ where: { id: c.id }, data: { boardCheckedAt: new Date() } })
    }
  })
  return { checked: companies.length, found }
}

export interface DiscoveryCompany {
  id: string
  name: string
  domain: string | null
  atsType: string | null
  atsSlug: string | null
}

const RECHECK_AFTER_DAYS = 14

/** A date condition: never done, or done before `cutoff`. */
const notSince = (field: 'boardCheckedAt' | 'boardMatchedAt', cutoff: Date) => ({ OR: [{ [field]: null }, { [field]: { lt: cutoff } }] })

/**
 * The phases of a run. repair = boards whose last read failed (found again or removed); find = companies without
 * a board; count = boards never counted for matching jobs (they stay; only the count is stored).
 * Companies probed in the last 14 days are skipped unless `includeChecked`, so repeated runs move on to new ones;
 * `resumeBefore` (the run's start) skips what the run already did, which is how a restarted run carries on.
 */
export type DiscoveryPhase = 'repair' | 'find' | 'count'

export function discoveryWhere(phase: DiscoveryPhase, includeChecked = false, resumeBefore?: Date) {
  const and: Array<Record<string, unknown>> = []
  if (phase === 'find' && !includeChecked) and.push(notSince('boardCheckedAt', new Date(Date.now() - RECHECK_AFTER_DAYS * 86_400_000)))
  if (resumeBefore) and.push(notSince(phase === 'count' ? 'boardMatchedAt' : 'boardCheckedAt', resumeBefore))
  const base =
    phase === 'repair'
      ? { atsType: { not: null }, lastFetchError: { not: null }, blacklisted: false }
      : phase === 'count'
        ? { atsType: { not: null }, lastFetchError: null, boardMatchedAt: null, blacklisted: false }
        : { atsType: null, blacklisted: false }
  return and.length ? { ...base, AND: and } : base
}

export async function countDiscoveryCompanies(phase: DiscoveryPhase, includeChecked = false, resumeBefore?: Date): Promise<number> {
  return db.company.count({ where: discoveryWhere(phase, includeChecked, resumeBefore) })
}

export async function selectDiscoveryCompanies(phase: DiscoveryPhase, limit: number, includeChecked = false, resumeBefore?: Date): Promise<DiscoveryCompany[]> {
  if (limit <= 0) return []
  return db.company.findMany({
    where: discoveryWhere(phase, includeChecked, resumeBefore),
    select: { id: true, name: true, domain: true, atsType: true, atsSlug: true },
    orderBy: [{ knownSponsor: 'desc' }, { jobs: { _count: 'desc' } }, { name: 'asc' }],
    take: Math.min(limit, 100_000),
  })
}

/** Is this exact board already the feed of another company? (A slug collision must not give one board to two companies.) */
export async function boardTakenByOther(hit: Pick<BoardHit, 'atsType' | 'atsSlug'>, companyId: string): Promise<string | null> {
  const other = await db.company.findFirst({ where: { atsType: hit.atsType, atsSlug: hit.atsSlug, id: { not: companyId } }, select: { name: true } })
  return other?.name ?? null
}

/** A found board with matching jobs becomes the company's main feed. */
export async function saveBoard(companyId: string, hit: BoardHit, matchingJobs: number | null = null, domain?: string | null): Promise<void> {
  const now = new Date()
  await db.company.update({
    where: { id: companyId },
    data: {
      atsType: hit.atsType,
      atsSlug: hit.atsSlug,
      careersUrl: hit.careersUrl,
      boardSource: hit.via === 'careers' ? 'careers' : hit.via === 'gemini' ? 'gemini' : 'probe',
      boardCheckedAt: now,
      lastFetchError: null,
      ...(matchingJobs === null ? {} : { boardMatchingJobs: matchingJobs, boardMatchedAt: now }),
      ...(domain ? { domain } : {}),
    },
  })
}

export async function markBoardChecked(companyId: string): Promise<void> {
  await db.company.update({ where: { id: companyId }, data: { boardCheckedAt: new Date() } })
}

/** Nothing usable answers any more: stop polling a dead board (the company stays, its jobs stay). */
export async function clearDeadBoard(c: Pick<DiscoveryCompany, 'id' | 'atsType' | 'atsSlug'>, why = 'stopped answering'): Promise<void> {
  await db.company.update({
    where: { id: c.id },
    data: { atsType: null, atsSlug: null, lastFetchError: null, boardMatchingJobs: null, boardMatchedAt: null, boardCheckedAt: new Date(), notes: `Board ${c.atsType}/${c.atsSlug} ${why}; removed on ${new Date().toISOString().slice(0, 10)}` },
  })
}

export interface DiscoverBoardsOptions {
  /** sponsors = known sponsors without a board; failing = boards whose last fetch errored; all = every company without a board */
  scope: 'sponsors' | 'failing' | 'all'
  limit?: number
  log?: (m: string) => void
}

/** Synchronous variant (CLI scripts): the Companies page uses runBoardDiscovery, which reports live progress and checks matching jobs. */
export async function discoverBoards(opts: DiscoverBoardsOptions): Promise<{ checked: number; found: number; cleared: number; hits: Array<{ company: string; atsType: string; atsSlug: string }> }> {
  const repair = opts.scope === 'failing'
  const where = repair ? discoveryWhere('repair') : { ...discoveryWhere('find', true), ...(opts.scope === 'sponsors' ? { knownSponsor: true } : {}) }
  const companies = await db.company.findMany({
    where,
    select: { id: true, name: true, domain: true, atsType: true, atsSlug: true },
    orderBy: [{ knownSponsor: 'desc' }, { jobs: { _count: 'desc' } }, { name: 'asc' }],
    take: Math.min(opts.limit ?? 150, 5000),
  })
  let found = 0
  let cleared = 0
  const hits: Array<{ company: string; atsType: string; atsSlug: string }> = []
  await mapLimit(companies, 4, async (c) => {
    const hit = await findBoard(c.name, c.domain)
    if (hit && !(await boardTakenByOther(hit, c.id))) {
      await saveBoard(c.id, hit)
      hits.push({ company: c.name, atsType: hit.atsType, atsSlug: hit.atsSlug })
      found++
      opts.log?.(`${c.name}: ${hit.atsType}/${hit.atsSlug}`)
    } else if (repair) {
      await clearDeadBoard(c)
      cleared++
    } else {
      await markBoardChecked(c.id)
    }
  })
  return { checked: companies.length, found, cleared, hits }
}
