import { db } from '@/lib/db'

/**
 * Sources and company boards that answer with an error rest for a while instead of being asked again on
 * every run ("stop that for 6 or 12 hours, then call it again"). Once
 * freehire.me answered HTTP 429 59 times in a day (asked once per country, every ~14 minutes), LinkedIn
 * 429, Adzuna 503, and a few Workday boards 500 on every run, so every run ended "completed with errors".
 *
 * Too many requests (429) or blocked: 6 hours. The server failing (5xx, timeouts): 12 hours. Kept as a
 * SourceCursor row (query "__rest__"), so no schema change is needed and a worker restart keeps it.
 */
export const REST_QUERY = '__rest__'
const HOUR = 3_600_000

/** How long to rest after this error, or null when the error is not the source's fault for a while. */
export function restAfter(message: string): { ms: number; reason: string } | null {
  if (/HTTP 429|rate limit|too many requests|quota/i.test(message)) return { ms: 6 * HOUR, reason: 'too many requests (HTTP 429)' }
  if (/HTTP 403|forbidden|blocked|captcha/i.test(message)) return { ms: 6 * HOUR, reason: 'blocked (HTTP 403)' }
  if (/HTTP 5\d\d|service unavailable|bad gateway|gateway time-?out|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|fetch failed|timed? ?out/i.test(message)) return { ms: 12 * HOUR, reason: 'the server failing' }
  return null
}

/** Until when this source rests, with the reason; null when it may be asked. */
export async function restingUntil(source: string, now = new Date()): Promise<{ until: Date; reason: string } | null> {
  const row = await db.sourceCursor.findUnique({ where: { source_query_country: { source, query: REST_QUERY, country: '' } }, select: { exhaustedAt: true, lastCreated: true, runs: true } })
  if (!row?.exhaustedAt || row.exhaustedAt <= now) return null
  return { until: row.exhaustedAt, reason: row.runs >= 2 ? 'repeated errors' : 'an error' }
}

/** Rest the source after an error; a second error in a row while it was resting doubles nothing, it simply restarts the rest. */
export async function restSource(source: string, message: string, now = new Date()): Promise<{ until: Date; reason: string } | null> {
  const r = restAfter(message)
  if (!r) return null
  const until = new Date(now.getTime() + r.ms)
  await db.sourceCursor.upsert({
    where: { source_query_country: { source, query: REST_QUERY, country: '' } },
    create: { source, query: REST_QUERY, country: '', exhaustedAt: until, lastRunAt: now, runs: 1 },
    update: { exhaustedAt: until, lastRunAt: now, runs: { increment: 1 } },
  })
  return { until, reason: r.reason }
}

/** A company board whose last fetch failed with a server or rate-limit error rests 6-12 hours from then. */
export function boardResting(lastFetchError: string | null, lastFetchedAt: Date | null, now = new Date()): boolean {
  if (!lastFetchError || !lastFetchedAt) return false
  const r = /HTTP 422/.test(lastFetchError) ? { ms: 12 * HOUR } : restAfter(lastFetchError)
  return !!r && now.getTime() - lastFetchedAt.getTime() < r.ms
}
