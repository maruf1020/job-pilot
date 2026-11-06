import { guessCountry, isRemoteLocation } from '@/lib/geo'
import { toPlainText } from '@/lib/text'
import { asString, fetchJson, parseDate } from './http'
import type { JobSourceAdapter, NormalizedJob, SearchParams, SourceContext } from './types'

interface ArbeitnowJob {
  slug: string
  company_name: string
  title: string
  description: string
  remote: boolean
  url: string
  tags: string[]
  job_types: string[]
  location: string
  created_at: number
  visa_sponsorship?: boolean
}

interface ArbeitnowResponse {
  data: ArbeitnowJob[]
  links?: { next?: string | null }
  meta?: { current_page?: number; last_page?: number }
}

function makeAdapter(id: 'arbeitnow' | 'arbeitnow_uk', host: string, label: string, defaultCountry: string): JobSourceAdapter {
  return {
    id,
    label,
    usesQuery: false,
    usesCountry: false,
    isConfigured: () => true,
    async fetch(params: SearchParams, ctx: SourceContext) {
      const url = new URL(`https://${host}/api/job-board-api`)
      url.searchParams.set('visa_sponsorship', 'true')
      url.searchParams.set('page', String(params.page))
      const res = await fetchJson<ArbeitnowResponse>(url.toString(), { method: 'GET' }, { source: id, fetchImpl: ctx.fetch })
      const cutoff = Date.now() - params.maxDaysOld * 86_400_000
      const jobs: NormalizedJob[] = []
      for (const j of res.data ?? []) {
        const postedAt = parseDate(j.created_at)
        if (postedAt && postedAt.getTime() < cutoff) continue
        const location = asString(j.location)
        jobs.push({
          source: id,
          externalId: j.slug,
          url: j.url,
          title: j.title,
          company: j.company_name,
          location,
          countryCode: guessCountry(location, defaultCountry),
          remote: Boolean(j.remote) || isRemoteLocation(location),
          description: toPlainText(j.description ?? ''),
          postedAt,
          visaSponsorship: j.visa_sponsorship ?? true,
          tags: [...(j.tags ?? []), ...(j.job_types ?? [])].map(String),
          raw: j,
        })
      }
      const hasMore = Boolean(res.links?.next) && (res.data?.length ?? 0) > 0
      return { jobs, hasMore, requests: 1 }
    },
  }
}

export const arbeitnowAdapter = makeAdapter('arbeitnow', 'www.arbeitnow.com', 'Arbeitnow (EU)', 'DE')
export const arbeitnowUkAdapter = makeAdapter('arbeitnow_uk', 'www.arbeitnow.co.uk', 'Arbeitnow (UK)', 'GB')
