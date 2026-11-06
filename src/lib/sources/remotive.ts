import { toPlainText } from '@/lib/text'
import { boardCategory, asString, fetchJson, parseDate } from './http'
import { remoteCountry, remoteOpen } from './region-filter'
import type { JobSourceAdapter, NormalizedJob, SearchParams, SourceContext } from './types'

interface RemotiveJob {
  id: number
  url: string
  title: string
  company_name: string
  category: string
  tags: string[]
  job_type: string
  publication_date: string
  candidate_required_location: string
  salary: string
  description: string
}

interface RemotiveResponse {
  jobs: RemotiveJob[]
}

export const remotiveAdapter: JobSourceAdapter = {
  id: 'remotive',
  label: 'Remotive',
  usesQuery: true,
  usesCountry: false,
  isConfigured: () => true,
  async fetch(params: SearchParams, ctx: SourceContext) {
    const url = new URL('https://remotive.com/api/remote-jobs')
    const category = boardCategory('remotive', ctx.search.profession)
    if (category) url.searchParams.set('category', category)
    url.searchParams.set('search', params.query)
    url.searchParams.set('limit', '100')
    const res = await fetchJson<RemotiveResponse>(url.toString(), { method: 'GET' }, { source: 'remotive', fetchImpl: ctx.fetch })
    const cutoff = Date.now() - params.maxDaysOld * 86_400_000
    const jobs: NormalizedJob[] = []
    for (const j of res.jobs ?? []) {
      const loc = asString(j.candidate_required_location)
      if (loc && !remoteOpen(loc, ctx.search)) continue
      const postedAt = parseDate(j.publication_date)
      if (postedAt && postedAt.getTime() < cutoff) continue
      jobs.push({
        source: 'remotive',
        externalId: String(j.id),
        url: j.url,
        title: j.title,
        company: j.company_name,
        location: loc ? `Remote (${loc})` : 'Remote',
        countryCode: remoteCountry(loc, ctx.search),
        remote: true,
        description: toPlainText(j.description ?? ''),
        postedAt,
        visaSponsorship: null,
        tags: [...(j.tags ?? []), j.job_type].filter(Boolean).map(String),
        raw: j,
      })
    }
    return { jobs, hasMore: false, requests: 1 }
  },
}
