import type { AtsType } from '@/lib/domain'
import { boardFromUrl, type BoardRef } from './board-registry'

/**
 * Finding a company's board from its own website. Slug guesses miss companies whose board slug is not their
 * name ("acme-careers", "acmegmbh"), but their careers page almost always links to or embeds the board:
 * a "View open roles" button to jobs.lever.co/<slug>, a Greenhouse iframe, an Ashby widget script.
 * The page is read for such links; robots.txt and the sitemap point at careers pages the usual paths miss.
 */

/**
 * Looser patterns for what URL parsing misses: a board named inside a script, a data attribute or a JSON blob
 * ("jobs.lever.co/acme", "acme.recruitee.com", "boards-api.greenhouse.io/v1/boards/acme").
 */
const ATS_LINKS: Array<{ ats: AtsType; re: RegExp }> = [
  { ats: 'greenhouse', re: /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9][\w-]{1,60})/i },
  { ats: 'greenhouse', re: /boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9][\w-]{1,60})/i },
  { ats: 'lever', re: /jobs\.lever\.co\/([a-z0-9][\w.-]{1,60})/i },
  { ats: 'lever', re: /api\.lever\.co\/v0\/postings\/([a-z0-9][\w.-]{1,60})/i },
  { ats: 'ashby', re: /jobs\.ashbyhq\.com\/([a-z0-9][\w.%-]{1,60})/i },
  { ats: 'smartrecruiters', re: /(?:jobs|careers)\.smartrecruiters\.com\/([a-z0-9][\w-]{1,60})/i },
  { ats: 'recruitee', re: /([a-z0-9][\w-]{1,60})\.recruitee\.com/i },
  { ats: 'personio', re: /([a-z0-9][\w-]{1,60})\.jobs\.personio\.(?:de|com)/i },
  { ats: 'teamtailor', re: /([a-z0-9][\w-]{1,60})\.teamtailor\.com/i },
  { ats: 'workable', re: /apply\.workable\.com\/([a-z0-9][\w-]{1,60})/i },
  { ats: 'workable', re: /([a-z0-9][\w-]{1,60})\.workable\.com/i },
  { ats: 'bamboohr', re: /([a-z0-9][\w-]{1,60})\.bamboohr\.com\/(?:careers|jobs)/i },
  { ats: 'breezy', re: /([a-z0-9][\w-]{1,60})\.breezy\.hr/i },
  { ats: 'pinpoint', re: /([a-z0-9][\w-]{1,60})\.pinpointhq\.com/i },
  { ats: 'join', re: /join\.com\/companies\/([a-z0-9][\w.-]{1,60})/i },
]
/** Workday names three things: tenant, data centre (wd1, wd3, wd5...) and site (https://acme.wd3.myworkdayjobs.com/en-US/AcmeCareers). */
const WORKDAY_LINK = /([a-z0-9][a-z0-9-]{1,40})\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Za-z]{2}\/)?([A-Za-z0-9][A-Za-z0-9_-]{1,60})/i
/** Words that are part of an ATS's own address, never a company's slug. */
const NOT_SLUG = new Set(['embed', 'api', 'www', 'static', 'assets', 'jobs', 'careers', 'v1', 'job_app', 'widget', 'cdn', 'app', 'support', 'help', 'blog', 'docs', 'developers', 'status', 'apply', 'j', 'boards', 'job-boards'])

