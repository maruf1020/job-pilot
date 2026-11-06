import type { AtsType } from '@/lib/domain'
import { guessCountry, isRemoteLocation } from '@/lib/geo'
import { decodeEntities, toPlainText } from '@/lib/text'
import { mapLimit, Semaphore } from '@/lib/utils/semaphore'
import type { SearchConfig } from '@/lib/settings/schema'
import { asString, fetchJson, parseDate, wantedTitle, type TitleSearch } from './http'
import type { AtsCompanyRef, JobSourceAdapter, NormalizedJob, SearchParams, SourceContext } from './types'

/**
 * Direct company job boards. Free, no keys, complete descriptions.
 * One request per company (SmartRecruiters and Workday need one more per new matching posting).
 * Postings already in the database are not ingested again: the board only refreshes their
 * "last seen" date, so a run over thousands of boards costs about one request per board.
 */

/** Board types this adapter reads (same list as the Company.atsType values). */
export type BoardType = AtsType

/** Whether a posting (its full externalId, "type:slug:id") is already in the database. */
export type KnownCheck = (externalId: string) => boolean

interface FetcherResult {
  jobs: NormalizedJob[]
  requests: number
  /** Postings skipped before their detail call because they are already known. */
  known?: string[]
}

type Fetcher = (c: AtsCompanyRef, ctx: SourceContext, maxDaysOld: number, isKnown: KnownCheck) => Promise<FetcherResult>

/** The full externalId of a posting on a company's board. */
export function atsExternalId(c: Pick<AtsCompanyRef, 'atsType' | 'atsSlug'>, id: string): string {
  return `${c.atsType}:${c.atsSlug}:${id}`
}

const base = (c: AtsCompanyRef, externalId: string): Pick<NormalizedJob, 'source' | 'externalId' | 'company' | 'companyId' | 'visaSponsorship'> => ({
  source: 'ats',
  externalId: atsExternalId(c, externalId),
  company: c.name,
  companyId: c.id,
  visaSponsorship: c.knownSponsor ? true : null,
})

const greenhouse: Fetcher = async (c, ctx) => {
  interface GhJob {
    id: number
    title: string
    updated_at: string
    absolute_url: string
    location?: { name?: string }
    content?: string
    departments?: Array<{ name: string }>
  }
  const res = await fetchJson<{ jobs: GhJob[] }>(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(c.atsSlug)}/jobs?content=true`,
    { method: 'GET' },
    { source: 'ats', fetchImpl: ctx.fetch },
  )
  const jobs = (res.jobs ?? [])
    .filter((j) => wantedTitle(j.title, ctx.search))
    .map((j) => {
      const location = asString(j.location?.name)
      return {
        ...base(c, String(j.id)),
        url: j.absolute_url,
        title: j.title,
        location,
        countryCode: guessCountry(location),
        remote: isRemoteLocation(location),
        description: toPlainText(decodeEntities(j.content ?? '')),
        postedAt: parseDate(j.updated_at),
        tags: (j.departments ?? []).map((d) => d.name),
        raw: { id: j.id, title: j.title, location },
      } satisfies NormalizedJob
    })
  return { jobs, requests: 1 }
}

const lever: Fetcher = async (c, ctx) => {
  interface LeverJob {
    id: string
    text: string
    categories?: { location?: string; team?: string; commitment?: string; allLocations?: string[] }
    descriptionPlain?: string
    description?: string
    lists?: Array<{ text: string; content: string }>
    hostedUrl: string
    applyUrl?: string
    createdAt?: number
    workplaceType?: string
    country?: string
  }
  const { slug, eu } = leverSlug(c.atsSlug)
  const res = await fetchJson<LeverJob[]>(
    `https://api${eu ? '.eu' : ''}.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`,
    { method: 'GET' },
    { source: 'ats', fetchImpl: ctx.fetch },
  )
  const jobs = (Array.isArray(res) ? res : [])
    .filter((j) => wantedTitle(j.text, ctx.search))
    .map((j) => {
      const location = asString(j.categories?.location)
      const lists = (j.lists ?? []).map((l) => `${l.text}\n${toPlainText(l.content)}`).join('\n\n')
      const description = [j.descriptionPlain ?? toPlainText(j.description ?? ''), lists].filter(Boolean).join('\n\n')
      return {
        ...base(c, j.id),
        url: j.hostedUrl,
        title: j.text,
        location,
        countryCode: (j.country && j.country.length === 2 ? j.country.toUpperCase() : undefined) ?? guessCountry(location),
        remote: j.workplaceType === 'remote' || isRemoteLocation(location),
        description,
        postedAt: parseDate(j.createdAt),
        tags: [j.categories?.team, j.categories?.commitment].filter(Boolean).map(String),
        raw: { id: j.id, title: j.text, location },
      } satisfies NormalizedJob
    })
  return { jobs, requests: 1 }
}

