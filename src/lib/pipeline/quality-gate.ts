import { needsSponsorshipFor, type CandidateContext } from '@/lib/candidate/context'
import type { EmailConfig } from '@/lib/settings/schema'

/**
 * The eligibility gate for automatic applications (email batches and browser batches). For a job in a
 * country where the candidate needs sponsorship, only jobs that can lead to a work permit pass: the
 * permit rules per country below. Where the candidate already has the right to work (citizenship, a
 * permit, EU/EEA free movement) none of the permit rules apply. Thresholds as published for 2026.
 */

export interface GateJob {
  countryCode: string | null
  sponsorship: string
  salaryMin: number | null
  salaryMax: number | null
  currency: string | null
  company: { knownSponsor: boolean }
  /** The posting's location text: "Remote (Worldwide)" needs no country or visa. */
  location?: string | null
}

/**
 * Yearly minimum pay for the usual permit, in the local currency (2026 figures as published by each
 * country). General knowledge, used only when the candidate needs sponsorship there. Missing salary =
 * unknown, never a fail.
 */
export const PERMIT_FLOORS: Record<string, { amount: number; currency: string; permit: string }> = {
  IE: { amount: 40_904, currency: 'EUR', permit: 'Critical Skills Employment Permit' },
  DE: { amount: 45_934, currency: 'EUR', permit: 'EU Blue Card (IT rate)' },
  NL: { amount: 5_942 * 12, currency: 'EUR', permit: 'highly skilled migrant (age 30+)' },
  GB: { amount: 54_700, currency: 'GBP', permit: 'Skilled Worker visa (software developer going rate)' },
  PL: { amount: 13_355 * 12, currency: 'PLN', permit: 'EU Blue Card' },
  ES: { amount: 39_270, currency: 'EUR', permit: 'EU Blue Card' },
  PT: { amount: 21_030, currency: 'EUR', permit: 'EU Blue Card' },
  CZ: { amount: 77_245 * 12, currency: 'CZK', permit: 'EU Blue Card' },
  EE: { amount: 2_600 * 12, currency: 'EUR', permit: 'EU Blue Card (IT rate)' },
  SE: { amount: 34_470 * 12, currency: 'SEK', permit: 'work permit (90% of the median wage)' },
  FI: { amount: 3_937 * 12, currency: 'EUR', permit: 'specialist residence permit' },
  AT: { amount: 3_465 * 14, currency: 'EUR', permit: 'Red-White-Red Card' },
  DK: { amount: 552_000, currency: 'DKK', permit: 'Pay Limit Scheme' },
  BE: { amount: 56_976, currency: 'EUR', permit: 'EU Blue Card (Brussels)' },
  AU: { amount: 79_423, currency: 'AUD', permit: 'Skills in Demand (482) visa' },
}

/**
 * Where an email application needs a sign that the employer sponsors (a licence or a register entry);
 * Germany and the rest of the EU let any employer apply for the permit.
 */
const EVIDENCE_COUNTRIES = new Set(['IE', 'GB', 'NL'])
/** Forms cost nothing to send, so Ireland's "any employer can apply" rule is enough there; the UK still needs a licence holder. */
const FORM_EVIDENCE_COUNTRIES = new Set(['GB', 'NL'])
/** Outside Europe the posting itself must say it sponsors (the prefilter checks the wording; enrichment records it). */
const OUTSIDE_EUROPE = new Set(['CA', 'AU', 'US', 'NZ'])

const RATES_TO_EUR: Record<string, number> = { EUR: 1, GBP: 1.17, USD: 0.92, CHF: 1.05, SEK: 0.088, DKK: 0.134, NOK: 0.086, PLN: 0.23, CZK: 0.04, AUD: 0.6, CAD: 0.67, NZD: 0.55, RON: 0.2, HUF: 0.0025, ISK: 0.0066, BGN: 0.51 }

function yearly(amount: number | null, currency: string | null): { amount: number; currency: string } | null {
  if (!amount || amount <= 0) return null
  const cur = (currency ?? 'EUR').toUpperCase()
  // Monthly figures (common in NL, PL, SE and CZ postings) are normalised; hourly or daily rates are ignored.
  // Decided in euros, so "SEK 40,000" (a month) is not read as a yearly salary.
  const eur = amount * (RATES_TO_EUR[cur] ?? 1)
  if (eur < 1_000) return null
  if (eur < 15_000) return { amount: amount * 12, currency: cur }
  return { amount, currency: cur }
}

function toLocal(amount: number, from: string, to: string): number | null {
  if (from === to) return amount
  const a = RATES_TO_EUR[from]
  const b = RATES_TO_EUR[to]
  return a && b ? (amount * a) / b : null
}

/**
 * The person's salary expectation as a yearly figure: "55000", "EUR 55,000", "55k", "50-60k EUR",
 * "4.500 EUR per month". Text without a number ("open to discuss") gives null. The currency comes from
 * the text, then from the profile's salary currency, then EUR.
 */
