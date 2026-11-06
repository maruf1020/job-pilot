import { guessCountry, outsideEurope } from '@/lib/geo'
import { isTargetCountry } from '@/lib/regions'
import type { SearchConfig } from '@/lib/settings/schema'

/**
 * Which postings a source keeps, by place: Europe (the UK when included) and the countries
 * outside Europe switched on in Settings → Search. Unknown places are kept; the prefilter and
 * the ranking decide later.
 */

export type RegionSearch = Pick<SearchConfig, 'includeUk' | 'outsideEurope'>

/** Europe only, for callers without settings (the old behaviour). */
export const EUROPE_ONLY: RegionSearch = { includeUk: true, outsideEurope: [] }

/** Whether a location ("Austin, TX", "Dublin", "Bangalore") is somewhere you apply. Empty or unknown = yes. */
export function locationAllowed(location: string | null | undefined, search: RegionSearch = EUROPE_ONLY): boolean {
  if (!location?.trim()) return true
  const cc = guessCountry(location)
  if (cc) return isTargetCountry(cc, search)
  return !outsideEurope(location)
}

const OPEN_TO_EUROPE_RE = /\b(europe|european|eu|emea|cet|worldwide|anywhere|global|international)\b/i
const ONLY_ELSEWHERE_RE = /\b(usa?|united states|us only|americas?|north america|canada|latam|apac|asia|india|australia|africa|new zealand)\b/i

/**
 * The country to store for a remote posting: only one you apply in. "Europe, Canada" is a
 * remote job open to Europe, not a Canadian job (which the prefilter would drop).
 */
export function remoteCountry(restriction: string | null | undefined, search: RegionSearch = EUROPE_ONLY): string | undefined {
  const cc = guessCountry(restriction)
  return cc && isTargetCountry(cc, search) ? cc : undefined
}

/**
 * A remote posting's allowed region ("Europe", "US only", "Worldwide", "Canada, UK"): open to you
 * when it names Europe, the world, a European country, or one of your countries outside Europe.
 */
export function remoteOpen(restriction: string | null | undefined, search: RegionSearch = EUROPE_ONLY): boolean {
  const r = restriction?.trim()
  if (!r) return true
  if (OPEN_TO_EUROPE_RE.test(r)) return true
  const cc = guessCountry(r)
  if (cc) return isTargetCountry(cc, search)
  return !ONLY_ELSEWHERE_RE.test(r) && !outsideEurope(r)
}
