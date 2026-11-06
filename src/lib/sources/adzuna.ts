import { ADZUNA_COUNTRIES, guessCountry, isRemoteLocation } from '@/lib/geo'
import { toPlainText } from '@/lib/text'
import { asNumber, asString, fetchJson, parseDate } from './http'
import type { JobSourceAdapter, NormalizedJob, SearchParams, SourceContext } from './types'

interface AdzunaJob {
  id: string
  title: string
  description: string
  redirect_url: string
  company?: { display_name?: string }
  location?: { display_name?: string; area?: string[] }
  salary_min?: number
  salary_max?: number
  salary_is_predicted?: string
  created?: string
  contract_type?: string
  contract_time?: string
  category?: { label?: string }
}

interface AdzunaResponse {
  results: AdzunaJob[]
  count?: number
}

const PAGE_SIZE = 50
const CURRENCY: Record<string, string> = { GB: 'GBP', CH: 'CHF', PL: 'PLN', CA: 'CAD', AU: 'AUD', US: 'USD', NZ: 'NZD' }

export const adzunaAdapter: JobSourceAdapter = {
  id: 'adzuna',
  label: 'Adzuna',
  usesQuery: true,
  usesCountry: true,
  supportedCountries: ADZUNA_COUNTRIES,
  isConfigured: (ctx) => Boolean(ctx.env.ADZUNA_APP_ID && ctx.env.ADZUNA_APP_KEY),
  async fetch(params: SearchParams, ctx: SourceContext) {
    const country = (params.countryCode ?? 'GB').toUpperCase()
    const url = new URL(`https://api.adzuna.com/v1/api/jobs/${country.toLowerCase()}/search/${params.page}`)
    url.searchParams.set('app_id', ctx.env.ADZUNA_APP_ID ?? '')
    url.searchParams.set('app_key', ctx.env.ADZUNA_APP_KEY ?? '')
    url.searchParams.set('results_per_page', String(PAGE_SIZE))
    url.searchParams.set('what', params.query)
    url.searchParams.set('max_days_old', String(params.maxDaysOld))
    url.searchParams.set('sort_by', 'date')
    url.searchParams.set('content-type', 'application/json')
    const res = await fetchJson<AdzunaResponse>(url.toString(), { method: 'GET' }, { source: 'adzuna', fetchImpl: ctx.fetch })
    const jobs: NormalizedJob[] = []
    for (const j of res.results ?? []) {
      const location = asString(j.location?.display_name)
      const predicted = j.salary_is_predicted === '1'
      jobs.push({
        source: 'adzuna',
        externalId: String(j.id),
        url: j.redirect_url,
        title: j.title,
        company: asString(j.company?.display_name) || 'Unknown company',
        location,
        countryCode: guessCountry(location, country),
        remote: isRemoteLocation(location, j.title),
        description: toPlainText(j.description ?? ''),
        salaryMin: predicted ? undefined : asNumber(j.salary_min),
        salaryMax: predicted ? undefined : asNumber(j.salary_max),
        currency: CURRENCY[country] ?? 'EUR',
        postedAt: parseDate(j.created),
        visaSponsorship: null,
        tags: [j.contract_type, j.contract_time, j.category?.label].filter(Boolean).map(String),
        raw: j,
      })
    }
    const total = res.count ?? 0
    return { jobs, hasMore: params.page * PAGE_SIZE < total && jobs.length > 0, requests: 1 }
  },
}
