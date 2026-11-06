import { guessCountry } from '@/lib/geo'
import { decodeEntities, htmlToText } from '@/lib/text'
import { wantedTitle, type TitleSearch, parseDate, sleep } from './http'
import { cleanApplyUrl, dkKeywords, looksDanish } from './jobnet'
import { SourceError, type JobSourceAdapter, type NormalizedJob, type SearchParams, type SourceContext } from './types'

/**
 * Jobindex.dk: Denmark's largest job board, its own ads plus postings it collects from employer
 * sites. No API and no key: the search page carries its results as JSON (`var Stash = {...}`),
 * which is read instead of the markup. Searched with the same keywords as Jobnet, newest
 * first; each result links to the employer's application form or posting. Results only carry a
 * teaser, so the deep fetch reads the full posting. Danish-language postings are dropped.
 */

const BASE = 'https://www.jobindex.dk'
/** Fixed by Jobindex. */
const PAGE_SIZE = 20
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
/** Posting ages the search form offers; a longer limit searches everything (the cutoff below still applies). */
const JOB_AGES = [1, 3, 7, 14, 30]

interface JobindexResult {
  tid: string
  headline?: string | null
  companytext?: string | null
  company?: { name?: string | null } | null
  area?: string | null
  firstdate?: string | null
  lastdate?: string | null
  /** The employer's own application form, when Jobindex knows it. */
  app_apply_url?: string | null
  /** Card markup: the title link (the posting) and the teaser paragraphs. */
  html?: string | null
  home_workplace?: boolean | null
  is_archived?: boolean | null
  /** Site a collected posting was found on ("Jobcenter" = Jobnet). */
  source?: string | null
}

interface JobindexSearchResponse {
  hitcount?: number
  total_pages?: number
  max_page?: number
  results: JobindexResult[]
}

export function jobindexSearchUrl(keyword: string, page: number, maxDaysOld: number): string {
  const q = new URLSearchParams({ q: keyword, sort: 'date', page: String(page) })
  const age = JOB_AGES.find((a) => a >= maxDaysOld)
  if (age) q.set('jobage', String(age))
  return `${BASE}/jobsoegning?${q}`
}

/** The object literal assigned to `var Stash` in a search page, parsed; null when absent. */
function stashJson(html: string): unknown {
  const marker = html.indexOf('var Stash = ')
  const start = marker < 0 ? -1 : html.indexOf('{', marker)
  if (start < 0) return null
  let depth = 0
  let inString = false
  for (let i = start; i < html.length; i++) {
    const c = html[i]
    if (inString) {
      if (c === '\\') i++
      else if (c === '"') inString = false
    } else if (c === '"') inString = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1))
      } catch {
        return null
      }
    }
  }
  return null
}

function findSearchResponse(node: unknown, depth = 0): JobindexSearchResponse | null {
  if (!node || typeof node !== 'object' || depth > 6) return null
  const sr = (node as { searchResponse?: JobindexSearchResponse }).searchResponse
  if (sr && Array.isArray(sr.results)) return sr
  for (const v of Object.values(node)) {
    const found = findSearchResponse(v, depth + 1)
    if (found) return found
  }
  return null
}

/** The search response embedded in a Jobindex search page, or null when the page has none. */
export function parseJobindexPage(html: string): JobindexSearchResponse | null {
  return findSearchResponse(stashJson(html))
}

/** The card's title link: the posting on the employer's site or on Jobindex (never the click tracker). */
function cardLink(html: string): string | null {
  const href = /<h4[^>]*>\s*<a[^>]+href="([^"]+)"/i.exec(html)?.[1]
  const url = href ? decodeEntities(href) : null
  return url && /^https?:\/\//i.test(url) && !/jobindex\.dk\/c\?/i.test(url) ? url : null
}

function cardTeaser(html: string): string {
  return [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => htmlToText(m[1]))
    .filter(Boolean)
    .join('\n')
}

