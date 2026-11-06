import { guessCountry, isRemoteLocation, JOOBLE_HOSTS } from '@/lib/geo'
import { OUTSIDE_EUROPE_TARGETS, regionCountryName } from '@/lib/regions'
import { toPlainText } from '@/lib/text'
import { asNumber, asString, fetchJson, parseDate } from './http'
import type { JobSourceAdapter, NormalizedJob, SearchParams, SourceContext } from './types'

interface JoobleJob {
  title: string
  location: string
  snippet: string
  salary: string
  source: string
  type: string
  link: string
  company: string
  updated: string
  id: number | string
}

interface JoobleResponse {
  totalCount: number
  jobs: JoobleJob[]
}

const PAGE_SIZE = 50

export const joobleAdapter: JobSourceAdapter = {
  id: 'jooble',
  label: 'Jooble',
  usesQuery: true,
  usesCountry: true,
  // The global API takes a country name as location, so the countries outside Europe work too.
  supportedCountries: new Set([...Object.keys(JOOBLE_HOSTS), ...OUTSIDE_EUROPE_TARGETS]),
  isConfigured: (ctx) => Boolean(ctx.env.JOOBLE_KEY),
  async fetch(params: SearchParams, ctx: SourceContext) {
    const country = (params.countryCode ?? ctx.search.countries[0] ?? 'GB').toUpperCase()
    // Country hosts (ie.jooble.org …) answer 403 to the API; the global host with a
    // country name as location works for every country in JOOBLE_HOSTS.
    const url = `https://jooble.org/api/${ctx.env.JOOBLE_KEY}`
    const since = new Date(Date.now() - params.maxDaysOld * 86_400_000)
    const body = {
      keywords: params.query,
      location: regionCountryName(country),
      page: params.page,
      ResultOnPage: PAGE_SIZE,
      datecreatedfrom: since.toISOString().slice(0, 10),
    }
    const res = await fetchJson<JoobleResponse>(
      url,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      { source: 'jooble', fetchImpl: ctx.fetch },
    )
    const jobs: NormalizedJob[] = []
    for (const j of res.jobs ?? []) {
      const location = asString(j.location)
      const salary = parseSalary(j.salary)
      jobs.push({
        source: 'jooble',
        externalId: String(j.id),
        url: j.link,
        title: j.title,
        company: asString(j.company) || 'Unknown company',
        location,
        countryCode: guessCountry(location, country),
        remote: isRemoteLocation(location, j.type),
        description: toPlainText(j.snippet ?? ''),
        salaryMin: salary?.min,
        salaryMax: salary?.max,
        currency: salary?.currency,
        postedAt: parseDate(j.updated),
        visaSponsorship: null,
        tags: [j.type, j.source].filter(Boolean).map(String),
        raw: j,
      })
    }
    const total = res.totalCount ?? 0
    return { jobs, hasMore: params.page * PAGE_SIZE < total && jobs.length > 0, requests: 1 }
  },
}

function parseSalary(s: string | undefined): { min?: number; max?: number; currency?: string } | undefined {
  if (!s) return undefined
  const currency = /€|eur/i.test(s) ? 'EUR' : /£|gbp/i.test(s) ? 'GBP' : /\$|usd/i.test(s) ? 'USD' : undefined
  const nums = (s.match(/\d[\d.,]*/g) ?? []).map((n) => asNumber(n.replace(/,/g, ''))).filter((n): n is number => n != null)
  if (!nums.length) return { currency }
  const scaled = nums.map((n) => (/\bk\b/i.test(s) && n < 1000 ? n * 1000 : n))
  return { min: Math.min(...scaled), max: Math.max(...scaled), currency }
}
