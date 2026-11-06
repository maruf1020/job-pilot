import { professionDictionary, wordsRegex } from '@/lib/candidate/professions'
import { guessCountry, isRemoteLocation } from '@/lib/geo'
import { decodeEntities, toPlainText } from '@/lib/text'
import { fetchJson, parseDate } from './http'
import { locationAllowed, remoteOpen } from './region-filter'
import type { JobSourceAdapter, NormalizedJob, SearchParams, SourceContext } from './types'

/**
 * Hacker News "Who is hiring?" (the monthly thread by the whoishiring account), through the
 * Algolia HN API. Each top-level comment is one employer; by convention its first line is
 * "Company | Role | Location | REMOTE/VISA | ...". Kept: posts that name one of the person's skills
 * (or, without skills, a word of their field) and mention visa, relocation or sponsorship, or sit in
 * one of their countries.
 */

const ALGOLIA = 'https://hn.algolia.com/api/v1'
/** Developer words, for a software search without skills. */
const DEV_WORDS_RE = /\b(software|engineer|developer|programmer|full[- ]?stack|front[- ]?end|back[- ]?end)\b/i
const VISA_RE = /\b(visa|relocat\w*|sponsor\w*)\b/i
const ROLE_RE = /\b(engineer|developer|programmer|swe|full[- ]?stack|front[- ]?end|back[- ]?end|designer|analyst|scientist|manager|marketer|recruiter|writer|researcher|lead)\b/i

interface HnItem {
  id: number
  author?: string | null
  text?: string | null
  title?: string | null
  created_at?: string
  children?: HnItem[]
}

interface HnSearch {
  hits: Array<{ objectID: string; title?: string; created_at?: string }>
}

/** The first line of a post (before the first paragraph), as plain text. */
export function firstLine(html: string): string {
  const head = html.split(/<p>/i)[0] ?? ''
  return decodeEntities(head.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/** The first link in a post that is not Hacker News itself. */
export function firstLink(html: string): string | null {
  for (const m of html.matchAll(/href="([^"]+)"/gi)) {
    const url = decodeEntities(m[1])
    if (/^https?:\/\//i.test(url) && !/news\.ycombinator\.com/i.test(url)) return url
  }
  return null
}

export interface HnHeader {
  company: string
  title: string
  location: string
}

/** "Acme (YC W21) | Senior Engineer | Berlin or REMOTE (EU) | VISA" -> company, role, location. */
/** `prefer` picks the role among several ("Frontend" for a person with frontend skills). */
export function parseHeader(line: string, prefer?: RegExp | null): HnHeader {
  const segments = line
    .split(/\s+[|•·]\s+|\s+[—–]\s+|\s+-\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const company = (segments[0] ?? '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/https?:\/\/\S+/g, '').trim()
  const rest = segments.slice(1)
  const roleSegment = rest.find((s) => ROLE_RE.test(s)) ?? 'Software Engineer'
  // "Platform & DevOps Engineer, Senior Frontend Engineer, ...": the role naming a preferred word, else the first one.
  const roles = roleSegment.split(/,|;|\s\/\s/).map((s) => s.trim()).filter((s) => ROLE_RE.test(s))
  const title = roles.find((r) => prefer?.test(r)) ?? roles[0] ?? roleSegment
  const placeLike = (s: string) => /\b(remote|onsite|on-site|hybrid|office)\b/i.test(s) || Boolean(guessCountry(s))
  // "PrairieLearn (Remote US) - Engineer": the place can sit in brackets after the company name.
  const bracketed = [...(segments[0] ?? '').matchAll(/\(([^)]*)\)/g)].map((m) => m[1]).find(placeLike)
  const location = rest.find((s) => s !== roleSegment && placeLike(s)) ?? bracketed ?? ''
  return { company, title: title.slice(0, 200), location: location.slice(0, 200) }
}

/** One post as a job, or null when it is not for this candidate. */
/** What a post must name: the person's skills, else their field's words (developer words for software). */
function fieldRegex(search: SourceContext['search'], skills: string[]): RegExp | null {
  if (skills.length) return wordsRegex(skills)
  const p = search.profession ?? 'software'
  if (p === 'software') return DEV_WORDS_RE
  return wordsRegex(professionDictionary(p).titleWords)
}

export function normalizeHnPost(item: HnItem, search: SourceContext['search'], cutoff: number, skills: string[] = []): NormalizedJob | null {
  if (!item.text || !item.id) return null
  const created = parseDate(item.created_at)
  if (created && created.getTime() < cutoff) return null
  const text = toPlainText(item.text)
  const field = fieldRegex(search, skills)
  if (field && !field.test(text)) return null
  const header = parseHeader(firstLine(item.text), field)
  if (!header.company) return null
  const countryCode = guessCountry(header.location)
  const remote = isRemoteLocation(header.location)
  const place = countryCode ? locationAllowed(header.location, search) : remote ? remoteOpen(header.location, search) : false
  // Visa, relocation or sponsorship named anywhere (the prefilter drops "no visa sponsorship"), or one of the searched places.
  if (!VISA_RE.test(text) && !place) return null
  if (header.location && !locationAllowed(header.location, search) && !(remote && remoteOpen(header.location, search))) return null
  return {
    source: 'hn',
    externalId: String(item.id),
    url: firstLink(item.text) ?? `https://news.ycombinator.com/item?id=${item.id}`,
    title: header.title,
    company: header.company.slice(0, 200),
    location: header.location || undefined,
    countryCode,
    remote,
    description: text,
    postedAt: created,
    visaSponsorship: null,
    tags: ['hacker-news'],
    raw: { id: item.id, author: item.author, line: firstLine(item.text).slice(0, 300) },
  }
}

/** The newest "Who is hiring?" threads, newest first. */
async function latestThreads(ctx: SourceContext, count: number): Promise<number[]> {
  const res = await fetchJson<HnSearch>(`${ALGOLIA}/search_by_date?tags=story,author_whoishiring&hitsPerPage=10`, { method: 'GET' }, { source: 'hn', fetchImpl: ctx.fetch })
  return res.hits
    .filter((h) => /^ask hn: who is hiring/i.test(h.title ?? ''))
    .slice(0, count)
    .map((h) => Number(h.objectID))
    .filter(Number.isFinite)
}

export const hnAdapter: JobSourceAdapter = {
  id: 'hn',
  label: 'Hacker News "Who is hiring"',
  usesQuery: false,
  usesCountry: false,
  isConfigured: () => true,
  async fetch(params: SearchParams, ctx: SourceContext) {
    const cutoff = Date.now() - params.maxDaysOld * 86_400_000
    // The current month's thread and the one before: early in a month the new thread is still short.
    const threads = await latestThreads(ctx, 2)
    let requests = 1
    const jobs: NormalizedJob[] = []
    for (const id of threads) {
      const story = await fetchJson<HnItem>(`${ALGOLIA}/items/${id}`, { method: 'GET' }, { source: 'hn', fetchImpl: ctx.fetch, timeoutMs: 60_000 })
      requests++
      for (const post of story.children ?? []) {
        const job = normalizeHnPost(post, ctx.search, cutoff, ctx.skills)
        if (job) jobs.push(job)
      }
    }
    return { jobs, hasMore: false, requests }
  },
}
