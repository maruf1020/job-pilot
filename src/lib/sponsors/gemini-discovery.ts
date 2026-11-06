import { z } from 'zod'
import { db } from '@/lib/db'
import type { CandidateContext } from '@/lib/candidate/context'
import type { AtsType } from '@/lib/domain'
import { atsBoardUrl } from '@/lib/sources/ats'
import { normalizeCompany } from '@/lib/text'
import { mapLimit } from '@/lib/utils/semaphore'
import { boardFromUrl } from './board-registry'
import { probeBoard } from './boards'

/**
 * More company boards through Gemini. Company ATS boards are the best source (every search run reads them),
 * so Gemini only proposes boards:
 *
 * - suggest: from its own knowledge, companies in a country that hire people like the candidate (the focus
 *   text is built from the profile's target titles and skills), with their ATS and board slug;
 * - search: Google Search grounding for open postings on ATS sites, whose links name the board.
 *
 * Nothing is trusted as is: every proposed board is checked against the ATS's public API and only added
 * when it answers with live jobs. Boards become sources the same way probe/job-link boards do.
 */

const SUGGEST_ATS = ['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'recruitee'] as const

// Plain strings only: Gemini's schema converter rejects enum/length limits here (400 INVALID_ARGUMENT).
const suggestSchema = z.object({
  companies: z.array(z.object({ name: z.string(), ats: z.string(), slug: z.string() })),
})

export interface Candidate {
  atsType: AtsType
  slug: string
  name: string | null
}

export interface GeminiDiscoveryResult {
  proposed: number
  alreadyKnown: number
  verified: number
  added: number
  dead: number
  addedBoards: string[]
}

/** Board links in free text ("https://jobs.lever.co/acme/..."), as board refs. */
export function boardsInText(text: string): Candidate[] {
  const out = new Map<string, Candidate>()
  for (const m of text.matchAll(/https?:\/\/[^\s)\]>"'`,]+/g)) {
    const ref = boardFromUrl(m[0])
    if (ref) out.set(`${ref.atsType}:${ref.slug.toLowerCase()}`, { atsType: ref.atsType, slug: ref.slug.toLowerCase(), name: null })
  }
  return [...out.values()]
}

/** "Senior Product Designer, UX Designer (Figma, user research)": who the boards should hire, from the profile. */
export function candidateFocus(ctx: Pick<CandidateContext, 'titles' | 'skills' | 'professionNoun'>): string {
  const titles = ctx.titles.slice(0, 4)
  const skills = ctx.skills.slice(0, 6)
  const who = titles.length ? titles.join(', ') : `${ctx.professionNoun || 'professional'}s`
  return skills.length ? `${who} (${skills.join(', ')})` : who
}

/** The focus and whether visa sponsors matter, from the candidate's profile. */
async function profileFocus(): Promise<{ focus: string; sponsors: boolean }> {
  const { loadCandidateContext } = await import('@/lib/candidate/load')
  const ctx = await loadCandidateContext()
  return { focus: candidateFocus(ctx), sponsors: ctx.workAuth.needsSponsorship === true }
}

export async function suggestFromKnowledge(country: string, focus: string, exclude: string[], opts: { sponsors?: boolean } = {}): Promise<Candidate[]> {
  const { generateJson } = await import('@/lib/ai/gemini')
  const { data } = await generateJson({
    task: 'enrich',
    model: 'lite',
    temperature: 0.4,
    schema: suggestSchema,
    system: 'You know which companies use which applicant tracking systems. Only list companies you are reasonably sure about; never invent companies.',
    prompt: [
      `List up to 40 companies with offices or remote hiring in ${country} that hire ${focus} and publish jobs on one of these ATS boards: ${SUGGEST_ATS.join(', ')}.`,
      'For each give the company name, the ATS and the board slug exactly as it appears in the board URL (e.g. https://boards.greenhouse.io/<slug>, https://jobs.lever.co/<slug>, https://jobs.ashbyhq.com/<slug>, https://apply.workable.com/<slug>, https://jobs.smartrecruiters.com/<slug>, https://<slug>.recruitee.com).',
      `Prefer established employers and scale-ups${opts.sponsors ? ' and companies known to sponsor visas' : ''}. Skip staffing agencies.`,
      exclude.length ? `Do not repeat these: ${exclude.slice(0, 150).join(', ')}` : '',
    ].join('\n'),
  })
  return data.companies
    .map((c) => ({ atsType: c.ats.toLowerCase().trim() as AtsType, slug: c.slug.toLowerCase().trim(), name: c.name.trim().slice(0, 120) || null }))
    .filter((c) => (SUGGEST_ATS as readonly string[]).includes(c.atsType) && c.slug.length >= 2)
    .slice(0, 60)
}

async function searchWithGoogle(query: string, country: string): Promise<Candidate[]> {
  const { generateText } = await import('@/lib/ai/gemini')
  const { text } = await generateText({
    task: 'enrich',
    model: 'lite',
    temperature: 0.2,
    webSearch: true,
    prompt: [
      `Search Google for currently open "${query}" jobs in ${country} (or remote in Europe) posted on these job boards:`,
      'boards.greenhouse.io, job-boards.greenhouse.io, jobs.lever.co, jobs.ashbyhq.com, apply.workable.com, jobs.smartrecruiters.com, recruitee.com, teamtailor.com, jobs.personio.de.',
      'Answer with only the full job posting URLs you found, one per line, exactly as they appear in the results. No other text.',
    ].join('\n'),
  })
  return boardsInText(text)
}

/** Verify candidates against the ATS APIs and add the live ones as company boards. */
export async function addVerifiedBoards(candidates: Candidate[], log?: (m: string) => void): Promise<GeminiDiscoveryResult> {
  const result: GeminiDiscoveryResult = { proposed: candidates.length, alreadyKnown: 0, verified: 0, added: 0, dead: 0, addedBoards: [] }
  const unique = [...new Map(candidates.filter((c) => /^[a-z0-9][a-z0-9_-]{1,80}$/.test(c.slug)).map((c) => [`${c.atsType}:${c.slug}`, c])).values()]
  await mapLimit(unique, 4, async (c) => {
    const known = await db.company.findFirst({ where: { atsType: c.atsType, atsSlug: c.slug }, select: { id: true } })
    if (known) {
      result.alreadyKnown++
      return
    }
    // Workable rate-limits this IP (Cloudflare 1015); its boards come through the slower probe path instead.
    if (c.atsType === 'workable') return
    const reported = await probeBoard(c.atsType, c.slug)
    if (reported === undefined) {
      result.dead++
      return
    }
    result.verified++
    const name = (reported || c.name || c.slug).trim().slice(0, 200)
    const normalizedName = normalizeCompany(name) || name.toLowerCase()
    const existing = await db.company.findUnique({ where: { normalizedName }, select: { id: true, atsType: true, blacklisted: true } })
    if (existing?.blacklisted || (existing?.atsType && existing.atsType !== c.atsType)) return
    const data = { atsType: c.atsType, atsSlug: c.slug, careersUrl: atsBoardUrl(c.atsType, c.slug), boardSource: 'gemini', boardCheckedAt: new Date(), lastFetchError: null }
    try {
      if (existing) await db.company.update({ where: { id: existing.id }, data })
      else await db.company.create({ data: { name, normalizedName, ...data } })
      result.added++
      result.addedBoards.push(`${name} (${c.atsType}/${c.slug})`)
      log?.(`Gemini board: ${name} -> ${c.atsType}/${c.slug}`)
    } catch {
      /* a parallel insert of the same company: fine */
    }
  })
  return result
}

/**
 * One discovery pass: knowledge suggestions for each country, plus a few grounded searches.
 * `searches` is kept small because Google Search grounding has its own small daily allowance.
 */
export async function discoverBoardsWithGemini(opts: {
  countries: string[]
  focus?: string
  queries?: string[]
  searches?: number
  log?: (m: string) => void
}): Promise<GeminiDiscoveryResult> {
  const fromProfile = await profileFocus()
  const focus = opts.focus ?? fromProfile.focus
  const knownSlugs = (await db.company.findMany({ where: { boardSource: 'gemini' }, select: { atsSlug: true }, take: 400 })).map((c) => c.atsSlug).filter((s): s is string => Boolean(s))
  const candidates: Candidate[] = []
  for (const country of opts.countries) {
    try {
      candidates.push(...(await suggestFromKnowledge(country, focus, knownSlugs, { sponsors: fromProfile.sponsors })))
    } catch (err) {
      opts.log?.(`Gemini suggestions for ${country} failed: ${err instanceof Error ? err.message.slice(0, 120) : err}`)
    }
  }
  const queries = opts.queries ?? []
  let searches = 0
  for (const country of opts.countries) {
    for (const query of queries) {
      if (searches >= (opts.searches ?? 0)) break
      searches++
      try {
        candidates.push(...(await searchWithGoogle(query, country)))
      } catch (err) {
        opts.log?.(`Gemini search "${query}" in ${country} failed: ${err instanceof Error ? err.message.slice(0, 120) : err}`)
        if (err instanceof Error && err.name === 'GroundingQuotaError') searches = Number.POSITIVE_INFINITY
      }
    }
  }
  return addVerifiedBoards(candidates, opts.log)
}

export const DISCOVERY_INDUSTRIES = [
  'fintech and payments', 'e-commerce and marketplaces', 'B2B SaaS', 'developer tools and infrastructure', 'AI and machine learning',
  'healthtech and biotech software', 'gaming and entertainment', 'travel and mobility', 'logistics and supply chain software', 'cybersecurity',
  'adtech and martech', 'edtech', 'automotive and industrial software', 'energy and climate tech', 'insurtech and banking software',
  'proptech', 'telecom and communications software', 'media and publishing technology', 'data and analytics platforms', 'cloud and hosting',
  'software agencies and product studios', 'IoT and hardware-software companies', 'HR tech and recruiting software', 'legal tech and govtech',
]

/**
 * Bulk discovery: every country x industry pair is one Gemini question, run in parallel (the Gemini client rotates all
 * configured API keys), then every proposed board is verified against the ATS and added.
 */
export async function discoverBoardsBulk(opts: {
  countries: string[]
  industries?: string[]
  concurrency?: number
  focus?: string
  log?: (m: string) => void
}): Promise<GeminiDiscoveryResult> {
  const industries = opts.industries ?? DISCOVERY_INDUSTRIES
  const fromProfile = await profileFocus()
  const focus = opts.focus ?? fromProfile.focus
  const pairs = opts.countries.flatMap((country) => industries.map((industry) => ({ country, industry })))
  const known = (await db.company.findMany({ where: { atsSlug: { not: null } }, select: { atsSlug: true }, take: 300 })).map((c) => c.atsSlug).filter((s): s is string => Boolean(s))
  const seen = new Set<string>()
  const all: Candidate[] = []
  let done = 0
  await mapLimit(pairs, opts.concurrency ?? 7, async ({ country, industry }) => {
    try {
      const found = await suggestFromKnowledge(country, `${focus} at ${industry} companies`, known, { sponsors: fromProfile.sponsors })
      for (const c of found) {
        const key = `${c.atsType}:${c.slug}`
        if (!seen.has(key)) {
          seen.add(key)
          all.push(c)
        }
      }
    } catch (err) {
      opts.log?.(`Gemini ${country}/${industry} failed: ${err instanceof Error ? err.message.slice(0, 100) : err}`)
    }
    done++
    if (done % 25 === 0) opts.log?.(`asked ${done}/${pairs.length}, ${all.length} distinct boards proposed`)
  })
  opts.log?.(`Gemini proposed ${all.length} distinct boards; verifying against the ATS APIs`)
  return addVerifiedBoards(all, opts.log)
}
