import { db } from '@/lib/db'
import type { SourceId } from '@/lib/domain'
import { SOURCE_ADAPTERS } from '@/lib/sources/registry'
import { searchCountries } from '@/lib/regions'
import type { AppSettings } from '@/lib/settings/schema'

/**
 * Search rotation. A source's search space is (query × country); a run only has time and
 * quota for a slice of it. Without rotation every run repeats the same first slice and
 * finds the same handful of new jobs. With rotation:
 *  - never-searched combinations go first, then the least recently searched,
 *  - each combination continues from the result page where it stopped last time,
 *  - a combination whose last page was reached rests for `cycleDays`, then starts over,
 *  - queries are expanded with variants from the profile (titles, main skills).
 */

export interface Combo {
  query: string
  countryCode?: string
}

export interface CursorRow {
  query: string
  country: string
  nextPage: number
  lastRunAt: Date | null
  exhaustedAt: Date | null
}

export interface PlannedCombo extends Combo {
  startPage: number
  neverRun: boolean
}

/** Skills that make sense as a search query when combined with "developer" (developer searches only). */
const QUERY_SKILLS = /^(typescript|javascript|react|next\.?js|node\.?js|nestjs|angular|vue|full[- ]?stack|front[- ]?end|back[- ]?end|java|python|golang|go|kotlin|\.net|c#|php|ruby|rust|graphql|postgres(ql)?|aws|azure|cloud)$/i

/** Base queries plus variants from the profile; deterministic order, deduped, capped. */
export function expandQueries(settings: AppSettings, profile: { titles: string[]; skills: string[]; stopSkills: string[] } | null, cap = 24): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (q: string) => {
    const key = q.trim().toLowerCase().replace(/\s+/g, ' ')
    if (!key || seen.has(key)) return
    seen.add(key)
    out.push(q.trim())
  }
  for (const q of settings.search.queries) push(q)
  if (settings.search.rotation.autoVariants && profile) {
    const stop = new Set(profile.stopSkills.map((s) => s.toLowerCase()))
    for (const t of profile.titles) push(t)
    // "<skill> developer" variants only for a developer search ("Python developer" is not a data analyst's query).
    const p = settings.search.profession ?? 'software'
    const devSearch = p === 'software' || p === 'other'
    for (const s of devSearch ? profile.skills : []) {
      if (!QUERY_SKILLS.test(s) || stop.has(s.toLowerCase())) continue
      push(/full|front|back/i.test(s) ? `${s} developer` : `${s} developer`)
    }
  }
  return out.slice(0, cap)
}

/** Countries an adapter can be asked for, priority tiers first. */
export function countriesFor(sourceId: SourceId, settings: AppSettings): string[] {
  const adapter = SOURCE_ADAPTERS[sourceId]
  const s = settings.search
  // Your countries, the UK when included, then the countries outside Europe switched on in Settings → Search.
  const all = searchCountries(s)
  const ordered = [...new Set([...s.priorityTiers.flat().map((c) => c.toUpperCase()), ...all])].filter((c) => all.includes(c))
  return ordered.filter((c) => !adapter.supportedCountries || adapter.supportedCountries.has(c))
}

/** Every combination a source could run, in priority order (used without rotation too). */
export function allCombos(sourceId: SourceId, settings: AppSettings, queries: string[]): Combo[] {
  const adapter = SOURCE_ADAPTERS[sourceId]
  const countries = countriesFor(sourceId, settings)
  if (!adapter.usesQuery && !adapter.usesCountry) return [{ query: '' }]
  if (adapter.usesQuery && !adapter.usesCountry) return queries.map((query) => ({ query }))
  if (!adapter.usesQuery && adapter.usesCountry) return countries.map((countryCode) => ({ query: '', countryCode }))
  if (sourceId === 'jsearch') {
    // Tiny monthly budget: only the top-priority countries (else the first searched one), one broad query each.
    const top = (settings.search.priorityTiers[0] ?? countries.slice(0, 1)).filter((c) => countries.includes(c.toUpperCase()) || !countries.length)
    const query = queries[0]
    return query ? top.map((countryCode) => ({ query, countryCode })) : []
  }
  const out: Combo[] = []
  for (const countryCode of countries) for (const query of queries) out.push({ query, countryCode })
  return out
}

/**
 * Pick which combinations to run now. Pure, so it can be tested: never-run first, then by
 * last run time; combinations exhausted less than `cycleDays` ago are used only when
 * nothing else is left.
 */
export function planCombos(candidates: Combo[], cursors: CursorRow[], opts: { take: number; cycleDays: number; now?: Date }): PlannedCombo[] {
  const now = opts.now ?? new Date()
  const restUntil = now.getTime() - opts.cycleDays * 86_400_000
  const byKey = new Map(cursors.map((c) => [`${c.query}\u0000${c.country}`, c]))
  const rows = candidates.map((c, index) => {
    const cur = byKey.get(`${c.query}\u0000${c.countryCode ?? ''}`)
    const resting = Boolean(cur?.exhaustedAt && cur.exhaustedAt.getTime() > restUntil && cur.nextPage === 1)
    return { c, cur, index, resting }
  })
  const order = (a: (typeof rows)[number], b: (typeof rows)[number]) => {
    const ta = a.cur?.lastRunAt?.getTime() ?? -1
    const tb = b.cur?.lastRunAt?.getTime() ?? -1
    if (ta !== tb) return ta - tb // never run (-1) first, then oldest
    return a.index - b.index // then the configured priority order
  }
  const fresh = rows.filter((r) => !r.resting).sort(order)
  const resting = rows.filter((r) => r.resting).sort(order)
  return [...fresh, ...resting].slice(0, opts.take).map(({ c, cur }) => ({ ...c, startPage: cur?.nextPage ?? 1, neverRun: !cur?.lastRunAt }))
}

export async function loadCursors(sourceId: SourceId): Promise<CursorRow[]> {
  return db.sourceCursor.findMany({ where: { source: sourceId }, select: { query: true, country: true, nextPage: true, lastRunAt: true, exhaustedAt: true } })
}

/** Record where the next run should continue for this combination. */
export async function advanceCursor(sourceId: SourceId, combo: Combo, result: { lastPage: number; hasMore: boolean; created: number; maxPage?: number }): Promise<void> {
  const exhausted = !result.hasMore || result.lastPage >= (result.maxPage ?? 40)
  const key = { source: sourceId, query: combo.query, country: combo.countryCode ?? '' }
  const data = {
    nextPage: exhausted ? 1 : result.lastPage + 1,
    exhaustedAt: exhausted ? new Date() : null,
    lastRunAt: new Date(),
    lastCreated: result.created,
  }
  await db.sourceCursor.upsert({
    where: { source_query_country: key },
    update: { ...data, runs: { increment: 1 } },
    create: { ...key, ...data, runs: 1 },
  })
}

/** Summary for the run log: how much of the space this run covers. */
export function describePlan(plan: PlannedCombo[], total: number): string {
  const never = plan.filter((p) => p.neverRun).length
  const continuing = plan.filter((p) => p.startPage > 1).length
  return `${plan.length} of ${total} combination(s)${never ? `, ${never} never searched` : ''}${continuing ? `, ${continuing} continuing from a later page` : ''}`
}
