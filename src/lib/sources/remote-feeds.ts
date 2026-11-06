import { toPlainText } from '@/lib/text'
import { asNumber, asString, boardCategory, wantedTitle, fetchJson, parseDate } from './http'
import { remoteCountry, remoteOpen } from './region-filter'
import type { JobSourceAdapter, NormalizedJob, SearchParams, SourceContext } from './types'

/**
 * Free remote-job feeds. None of them has a country filter that matters for us, so each
 * adapter keeps only postings open to Europe, the world, or one of your countries outside
 * Europe (Settings → Search), with a title in the person's field.
 */

// ---------------------------------------------------------------------------
// Jobicy: https://jobicy.com/jobs-rss-feed  (JSON API v2, no key)
// ---------------------------------------------------------------------------

interface JobicyJob {
  id: number
  url: string
  jobTitle: string
  companyName: string
  jobIndustry?: string[]
  jobType?: string[]
  jobGeo?: string
  jobLevel?: string
  jobExcerpt?: string
  jobDescription?: string
  pubDate?: string
  annualSalaryMin?: number
  annualSalaryMax?: number
  salaryCurrency?: string
}

export const jobicyAdapter: JobSourceAdapter = {
  id: 'jobicy',
  label: 'Jobicy (remote Europe)',
  usesQuery: true,
  usesCountry: false,
  isConfigured: () => true,
  async fetch(params: SearchParams, ctx: SourceContext) {
    const url = new URL('https://jobicy.com/api/v2/remote-jobs')
    url.searchParams.set('count', '100')
    url.searchParams.set('geo', 'europe')
    const industry = boardCategory('jobicy', ctx.search.profession)
    if (industry) url.searchParams.set('industry', industry)
    if (params.query.trim()) url.searchParams.set('tag', params.query.trim().split(/\s+/)[0].toLowerCase())
    const res = await fetchJson<{ jobs?: JobicyJob[] }>(url.toString(), { method: 'GET' }, { source: 'jobicy', fetchImpl: ctx.fetch })
    const cutoff = Date.now() - params.maxDaysOld * 86_400_000
    const jobs: NormalizedJob[] = []
    for (const j of res.jobs ?? []) {
      if (!wantedTitle(j.jobTitle ?? '', ctx.search)) continue
      const postedAt = parseDate(j.pubDate)
      if (postedAt && postedAt.getTime() < cutoff) continue
      const geo = asString(j.jobGeo)
      if (!remoteOpen(geo, ctx.search)) continue
      jobs.push({
        source: 'jobicy',
        externalId: String(j.id),
        url: j.url,
        title: j.jobTitle,
        company: j.companyName,
        location: geo ? `Remote (${geo})` : 'Remote',
        countryCode: remoteCountry(geo, ctx.search),
        remote: true,
        description: toPlainText(j.jobDescription ?? j.jobExcerpt ?? ''),
        salaryMin: asNumber(j.annualSalaryMin),
        salaryMax: asNumber(j.annualSalaryMax),
        currency: asString(j.salaryCurrency) || undefined,
        postedAt,
        visaSponsorship: null,
        tags: [...(j.jobType ?? []), ...(j.jobIndustry ?? []), j.jobLevel ?? ''].filter(Boolean),
        raw: j,
      })
    }
    return { jobs, hasMore: false, requests: 1 }
  },
}

// ---------------------------------------------------------------------------
// Himalayas: https://himalayas.app/jobs/api  (cursor-paged JSON, no key)
// ---------------------------------------------------------------------------

interface HimalayasJob {
  guid: string
  title: string
  companyName: string
  excerpt?: string
  description?: string
  applicationLink?: string
  pubDate?: string | number
  locationRestrictions?: string[]
  seniority?: string[]
  categories?: string[]
  minSalary?: number
  maxSalary?: number
  currency?: string
  employmentType?: string
}

interface HimalayasResponse {
  jobs?: HimalayasJob[]
  nextCursor?: string | null
}

export const himalayasAdapter: JobSourceAdapter = {
  id: 'himalayas',
  label: 'Himalayas (remote)',
  usesQuery: false,
  usesCountry: false,
  isConfigured: () => true,
  async fetch(params: SearchParams, ctx: SourceContext) {
    // Cursor pagination: walk `page` pages of 100 in one call (the pipeline calls us once).
    const jobs: NormalizedJob[] = []
    const cutoff = Date.now() - params.maxDaysOld * 86_400_000
    let cursor: string | null = null
    let requests = 0
    const pages = Math.max(1, Math.min(5, ctx.search.sources.himalayas?.maxPages ?? 2))
    for (let p = 0; p < pages; p++) {
      const url = new URL('https://himalayas.app/jobs/api')
      url.searchParams.set('limit', '100')
      if (cursor) url.searchParams.set('cursor', cursor)
      const res: HimalayasResponse = await fetchJson<HimalayasResponse>(url.toString(), { method: 'GET' }, { source: 'himalayas', fetchImpl: ctx.fetch })
      requests++
      let tooOld = 0
      for (const j of res.jobs ?? []) {
        const postedAt = parseDate(typeof j.pubDate === 'number' ? j.pubDate * 1000 : j.pubDate)
        if (postedAt && postedAt.getTime() < cutoff) {
          tooOld++
          continue
        }
        if (!wantedTitle(j.title ?? '', ctx.search)) continue
        const restrictions = (j.locationRestrictions ?? []).join(', ')
        if (restrictions && !remoteOpen(restrictions, ctx.search)) continue
        jobs.push({
          source: 'himalayas',
          externalId: j.guid,
          url: j.applicationLink ?? `https://himalayas.app/jobs?search=${encodeURIComponent(j.title)}`,
          title: j.title,
          company: j.companyName,
          location: restrictions ? `Remote (${restrictions})` : 'Remote (worldwide)',
          countryCode: remoteCountry(restrictions, ctx.search),
          remote: true,
          description: toPlainText(j.description ?? j.excerpt ?? ''),
          salaryMin: asNumber(j.minSalary),
          salaryMax: asNumber(j.maxSalary),
          currency: asString(j.currency) || undefined,
          postedAt,
          visaSponsorship: null,
          tags: [...(j.seniority ?? []), ...(j.categories ?? []).slice(0, 5), j.employmentType ?? ''].filter(Boolean),
          raw: { guid: j.guid, restrictions: j.locationRestrictions },
        })
      }
      cursor = res.nextCursor ?? null
      // The feed is newest-first: once a whole page is older than the cutoff, stop.
      if (!cursor || tooOld === (res.jobs?.length ?? 0)) break
    }
    return { jobs, hasMore: false, requests }
  },
}

