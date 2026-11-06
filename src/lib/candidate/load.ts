import { db } from '@/lib/db'
import { buildCandidateContext, type CandidateContext } from './context'

let cache: { at: number; ctx: CandidateContext } | null = null
const TTL_MS = 30_000

/**
 * The candidate as one object, read from CandidateProfile (cached for 30 s; the workers call it per
 * form and per email). An install without a profile yet gets an empty context, never a crash.
 */
export async function loadCandidateContext(opts: { fresh?: boolean } = {}): Promise<CandidateContext> {
  if (!opts.fresh && cache && Date.now() - cache.at < TTL_MS) return cache.ctx
  const [profile, settings] = await Promise.all([db.candidateProfile.findUnique({ where: { id: 1 } }), db.settings.findUnique({ where: { id: 1 }, select: { timezone: true } })])
  const ctx = buildCandidateContext(profile as unknown as Record<string, unknown> | null, settings?.timezone ?? 'UTC')
  cache = { at: Date.now(), ctx }
  return ctx
}

/** Call after the profile changes (onboarding, Settings > Profile, remove my data). */
export function invalidateCandidateContext(): void {
  cache = null
}
