import { professionDictionary } from '@/lib/candidate/professions'
import type { SearchConfig } from '@/lib/settings/schema'
import { extractEmails, toPlainText } from '@/lib/text'
import { wantedTitle, type TitleSearch, fetchJson, parseDate, sleep } from './http'
import type { JobSourceAdapter, NormalizedJob, SearchParams, SourceContext } from './types'

/**
 * Jobnet.dk: Denmark's official public job portal (run by STAR), with public and private employers.
 * Public JSON API behind the portal (no key; it only wants an `x-csrf: 1` header). Searched with the
 * search queries as keywords, newest first. Results already carry the full description
 * and, for ads that live elsewhere, the employer's own link; ads posted on Jobnet itself get one
 * detail call for their application link and contact. Danish-language postings are dropped.
 */

const BASE = 'https://jobnet.dk/bff'
const HEADERS = { 'x-csrf': '1' }
const PAGE_SIZE = 50
/** Detail calls per page at most (only English engineering ads posted on Jobnet itself need one). */
const MAX_DETAILS = 10

/** Fallback keywords for a software search without queries. */
export const DK_KEYWORDS = ['software developer', 'software engineer', 'frontend developer', 'backend developer', 'full stack developer']

/** Keywords searched one by one on the Danish boards: the person's queries (at most 8), else the field's defaults. */
export function dkKeywords(search: Partial<Pick<SearchConfig, 'queries' | 'profession'>> | null | undefined): string[] {
  const qs = (search?.queries ?? []).map((q) => q.trim()).filter(Boolean).slice(0, 8)
  if (qs.length) return qs
  const p = search?.profession ?? 'software'
  return p === 'software' ? DK_KEYWORDS : professionDictionary(p).queries.slice(0, 5)
}

interface JobnetAd {
  jobAdId: string
  title: string
  hiringOrgName?: string | null
  occupation?: string | null
  municipality?: string | null
  postalDistrictName?: string | null
  country?: string | null
  description?: string | null
  publicationDate?: string | null
  applicationDeadline?: string | null
  workHourPartTime?: boolean
  isExternal?: boolean
  jobAdUrl?: string | null
}

interface JobnetSearchResponse {
  jobAds?: JobnetAd[]
  totalJobAdCount?: number
}

export interface JobnetDetail {
  job?: { classifications?: string[] | null }
  application?: { url?: string | null; contactPersons?: Array<{ emailAddress?: string | null }> | null }
}

export function jobnetSearchUrl(keyword: string, page: number): string {
  const q = new URLSearchParams({ searchString: keyword, resultsPerPage: String(PAGE_SIZE), pageNumber: String(page), orderType: 'PublicationDate' })
  return `${BASE}/FindJob/Search?${q}`
}

export function jobnetPostingUrl(id: string): string {
  return `https://jobnet.dk/find-job/${encodeURIComponent(id)}`
}

/** Words only Danish uses; English job ads have next to none of them. */
const DANISH_WORDS = new Set(['og', 'til', 'du', 'vi', 'er', 'af', 'med', 'på', 'det', 'den', 'som', 'har', 'vores', 'dig', 'kan', 'skal', 'der', 'hos', 'eller', 'ikke', 'os', 'en', 'et', 'vil', 'samt', 'også', 'hvor', 'bliver', 'udvikler', 'udviklere', 'søger', 'søges', 'erfaring', 'arbejde'])
const ENGLISH_WORDS = new Set(['the', 'and', 'with', 'you', 'your', 'our', 'we', 'are', 'will', 'this', 'that', 'of', 'is', 'in', 'as', 'who'])

/** Whether a posting is written in Danish: its Danish function words outnumber the English ones. */
export function looksDanish(text: string): boolean {
  let da = 0
  let en = 0
  for (const w of text.slice(0, 4000).toLowerCase().match(/[a-zæøå]+/g) ?? []) {
    if (DANISH_WORDS.has(w)) da++
    else if (ENGLISH_WORDS.has(w)) en++
  }
  return da >= 2 && da > en
}

/**
 * An employer link fit for the apply agents: http(s) only, and LinkedIn's slugged job links
 * ("/jobs/view/frontend-developer-at-acme-4475511283?refId=...") cut to the id form the apply step knows.
 */
export function cleanApplyUrl(raw?: string | null): string | null {
  const s = raw?.trim()
  if (!s) return null
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const li = /(^|\.)linkedin\.com$/i.test(u.hostname) ? /\/jobs\/view\/(?:[^/]*?-)?(\d{6,})\/?$/.exec(u.pathname) : null
  return li ? `https://www.linkedin.com/jobs/view/${li[1]}/` : s
}