const ashby: Fetcher = async (c, ctx) => {
  interface AshbyJob {
    id: string
    title: string
    location?: string
    secondaryLocations?: Array<{ location: string }>
    department?: string
    team?: string
    isRemote?: boolean
    descriptionHtml?: string
    descriptionPlain?: string
    publishedAt?: string
    jobUrl: string
    applyUrl?: string
    compensation?: { compensationTierSummary?: string }
  }
  const res = await fetchJson<{ jobs: AshbyJob[] }>(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(c.atsSlug)}?includeCompensation=true`,
    { method: 'GET' },
    { source: 'ats', fetchImpl: ctx.fetch },
  )
  const jobs = (res.jobs ?? [])
    .filter((j) => wantedTitle(j.title, ctx.search))
    .map((j) => {
      const location = asString(j.location)
      return {
        ...base(c, j.id),
        url: j.jobUrl,
        title: j.title,
        location,
        countryCode: guessCountry(location),
        remote: Boolean(j.isRemote) || isRemoteLocation(location),
        description: j.descriptionPlain ?? toPlainText(j.descriptionHtml ?? ''),
        postedAt: parseDate(j.publishedAt),
        tags: [j.department, j.team, j.compensation?.compensationTierSummary].filter(Boolean).map(String),
        raw: { id: j.id, title: j.title, location },
      } satisfies NormalizedJob
    })
  return { jobs, requests: 1 }
}

const WORKABLE_GATE = new Semaphore(1)
const WORKABLE_GAP_MS = 4000

const workable: Fetcher = async (c, ctx) => {
  interface WkJob {
    title: string
    shortcode: string
    url: string
    application_url?: string
    description?: string
    requirements?: string
    benefits?: string
    city?: string
    state?: string
    country?: string
    telecommuting?: boolean
    published_on?: string
    department?: string
    employment_type?: string
  }
  // Workable answers 429 when several boards are read at once (107 boards once failed that way):
  // one Workable read at a time, 4 s apart (Cloudflare 1015 bans the IP at a faster pace, which also blocks
  // the Workable application forms for a while).
  const res = await WORKABLE_GATE.run(async () => {
    try {
      return await fetchJson<{ jobs: WkJob[] }>(
        `https://www.workable.com/api/accounts/${encodeURIComponent(c.atsSlug)}?details=true`,
        { method: 'GET' },
        { source: 'ats', fetchImpl: ctx.fetch, retries: 3 },
      )
    } finally {
      await new Promise((r) => setTimeout(r, WORKABLE_GAP_MS))
    }
  })
  const jobs = (res.jobs ?? [])
    .filter((j) => wantedTitle(j.title, ctx.search))
    .map((j) => {
      const location = [j.city, j.state, j.country].filter(Boolean).join(', ')
      const description = [j.description, j.requirements, j.benefits].filter(Boolean).map((h) => toPlainText(h!)).join('\n\n')
      return {
        ...base(c, j.shortcode),
        url: j.url,
        title: j.title,
        location,
        countryCode: guessCountry(location),
        remote: Boolean(j.telecommuting) || isRemoteLocation(location),
        description,
        postedAt: parseDate(j.published_on),
        tags: [j.department, j.employment_type].filter(Boolean).map(String),
        raw: { shortcode: j.shortcode, title: j.title, location },
      } satisfies NormalizedJob
    })
  return { jobs, requests: 1 }
}