export function parseSalaryExpectation(text: string | null | undefined, currency?: string | null): { amount: number; currency: string } | null {
  const t = (text ?? '').trim()
  if (!t) return null
  const m = t.match(/(\d[\d.,\s]*\d|\d)\s*(k\b)?/i)
  if (!m) return null
  // "55,000" / "55.000" / "55 000" are thousands separators; "55.5k" keeps its decimal.
  let raw = m[1].replace(/\s+/g, '')
  raw = /[.,]\d{3}(?!\d)/.test(raw) ? raw.replace(/[.,]/g, '') : raw.replace(',', '.')
  let amount = Number(raw)
  if (!Number.isFinite(amount) || amount <= 0) return null
  if (m[2] || (amount < 1_000 && /\d\s*k\b/i.test(t))) amount *= 1_000
  if (/(per|a|\/)\s*month|monthly|\bp\.?\s?m\.?(\s|$)/i.test(t)) amount *= 12
  const symbol = t.includes('€') ? 'EUR' : t.includes('£') ? 'GBP' : t.includes('$') ? 'USD' : null
  const code = t.toUpperCase().match(/\b[A-Z]{3}\b/g)?.find((c) => c in RATES_TO_EUR) ?? null
  return { amount: Math.round(amount), currency: (code ?? symbol ?? currency ?? 'EUR').toUpperCase() }
}

/** The person's ask converted to the currency a form names ("salary in USD"), rounded to thousands; null when there is no ask or no rate. */
export function modestAskInCurrency(currency: string, ask?: { amount: number; currency: string } | null): { amount: number; currency: string } | null {
  if (!ask) return null
  const c = currency.toUpperCase()
  if (c === ask.currency) return ask
  const converted = toLocal(ask.amount, ask.currency, c)
  return converted === null ? null : { amount: Math.round(converted / 1000) * 1000, currency: c }
}

/**
 * Salary to put on a form that requires one: the person's own expectation (Settings > Profile), in the
 * posting's currency when the posting states a salary, and never under the posting's own minimum. No
 * expectation in the profile = null, so the answer bank or the person decides; there is no built-in figure.
 * `onlyWhenAsked` mirrors the profile switch: when true, the figure goes only into fields that ask for it.
 */
export function modestSalaryAsk(
  job: { countryCode: string | null; salaryMin: number | null; currency: string | null },
  candidate?: Pick<CandidateContext, 'salaryExpectation' | 'salaryCurrency' | 'salaryOnlyWhenAsked'> | null,
): { amount: number; currency: string; onlyWhenAsked: boolean } | null {
  const own = parseSalaryExpectation(candidate?.salaryExpectation, candidate?.salaryCurrency)
  if (!own) return null
  const onlyWhenAsked = candidate?.salaryOnlyWhenAsked !== false
  const posted = yearly(job.salaryMin, job.currency)
  if (posted && posted.currency !== own.currency) {
    // Ask in the posting's currency so the number reads naturally on that form.
    const local = modestAskInCurrency(posted.currency, own)
    if (local) return posted.amount > local.amount ? { amount: Math.round(posted.amount), currency: posted.currency, onlyWhenAsked } : { ...local, onlyWhenAsked }
  }
  if (posted && posted.currency === own.currency && posted.amount > own.amount) return { amount: Math.round(posted.amount), currency: posted.currency, onlyWhenAsked }
  return { ...own, onlyWhenAsked }
}

/** Remote from anywhere: the candidate can work it from home, so no permit is needed. */
export const WORLDWIDE_REMOTE = /\b(worldwide|anywhere|global(ly)?)\b/i

/**
 * Why automatic applying should skip this job, or null when it is eligible. `channel` 'form' is the
 * browser agent (an application costs nothing, so Ireland needs no sponsor sign); 'email' (the
 * default) keeps the stricter rule, because cold email has a reputation cost. `candidate` decides
 * whether the permit rules apply at all: without it (or with unknown work rights) they do, to stay safe.
 */
export function gateReason(
  job: GateJob,
  opts: { requireEvidence?: boolean; channel?: 'form' | 'email'; candidate?: Pick<CandidateContext, 'citizenships' | 'workAuth'> | null } = {},
): string | null {
  const cc = job.countryCode?.toUpperCase() ?? null
  if (!cc) return WORLDWIDE_REMOTE.test(job.location ?? '') ? null : 'Country unknown: check the location before applying'
  // Right to work there already: sponsorship, sponsor registers and permit salary floors do not matter.
  if (opts.candidate && needsSponsorshipFor(opts.candidate, cc) === false) return null
  if (job.sponsorship === 'no') return 'Employer says no visa sponsorship'

  if (cc === 'NL' && !job.company.knownSponsor) return 'Netherlands: only IND recognised sponsors can hire from abroad, and this company is not on the register'

  const floor = PERMIT_FLOORS[cc]
  const pay = yearly(job.salaryMax ?? job.salaryMin, job.currency)
  if (floor && pay) {
    const local = toLocal(pay.amount, pay.currency, floor.currency)
    if (local !== null && local < floor.amount * 0.95) {
      return `Salary (${pay.currency} ${Math.round(pay.amount).toLocaleString()}) is below the ${floor.permit} floor (${floor.currency} ${floor.amount.toLocaleString()})`
    }
  }

  const sponsorSign = job.sponsorship === 'yes' || job.sponsorship === 'likely'
  if (OUTSIDE_EUROPE.has(cc) && !sponsorSign) return `${cc}: only postings that say the employer sponsors a visa are applied to`
  const evidence = opts.channel === 'form' ? FORM_EVIDENCE_COUNTRIES : EVIDENCE_COUNTRIES
  if ((opts.requireEvidence ?? true) && evidence.has(cc) && !(sponsorSign || job.company.knownSponsor)) {
    return `No sign of visa sponsorship (needed for ${cc}): not on the sponsor register and the posting does not mention it`
  }
  return null
}

/** Settings-driven switch so the gate can be relaxed from Settings → Email later. */
export function gateEnabled(email: Pick<EmailConfig, 'eligibilityGate'>): boolean {
  return email.eligibilityGate !== false
}