/** One Jobnet ad as a NormalizedJob, or null when it is not an English engineering role in Denmark. */
export function normalizeJobnetAd(ad: JobnetAd, search?: TitleSearch): NormalizedJob | null {
  const title = (ad.title ?? '').replace(/\s+/g, ' ').trim()
  const company = (ad.hiringOrgName ?? '').trim()
  if (!ad.jobAdId || !title || !company) return null
  // Jobnet also shows EURES jobs abroad; the EURES source covers those.
  if (ad.country && ad.country !== 'Danmark') return null
  // Keyword search matches anywhere in the text; keep only engineering titles.
  if (!wantedTitle(title, search)) return null
  const description = toPlainText(ad.description ?? '')
  if (looksDanish(`${title}\n${description}`)) return null
  const city = ad.postalDistrictName?.trim() || ad.municipality?.trim()
  // 1900-01-01 is Jobnet's "no deadline given".
  const deadline = ad.applicationDeadline && !ad.applicationDeadline.startsWith('1900-01-01') ? ad.applicationDeadline.slice(0, 10) : null
  return {
    source: 'jobnet',
    externalId: ad.jobAdId,
    url: (ad.isExternal ? cleanApplyUrl(ad.jobAdUrl) : null) ?? jobnetPostingUrl(ad.jobAdId),
    title,
    company,
    location: city ? `${city}, Denmark` : 'Denmark',
    countryCode: 'DK',
    remote: false,
    description,
    postedAt: parseDate(ad.publicationDate),
    visaSponsorship: null,
    tags: [ad.occupation ?? '', ad.workHourPartTime ? 'part-time' : ''].filter(Boolean),
    contactEmail: extractEmails(description)[0],
    raw: { id: ad.jobAdId, posting: jobnetPostingUrl(ad.jobAdId), external: Boolean(ad.isExternal), occupation: ad.occupation ?? null, deadline },
  }
}

/**
 * An ad posted on Jobnet itself, completed from its detail: the employer's application link, the
 * named contact's email, and whether it is shared with Workindenmark (the state's service for hiring from abroad).
 */
export function withJobnetDetail(job: NormalizedJob, detail: JobnetDetail | null): NormalizedJob {
  if (!detail) return job
  const url = cleanApplyUrl(detail.application?.url)
  const email = (detail.application?.contactPersons ?? []).map((p) => p.emailAddress?.trim().toLowerCase()).find(Boolean)
  const abroad = detail.job?.classifications?.includes('WorkInDenmark')
  return {
    ...job,
    url: url ?? job.url,
    contactEmail: email ?? job.contactEmail,
    tags: abroad ? [...job.tags, 'work-in-denmark'] : job.tags,
  }
}

async function fetchDetail(id: string, ctx: SourceContext): Promise<JobnetDetail | null> {
  const url = `${BASE}/FindJob/JobAdDetails/${encodeURIComponent(id)}?incrementViews=false`
  return fetchJson<JobnetDetail>(url, { method: 'GET', headers: HEADERS }, { source: 'jobnet', fetchImpl: ctx.fetch, retries: 0 }).catch(() => null)
}

export const jobnetAdapter: JobSourceAdapter = {
  id: 'jobnet',
  label: 'Jobnet (Denmark, official)',
  usesQuery: false,
  usesCountry: true,
  supportedCountries: new Set(['DK']),
  isConfigured: () => true,
  async fetch(params: SearchParams, ctx: SourceContext) {
    const cutoff = Date.now() - params.maxDaysOld * 86_400_000
    const seen = new Set<string>()
    const jobs: NormalizedJob[] = []
    let requests = 0
    let details = 0
    let hasMore = false
    let failed = 0
    let failure: unknown = null
    const keywords = dkKeywords(ctx.search)
    for (const keyword of keywords) {
      // One keyword failing should not cost the others; only a page where all fail is an error.
      const res = await fetchJson<JobnetSearchResponse>(jobnetSearchUrl(keyword, params.page), { method: 'GET', headers: HEADERS }, { source: 'jobnet', fetchImpl: ctx.fetch }).catch((err: unknown) => {
        failed++
        failure = err
        ctx.log('warn', `Jobnet "${keyword}": ${err instanceof Error ? err.message : err}`)
        return null
      })
      requests++
      await sleep(400)
      if (!res) continue
      const rows = res.jobAds ?? []
      let stale = false
      for (const ad of rows) {
        const postedAt = parseDate(ad.publicationDate)
        if (postedAt && postedAt.getTime() < cutoff) {
          stale = true
          continue
        }
        if (seen.has(ad.jobAdId)) continue
        seen.add(ad.jobAdId)
        let job = normalizeJobnetAd(ad, ctx.search)
        if (!job) continue
        if (!ad.isExternal && details < MAX_DETAILS) {
          details++
          requests++
          job = withJobnetDetail(job, await fetchDetail(ad.jobAdId, ctx))
          await sleep(300)
        }
        jobs.push(job)
      }
      // Newest first: a page that reaches past the age limit is the last one worth reading.
      if (rows.length === PAGE_SIZE && !stale && params.page * PAGE_SIZE < (res.totalJobAdCount ?? 0)) hasMore = true
    }
    if (keywords.length && failed === keywords.length) throw failure
    return { jobs, hasMore, requests }
  },
}
