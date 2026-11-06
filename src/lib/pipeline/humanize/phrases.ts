import { db } from '@/lib/db'
import { DEFAULT_BANNED_PHRASES, type BannedPhraseSeed } from './banned-phrases'

let cache: { at: number; phrases: BannedPhraseSeed[] } | null = null

/** Enabled banned phrases from the DB (falls back to the seed list), cached 60 s. */
export async function getBannedPhrases(): Promise<BannedPhraseSeed[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.phrases
  try {
    const rows = await db.bannedPhrase.findMany({ where: { enabled: true } })
    const phrases: BannedPhraseSeed[] = rows.length
      ? rows.map((r) => ({ phrase: r.phrase, severity: r.severity === 'warn' ? 'warn' : 'error', category: (r.category as BannedPhraseSeed['category']) ?? 'buzzword', isRegex: r.isRegex }))
      : DEFAULT_BANNED_PHRASES
    cache = { at: Date.now(), phrases }
    return phrases
  } catch {
    return DEFAULT_BANNED_PHRASES
  }
}

export function invalidateBannedPhrases() {
  cache = null
}