/** Links and embeds that name a board ("https://jobs.lever.co/acme/...", "boards.greenhouse.io/embed/job_board?for=acme", JSON-escaped ones too). */
export function extractBoardRefs(html: string): BoardRef[] {
  const bs = String.fromCharCode(92)
  const text = html.split(bs + 'u002F').join('/').split(bs + '/').join('/').replace(/&amp;/g, '&')
  const out = new Map<string, BoardRef>()
  const add = (ref: BoardRef) => {
    const key = `${ref.atsType}:${ref.slug.toLowerCase()}`
    if (!out.has(key)) out.set(key, ref)
  }
  for (const m of text.matchAll(/(?:https?:)?\/\/[a-z0-9][a-z0-9.-]*\.[a-z]{2,}[^\s"'<>)\]\\]*/gi)) {
    const ref = boardFromUrl(m[0].startsWith('//') ? `https:${m[0]}` : m[0])
    if (ref) add(ref)
  }
  for (const { ats, re } of ATS_LINKS) {
    const slug = text.match(re)?.[1]?.toLowerCase()
    if (slug && !NOT_SLUG.has(slug) && !/^[0-9a-f-]{32,}$/.test(slug)) add({ atsType: ats, slug })
  }
  for (const m of text.matchAll(new RegExp(WORKDAY_LINK.source, 'gi'))) {
    const site = m[3]
    if (!/^(wday|job|jobs|cxs|login)$/i.test(site)) add({ atsType: 'workday', slug: `${m[1].toLowerCase()}/${site}@${m[2].toLowerCase()}` })
  }
  return [...out.values()]
}

const CAREER_WORDS = /(career|jobs?|join[-_ ]?us|work[-_ ]?(with|for)[-_ ]?us|open[-_ ]?(positions|roles)|vacanc|hiring|karriere|stellen|werken[-_ ]?bij|emploi|trabaja)/i

/** Links on a page that probably lead to its careers section (same site only), best guess first. */
export function extractCareerLinks(html: string, pageUrl: string, max = 3): string[] {
  let base: URL
  try {
    base = new URL(pageUrl)
  } catch {
    return []
  }
  const sameSite = (host: string) => host.replace(/^www\./, '') === base.hostname.replace(/^www\./, '')
  const scored = new Map<string, number>()
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u: URL
    try {
      u = new URL(m[1].trim(), base)
    } catch {
      continue
    }
    if (!/^https?:$/.test(u.protocol) || !sameSite(u.hostname)) continue
    const label = m[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    const pathHit = CAREER_WORDS.test(u.pathname)
    const labelHit = label.length < 60 && CAREER_WORDS.test(label)
    if (!pathHit && !labelHit) continue
    u.hash = ''
    const key = u.href
    // A short path beats a long one ("/careers" over "/blog/why-we-are-hiring").
    const score = (pathHit ? 2 : 0) + (labelHit ? 1 : 0) - Math.min(u.pathname.length, 80) / 100
    scored.set(key, Math.max(scored.get(key) ?? -9, score))
  }
  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([k]) => k)
}

/** "Sitemap: https://acme.com/sitemap.xml" lines of a robots.txt. */
export function parseRobotsSitemaps(robots: string): string[] {
  const out: string[] = []
  for (const line of robots.split(/\r?\n/)) {
    const m = line.match(/^\s*sitemap:\s*(\S+)/i)
    if (m && /^https?:\/\//i.test(m[1]) && !out.includes(m[1])) out.push(m[1])
  }
  return out
}

/** URLs in a sitemap that look like careers or jobs pages (an index sitemap's child sitemaps are returned too, last). */
export function sitemapCareerUrls(xml: string, max = 3): { pages: string[]; children: string[] } {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, '&'))
  const pathOf = (u: string) => {
    try {
      return new URL(u, 'https://x.invalid').pathname
    } catch {
      return ''
    }
  }
  const pages = locs.filter((u) => !/\.xml(\.gz)?$/i.test(u) && CAREER_WORDS.test(pathOf(u))).sort((a, b) => a.length - b.length)
  const children = locs.filter((u) => /\.xml(\.gz)?$/i.test(u) && /(page|career|job|company|general)/i.test(u))
  return { pages: pages.slice(0, max), children: children.slice(0, 2) }
}

const PATHS = ['/careers', '/jobs', '/career', '/company/careers', '/about/careers', '/join-us']
const MAX_BYTES = 600_000

/** The site's domain cleaned to a host name ("https://www.Acme.com/path" -> "acme.com"), or null. */
export function siteHost(domain: string): string | null {
  const host = domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0]
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null
}

export interface CareersStats {
  requests: number
  failures: number
}

/**
 * Board links found on a company's own website, in the order found. Reads the home page, the careers pages it
 * links to, the usual /careers and /jobs paths and, when nothing turned up, the pages its sitemap lists.
 * At most `budget` requests; stops at the first page that names a board.
 */
export async function collectCareersBoards(domain: string, fetchImpl: typeof fetch = globalThis.fetch, stats?: CareersStats, budget = 10): Promise<BoardRef[]> {
  const host = siteHost(domain)
  if (!host) return []
  let used = 0
  const seen = new Set<string>()
  const get = async (url: string): Promise<string | null> => {
    if (used >= budget || seen.has(url)) return null
    seen.add(url)
    used++
    if (stats) stats.requests++
    try {
      const res = await fetchImpl(url, { headers: { 'user-agent': 'job-pilot/1.0 (+personal job search)', accept: 'text/html,application/xhtml+xml,application/xml,text/plain' }, redirect: 'follow' })
      if (!res.ok) return null
      return (await res.text()).slice(0, MAX_BYTES)
    } catch {
      if (stats) stats.failures++
      return null
    }
  }

  const origin = `https://${host}`
  let home = await get(`${origin}/`)
  let root = origin
  if (home === null) {
    home = await get(`https://www.${host}/`)
    root = `https://www.${host}`
  }
  if (home === null) return [] // the site does not answer: nothing more to try
  const fromHome = extractBoardRefs(home)
  if (fromHome.length) return fromHome

  const pages = [...extractCareerLinks(home, `${root}/`), ...PATHS.map((p) => root + p)]
  for (const page of pages) {
    const html = await get(page)
    if (!html) continue
    const refs = extractBoardRefs(html)
    if (refs.length) return refs
    // A careers page that only links further ("Open roles") may name the board one click deeper.
    for (const deeper of extractCareerLinks(html, page, 1)) {
      const sub = await get(deeper)
      const more = sub ? extractBoardRefs(sub) : []
      if (more.length) return more
    }
  }

  const robots = await get(`${root}/robots.txt`)
  const sitemaps = robots ? parseRobotsSitemaps(robots) : []
  const first = sitemaps[0] ? await get(sitemaps[0]) : null
  if (first) {
    const { pages: urls, children } = sitemapCareerUrls(first)
    let candidates = urls
    if (!candidates.length) {
      for (const child of children) {
        const xml = await get(child)
        if (xml) candidates = sitemapCareerUrls(xml).pages
        if (candidates.length) break
      }
    }
    for (const url of candidates) {
      const html = await get(url)
      const refs = html ? extractBoardRefs(html) : []
      if (refs.length) return refs
    }
  }
  return []
}
