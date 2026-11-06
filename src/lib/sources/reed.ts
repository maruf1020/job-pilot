import { toPlainText } from '@/lib/text'
import { asNumber, asString, wantedTitle, fetchJson } from './http'
import type { JobSourceAdapter, NormalizedJob, SearchParams, SourceContext } from './types'

/**
 * Reed.co.uk Jobseeker API (UK). Free key from reed.co.uk/developers; HTTP Basic auth with
 * the key as the user name. The search returns a short description; the full posting is
 * fetched per job.
 */

interface ReedJob {
  jobId: number
  employerName: string
  jobTitle: string
  locationName?: string
  minimumSalary?: number | null
  maximumSalary?: number | null
  currency?: string | null
  date?: string
  jobDescription?: string
  jobUrl?: string
  applications?: number
}

interface ReedSearch {
  results?: ReedJob[]
  totalResults?: number
}

const PAGE_SIZE = 100

function parseReedDate(v: unknown): Date | undefined {
  const s = asString(v)
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s)
  if (!m) return undefined
  return new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`)
}

export const reedAdapter: JobSourceAdapter = {
  id: 'reed',
  label: 'Reed (UK)',
  usesQuery: true,
  usesCountry: true,
  supportedCountries: new Set(['GB']),
  isConfigured: (ctx) => Boolean(ctx.env.REED_KEY),
  async fetch(params: SearchParams, ctx: SourceContext) {
    const auth = `Basic ${Buffer.from(`${ctx.env.REED_KEY}:`).toString('base64')}`
    const url = new URL('https://www.reed.co.uk/api/1.0/search')
    url.searchParams.set('keywords', params.query)
    url.searchParams.set('resultsToTake', String(PAGE_SIZE))
    url.searchParams.set('resultsToSkip', String((params.page - 1) * PAGE_SIZE))
    const res = await fetchJson<ReedSearch>(url.toString(), { method: 'GET', headers: { authorization: auth } }, { source: 'reed', fetchImpl: ctx.fetch })
    let requests = 1
    const cutoff = Date.now() - params.maxDaysOld * 86_400_000
    const jobs: NormalizedJob[] = []
    for (const j of res.results ?? []) {
      if (!wantedTitle(j.jobTitle ?? '', ctx.search)) continue
      const postedAt = parseReedDate(j.date)
      if (postedAt && postedAt.getTime() < cutoff) continue
      let description = toPlainText(j.jobDescription ?? '')
      try {
        const full = await fetchJson<{ jobDescription?: string }>(`https://www.reed.co.uk/api/1.0/jobs/${j.jobId}`, { method: 'GET', headers: { authorization: auth } }, { source: 'reed', fetchImpl: ctx.fetch, retries: 0 })
        requests++
        if (full.jobDescription) description = toPlainText(full.jobDescription)
      } catch {
        /* keep the short description */
      }
      jobs.push({
        source: 'reed',
        externalId: String(j.jobId),
        url: j.jobUrl ?? `https://www.reed.co.uk/jobs/${j.jobId}`,
        title: j.jobTitle,
        company: j.employerName,
        location: asString(j.locationName) || 'United Kingdom',
        countryCode: 'GB',
        remote: /remote/i.test(`${j.locationName ?? ''} ${j.jobTitle}`),
        description,
        salaryMin: asNumber(j.minimumSalary) || undefined,
        salaryMax: asNumber(j.maximumSalary) || undefined,
        currency: asString(j.currency) || 'GBP',
        postedAt,
        visaSponsorship: null,
        tags: [],
        raw: { jobId: j.jobId, applications: j.applications },
      })
    }
    const hasMore = (res.results?.length ?? 0) === PAGE_SIZE && params.page * PAGE_SIZE < (res.totalResults ?? 0)
    return { jobs, hasMore, requests }
  },
}
