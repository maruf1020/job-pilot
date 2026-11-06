import { normalizeCompany, normalizeTitle } from '@/lib/text'
import { asNumber, fetchJson, parseDate, sleep } from './http'
import { EUROPE_ONLY, locationAllowed, type RegionSearch } from './region-filter'
import type { JobSourceAdapter, NormalizedJob, SearchParams, SourceContext } from './types'

/**
 * freehire.me: an open-source tech job aggregator that normalises postings from ~50 ATS platforms
 * (Greenhouse, Ashby, Lever, Workable...) into one schema. Public JSON API, no key. Searched per
 * country with the person's skills as facets (developer searches only); each result links to the employer's own
 * posting and already carries the full description, a visa/relocation flag and a freshness class.
 */

const BASE = process.env.FREEHIRE_API_URL?.trim() || 'https://freehire.me'
const PAGE_SIZE = 50
/** The API refuses offset + limit beyond this. */
const MAX_WINDOW = 10_000

/** Skill names freehire knows as facets (its canonical spelling: "nodejs", "nextjs"). */
export const FREEHIRE_SKILLS = ['typescript', 'javascript', 'react', 'nodejs', 'nextjs', 'nestjs', 'vue', 'angular', 'python', 'django', 'java', 'kotlin', 'go', 'ruby', 'rails', 'php', 'csharp', 'dotnet', 'rust', 'scala', 'elixir', 'swift', 'flutter']
const CATEGORIES = ['frontend', 'fullstack', 'backend']

/** The person's skills as freehire facets ("Node.js" -> "nodejs", "C#" -> "csharp"); unknown skills are left out. */
export function freehireSkills(skills: string[] | null | undefined): string[] {
  const alias: Record<string, string> = { golang: 'go', 'c#': 'csharp', '.net': 'dotnet', 'ruby on rails': 'rails' }
  const out = new Set<string>()
  for (const raw of skills ?? []) {
    const k = raw.toLowerCase().trim()
    const name = alias[k] ?? k.replace(/\.js$/, 'js').replace(/[.\s]/g, '')
    if (FREEHIRE_SKILLS.includes(name)) out.add(name)
  }
  return [...out]
}

/**
 * Job boards that only re-list other boards or need their own sign-in (Himalayas, Reed): no
 * employer form behind them for the apply agents.
 */
const RELISTING_HOSTS = /(^|\.)(whatjobs|jooble|adzuna|jobicy|himalayas|echojobs|thehub|wellfound|reed|talent|jobrapido|careerjet|neuvoo|jobted|jora)\.[a-z.]+$/i

/** Job boards that only list jobs outside Europe (Philippines, US payroll systems). */
export const NON_EUROPE_BOARDS = /(^|\.)(jobstreet|paylocity|seek|naukri|indeed\.co\.in|jobsdb)\.[a-z.]+$|recruiting\.paylocity\.com$/i

interface FreehireJob {
  public_slug: string
  source?: string
  url: string
  title: string
  company: string
  location?: string
  description?: string
  skills?: string[]
  work_mode?: string | null
  countries?: string[]
  posted_at?: string | null
  created_at?: string
  enrichment?: {
    seniority?: string
    category?: string
    employment_type?: string
    salary_min?: number
    salary_max?: number
    salary_currency?: string
    visa_sponsorship?: boolean | string
    relocation?: string
  }
  reality?: { class?: string; fake_freshness?: boolean }
}

interface FreehireResponse {
  data?: FreehireJob[]
  meta?: { total?: number; limit?: number; offset?: number }
  error?: string
}