const smartrecruiters: Fetcher = async (c, ctx, maxDaysOld, isKnown) => {
  interface SrPosting {
    id: string
    name: string
    releasedDate?: string
    location?: { city?: string; country?: string; remote?: boolean; region?: string }
    ref?: string
  }
  interface SrDetail {
    applyUrl?: string
    jobAd?: { sections?: Record<string, { title?: string; text?: string }> }
  }
  const cutoff = Date.now() - maxDaysOld * 86_400_000
  const list = await fetchJson<{ content: SrPosting[] }>(
    `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(c.atsSlug)}/postings?limit=100&releasedAfter=${encodeURIComponent(new Date(cutoff).toISOString())}`,
    { method: 'GET' },
    { source: 'ats', fetchImpl: ctx.fetch },
  )
  const known: string[] = []
  const candidates = (list.content ?? [])
    .filter((p) => wantedTitle(p.name, ctx.search))
    .filter((p) => {
      const d = parseDate(p.releasedDate)
      return !d || d.getTime() >= cutoff
    })
    // A posting already in the database needs no detail call: the list proves it is still open.
    .filter((p) => {
      const id = atsExternalId(c, p.id)
      if (!isKnown(id)) return true
      known.push(id)
      return false
    })
    .slice(0, 25)
  let requests = 1
  const jobs: NormalizedJob[] = []
  for (const p of candidates) {
    try {
      const detail = await fetchJson<SrDetail>(
        `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(c.atsSlug)}/postings/${encodeURIComponent(p.id)}`,
        { method: 'GET' },
        { source: 'ats', fetchImpl: ctx.fetch, retries: 0 },
      )
      requests++
      const sections = Object.values(detail.jobAd?.sections ?? {})
      const description = sections.map((s) => `${s.title ?? ''}\n${toPlainText(s.text ?? '')}`.trim()).join('\n\n')
      const location = [p.location?.city, p.location?.region, p.location?.country].filter(Boolean).join(', ')
      const cc = p.location?.country && p.location.country.length === 2 ? p.location.country.toUpperCase() : undefined
      jobs.push({
        ...base(c, p.id),
        url: detail.applyUrl ?? `https://jobs.smartrecruiters.com/${encodeURIComponent(c.atsSlug)}/${p.id}`,
        title: p.name,
        location,
        countryCode: cc ?? guessCountry(location),
        remote: Boolean(p.location?.remote) || isRemoteLocation(location),
        description,
        postedAt: parseDate(p.releasedDate),
        tags: [],
        raw: { id: p.id, title: p.name, location },
      })
    } catch (err) {
      ctx.log('warn', `SmartRecruiters posting ${p.id} failed: ${err instanceof Error ? err.message : err}`)
    }
  }
  return { jobs, requests, known }
}

/** Recruitee: public offers API per company subdomain (https://<slug>.recruitee.com/api/offers/). */
const recruitee: Fetcher = async (c, ctx) => {
  interface RtOffer {
    id: number
    title: string
    slug: string
    careers_url?: string
    description?: string
    requirements?: string
    city?: string
    country?: string
    country_code?: string
    remote?: boolean
    department?: string
    published_at?: string
    created_at?: string
  }
  const res = await fetchJson<{ offers: RtOffer[] }>(`https://${encodeURIComponent(c.atsSlug)}.recruitee.com/api/offers/`, { method: 'GET' }, { source: 'ats', fetchImpl: ctx.fetch })
  const jobs = (res.offers ?? [])
    .filter((o) => wantedTitle(o.title, ctx.search))
    .map((o) => {
      const location = [o.city, o.country].filter(Boolean).join(', ')
      return {
        ...base(c, String(o.id)),
        url: o.careers_url ?? `https://${c.atsSlug}.recruitee.com/o/${o.slug}`,
        title: o.title,
        location: location || (o.remote ? 'Remote' : undefined),
        countryCode: o.country_code?.toUpperCase() ?? guessCountry(location),
        remote: Boolean(o.remote) || isRemoteLocation(location),
        description: toPlainText(`${o.description ?? ''}\n${o.requirements ?? ''}`),
        postedAt: parseDate(o.published_at ?? o.created_at),
        tags: [o.department ?? ''].filter(Boolean),
        raw: { id: o.id, title: o.title, location },
      } satisfies NormalizedJob
    })
  return { jobs, requests: 1 }
}

/**
 * Workday: every tenant exposes the same JSON API the career site uses.
 * atsSlug is "tenant/site@wdN", e.g. "mastercard/CorporateCareers@wd1"
 * (https://mastercard.wd1.myworkdayjobs.com/CorporateCareers).
 */
/** Workday search terms: the first two search queries, or developer words for a software search without queries. */
export function workdaySearchTerms(search: Partial<Pick<SearchConfig, 'queries' | 'profession'>> | null | undefined): string[] {
  const qs = (search?.queries ?? []).filter((q) => q.trim()).slice(0, 2)
  if (qs.length) return qs
  return (search?.profession ?? 'software') === 'software' ? ['software engineer', 'developer'] : ['']
}

export function parseWorkdaySlug(slug: string): { tenant: string; site: string; wd: string } | null {
  const m = /^([a-z0-9-]+)\/([A-Za-z0-9_-]+)@(wd\d+)$/i.exec(slug.trim())
  return m ? { tenant: m[1].toLowerCase(), site: m[2], wd: m[3].toLowerCase() } : null
}

