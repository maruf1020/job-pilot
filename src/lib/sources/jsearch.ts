import { countryName } from '@/lib/domain'
import { guessCountry, isRemoteLocation } from '@/lib/geo'
import { toPlainText } from '@/lib/text'
import { asNumber, asString, fetchJson, parseDate } from './http'
import type { JobSourceAdapter, NormalizedJob, SearchParams, SourceContext } from './types'

interface JSearchJob {
  job_id: string
  job_title: string
  employer_name: string
  employer_website?: string | null
  job_publisher?: string
  job_apply_link: string
  job_description: string
  job_city?: string | null
  job_state?: string | null
  job_country?: string | null
  job_is_remote?: boolean
  job_posted_at_datetime_utc?: string | null
  job_min_salary?: number | null
  job_max_salary?: number | null
  job_salary_currency?: string | null
  job_employment_type?: string | null
  job_highlights?: Record<string, string[]>
}

interface JSearchResponse {
  status: string
  data: JSearchJob[]
}

/**
 * JSearch (RapidAPI) aggregates LinkedIn/Indeed/Glassdoor. ~200 requests/month free,
 * so the pipeline only calls it a couple of times a day with queries for the top-priority countries.
 */
export const jsearchAdapter: JobSourceAdapter = {
  id: 'jsearch',
  label: 'JSearch',
  usesQuery: true,
  usesCountry: true,
  isConfigured: (ctx) => Boolean(ctx.env.RAPIDAPI_KEY),
  async fetch(params: SearchParams, ctx: SourceContext) {
    const country = (params.countryCode ?? ctx.search.countries[0] ?? 'GB').toUpperCase()
    const url = new URL('https://jsearch.p.rapidapi.com/search')
    url.searchParams.set('query', `${params.query}${ctx.sponsorship === false ? '' : ' visa sponsorship'} in ${countryName(country)}`)
    url.searchParams.set('page', String(params.page))
    url.searchParams.set('num_pages', '1')
    url.searchParams.set('country', country.toLowerCase())
    url.searchParams.set('date_posted', params.maxDaysOld <= 7 ? 'week' : 'month')
    const res = await fetchJson<JSearchResponse>(
      url.toString(),
      { method: 'GET', headers: { 'x-rapidapi-key': ctx.env.RAPIDAPI_KEY ?? '', 'x-rapidapi-host': 'jsearch.p.rapidapi.com' } },
      { source: 'jsearch', fetchImpl: ctx.fetch, retries: 0 },
    )
    const jobs: NormalizedJob[] = []
    for (const j of res.data ?? []) {
      const location = [j.job_city, j.job_state, j.job_country].filter(Boolean).join(', ')
      jobs.push({
        source: 'jsearch',
        externalId: j.job_id,
        url: j.job_apply_link,
        title: j.job_title,
        company: asString(j.employer_name) || 'Unknown company',
        location,
        countryCode: (j.job_country && j.job_country.length === 2 ? j.job_country.toUpperCase() : undefined) ?? guessCountry(location, country),
        remote: Boolean(j.job_is_remote) || isRemoteLocation(location),
        description: toPlainText(j.job_description ?? ''),
        salaryMin: asNumber(j.job_min_salary),
        salaryMax: asNumber(j.job_max_salary),
        currency: j.job_salary_currency ?? undefined,
        postedAt: parseDate(j.job_posted_at_datetime_utc),
        visaSponsorship: null,
        tags: [j.job_employment_type, j.job_publisher].filter(Boolean).map(String),
        raw: j,
      })
    }
    return { jobs, hasMore: false, requests: 1 }
  },
}