export function freehireSearchUrl(params: SearchParams, skills: string[] = []): string {
  const q = new URLSearchParams()
  if (params.countryCode) q.append('countries', params.countryCode.toLowerCase())
  for (const c of CATEGORIES) q.append('category', c)
  for (const s of freehireSkills(skills)) q.append('skills', s)
  q.set('posted_within_days', String(params.maxDaysOld))
  q.set('limit', String(PAGE_SIZE))
  q.set('offset', String((params.page - 1) * PAGE_SIZE))
  q.set('description_format', 'text')
  return `${BASE}/api/v1/agent/jobs/search?${q}`
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/** One freehire posting as a NormalizedJob, or null when it is not worth applying to. */
export function normalizeFreehireJob(j: FreehireJob, countryCode?: string, search: RegionSearch = EUROPE_ONLY): NormalizedJob | null {
  if (!j.url || !j.title || !j.company) return null
  // Reposted for months with a fresh date: a standing ad, not an opening.
  if (j.reality?.class === 'likely-evergreen' || j.reality?.fake_freshness) return null
  if (RELISTING_HOSTS.test(hostOf(j.url))) return null
  // Multi-country postings match a country filter while the job sits in Manila or Texas.
  if (!locationAllowed(j.location, search) || NON_EUROPE_BOARDS.test(hostOf(j.url))) return null
  const e = j.enrichment ?? {}
  const visa = e.visa_sponsorship === true || e.visa_sponsorship === 'true' ? true : e.visa_sponsorship === false || e.visa_sponsorship === 'false' ? false : null
  const relocation = e.relocation === 'supported'
  const url = cleanUrl(j.url)
  return {
    source: 'freehire',
    externalId: j.public_slug,
    url,
    title: j.title,
    company: j.company,
    location: j.location || undefined,
    countryCode: countryCode?.toUpperCase() ?? j.countries?.[0]?.toUpperCase(),
    remote: j.work_mode === 'remote',
    description: j.description ?? '',
    salaryMin: asNumber(e.salary_min) || undefined,
    salaryMax: asNumber(e.salary_max) || undefined,
    currency: e.salary_currency ?? undefined,
    postedAt: parseDate(j.posted_at ?? j.created_at),
    // A relocation package is a sponsorship signal; an explicit "no" saves the ranking call.
    visaSponsorship: visa ?? (relocation ? true : null),
    tags: [...(j.skills ?? []).slice(0, 12), e.category ?? '', e.seniority ?? '', relocation ? 'relocation-supported' : '', visa ? 'visa-sponsorship' : ''].filter(Boolean),
    raw: { slug: j.public_slug, ats: j.source, reality: j.reality?.class },
  }
}

/**
 * Boards whose own page gives the apply agents no form (region-blocked, sign-in such as Wellfound and The Hub,
 * a re-listing, or NoFluffJobs, whose "Apply" opens a job-alert popup or wants an account).
 */
export const NO_FORM_HOSTS = /(^|\.)(adzuna|jooble|jobicy|himalayas|whatjobs|echojobs|thehub|wellfound|nofluffjobs)\.[a-z.]+$/i

function cleanUrl(url: string): string {
  return url.replace(/([?&])utm_source=freehire\.me&?/, '$1').replace(/[?&]$/, '')
}

/**
 * The employer's own posting for a job found on a board without a usable form (Adzuna, Jooble...):
 * freehire's index searched by company and title, kept only when both match. Null when unsure.
 */
export async function findEmployerLink(company: string, title: string, fetchImpl: typeof fetch = fetch, search: RegionSearch = EUROPE_ONLY): Promise<string | null> {
  const c = normalizeCompany(company.replace(/&#0?38;/g, '&'))
  const t = normalizeTitle(title)
  const short = title.split(/[|(\-–—]/)[0].trim()
  const q = new URLSearchParams({ q: `${company.replace(/&#0?38;/g, '&')} ${short}`.replace(/[^\p{L}\p{N}\s&.+-]/gu, ' ').trim(), limit: '20' })
  const res = await fetchJson<FreehireResponse>(`${BASE}/api/v1/jobs/search?${q}`, { method: 'GET' }, { source: 'freehire', fetchImpl, retries: 0 }).catch(() => null)
  for (const j of res?.data ?? []) {
    if (!j.url || RELISTING_HOSTS.test(hostOf(j.url)) || NO_FORM_HOSTS.test(hostOf(j.url))) continue
    // The same company abroad is another job (KDCI's "France" listing led to its Philippines JobStreet post).
    if (NON_EUROPE_BOARDS.test(hostOf(j.url)) || !locationAllowed(j.location, search)) continue
    if (normalizeCompany(j.company) !== c) continue
    const jt = normalizeTitle(j.title)
    if (jt === t || (jt.length > 12 && t.includes(jt)) || (t.length > 12 && jt.includes(t))) return cleanUrl(j.url)
  }
  return null
}

export const freehireAdapter: JobSourceAdapter = {
  id: 'freehire',
  label: 'freehire.me (EU/UK tech, ~50 ATS)',
  usesQuery: false,
  usesCountry: true,
  isConfigured: () => true,
  async fetch(params: SearchParams, ctx: SourceContext) {
    // Developer categories only: other professions have nothing to find here.
    if ((ctx.search.profession ?? 'software') !== 'software') return { jobs: [], hasMore: false, requests: 0 }
    const res = await fetchJson<FreehireResponse>(freehireSearchUrl(params, ctx.skills), { method: 'GET' }, { source: 'freehire', fetchImpl: ctx.fetch })
    await sleep(400)
    const rows = res.data ?? []
    const jobs = rows.map((j) => normalizeFreehireJob(j, params.countryCode, ctx.search)).filter((j): j is NormalizedJob => j !== null)
    const end = params.page * PAGE_SIZE
    const hasMore = rows.length === PAGE_SIZE && end < (res.meta?.total ?? 0) && end + PAGE_SIZE <= MAX_WINDOW
    return { jobs, hasMore, requests: 1 }
  },
}