const workday: Fetcher = async (c, ctx, maxDaysOld, isKnown) => {
  const parsed = parseWorkdaySlug(c.atsSlug)
  if (!parsed) throw new Error(`Workday slug must look like "tenant/site@wd1", got "${c.atsSlug}"`)
  const host = `https://${parsed.tenant}.${parsed.wd}.myworkdayjobs.com`
  const api = `${host}/wday/cxs/${parsed.tenant}/${parsed.site}`
  interface WdPosting {
    title: string
    externalPath: string
    locationsText?: string
    postedOn?: string
    bulletFields?: string[]
  }
  interface WdDetail {
    jobPostingInfo?: { title?: string; jobDescription?: string; location?: string; additionalLocations?: string[]; country?: { descriptor?: string }; startDate?: string; externalUrl?: string; jobReqId?: string }
  }
  const jobs: NormalizedJob[] = []
  const known: string[] = []
  let requests = 0
  const cutoff = Date.now() - maxDaysOld * 86_400_000
  // Workday search: a few engineering keywords, 20 per page, at most 3 pages each.
  const seen = new Set<string>()
  for (const searchText of workdaySearchTerms(ctx.search)) {
    for (let offset = 0; offset < 60; offset += 20) {
      const res = await fetchJson<{ total?: number; jobPostings?: WdPosting[] }>(
        `${api}/jobs`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText }) },
        { source: 'ats', fetchImpl: ctx.fetch },
      )
      requests++
      const postings = res.jobPostings ?? []
      for (const p of postings) {
        if (!wantedTitle(p.title, ctx.search) || seen.has(p.externalPath)) continue
        seen.add(p.externalPath)
        // "Posted Today" / "Posted 3 Days Ago" / "Posted 30+ Days Ago": skip the clearly old ones before the detail call.
        const days = /(\d+)\+?\s*Days?/i.exec(p.postedOn ?? '')?.[1]
        if (days && Number(days) > maxDaysOld) continue
        // Known postings skip the detail call (the requisition id is in the list row).
        const knownId = [p.bulletFields?.[0], p.externalPath].filter((x): x is string => Boolean(x)).map((x) => atsExternalId(c, x)).find(isKnown)
        if (knownId) {
          known.push(knownId)
          continue
        }
        try {
          const d = await fetchJson<WdDetail>(`${api}${p.externalPath}`, { method: 'GET' }, { source: 'ats', fetchImpl: ctx.fetch, retries: 0 })
          requests++
          const info = d.jobPostingInfo
          if (!info?.jobDescription) continue
          const postedAt = parseDate(info.startDate)
          if (postedAt && postedAt.getTime() < cutoff) continue
          const location = asString(info.location) || asString(p.locationsText)
          jobs.push({
            ...base(c, p.bulletFields?.[0] ?? info.jobReqId ?? p.externalPath),
            url: info.externalUrl ?? `${host}/${parsed.site}${p.externalPath}`,
            title: info.title ?? p.title,
            location,
            countryCode: guessCountry(info.country?.descriptor ?? location),
            remote: isRemoteLocation(location),
            description: toPlainText(decodeEntities(info.jobDescription)),
            postedAt,
            tags: (info.additionalLocations ?? []).slice(0, 3),
            raw: { path: p.externalPath, reqId: info.jobReqId, country: info.country?.descriptor },
          })
        } catch (err) {
          ctx.log('debug', `${c.name}: Workday detail failed for ${p.externalPath}: ${err instanceof Error ? err.message : err}`)
        }
      }
      if (postings.length < 20) break
    }
  }
  return { jobs, requests, known }
}

function escapeTag(tag: string): string {
  return tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** First `<tag>...</tag>` inside an XML block, CDATA unwrapped, entities decoded. */
export function xmlText(block: string, tag: string): string {
  const t = escapeTag(tag)
  const m = new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`, 'i').exec(block)
  if (!m) return ''
  const inner = m[1].trim()
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(inner)
  return cdata ? cdata[1] : decodeEntities(inner)
}

function xmlBlocks(xml: string, tag: string): string[] {
  const t = escapeTag(tag)
  return [...xml.matchAll(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`, 'gi'))].map((m) => m[1])
}