/** The employer's form link without Jobindex's own markers ("apply_with=jobdk", "#jobdk"). */
function employerFormUrl(raw?: string | null): string | null {
  const url = cleanApplyUrl(raw)
  return url ? url.replace(/([?&])apply_with=jobdk(&|$)/i, (_, sep: string, next: string) => (next ? sep : '')).replace(/#jobdk$/i, '') : null
}

/** One Jobindex result as a NormalizedJob, or null when it is not an English engineering role. */
export function normalizeJobindexResult(r: JobindexResult, search?: TitleSearch): NormalizedJob | null {
  const title = decodeEntities(r.headline ?? '').replace(/\s+/g, ' ').trim()
  const company = decodeEntities(r.company?.name ?? r.companytext ?? '').trim()
  if (!r.tid || !title || !company || r.is_archived) return null
  // Keyword search matches anywhere in the text; keep only engineering titles.
  if (!wantedTitle(title, search)) return null
  const card = r.html ?? ''
  const teaser = cardTeaser(card)
  if (looksDanish(`${title}\n${teaser}`)) return null
  const rawArea = decodeEntities(r.area ?? '')
  const area = rawArea.replace(/\s+og mulighed for hjemmearbejde$/i, '').trim()
  const countryCode = guessCountry(area, 'DK') ?? 'DK'
  const posting = `${BASE}/vis-job/${encodeURIComponent(r.tid)}`
  return {
    source: 'jobindex',
    externalId: r.tid,
    url: employerFormUrl(r.app_apply_url) ?? cleanApplyUrl(cardLink(card)) ?? posting,
    title,
    company,
    location: [area, countryCode === 'DK' ? 'Denmark' : ''].filter(Boolean).join(', ') || undefined,
    countryCode,
    remote: Boolean(r.home_workplace) || /100\s*%\s*hjemmearbejde/i.test(rawArea),
    description: teaser,
    postedAt: parseDate(r.firstdate),
    visaSponsorship: null,
    tags: [/mulighed for hjemmearbejde/i.test(rawArea) ? 'hybrid' : ''].filter(Boolean),
    raw: { tid: r.tid, posting, deadline: r.lastdate ?? null, foundOn: r.source ?? null },
  }
}

async function getPage(url: string, fetchImpl: typeof fetch): Promise<string> {
  const res = await fetchImpl(url, {
    headers: { 'user-agent': UA, accept: 'text/html,*/*', 'accept-language': 'en,da;q=0.8' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new SourceError('jobindex', `HTTP ${res.status} from www.jobindex.dk`, res.status)
  return res.text()
}

export const jobindexAdapter: JobSourceAdapter = {
  id: 'jobindex',
  label: 'Jobindex (Denmark)',
  usesQuery: false,
  usesCountry: true,
  supportedCountries: new Set(['DK']),
  isConfigured: () => true,
  async fetch(params: SearchParams, ctx: SourceContext) {
    const cutoff = Date.now() - params.maxDaysOld * 86_400_000
    const seen = new Set<string>()
    const jobs: NormalizedJob[] = []
    let requests = 0
    let hasMore = false
    let failed = 0
    let failure: unknown = null
    const keywords = dkKeywords(ctx.search)
    for (const keyword of keywords) {
      // One keyword failing should not cost the others; only a page where all fail is an error.
      const sr = await getPage(jobindexSearchUrl(keyword, params.page, params.maxDaysOld), ctx.fetch)
        .then((html) => parseJobindexPage(html) ?? Promise.reject(new SourceError('jobindex', 'no results data in the search page (layout changed?)')))
        .catch((err: unknown) => {
          failed++
          failure = err
          ctx.log('warn', `Jobindex "${keyword}": ${err instanceof Error ? err.message : err}`)
          return null
        })
      requests++
      await sleep(400)
      if (!sr) continue
      let stale = false
      for (const r of sr.results) {
        const postedAt = parseDate(r.firstdate)
        if (postedAt && postedAt.getTime() < cutoff) {
          stale = true
          continue
        }
        if (seen.has(r.tid)) continue
        seen.add(r.tid)
        const job = normalizeJobindexResult(r, ctx.search)
        if (job) jobs.push(job)
      }
      // Newest first: a page that reaches past the age limit is the last one worth reading.
      const lastPage = Math.min(sr.total_pages ?? 0, sr.max_page ?? 50)
      if (sr.results.length === PAGE_SIZE && !stale && params.page < lastPage) hasMore = true
    }
    if (keywords.length && failed === keywords.length) throw failure
    return { jobs, hasMore, requests }
  },
}
