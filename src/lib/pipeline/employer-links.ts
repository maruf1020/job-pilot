import { db } from '@/lib/db'
import type { AtsType } from '@/lib/domain'
import { getSettings } from '@/lib/settings/service'
import { fetchCompanyBoard } from '@/lib/sources/ats'
import { findEmployerLink, NO_FORM_HOSTS } from '@/lib/sources/freehire'
import type { NormalizedJob, SourceContext } from '@/lib/sources/types'
import { normalizeTitle } from '@/lib/text'
import { mapLimit } from '@/lib/utils/semaphore'
import { detectAts } from './ats-detect'

/**
 * Board-only postings (Adzuna, Jooble, Jobicy, Himalayas...) have no application form behind
 * their link. For the good ones, find the employer's own posting ahead of the apply batch
 * (plan-apply-all.md 7.2): the same job already in the database on the employer's site (then this
 * copy is skipped), the company's own board, or freehire.me's index. Each job is looked at once a week.
 */

/** Hosts in the shape the SQL filter needs (NO_FORM_HOSTS is a regex). */
const BOARD_HOSTS = ['adzuna.', 'jooble.', 'jobicy.', 'himalayas.', 'whatjobs.', 'echojobs.', 'thehub.', 'wellfound.', 'nofluffjobs.']

const RECHECK_MS = 7 * 86_400_000

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function tokens(title: string): Set<string> {
  return new Set(normalizeTitle(title).split(' ').filter((w) => w.length > 1))
}

/** Same role? Equal normalized titles, else at least 80% of the longer title's words shared. */
export function sameTitle(a: string, b: string): boolean {
  const na = normalizeTitle(a)
  const nb = normalizeTitle(b)
  if (!na || !nb) return false
  if (na === nb) return true
  const ta = tokens(a)
  const tb = tokens(b)
  if (!ta.size || !tb.size) return false
  let shared = 0
  for (const w of ta) if (tb.has(w)) shared++
  return shared / Math.max(ta.size, tb.size) >= 0.8
}

export interface EmployerLinkResult {
  checked: number
  duplicates: number
  fromBoard: number
  fromFreehire: number
  none: number
}

export async function resolveEmployerLinks(opts: { limit?: number; minScore?: number; log?: (m: string) => void; shouldStop?: () => Promise<boolean> } = {}): Promise<EmployerLinkResult> {
  const settings = await getSettings()
  const since = new Date(Date.now() - RECHECK_MS)
  const jobs = await db.job.findMany({
    where: {
      status: { in: ['RANKED', 'REVIEW'] },
      finalScore: { gte: opts.minScore ?? 55 },
      application: null,
      OR: BOARD_HOSTS.map((h) => ({ url: { contains: h } })),
      AND: [{ OR: [{ employerLinkCheckedAt: null }, { employerLinkCheckedAt: { lt: since } }] }],
    },
    orderBy: [{ finalScore: 'desc' }, { firstSeenAt: 'desc' }],
    take: Math.min(opts.limit ?? 150, 500),
    select: { id: true, title: true, url: true, companyId: true, companyName: true, countryCode: true, company: { select: { id: true, name: true, atsType: true, atsSlug: true, knownSponsor: true } } },
  })
  const result: EmployerLinkResult = { checked: 0, duplicates: 0, fromBoard: 0, fromFreehire: 0, none: 0 }
  // One board read per company per pass.
  const boards = new Map<string, Promise<NormalizedJob[]>>()
  const ctx: SourceContext = { search: settings.search, env: {}, fetch: globalThis.fetch, log: () => undefined, atsKnown: null }

  await mapLimit(jobs, 4, async (j) => {
    if (!NO_FORM_HOSTS.test(hostOf(j.url))) return
    if (await opts.shouldStop?.()) return
    result.checked++
    const now = new Date()
    try {
      // (a) The same posting is already here from the employer's own site: that one is the one to apply to.
      const siblings = await db.job.findMany({
        where: { companyId: j.companyId, id: { not: j.id }, ...(j.countryCode ? { countryCode: j.countryCode } : {}), NOT: BOARD_HOSTS.map((h) => ({ url: { contains: h } })) },
        select: { id: true, title: true, url: true },
        take: 200,
      })
      const twin = siblings.find((s) => sameTitle(s.title, j.title))
      if (twin) {
        await db.job.update({ where: { id: j.id }, data: { status: 'SKIPPED', filterReason: `Same posting as "${twin.title}" on ${hostOf(twin.url)}`.slice(0, 300), employerLinkCheckedAt: now } })
        result.duplicates++
        return
      }
      // (b) The company's own board lists the same role.
      let url: string | null = null
      if (j.company.atsType && j.company.atsSlug) {
        const key = j.company.id
        if (!boards.has(key)) {
          const ref = { id: j.company.id, name: j.company.name, atsType: j.company.atsType as AtsType, atsSlug: j.company.atsSlug, knownSponsor: j.company.knownSponsor }
          boards.set(key, fetchCompanyBoard(ref, ctx, settings.search.maxDaysOld).then((r) => r.jobs).catch(() => []))
        }
        const posting = (await boards.get(key)!).find((p) => sameTitle(p.title, j.title) && (!j.countryCode || !p.countryCode || p.countryCode === j.countryCode))
        if (posting) {
          url = posting.url
          result.fromBoard++
        }
      }
      // (c) freehire.me's index of ~50 ATS platforms.
      if (!url) {
        url = await findEmployerLink(j.companyName, j.title, globalThis.fetch, settings.search).catch(() => null)
        if (url) result.fromFreehire++
      }
      if (url) {
        await db.job.update({ where: { id: j.id }, data: { url, atsType: detectAts(url), employerLinkCheckedAt: now } })
      } else {
        result.none++
        await db.job.update({ where: { id: j.id }, data: { employerLinkCheckedAt: now } })
      }
    } catch (err) {
      result.none++
      await db.job.update({ where: { id: j.id }, data: { employerLinkCheckedAt: now } }).catch(() => undefined)
      opts.log?.(`Employer link for "${j.title}" at ${j.companyName} failed: ${err instanceof Error ? err.message : err}`)
    }
  })
  if (result.checked) opts.log?.(`Employer links: ${result.checked} board-only job(s) checked: ${result.duplicates} already here from the employer's site, ${result.fromBoard} found on the company board, ${result.fromFreehire} via freehire.me, ${result.none} not found`)
  return result
}
