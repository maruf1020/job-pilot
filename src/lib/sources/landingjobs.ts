import { toPlainText } from '@/lib/text'
import { asNumber, wantedTitle, fetchJson, parseDate, sleep } from './http'
import type { JobSourceAdapter, NormalizedJob, SearchParams, SourceContext } from './types'

/**
 * Landing.jobs (Lisbon-based tech job board with EU-wide postings). Public JSON API,
 * no key, 50 postings per page, newest first, no keyword filter: we page through and
 * keep engineering titles. "relocation_paid" is a strong sponsorship signal.
 */

interface LandingJob {
  id: number
  title: string
  url: string
  role_description?: string
  main_requirements?: string
  nice_to_have?: string
  perks?: string
  relocation_paid?: boolean
  remote?: boolean
  type?: string
  currency_code?: string
  gross_salary_low?: number | null
  gross_salary_high?: number | null
  tags?: string[]
  locations?: Array<{ city?: string | null; country_code?: string | null }>
  published_at?: string
  created_at?: string
}

/** Company name from the posting URL: https://landing.jobs/at/<company-slug>/<job-slug> */
export function landingCompanyFromUrl(url: string): string {
  const m = /\/at\/([^/]+)\//.exec(url)
  if (!m) return 'Unknown company'
  return m[1]
    .split('-')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

export const landingJobsAdapter: JobSourceAdapter = {
  id: 'landingjobs',
  label: 'Landing.jobs (Portugal/EU)',
  usesQuery: false,
  usesCountry: false,
  isConfigured: () => true,
  async fetch(params: SearchParams, ctx: SourceContext) {
    const res = await fetchJson<LandingJob[]>(`https://landing.jobs/api/v1/jobs?page=${params.page}`, { method: 'GET' }, { source: 'landingjobs', fetchImpl: ctx.fetch })
    await sleep(300)
    const cutoff = Date.now() - params.maxDaysOld * 86_400_000
    const jobs: NormalizedJob[] = []
    let tooOld = 0
    for (const j of res) {
      const postedAt = parseDate(j.published_at ?? j.created_at)
      if (postedAt && postedAt.getTime() < cutoff) {
        tooOld++
        continue
      }
      if (!wantedTitle(j.title ?? '', ctx.search)) continue
      const loc = j.locations?.[0]
      const countryCode = loc?.country_code?.toUpperCase() ?? undefined
      const description = [j.role_description, j.main_requirements ? `Requirements:\n${j.main_requirements}` : '', j.nice_to_have ? `Nice to have:\n${j.nice_to_have}` : '', j.perks ? `Perks:\n${j.perks}` : '']
        .filter(Boolean)
        .map((html) => toPlainText(html!))
        .join('\n\n')
      jobs.push({
        source: 'landingjobs',
        externalId: String(j.id),
        url: j.url,
        title: j.title,
        company: landingCompanyFromUrl(j.url),
        location: loc?.city ? `${loc.city}${countryCode ? `, ${countryCode}` : ''}` : (countryCode ?? (j.remote ? 'Remote' : undefined)),
        countryCode,
        remote: Boolean(j.remote),
        description,
        salaryMin: asNumber(j.gross_salary_low) || undefined,
        salaryMax: asNumber(j.gross_salary_high) || undefined,
        currency: j.currency_code ?? undefined,
        postedAt,
        visaSponsorship: j.relocation_paid ? true : null,
        tags: [...(j.tags ?? []).slice(0, 12), j.type ?? '', j.relocation_paid ? 'relocation-paid' : ''].filter(Boolean),
        raw: { id: j.id, relocationPaid: j.relocation_paid },
      })
    }
    // Newest first: a page entirely older than the cutoff means the rest is too.
    const hasMore = res.length === 50 && tooOld < res.length
    return { jobs, hasMore, requests: 1 }
  },
}