/** Personio: the public XML feed a company can switch on ({slug}.jobs.personio.de/xml). */
export function parsePersonioXml(xml: string, c: AtsCompanyRef, search?: TitleSearch): NormalizedJob[] {
  const out: NormalizedJob[] = []
  for (const pos of xmlBlocks(xml, 'position')) {
    const id = xmlText(pos, 'id')
    const title = xmlText(pos, 'name')
    if (!id || !title || !wantedTitle(title, search)) continue
    const office = xmlText(pos, 'office')
    const sections = xmlBlocks(pos, 'jobDescription').map((d) => `${xmlText(d, 'name')}\n${toPlainText(xmlText(d, 'value'))}`.trim())
    const keywords = xmlText(pos, 'keywords')
    out.push({
      ...base(c, id),
      url: `https://${c.atsSlug}.jobs.personio.com/job/${id}?language=en`,
      title,
      location: office || undefined,
      countryCode: guessCountry(office),
      remote: isRemoteLocation(office),
      description: sections.join('\n\n'),
      postedAt: parseDate(xmlText(pos, 'createdAt')),
      tags: [xmlText(pos, 'department'), xmlText(pos, 'seniority'), xmlText(pos, 'employmentType'), ...keywords.split(',')].map((t) => t.trim()).filter(Boolean).slice(0, 10),
      raw: { id, title, office },
    })
  }
  return out
}