// ---------------------------------------------------------------------------
// Remote OK: https://remoteok.com/api  (single JSON feed; first element is a legal notice)
// ---------------------------------------------------------------------------

interface RemoteOkJob {
  id: string
  slug: string
  url: string
  apply_url?: string
  position: string
  company: string
  location?: string
  tags?: string[]
  description?: string
  date?: string
  epoch?: number
  salary_min?: number
  salary_max?: number
}

export const remoteOkAdapter: JobSourceAdapter = {
  id: 'remoteok',
  label: 'Remote OK',
  usesQuery: false,
  usesCountry: false,
  isConfigured: () => true,
  async fetch(params: SearchParams, ctx: SourceContext) {
    const res = await fetchJson<Array<RemoteOkJob | { legal?: string }>>('https://remoteok.com/api', { method: 'GET' }, { source: 'remoteok', fetchImpl: ctx.fetch })
    const cutoff = Date.now() - params.maxDaysOld * 86_400_000
    const jobs: NormalizedJob[] = []
    for (const item of res) {
      const j = item as RemoteOkJob
      if (!j.id || !j.position) continue
      if (!wantedTitle(j.position, ctx.search)) continue
      const postedAt = parseDate(j.epoch ? j.epoch * 1000 : j.date)
      if (postedAt && postedAt.getTime() < cutoff) continue
      const loc = asString(j.location)
      if (!remoteOpen(loc, ctx.search)) continue
      jobs.push({
        source: 'remoteok',
        externalId: String(j.id),
        url: j.url,
        title: j.position,
        company: (j.company ?? '').trim(),
        location: loc ? `Remote (${loc})` : 'Remote',
        countryCode: remoteCountry(loc, ctx.search),
        remote: true,
        description: toPlainText(j.description ?? ''),
        salaryMin: asNumber(j.salary_min) || undefined,
        salaryMax: asNumber(j.salary_max) || undefined,
        currency: j.salary_min ? 'USD' : undefined,
        postedAt,
        visaSponsorship: null,
        tags: (j.tags ?? []).slice(0, 12),
        raw: { id: j.id, apply: j.apply_url },
      })
    }
    return { jobs, hasMore: false, requests: 1 }
  },
}

// ---------------------------------------------------------------------------
// Working Nomads: https://www.workingnomads.com/api/exposed_jobs/  (single JSON feed)
// ---------------------------------------------------------------------------

interface WorkingNomadsJob {
  url: string
  title: string
  description?: string
  company_name: string
  category_name?: string
  tags?: string
  location?: string
  pub_date?: string
}

export const workingNomadsAdapter: JobSourceAdapter = {
  id: 'workingnomads',
  label: 'Working Nomads',
  usesQuery: false,
  usesCountry: false,
  isConfigured: () => true,
  async fetch(params: SearchParams, ctx: SourceContext) {
    const res = await fetchJson<WorkingNomadsJob[]>('https://www.workingnomads.com/api/exposed_jobs/', { method: 'GET' }, { source: 'workingnomads', fetchImpl: ctx.fetch })
    const cutoff = Date.now() - params.maxDaysOld * 86_400_000
    const jobs: NormalizedJob[] = []
    for (const j of res) {
      if (!wantedTitle(j.title ?? '', ctx.search)) continue
      const postedAt = parseDate(j.pub_date)
      if (postedAt && postedAt.getTime() < cutoff) continue
      const loc = asString(j.location)
      if (!remoteOpen(loc, ctx.search)) continue
      jobs.push({
        source: 'workingnomads',
        externalId: j.url.replace(/\/+$/, '').split('/').pop() ?? j.url,
        url: j.url,
        title: j.title,
        company: j.company_name,
        location: loc ? `Remote (${loc})` : 'Remote',
        countryCode: remoteCountry(loc, ctx.search),
        remote: true,
        description: toPlainText(j.description ?? ''),
        postedAt,
        visaSponsorship: null,
        tags: (j.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 12),
        raw: { category: j.category_name },
      })
    }
    return { jobs, hasMore: false, requests: 1 }
  },
}
