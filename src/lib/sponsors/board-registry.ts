import { db } from '@/lib/db'
import type { BoardType } from '@/lib/sources/ats'
import { atsBoardUrl } from '@/lib/sources/ats'

/**
 * Company boards from the links we already have (plan-apply-all.md 8.2). Every Greenhouse, Lever,
 * Ashby, Workable, SmartRecruiters, Recruitee, Personio, Teamtailor or Workday posting names its
 * company's board in the URL; registering that board makes the company's ATS feed the main,
 * fresh source for all its other jobs.
 */

export interface BoardRef {
  atsType: BoardType
  slug: string
}

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/

function clean(slug: string | undefined | null): string | null {
  if (!slug) return null
  let s: string
  try {
    s = decodeURIComponent(slug).trim()
  } catch {
    return null
  }
  return SLUG_RE.test(s) ? s : null
}

/** The company board a posting URL belongs to, or null when the URL does not name one. */
export function boardFromUrl(raw: string | null | undefined): BoardRef | null {
  if (!raw) return null
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  const host = u.hostname.toLowerCase()
  const parts = u.pathname.split('/').filter(Boolean)

  // Greenhouse: boards.greenhouse.io/<slug>/jobs/<id>, job-boards.(eu.)greenhouse.io/<slug>/..., embed?for=<slug>.
  // The public API serves EU-hosted boards too. A company page with only ?gh_jid= names no board.
  if (/(^|\.)greenhouse\.io$/.test(host) && /^(boards|job-boards)(\.eu)?\.greenhouse\.io$|^boards-api\.greenhouse\.io$/.test(host)) {
    const forParam = clean(u.searchParams.get('for'))
    if (forParam) return { atsType: 'greenhouse', slug: forParam.toLowerCase() }
    if (host === 'boards-api.greenhouse.io') {
      const i = parts.indexOf('boards')
      const s = clean(parts[i + 1])
      return i >= 0 && s ? { atsType: 'greenhouse', slug: s.toLowerCase() } : null
    }
    const s = clean(parts[0])
    if (!s || /^(embed|v1)$/i.test(s)) return null
    return { atsType: 'greenhouse', slug: s.toLowerCase() }
  }

  // Lever: jobs.lever.co/<slug>/<uuid>(/apply); the EU instance keeps its slug with an "@eu" mark.
  if (host === 'jobs.lever.co' || host === 'jobs.eu.lever.co') {
    const s = clean(parts[0])
    if (!s) return null
    return { atsType: 'lever', slug: host === 'jobs.eu.lever.co' ? `${s.toLowerCase()}@eu` : s.toLowerCase() }
  }

  // Ashby: jobs.ashbyhq.com/<slug>/<uuid>(/application)
  if (host === 'jobs.ashbyhq.com') {
    const s = clean(parts[0])
    return s ? { atsType: 'ashby', slug: s } : null
  }

  // Workable: apply.workable.com/<slug>/j/<code>, <slug>.workable.com/jobs/<id>; apply.workable.com/j/<code> names none.
  if (host === 'apply.workable.com') {
    const s = clean(parts[0])
    if (!s || s === 'j' || s === 'api') return null
    return { atsType: 'workable', slug: s.toLowerCase() }
  }
  if (host.endsWith('.workable.com') && !/^(www|apply|jobs|api)\./.test(host)) {
    const s = clean(host.slice(0, -'.workable.com'.length))
    return s ? { atsType: 'workable', slug: s.toLowerCase() } : null
  }

  // SmartRecruiters: jobs.smartrecruiters.com/<Company>/<id>-..., careers.smartrecruiters.com/<Company>
  if (host === 'jobs.smartrecruiters.com' || host === 'careers.smartrecruiters.com') {
    const s = clean(parts[0])
    if (!s || /^(oneclick-ui|ni|sr-jobs)$/i.test(s)) return null
    return { atsType: 'smartrecruiters', slug: s }
  }

  // Recruitee / Personio / Teamtailor: the company is the subdomain.
  const sub = (suffix: string) => (host.endsWith(suffix) ? clean(host.slice(0, -suffix.length)) : null)
  const recruitee = sub('.recruitee.com')
  if (recruitee && !/^(www|app|api|careers)$/.test(recruitee)) return { atsType: 'recruitee', slug: recruitee.toLowerCase() }
  const personio = sub('.jobs.personio.de') ?? sub('.jobs.personio.com')
  if (personio) return { atsType: 'personio', slug: personio.toLowerCase() }
  const teamtailor = sub('.teamtailor.com')
  if (teamtailor && !/^(www|app|api|career|careers)$/.test(teamtailor) && !teamtailor.includes('.')) return { atsType: 'teamtailor', slug: teamtailor.toLowerCase() }

  // BambooHR, Breezy, Pinpoint: the company is the subdomain (careers pages live at <slug>.bamboohr.com/careers).
  const bamboohr = sub('.bamboohr.com')
  if (bamboohr && !/^(www|app|api|careers|help|support|marketplace|documentation)$/.test(bamboohr) && !bamboohr.includes('.')) return { atsType: 'bamboohr', slug: bamboohr.toLowerCase() }
  const breezy = sub('.breezy.hr')
  if (breezy && !/^(www|app|api|help|support|blog)$/.test(breezy) && !breezy.includes('.')) return { atsType: 'breezy', slug: breezy.toLowerCase() }
  const pinpoint = sub('.pinpointhq.com')
  if (pinpoint && !/^(www|app|api|help|support|blog|developers)$/.test(pinpoint) && !pinpoint.includes('.')) return { atsType: 'pinpoint', slug: pinpoint.toLowerCase() }

  // JOIN: join.com/companies/<slug>(/<id>-<title>)
  if (host === 'join.com' || host === 'www.join.com') {
    const i = parts.indexOf('companies')
    const s = i >= 0 ? clean(parts[i + 1]) : null
    return s ? { atsType: 'join', slug: s.toLowerCase() } : null
  }

  // Workday: <tenant>.wd<N>.myworkdayjobs.com/(<locale>/)<site>/job/... -> "tenant/site@wdN" (the format sources/ats.ts reads).
  const wd = /^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/.exec(host)
  if (wd) {
    const rest = /^[a-z]{2}-[A-Z]{2}$/.test(parts[0] ?? '') ? parts.slice(1) : parts
    const site = clean(rest[0])
    if (!site || /^(wday|job)$/i.test(site)) return null
    return { atsType: 'workday', slug: `${wd[1]}/${site}@${wd[2]}` }
  }
  return null
}