const personio: Fetcher = async (c, ctx) => {
  const res = await ctx.fetch(`https://${encodeURIComponent(c.atsSlug)}.jobs.personio.de/xml?language=en`, { headers: { accept: 'application/xml,text/xml' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${c.atsSlug}.jobs.personio.de`)
  return { jobs: parsePersonioXml(await res.text(), c, ctx.search), requests: 1 }
}

/** Teamtailor: every career site publishes an RSS feed of its open jobs ({slug}.teamtailor.com/jobs.rss). */
export function parseTeamtailorRss(xml: string, c: AtsCompanyRef, search?: TitleSearch): NormalizedJob[] {
  const out: NormalizedJob[] = []
  for (const item of xmlBlocks(xml, 'item')) {
    const title = xmlText(item, 'title')
    const link = xmlText(item, 'link')
    const id = /\/jobs\/(\d+)/.exec(link)?.[1] ?? xmlText(item, 'guid')
    if (!title || !link || !id || !wantedTitle(title, search)) continue
    const places = xmlBlocks(item, 'tt:location').map((l) => [xmlText(l, 'tt:city'), xmlText(l, 'tt:country')].filter(Boolean).join(', '))
    const remoteStatus = xmlText(item, 'remoteStatus')
    const location = places[0] || (remoteStatus === 'fully' ? 'Remote' : '')
    out.push({
      ...base(c, id),
      url: link,
      title,
      location: location || undefined,
      countryCode: guessCountry(places.join('; ')),
      remote: remoteStatus === 'fully' || isRemoteLocation(location),
      description: toPlainText(xmlText(item, 'description')),
      postedAt: parseDate(xmlText(item, 'pubDate')),
      tags: [xmlText(item, 'tt:department'), remoteStatus].filter(Boolean),
      raw: { id, title, places },
    })
  }
  return out
}

const teamtailor: Fetcher = async (c, ctx) => {
  const res = await ctx.fetch(`https://${encodeURIComponent(c.atsSlug)}.teamtailor.com/jobs.rss`, { headers: { accept: 'application/rss+xml,application/xml' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${c.atsSlug}.teamtailor.com`)
  return { jobs: parseTeamtailorRss(await res.text(), c, ctx.search), requests: 1 }
}

/** Lever's EU instance keeps the slug with an "@eu" mark ("acme@eu" reads api.eu.lever.co). */
export function leverSlug(slug: string): { slug: string; eu: boolean } {
  return slug.endsWith('@eu') ? { slug: slug.slice(0, -3), eu: true } : { slug, eu: false }
}

/**
 * BambooHR: the career page's own JSON, https://<slug>.bamboohr.com/careers/list. The list has no country or text, so each
 * engineering posting not yet known gets one detail call (/careers/<id>/detail) for its country, date and description.
 */
const bamboohr: Fetcher = async (c, ctx, _maxDaysOld, isKnown) => {
  interface BbJob {
    id: string
    jobOpeningName: string
    departmentLabel?: string | null
    employmentStatusLabel?: string | null
    location?: { city?: string | null; state?: string | null }
    isRemote?: boolean | null
  }
  interface BbOpening {
    jobOpeningShareUrl?: string
    description?: string
    datePosted?: string
    location?: { city?: string | null; state?: string | null; addressCountry?: string | null }
  }
  const host = `https://${encodeURIComponent(c.atsSlug)}.bamboohr.com`
  const list = await fetchJson<{ result?: BbJob[] }>(`${host}/careers/list`, { method: 'GET' }, { source: 'ats', fetchImpl: ctx.fetch })
  if (!Array.isArray(list?.result)) throw new Error(`${c.atsSlug}.bamboohr.com has no careers list`)
  const known: string[] = []
  const candidates = list.result
    .filter((j) => wantedTitle(j.jobOpeningName, ctx.search))
    .filter((j) => {
      const id = atsExternalId(c, String(j.id))
      if (!isKnown(id)) return true
      known.push(id)
      return false
    })
    .slice(0, 25)
  let requests = 1
  const jobs: NormalizedJob[] = []
  for (const j of candidates) {
    let detail: BbOpening | undefined
    try {
      detail = (await fetchJson<{ result?: { jobOpening?: BbOpening } }>(`${host}/careers/${encodeURIComponent(String(j.id))}/detail`, { method: 'GET' }, { source: 'ats', fetchImpl: ctx.fetch, retries: 0 })).result?.jobOpening
      requests++
    } catch (err) {
      ctx.log('warn', `BambooHR posting ${j.id} failed: ${err instanceof Error ? err.message : err}`)
    }
    const loc = detail?.location ?? j.location
    const country = detail?.location?.addressCountry
    const location = [loc?.city, loc?.state, country].filter(Boolean).join(', ')
    jobs.push({
      ...base(c, String(j.id)),
      url: detail?.jobOpeningShareUrl ?? `${host}/careers/${j.id}`,
      title: j.jobOpeningName,
      location: location || (j.isRemote ? 'Remote' : undefined),
      countryCode: guessCountry(location),
      remote: Boolean(j.isRemote) || isRemoteLocation(location),
      description: toPlainText(decodeEntities(detail?.description ?? '')),
      postedAt: parseDate(detail?.datePosted),
      tags: [j.departmentLabel, j.employmentStatusLabel].filter(Boolean).map(String),
      raw: { id: j.id, title: j.jobOpeningName, location },
    })
  }
  return { jobs, requests, known }
}

/** Breezy HR: the public positions JSON, https://<slug>.breezy.hr/json (country as an ISO code; no description in the list). */
const breezy: Fetcher = async (c, ctx) => {
  interface BzLocation {
    name?: string
    city?: string
    is_remote?: boolean
    country?: { id?: string; name?: string }
  }
  interface BzJob {
    id: string
    friendly_id?: string
    name: string
    url?: string
    published_date?: string
    department?: string
    type?: { name?: string }
    location?: BzLocation
    locations?: BzLocation[]
  }
  const res = await fetchJson<BzJob[]>(`https://${encodeURIComponent(c.atsSlug)}.breezy.hr/json`, { method: 'GET' }, { source: 'ats', fetchImpl: ctx.fetch })
  if (!Array.isArray(res)) throw new Error(`${c.atsSlug}.breezy.hr returned no positions list`)
  const jobs = res
    .filter((j) => wantedTitle(j.name, ctx.search))
    .map((j) => {
      const all = [j.location, ...(j.locations ?? [])].filter((l): l is BzLocation => Boolean(l))
      const place = all.find((l) => l.country?.id && l.country.id.length === 2) ?? all[0]
      const location = place?.name ?? [place?.city, place?.country?.name].filter(Boolean).join(', ')
      const code = place?.country?.id && place.country.id.length === 2 ? place.country.id.toUpperCase() : undefined
      return {
        ...base(c, j.friendly_id ?? j.id),
        url: j.url ?? `https://${c.atsSlug}.breezy.hr/p/${j.friendly_id ?? j.id}`,
        title: j.name,
        location: location || undefined,
        countryCode: code ?? guessCountry(location),
        remote: all.some((l) => l.is_remote) || isRemoteLocation(location),
        description: '',
        postedAt: parseDate(j.published_date),
        tags: [j.department, j.type?.name].filter(Boolean).map(String),
        raw: { id: j.id, title: j.name, location },
      } satisfies NormalizedJob
    })
  return { jobs, requests: 1 }
}

/** Pinpoint: the public postings JSON, https://<slug>.pinpointhq.com/postings.json (full descriptions included). */
const pinpoint: Fetcher = async (c, ctx) => {
  interface PpJob {
    id: string
    title: string
    url?: string
    path?: string
    description?: string | null
    key_responsibilities?: string | null
    skills_knowledge_expertise?: string | null
    employment_type_text?: string | null
    workplace_type?: string | null
    job?: { department?: { name?: string } | null } | null
    location?: { name?: string | null; city?: string | null; province?: string | null } | null
  }
  const res = await fetchJson<{ data?: PpJob[] }>(`https://${encodeURIComponent(c.atsSlug)}.pinpointhq.com/postings.json`, { method: 'GET' }, { source: 'ats', fetchImpl: ctx.fetch })
  if (!Array.isArray(res?.data)) throw new Error(`${c.atsSlug}.pinpointhq.com returned no postings`)
  const jobs = res.data
    .filter((j) => wantedTitle(j.title, ctx.search))
    .map((j) => {
      const location = j.location?.name ?? [j.location?.city, j.location?.province].filter(Boolean).join(', ')
      const description = [j.description, j.key_responsibilities, j.skills_knowledge_expertise]
        .filter(Boolean)
        .map((h) => toPlainText(decodeEntities(h!)))
        .join('\n\n')
      return {
        ...base(c, String(j.id)),
        url: j.url ?? `https://${c.atsSlug}.pinpointhq.com${j.path ?? ''}`,
        title: j.title,
        location: location || undefined,
        countryCode: guessCountry(location),
        remote: j.workplace_type === 'remote' || isRemoteLocation(location),
        description,
        tags: [j.job?.department?.name, j.employment_type_text].filter(Boolean).map(String),
        raw: { id: j.id, title: j.title, location },
      } satisfies NormalizedJob
    })
  return { jobs, requests: 1 }
}

/** One page of a JOIN company page: its jobs and name, from the Next.js data embedded in the HTML (no key needed). */
export interface JoinPage {
  name: string | null
  pageCount: number
  jobs: Array<{
    id: number
    idParam: string
    title: string
    createdAt?: string
    remoteType?: string | null
    workplaceType?: string | null
    city?: { cityName?: string | null; countryName?: string | null } | null
    country?: { iso3166?: string | null } | null
    employmentType?: { name?: string } | null
    category?: { name?: string } | null
  }>
}

export function parseJoinCompanyPage(html: string): JoinPage | null {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)
  if (!m) return null
  try {
    const state = (JSON.parse(m[1]) as { props?: { pageProps?: { initialState?: { jobs?: { items?: JoinPage['jobs']; pagination?: { pageCount?: number } }; company?: { name?: string } } } } }).props?.pageProps?.initialState
    if (!state?.jobs || !Array.isArray(state.jobs.items)) return null
    return { name: state.company?.name ?? null, pageCount: Math.max(1, state.jobs.pagination?.pageCount ?? 1), jobs: state.jobs.items }
  } catch {
    return null
  }
}

/** JOIN: https://join.com/companies/<slug>; the job list is read from the page's embedded data, a page at a time (no descriptions). */
const join: Fetcher = async (c, ctx) => {
  const url = (page: number) => `https://join.com/companies/${encodeURIComponent(c.atsSlug)}${page > 1 ? `?page=${page}` : ''}`
  const jobs: NormalizedJob[] = []
  let requests = 0
  let pages = 1
  for (let page = 1; page <= Math.min(pages, 10); page++) {
    const res = await ctx.fetch(url(page), { headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 (compatible; job-pilot/1.0)' } })
    requests++
    if (!res.ok) throw new Error(`HTTP ${res.status} from join.com/companies/${c.atsSlug}`)
    const parsed = parseJoinCompanyPage(await res.text())
    if (!parsed) throw new Error(`join.com/companies/${c.atsSlug} has no job list`)
    pages = parsed.pageCount
    for (const j of parsed.jobs) {
      if (!wantedTitle(j.title, ctx.search)) continue
      const location = [j.city?.cityName, j.city?.countryName].filter(Boolean).join(', ')
      const code = j.country?.iso3166 && j.country.iso3166.length === 2 ? j.country.iso3166.toUpperCase() : undefined
      jobs.push({
        ...base(c, String(j.id)),
        url: `https://join.com/companies/${c.atsSlug}/${j.idParam}`,
        title: j.title,
        location: location || undefined,
        countryCode: code ?? guessCountry(location),
        remote: /remote/i.test(`${j.workplaceType ?? ''} ${j.remoteType ?? ''}`) || isRemoteLocation(location),
        description: '',
        postedAt: parseDate(j.createdAt),
        tags: [j.category?.name, j.employmentType?.name].filter(Boolean).map(String),
        raw: { id: j.id, title: j.title, location },
      })
    }
  }
  return { jobs, requests }
}

const FETCHERS: Record<AtsType, Fetcher> = { greenhouse, lever, ashby, workable, smartrecruiters, recruitee, personio, teamtailor, workday, bamboohr, breezy, pinpoint, join }

export function atsBoardUrl(atsType: AtsType, slug: string): string {
  switch (atsType) {
    case 'greenhouse':
      return `https://boards.greenhouse.io/${slug}`
    case 'lever': {
      const l = leverSlug(slug)
      return `https://jobs${l.eu ? '.eu' : ''}.lever.co/${l.slug}`
    }
    case 'ashby':
      return `https://jobs.ashbyhq.com/${slug}`
    case 'workable':
      return `https://apply.workable.com/${slug}`
    case 'smartrecruiters':
      return `https://jobs.smartrecruiters.com/${slug}`
    case 'recruitee':
      return `https://${slug}.recruitee.com`
    case 'personio':
      return `https://${slug}.jobs.personio.com`
    case 'teamtailor':
      return `https://${slug}.teamtailor.com/jobs`
    case 'bamboohr':
      return `https://${slug}.bamboohr.com/careers`
    case 'breezy':
      return `https://${slug}.breezy.hr`
    case 'pinpoint':
      return `https://${slug}.pinpointhq.com`
    case 'join':
      return `https://join.com/companies/${slug}`
    case 'workday': {
      const p = parseWorkdaySlug(slug)
      return p ? `https://${p.tenant}.${p.wd}.myworkdayjobs.com/${p.site}` : `https://www.myworkdayjobs.com/`
    }
  }
}

/**
 * Fetch a single company board (used by the "fetch this board" button and by the adapter).
 * `isKnown` lets fetchers skip detail calls for postings already in the database; those come
 * back in `known` instead of `jobs`.
 */
export async function fetchCompanyBoard(c: AtsCompanyRef, ctx: SourceContext, maxDaysOld: number, isKnown: KnownCheck = () => false) {
  const fetcher = FETCHERS[c.atsType]
  if (!fetcher) throw new Error(`Unsupported ATS type: ${c.atsType}`)
  const { jobs, requests, known = [] } = await fetcher(c, ctx, maxDaysOld, isKnown)
  const cutoff = Date.now() - maxDaysOld * 86_400_000
  return { jobs: jobs.filter((j) => !j.postedAt || j.postedAt.getTime() >= cutoff), requests, known }
}

/** Boards read at the same time (each board is one or a few requests to a different host). */
const BOARD_CONCURRENCY = 6

export const atsAdapter: JobSourceAdapter = {
  id: 'ats',
  label: 'Company ATS boards',
  usesQuery: false,
  usesCountry: false,
  isConfigured: (ctx) => (ctx.atsCompanies?.length ?? 0) > 0,
  async fetch(params: SearchParams, ctx: SourceContext) {
    const jobs: NormalizedJob[] = []
    let requests = 0
    let skippedKnown = 0
    // Postings already in the database (externalId -> jobId). Null: read every posting as before.
    const known = ctx.atsKnown !== undefined ? ctx.atsKnown : await loadKnown(ctx)
    const touch = ctx.atsTouchKnown ?? (known ? defaultTouch : null)
    const isKnown: KnownCheck = (id) => Boolean(known?.has(id))
    await mapLimit(ctx.atsCompanies ?? [], BOARD_CONCURRENCY, async (c) => {
      try {
        const r = await fetchCompanyBoard(c, ctx, params.maxDaysOld, isKnown)
        const fresh = r.jobs.filter((j) => !isKnown(j.externalId))
        const seen = [...r.known, ...r.jobs.filter((j) => isKnown(j.externalId)).map((j) => j.externalId)]
        jobs.push(...fresh)
        requests += r.requests
        skippedKnown += seen.length
        if (seen.length && touch && known) {
          const jobIds = seen.map((id) => known.get(id)).filter((x): x is string => Boolean(x))
          await touch(seen, jobIds).catch(() => undefined)
        }
        ctx.log('debug', `${c.name} (${c.atsType}): ${fresh.length} new, ${seen.length} known engineering roles`)
        await ctx.onAtsCompanyDone?.(c.id, { found: fresh.length + seen.length })
      } catch (err) {
        requests++
        const message = err instanceof Error ? err.message : String(err)
        ctx.log('warn', `${c.name} (${c.atsType}/${c.atsSlug}) failed: ${message}`, { companyId: c.id })
        await ctx.onAtsCompanyDone?.(c.id, { found: 0, error: message })
      }
    })
    if (skippedKnown) ctx.log('info', `Company ATS boards: ${skippedKnown} posting(s) already known (only their "last seen" date was refreshed), ${jobs.length} new`)
    return { jobs, hasMore: false, requests }
  },
}

/** The known ATS postings from the database; null when the database cannot be read (then every posting is read). */
async function loadKnown(ctx: SourceContext): Promise<Map<string, string> | null> {
  try {
    const { loadKnownAtsPostings } = await import('./ats-known')
    return await loadKnownAtsPostings()
  } catch (err) {
    ctx.log('debug', `ATS boards: reading every posting (known list unavailable: ${err instanceof Error ? err.message : err})`)
    return null
  }
}

async function defaultTouch(externalIds: string[], jobIds: string[]): Promise<void> {
  const { touchKnownAtsPostings } = await import('./ats-known')
  await touchKnownAtsPostings(externalIds, jobIds)
}
