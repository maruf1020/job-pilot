import { z } from 'zod'
import type { AtsType } from '@/lib/domain'
import { boardFromUrl } from './board-registry'
import { extractBoardRefs, siteHost } from './careers-discovery'
import { namesMatch, probeBoard, type BoardHit, type FindBoardStats } from './boards'
import { atsBoardUrl } from '@/lib/sources/ats'

/**
 * Method 3, the last fallback: ask Gemini where a company's jobs live. Gemini only points (its website, its
 * careers page, its ATS board URL); nothing it says is trusted as is. A pointer counts only when the board answers
 * with live jobs (and, where the ATS names the company, it is this company), or when the careers page it names
 * links to such a board.
 */

const answerSchema = z.object({ domain: z.string(), careersUrl: z.string(), boardUrl: z.string() })

export interface GeminiPointer {
  domain: string | null
  careersUrl: string | null
  boardUrl: string | null
}

/** Stops asking after a run of failures in a row (quota gone, no key): the rest of the run goes without Gemini. */
export class GeminiBreaker {
  private streak = 0
  constructor(private readonly limit = 8) {}
  get open(): boolean {
    return this.streak >= this.limit
  }
  ok(): void {
    this.streak = 0
  }
  fail(): void {
    this.streak++
  }
}

function cleanUrl(raw: string): string | null {
  const t = raw.trim()
  if (!t || !/^https?:\/\//i.test(t)) return null
  try {
    return new URL(t).href
  } catch {
    return null
  }
}

/** Turn the model's answer into clean values (anything that is not a plain domain or http(s) URL becomes null). */
export function normalizePointer(a: { domain: string; careersUrl: string; boardUrl: string }): GeminiPointer {
  return { domain: siteHost(a.domain), careersUrl: cleanUrl(a.careersUrl), boardUrl: cleanUrl(a.boardUrl) }
}

export async function askGeminiForBoard(name: string, domain: string | null | undefined): Promise<GeminiPointer> {
  const { generateJson } = await import('@/lib/ai/gemini')
  const { data } = await generateJson({
    task: 'enrich',
    model: 'lite',
    temperature: 0.1,
    schema: answerSchema,
    system: 'You know where companies publish their jobs. Answer only with what you are sure of; use an empty string for anything you do not know. Never invent a URL.',
    prompt: [
      `Company: "${name}"${domain ? ` (website ${domain})` : ''}.`,
      'Give: (1) its main website domain like "acme.com", (2) the URL of its careers or jobs page, (3) the URL of its job board if it uses one of these applicant tracking systems: Greenhouse, Lever, Ashby, SmartRecruiters, Recruitee, Personio, Teamtailor, Workable, Workday, BambooHR, Breezy, Pinpoint, JOIN (for example https://boards.greenhouse.io/acme or https://jobs.lever.co/acme or https://apply.workable.com/acme).',
    ].join('\n'),
  })
  return normalizePointer(data)
}

export interface GeminiLookup {
  hit: BoardHit | null
  /** The website Gemini named, so a saved company gets its domain. */
  domain: string | null
}

/** Ask Gemini, then verify whatever it pointed at. `ask` is injectable for tests. */
export async function findBoardWithGemini(
  name: string,
  domain: string | null | undefined,
  fetchImpl: typeof fetch,
  stats: FindBoardStats,
  ask: (name: string, domain: string | null | undefined) => Promise<GeminiPointer> = askGeminiForBoard,
): Promise<GeminiLookup> {
  const pointer = await ask(name, domain)
  const result: GeminiLookup = { hit: null, domain: pointer.domain }

  const verify = async (type: AtsType, slug: string): Promise<BoardHit | null> => {
    stats.requests++
    const reported = await probeBoard(type, slug, fetchImpl)
    if (reported === undefined) return null // no live board of that name
    if (reported && !namesMatch(name, reported)) return null // somebody else's board
    return { atsType: type, atsSlug: slug, careersUrl: atsBoardUrl(type, slug), via: 'gemini' }
  }

  const direct = [pointer.boardUrl, pointer.careersUrl].map((u) => boardFromUrl(u)).filter((r): r is NonNullable<typeof r> => Boolean(r))
  for (const ref of direct) {
    const hit = await verify(ref.atsType, ref.slug)
    if (hit) return { ...result, hit }
  }

  // The careers page it named may link to the board (like method 2, on the page Gemini found).
  const page = pointer.careersUrl && !boardFromUrl(pointer.careersUrl) ? pointer.careersUrl : null
  if (page) {
    stats.requests++
    try {
      const res = await fetchImpl(page, { headers: { 'user-agent': 'job-pilot/1.0 (+personal job search)', accept: 'text/html' }, redirect: 'follow' })
      if (res.ok) {
        for (const ref of extractBoardRefs((await res.text()).slice(0, 600_000)).slice(0, 3)) {
          const hit = await verify(ref.atsType, ref.slug)
          if (hit) return { ...result, hit }
        }
      }
    } catch {
      stats.failures++
    }
  }
  return result
}
