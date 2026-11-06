import { EUROPE_COUNTRIES, isEuropeanCountry } from '@/lib/domain'
import type { SearchConfig } from '@/lib/settings/schema'

/**
 * Where the app searches and applies. Europe is the main market (the sources are Europe-centred);
 * Canada, Australia, New Zealand and the USA are opt-in (Settings → Search). For a person who needs
 * a visa there, only postings that state sponsorship pass, because the visa rules allow little else.
 * Any other country the person lists in Settings → Search → countries counts as a target too.
 */

export const OUTSIDE_EUROPE_TARGETS = ['CA', 'AU', 'US', 'NZ'] as const
export type OutsideEuropeTarget = (typeof OUTSIDE_EUROPE_TARGETS)[number]

export const OUTSIDE_EUROPE_NAMES: Record<OutsideEuropeTarget, string> = {
  CA: 'Canada',
  AU: 'Australia',
  US: 'United States',
  NZ: 'New Zealand',
}

type RegionSearch = Pick<SearchConfig, 'countries' | 'includeUk' | 'outsideEurope'>

export function isOutsideEuropeTarget(code: string | null | undefined, search: Pick<SearchConfig, 'outsideEurope'> & Partial<Pick<SearchConfig, 'countries'>>): boolean {
  const c = code?.toUpperCase()
  if (!c || isEuropeanCountry(c)) return false
  return (search.outsideEurope ?? []).includes(c as OutsideEuropeTarget) || (search.countries ?? []).some((x) => x.toUpperCase() === c)
}

/** A country the app applies in: Europe (the UK when included) or an enabled country outside Europe. */
export function isTargetCountry(code: string | null | undefined, search: Pick<SearchConfig, 'includeUk' | 'outsideEurope'> & Partial<Pick<SearchConfig, 'countries'>>): boolean {
  const c = code?.toUpperCase()
  if (!c) return false
  if (c === 'GB') return search.includeUk
  return isEuropeanCountry(c) || isOutsideEuropeTarget(c, search)
}

/** Countries sources should query: the search list, the UK when included, then the enabled countries outside Europe. */
export function searchCountries(search: RegionSearch): string[] {
  const out = [...search.countries.map((c) => c.toUpperCase())]
  if (search.includeUk && !out.includes('GB')) out.push('GB')
  for (const c of search.outsideEurope ?? []) if (!out.includes(c)) out.push(c)
  return out
}

/** Display name for any country the app knows. */
export function regionCountryName(code: string | null | undefined): string {
  if (!code) return 'Unknown'
  const c = code.toUpperCase()
  return EUROPE_COUNTRIES[c] ?? OUTSIDE_EUROPE_NAMES[c as OutsideEuropeTarget] ?? c
}

/** Region bucket used by the scoreboard. */
export type RegionBucket = 'EU' | 'UK' | 'CA' | 'AU' | 'US' | 'NZ' | 'remote' | 'unknown' | 'other'
export function regionBucket(code: string | null | undefined, remote?: boolean | null): RegionBucket {
  const c = code?.toUpperCase()
  if (!c) return remote ? 'remote' : 'unknown'
  if (c === 'GB') return 'UK'
  if (isEuropeanCountry(c)) return 'EU'
  if ((OUTSIDE_EUROPE_TARGETS as readonly string[]).includes(c)) return c as RegionBucket
  return 'other'
}