/** The board most of these URLs name, or null (ties go to the first seen). */
export function dominantBoard(urls: Array<string | null | undefined>): BoardRef | null {
  const counts = new Map<string, { ref: BoardRef; n: number }>()
  for (const url of urls) {
    const ref = boardFromUrl(url)
    if (!ref) continue
    const key = `${ref.atsType}:${ref.slug}`
    const hit = counts.get(key)
    if (hit) hit.n++
    else counts.set(key, { ref, n: 1 })
  }
  let best: { ref: BoardRef; n: number } | null = null
  for (const v of counts.values()) if (!best || v.n > best.n) best = v
  return best?.ref ?? null
}

/**
 * A company page with "?gh_jid=123" runs Greenhouse without naming its board. The public API
 * answers boards/<slug>/jobs/<id> only for the board that owns that job, so a few slug guesses
 * from the page's domain and the company name find it exactly.
 */
export async function greenhouseBoardForJob(url: string, companyName: string, fetchImpl: typeof fetch = globalThis.fetch): Promise<BoardRef | null> {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const id = u.searchParams.get('gh_jid')
  if (!id || !/^\d+$/.test(id)) return null
  const labels = u.hostname.toLowerCase().replace(/^(www|careers|jobs|boards)\./, '').split('.')
  const fromDomain = labels.length > 1 ? labels[labels.length - 2] : labels[0]
  const fromName = companyName.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '')
  const guesses = [...new Set([fromDomain, fromName, fromDomain.replace(/hq$/, ''), companyName.toLowerCase().split(/\s+/)[0]?.replace(/[^a-z0-9]/g, '')].filter((s): s is string => Boolean(s) && s.length >= 2))].slice(0, 4)
  for (const slug of guesses) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 8000)
      const res = await fetchImpl(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${id}`, { headers: { accept: 'application/json' }, signal: controller.signal })
      clearTimeout(timer)
      if (res.ok) return { atsType: 'greenhouse', slug }
    } catch {
      /* next guess */
    }
  }
  return null
}

export interface RegisterBoardsResult {
  companies: number
  registered: number
  byType: Record<string, number>
}

/**
 * Give companies without a board the board their own postings point to. Only companies whose
 * board is still unknown are touched; a board that stops answering is removed by the ATS source
 * after two "not found" replies, as before.
 */
export async function registerBoardsFromJobs(opts: { jobIds?: string[]; companyIds?: string[]; log?: (m: string) => void; probeGhJid?: boolean } = {}): Promise<RegisterBoardsResult> {
  const where = {
    atsType: null,
    blacklisted: false,
    ...(opts.companyIds ? { id: { in: opts.companyIds } } : {}),
    ...(opts.jobIds ? { jobs: { some: { id: { in: opts.jobIds } } } } : {}),
  }
  const result: RegisterBoardsResult = { companies: 0, registered: 0, byType: {} }
  const PAGE = 500
  let cursor: string | undefined
  for (;;) {
    const companies = await db.company.findMany({
      where,
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, name: true, jobs: { select: { url: true, sourceLinks: { select: { url: true } } }, take: 50, orderBy: { firstSeenAt: 'desc' } } },
    })
    if (!companies.length) break
    cursor = companies[companies.length - 1].id
    result.companies += companies.length
    for (const c of companies) {
      const urls = c.jobs.flatMap((j) => [j.url, ...j.sourceLinks.map((l) => l.url)])
      let ref = dominantBoard(urls)
      if (!ref && opts.probeGhJid !== false) {
        const gh = urls.find((u) => /[?&]gh_jid=\d+/.test(u))
        if (gh) ref = await greenhouseBoardForJob(gh, c.name).catch(() => null)
      }
      if (!ref) continue
      // Another company already owns this board (the same employer under two spellings): leave it there.
      const taken = await db.company.findFirst({ where: { atsType: ref.atsType, atsSlug: ref.slug }, select: { id: true } })
      if (taken) continue
      await db.company.update({ where: { id: c.id }, data: { atsType: ref.atsType, atsSlug: ref.slug, careersUrl: atsBoardUrl(ref.atsType, ref.slug), boardSource: 'job-link', lastFetchError: null } })
      result.registered++
      result.byType[ref.atsType] = (result.byType[ref.atsType] ?? 0) + 1
    }
    if (companies.length < PAGE) break
  }
  if (result.registered) opts.log?.(`Boards: ${result.registered} company board(s) registered from job links (${Object.entries(result.byType).map(([t, n]) => `${t} ${n}`).join(', ')})`)
  return result
}
