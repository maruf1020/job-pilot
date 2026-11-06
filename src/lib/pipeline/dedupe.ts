import { sha1 } from '@/lib/crypto'
import { normalizeCompany, normalizeTitle } from '@/lib/text'

/**
 * Cross-source identity for a job: same company + same title + same country.
 * Reposts and multi-source listings collapse onto one `Job` row.
 */
export function buildDedupeKey(company: string, title: string, countryCode?: string | null): string {
  const c = normalizeCompany(company)
  const t = normalizeTitle(title)
  const k = `${c}|${t}|${(countryCode ?? '').toUpperCase()}`
  return sha1(k)
}

export function companyKey(company: string): string {
  return normalizeCompany(company)
}
