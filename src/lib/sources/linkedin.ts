import { countryName } from '@/lib/domain'
import { guessCountry, isRemoteLocation } from '@/lib/geo'
import { htmlToText } from '@/lib/text'
import { sleep } from './http'
import { SourceError, type JobSourceAdapter, type NormalizedJob, type SearchParams, type SourceContext } from './types'

/**
 * LinkedIn's public, logged-out job search ("guest" pages). No account, no cookies,
 * low volume, long pauses. Off by default: LinkedIn's terms forbid automated access and
 * robots.txt disallows crawling; the operator opts in knowingly (see SOURCE_NOTES).
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const PAGE_SIZE = 25
const DETAIL_PAUSE_MS = 1800

export interface LinkedInCard {
  id: string
  url: string
  title: string
  company: string
  location: string
  postedAt?: Date
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Parse the HTML fragment returned by the guest "seeMoreJobPostings" endpoint into cards. */
export function parseLinkedInCards(html: string): LinkedInCard[] {
  const cards: LinkedInCard[] = []
  const blocks = html.split(/<li\b/i).slice(1)
  for (const block of blocks) {
    const id = /urn:li:jobPosting:(\d+)/.exec(block)?.[1]
    const title = /base-search-card__title[^>]*>([\s\S]*?)<\//i.exec(block)?.[1]
    if (!id || !title) continue
    const company = /base-search-card__subtitle[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i.exec(block)?.[1] ?? /base-search-card__subtitle[^>]*>([\s\S]*?)<\//i.exec(block)?.[1] ?? ''
    const location = /job-search-card__location[^>]*>([\s\S]*?)<\//i.exec(block)?.[1] ?? ''
    const date = /datetime="(\d{4}-\d{2}-\d{2})"/.exec(block)?.[1]
    cards.push({
      id,
      url: `https://www.linkedin.com/jobs/view/${id}`,
      title: decode(title.replace(/<[^>]+>/g, '')),
      company: decode(company.replace(/<[^>]+>/g, '')),
      location: decode(location.replace(/<[^>]+>/g, '')),
      postedAt: date ? new Date(`${date}T00:00:00Z`) : undefined,
    })
  }
  return cards
}

/** Parse the guest job-posting page: description text plus the criteria list (seniority, type). */
export function parseLinkedInPosting(html: string): { description: string; criteria: string[] } {
  const desc = /class="[^"]*description__text[^"]*"[^>]*>([\s\S]*?)<\/(section|div)>/i.exec(html)?.[1] ?? ''
  const criteria: string[] = []
  for (const m of html.matchAll(/description__job-criteria-text[^>]*>([\s\S]*?)<\//gi)) criteria.push(decode(m[1].replace(/<[^>]+>/g, '')))
  return { description: htmlToText(desc).replace(/\s*Show more\s*Show less\s*$/i, '').trim(), criteria }
}

async function getText(url: string, fetchImpl: typeof fetch): Promise<{ status: number; text: string }> {
  const res = await fetchImpl(url, { headers: { 'user-agent': UA, accept: 'text/html,*/*', 'accept-language': 'en-IE,en;q=0.9' } })
  return { status: res.status, text: res.ok ? await res.text() : '' }
}

export const linkedInAdapter: JobSourceAdapter = {
  id: 'linkedin',
  label: 'LinkedIn public jobs',
  usesQuery: true,
  usesCountry: true,
  isConfigured: () => true,
  async fetch(params: SearchParams, ctx: SourceContext) {
    const country = (params.countryCode ?? ctx.search.countries[0] ?? 'GB').toUpperCase()
    const location = countryName(country) || country
    const url = new URL('https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search')
    url.searchParams.set('keywords', params.query)
    url.searchParams.set('location', location)
    url.searchParams.set('f_TPR', `r${Math.max(1, params.maxDaysOld) * 86_400}`)
    // Easy Apply postings only: those the agent can apply to on LinkedIn itself (the rest
    // usually come in through the company's own ATS board anyway).
    url.searchParams.set('f_AL', 'true')
    url.searchParams.set('start', String((params.page - 1) * PAGE_SIZE))
    const list = await getText(url.toString(), ctx.fetch)
    let requests = 1
    if (list.status === 429 || list.status === 403) throw new SourceError('linkedin', `LinkedIn is rate limiting this IP (HTTP ${list.status}); try again later`, list.status)
    if (list.status !== 200) throw new SourceError('linkedin', `HTTP ${list.status} from the public job search`, list.status)
    const cards = parseLinkedInCards(list.text)
    const cutoff = Date.now() - params.maxDaysOld * 86_400_000
    const jobs: NormalizedJob[] = []
    for (const card of cards) {
      if (card.postedAt && card.postedAt.getTime() < cutoff) continue
      await sleep(DETAIL_PAUSE_MS + Math.random() * 900)
      const detail = await getText(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${card.id}`, ctx.fetch)
      requests++
      if (detail.status === 429) {
        ctx.log('warn', `LinkedIn: rate limited after ${jobs.length} postings; stopping this page`)
        break
      }
      const posting = detail.status === 200 ? parseLinkedInPosting(detail.text) : { description: '', criteria: [] }
      if (posting.description.length < 200) continue
      jobs.push({
        source: 'linkedin',
        externalId: card.id,
        url: card.url,
        title: card.title,
        company: card.company || 'Unknown company',
        location: card.location,
        countryCode: guessCountry(card.location, country),
        remote: isRemoteLocation(card.location) || /\bremote\b/i.test(card.title),
        description: posting.description,
        postedAt: card.postedAt,
        visaSponsorship: null,
        tags: posting.criteria.slice(0, 4),
        raw: { id: card.id, criteria: posting.criteria },
      })
    }
    return { jobs, hasMore: cards.length === PAGE_SIZE, requests }
  },
}
