import { guessCountry, isRemoteLocation } from '@/lib/geo'
import { toPlainText } from '@/lib/text'
import { boardCategory, wantedTitle, fetchJson, parseDate, sleep } from './http'
import type { JobSourceAdapter, NormalizedJob, SearchParams, SourceContext } from './types'

/**
 * The Muse public jobs API (no key): larger employers, searched per hub city because the
 * API filters by exact location names. Results are re-checked against the country.
 */

interface MuseJob {
  id: number
  name: string
  contents?: string
  publication_date?: string
  company?: { name?: string }
  locations?: Array<{ name: string }>
  levels?: Array<{ name: string }>
  categories?: Array<{ name: string }>
  refs?: { landing_page?: string }
}

interface MuseResponse {
  page: number
  page_count: number
  results: MuseJob[]
}

/** Hub cities The Muse knows, per country. */
export const MUSE_CITIES: Record<string, string[]> = {
  IE: ['Dublin, Ireland'],
  GB: ['London, United Kingdom'],
  DE: ['Berlin, Germany', 'Munich, Germany'],
  NL: ['Amsterdam, Netherlands'],
  FR: ['Paris, France'],
  ES: ['Madrid, Spain', 'Barcelona, Spain'],
  PT: ['Lisbon, Portugal'],
  SE: ['Stockholm, Sweden'],
  DK: ['Copenhagen, Denmark'],
  FI: ['Helsinki, Finland'],
  PL: ['Warsaw, Poland', 'Krakow, Poland'],
  AT: ['Vienna, Austria'],
  BE: ['Brussels, Belgium'],
  CH: ['Zurich, Switzerland'],
  CZ: ['Prague, Czech Republic'],
  IT: ['Milan, Italy'],
  EE: ['Tallinn, Estonia'],
  // Only searched when switched on in Settings → Search (countries outside Europe).
  CA: ['Toronto, Canada', 'Vancouver, Canada'],
  AU: ['Sydney, Australia', 'Melbourne, Australia'],
  US: ['New York, NY', 'San Francisco, CA', 'Seattle, WA', 'Boston, MA', 'Austin, TX'],
}

export const theMuseAdapter: JobSourceAdapter = {
  id: 'themuse',
  label: 'The Muse',
  usesQuery: false,
  usesCountry: true,
  supportedCountries: new Set(Object.keys(MUSE_CITIES)),
  isConfigured: () => true,
  async fetch(params: SearchParams, ctx: SourceContext) {
    const country = (params.countryCode ?? '').toUpperCase()
    const cities = MUSE_CITIES[country] ?? []
    const cutoff = Date.now() - params.maxDaysOld * 86_400_000
    const seen = new Set<number>()
    const jobs: NormalizedJob[] = []
    let requests = 0
    let hasMore = false
    for (const city of cities) {
      const url = new URL('https://www.themuse.com/api/public/jobs')
      const category = boardCategory('themuse', ctx.search.profession)
      if (category) url.searchParams.set('category', category)
      url.searchParams.set('location', city)
      url.searchParams.set('page', String(params.page))
      // The Muse sits behind a bot filter that rejects unusual user agents; a plain browser UA is accepted.
      const res = await fetchJson<MuseResponse>(url.toString(), { method: 'GET', headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' } }, { source: 'themuse', fetchImpl: ctx.fetch })
      requests++
      if (res.page < res.page_count) hasMore = true
      for (const j of res.results ?? []) {
        if (seen.has(j.id)) continue
        seen.add(j.id)
        if (!wantedTitle(j.name ?? '', ctx.search)) continue
        const postedAt = parseDate(j.publication_date)
        if (postedAt && postedAt.getTime() < cutoff) continue
        const names = (j.locations ?? []).map((l) => l.name)
        const here = names.find((n) => guessCountry(n) === country)
        const remote = names.some((n) => isRemoteLocation(n))
        if (!here && !remote) continue
        jobs.push({
          source: 'themuse',
          externalId: String(j.id),
          url: j.refs?.landing_page ?? `https://www.themuse.com/jobs/${j.id}`,
          title: j.name,
          company: j.company?.name ?? 'Unknown company',
          location: here ?? (remote ? 'Remote' : names[0]),
          countryCode: here ? country : undefined,
          remote: !here && remote,
          description: toPlainText(j.contents ?? ''),
          postedAt,
          visaSponsorship: null,
          tags: [...(j.levels ?? []).map((l) => l.name), ...(j.categories ?? []).map((c) => c.name)].slice(0, 8),
          raw: { id: j.id, locations: names },
        })
      }
      await sleep(300)
    }
    return { jobs, hasMore, requests }
  },
}
