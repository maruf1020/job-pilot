import { EU_COUNTRY_CODES } from '@/lib/domain'
import { toPlainText } from '@/lib/text'
import { wantedTitle, fetchJson, sleep } from './http'
import type { JobSourceAdapter, NormalizedJob, SearchParams, SourceContext } from './types'

/**
 * EURES, the European Commission's job mobility portal: vacancies from every EEA public
 * employment service plus EURES-flagged employers. Public search endpoint used by the
 * portal itself (no key). Only postings available in English are kept.
 */

interface EuresJv {
  id: string
  title: string
  description?: string
  creationDate?: number
  lastModificationDate?: number
  locationMap?: Record<string, Array<string | null>>
  euresFlag?: boolean
  positionScheduleCodes?: string[]
  positionOfferingCode?: string
  employer?: { name?: string | null; website?: string | null }
  availableLanguages?: string[]
  translations?: Record<string, { title?: string; description?: string }>
}

interface EuresResponse {
  numberRecords: number
  jvs: EuresJv[]
}

const SEARCH_URL = 'https://europa.eu/eures/api/jv-searchengine/public/jv-search/search?lang=en'
const PAGE_SIZE = 50
/** EURES covers the EEA and Switzerland, not the UK. */
const SUPPORTED = new Set(EU_COUNTRY_CODES.filter((c) => c !== 'GB'))

function periodFor(maxDaysOld: number): string | null {
  if (maxDaysOld <= 1) return 'LAST_DAY'
  if (maxDaysOld <= 7) return 'LAST_WEEK'
  if (maxDaysOld <= 31) return 'LAST_MONTH'
  return null
}

export function euresJobUrl(id: string): string {
  return `https://europa.eu/eures/portal/jv-se/jv-details/${encodeURIComponent(id)}?lang=en`
}

export const euresAdapter: JobSourceAdapter = {
  id: 'eures',
  label: 'EURES (official EU portal)',
  usesQuery: true,
  usesCountry: true,
  supportedCountries: SUPPORTED,
  isConfigured: () => true,
  async fetch(params: SearchParams, ctx: SourceContext) {
    const body = {
      resultsPerPage: PAGE_SIZE,
      page: params.page,
      sortSearch: 'MOST_RECENT',
      keywords: [{ keyword: params.query, specificSearchCode: 'EVERYWHERE' }],
      publicationPeriod: periodFor(params.maxDaysOld),
      occupationUris: [],
      skillUris: [],
      requiredExperienceCodes: [],
      positionScheduleCodes: [],
      sectorCodes: [],
      educationAndQualificationLevelCodes: [],
      positionOfferingCodes: [],
      locationCodes: params.countryCode ? [params.countryCode.toLowerCase()] : [],
      euresFlagCodes: [],
      otherBenefitsCodes: [],
      requiredLanguages: [],
      minNumberPost: null,
    }
    const res = await fetchJson<EuresResponse>(
      SEARCH_URL,
      { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 job-pilot' }, body: JSON.stringify(body) },
      { source: 'eures', fetchImpl: ctx.fetch, timeoutMs: 30_000 },
    )
    await sleep(400)
    const cutoff = Date.now() - params.maxDaysOld * 86_400_000
    const jobs: NormalizedJob[] = []
    for (const jv of res.jvs ?? []) {
      const langs = (jv.availableLanguages ?? []).map((l) => l.toLowerCase())
      const en = jv.translations?.en
      if (!langs.includes('en') && !en) continue
      const title = (en?.title ?? jv.title ?? '').trim()
      const html = en?.description ?? jv.description ?? ''
      if (!title || !html) continue
      // EURES keyword search matches anywhere in the text; keep only engineering titles.
      if (!wantedTitle(title, ctx.search)) continue
      const postedAt = jv.creationDate ? new Date(jv.creationDate) : undefined
      if (postedAt && postedAt.getTime() < cutoff) continue
      const countryCode = Object.keys(jv.locationMap ?? {})[0]?.toUpperCase() ?? params.countryCode?.toUpperCase()
      const cities = Object.values(jv.locationMap ?? {})
        .flat()
        .filter((c): c is string => Boolean(c))
      jobs.push({
        source: 'eures',
        externalId: jv.id,
        url: euresJobUrl(jv.id),
        title,
        company: (jv.employer?.name ?? '').trim() || 'Unknown employer',
        location: cities.length ? `${cities[0]}${countryCode ? `, ${countryCode}` : ''}` : countryCode,
        countryCode,
        remote: false,
        description: toPlainText(html),
        postedAt,
        visaSponsorship: null,
        tags: [...(jv.positionScheduleCodes ?? []), jv.euresFlag ? 'eures-flag' : ''].filter(Boolean),
        raw: { id: jv.id, employer: jv.employer?.name, languages: langs, website: jv.employer?.website },
      })
    }
    const hasMore = (res.jvs?.length ?? 0) === PAGE_SIZE && params.page * PAGE_SIZE < (res.numberRecords ?? 0)
    return { jobs, hasMore, requests: 1 }
  },
}
