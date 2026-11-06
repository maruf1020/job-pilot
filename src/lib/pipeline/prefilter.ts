import { franc } from 'franc'
import { countryName, isEuropeanCountry } from '@/lib/domain'
import { escapeRegex, guessCountry, outsideEurope } from '@/lib/geo'
import { needsSponsorshipFor, type CandidateContext, type Profession } from '@/lib/candidate/context'
import { excludedTradeWord, looksLikeProfessionRole, matchesAnyTarget, professionDictionary } from '@/lib/candidate/professions'
import { canonicalLanguage } from '@/lib/ranking/rules'
import { isOutsideEuropeTarget } from '@/lib/regions'
import type { SearchConfig } from '@/lib/settings/schema'
import { normalizeTitle } from '@/lib/text'

export interface PrefilterInput {
  title: string
  description: string
  companyName?: string | null
  countryCode?: string | null
  location?: string | null
  remote?: boolean | null
  visaFlag?: boolean | null
}

/** Wording that says the employer sponsors, per country outside Europe (plan-apply-all.md section 6). */
const OUTSIDE_EUROPE_SPONSOR_RE: Record<string, RegExp> = {
  CA: /\b(global talent stream|lmia|labou?r market impact assessment|work permit sponsorship|sponsor (a |your )?(canadian )?work permit|relocat(e|ion) to canada)\b/i,
  AU: /\b(482 visa|subclass 482|skills in demand|tss visa|accredited sponsor|employer[- ]sponsored visa)\b/i,
  NZ: /\b(accredited employer|aewv)\b/i,
  US: /\b(h-?1b|h1-b)\b/i,
}

/** Universities, non-profit research labs, hospitals: US employers outside the H-1B lottery. */
const CAP_EXEMPT_RE = /\b(university|college|institute of technology|research (institute|center|centre|foundation|laborator(y|ies))|national (lab|laboratory)|medical (center|centre)|hospital|school of medicine|polytechnic)\b/i

/** Postings outside Europe that ask for work rights a sponsored candidate does not have. */
const WORK_RIGHTS_RE =
  /(full (working|work) rights|(australian|canadian|us|u\.s\.|american|new zealand) (citizens?|citizenship|permanent residen(ts?|cy))( only| required| is required)?|(citizens?|permanent residents?) (only|or permanent residents)|green card|security clearance|legally (eligible|entitled|authori[sz]ed) to work in (canada|australia|the u\.?s\.?|the united states|new zealand)|must (be|currently be) (located|based|residing) in (the u\.?s\.?|the united states|canada|australia|new zealand))/i

/**
 * Why a posting in Canada, Australia, New Zealand or the USA cannot lead to a visa, or null. The
 * visa rules there leave little room: only postings that say the employer sponsors pass, and in the
 * USA only universities and non-profit research employers (no lottery, no fee).
 */
export function outsideEuropeReason(cc: string, job: Pick<PrefilterInput, 'title' | 'description' | 'companyName'>): string | null {
  const name = countryName(cc)
  const text = `${job.title}\n${job.description}`
  const rights = WORK_RIGHTS_RE.exec(text)
  if (rights) return `${name}: the posting asks for existing work rights ("${rights[0].slice(0, 60)}")`
  const sponsors = (OUTSIDE_EUROPE_SPONSOR_RE[cc]?.test(text) ?? false) || mentionsSponsoring(text)
  if (!sponsors) return `${name}: the posting does not say the employer sponsors a visa`
  if (cc === 'US' && !CAP_EXEMPT_RE.test(job.companyName ?? '')) return 'United States: only universities and non-profit research employers can hire without the H-1B lottery'
  return null
}

/**
 * Postings that say the job cannot sponsor a visa, in the employer's own words. These used to
 * cost an AI call each before the enrichment step caught them.
 */
export const NO_SPONSORSHIP_RE =
  /(no (visa )?sponsorship( is)?( available| offered| provided)?|(we|the company|this role|this position) (do not|does not|don't|doesn't|cannot|can't|will not|won't|is not able to|are not able to|are unable to|unable to) (offer|provide|sponsor)( visa| work)? ?(sponsorship|visas?|work permits?)|(unable|not able) to sponsor|sponsorship (is )?not (available|possible|offered|provided)|do not sponsor|not sponsoring|does not sponsor|sponsorship will not be (provided|offered)|visa sponsorship: no)/i

/**
 * Softer wording: "must be authorised to work", "without sponsorship". Many employers who do
 * sponsor write this too, so it only counts when the posting says nothing positive about visas.
 */
const SOFT_NO_SPONSORSHIP_RE =
  /((?<!with or )without (the need for |requiring )?(visa )?sponsorship(?! for an? (export|license|licence))|must (already )?(have|hold|possess) (the |a |an )?(existing |valid |current )?(right|permission|authori[sz]ation|eligibility) to (live and )?work|existing right to work|(already )?(legally )?(authori[sz]ed|eligible|entitled) to work in [a-z ]+ (without|with no) (visa )?sponsorship|(eu|eea|european union|uk|irish|british) (passport|citizen(ship)?|national(ity)?) (is )?(required|only|holders? only|mandatory)|only (candidates|applicants) (who are )?(already )?(eligible|authori[sz]ed|entitled) to work|(candidates|applicants) must (already )?be (eligible|authori[sz]ed|entitled) to work in (?!the country|the location|their country))/i

const SPONSORS_RE =
  /(we (do |can |will |are happy to |gladly )?(offer|provide|sponsor|support)s? (full |the )?(visa|work permit|relocation and visa|sponsorship|immigration)|visa sponsorship (is )?(available|offered|provided|possible)|sponsorship (is )?(available|offered|possible)|with or without (visa )?sponsorship|visa (support|assistance)|relocation (and|&) visa|(sponsor|support) (your |a )?(visa|work permit))/gi

/** A positive sponsorship statement that is not itself negated ("no visa support"). */
function mentionsSponsoring(text: string): boolean {
  for (const m of text.matchAll(SPONSORS_RE)) {
    const before = text.slice(Math.max(0, m.index - 24), m.index)
    if (!/\b(no|not|n't|cannot|unable to|without)\b[\w ]{0,16}$/i.test(before)) return true
  }
  return false
}

/** Why the posting itself rules out a sponsored hire, or null. */
export function noSponsorshipReason(description: string): string | null {
  const m = NO_SPONSORSHIP_RE.exec(description) ?? (mentionsSponsoring(description) ? null : SOFT_NO_SPONSORSHIP_RE.exec(description))
  return m ? `Employer says no visa sponsorship ("${m[0].slice(0, 60)}")` : null
}

const ENGLISH_OK = new Set(['eng', 'und', 'sco'])

/** Software check: the title (or, failing that, the description) must look like software work. */
export function looksLikeSoftwareRole(title: string, description: string): boolean {
  return looksLikeProfessionRole(title, description, 'software')
}

const EN_STOPWORDS = new Set(['the', 'and', 'with', 'you', 'our', 'we', 'for', 'are', 'will', 'have', 'this', 'that', 'your', 'from', 'of', 'to', 'in', 'on', 'as', 'be', 'an', 'or', 'is', 'at', 'by', 'it', 'a', 'who', 'what', 'about'])

/**
 * Language of a posting. franc misfires on short or repetitive text, so English is
 * decided first from a stop-word ratio (English prose is ~30-40% stop words).
 */
export function detectLanguage(description: string): string | null {
  if (description.length < 300) return null
  const sample = description.slice(0, 4000)
  const tokens = sample.toLowerCase().match(/[a-z']+/g) ?? []
  if (tokens.length >= 40) {
    const stop = tokens.filter((t) => EN_STOPWORDS.has(t)).length
    if (stop / tokens.length >= 0.12) return 'eng'
  }
  const code = franc(sample, { minLength: 100 })
  return code === 'und' ? null : code
}

/** The excluded keyword the title contains (Settings → Search), or null. */
export function excludedTitleKeyword(title: string, keywords: string[]): string | null {
  const nt = normalizeTitle(title)
  for (const kw of keywords) {
    const k = kw.toLowerCase().trim()
    if (!k) continue
    const simple = /^[a-z0-9 ]+$/.test(k)
    const hit = simple ? new RegExp(`\\b${escapeRegex(k)}\\b`).test(nt) : nt.includes(k)
    if (hit) return kw
  }
  return null
}

/** Stack words found in the text, one per technology ("node.js" and "node" count once). */
function stackWordsIn(text: string, stack: string[]): Set<string> {
  const t = text.toLowerCase()
  const found = new Set<string>()
  for (const s of stack) {
    const k = s.toLowerCase().trim()
    if (k && new RegExp(`(^|[^a-z0-9])${escapeRegex(k)}([^a-z0-9]|$)`).test(t)) found.add(k.replace(/\.js$/, '').replace(/[\s-]/g, ''))
  }
  return found
}

/** Whether the text names one of the stack words ("node.js", "react"...); an empty list matches everything. */
export function mentionsStack(text: string, stack: string[]): boolean {
  return !stack.length || stackWordsIn(text, stack).size > 0
}

/**
 * The fewest years of experience the posting asks for ("8+ years of experience", "at least 10 years
 * of professional experience"), or null when it names none. Company age ("25+ years in business") does not count.
 */
export function yearsRequired(description: string): number | null {
  const re = /\b(?:at least |minimum (?:of )?)?(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?years?\s+(?:of\s+)?(?:[-\w]+\s+){0,3}?(?:experience|exp\b)/gi
  let min: number | null = null
  for (const m of description.matchAll(re)) {
    const n = Number(m[1])
    if (n < 1 || n > 30) continue
    // "...offices in Oradea and 20 years of experience in turning business challenges into..." is the company's age,
    // not a requirement (it made every Accesa posting read as "20 years asked").
    const at = m.index ?? 0
    // Only the sentence the number sits in: an earlier sentence about the company must not hide a real requirement.
    const before = description.slice(Math.max(0, at - 110), at).split(SENTENCE_BREAK).pop() ?? ''
    const after = description.slice(at + m[0].length, at + m[0].length + 40)
    if (COMPANY_AGE_BEFORE.test(before) || COMPANY_AGE_AFTER.test(after)) continue
    min = min === null ? n : Math.min(min, n)
  }
  return min
}

const SENTENCE_BREAK = /[.!?\n•]\s*/
const COMPANY_AGE_BEFORE =/\b(headquartered|offices?|founded|we have|we are|we'?ve|our company|the company|as a company|company with)\b/i
const COMPANY_AGE_AFTER = /^\s*(?:in|of|at)\s+(?:turning|delivering|helping|building|providing|creating|transforming|serving|driving|enabling|shaping|developing software for)\b/i

/** Languages, frameworks and platforms of developer stacks, to tell a job in one stack from one that only mentions a tool once. */
const ALL_STACKS = ['java', 'spring', 'python', 'django', 'golang', 'kotlin', 'scala', 'ruby', 'rails', 'c#', '.net', 'php', 'rust', 'elixir', 'c++', 'swift', 'flutter', 'terraform', 'kubernetes', 'javascript', 'typescript', 'react', 'node.js', 'next.js', 'nestjs', 'vue', 'angular']

const stackKey = (s: string) => s.toLowerCase().trim().replace(/\.js$/, '').replace(/[\s-]/g, '')

/**
 * Whether a job is in the person's stack (Settings skills): its title names it, or its description
 * names more of it than of other stacks (an SRE posting that lists React among twenty tools is not a
 * React job). Mixed stacks count when the person's languages or frameworks are a real part of the job:
 * two of them, or one with more than half as much of the person's stack as of the others.
 */
export function fitsStack(title: string, description: string, stack: string[]): boolean {
  if (!stack.length || mentionsStack(title, stack)) return true
  const mineKeys = new Set(stack.map(stackKey))
  const mine = stackWordsIn(description, stack).size
  const others = stackWordsIn(description, ALL_STACKS.filter((s) => !mineKeys.has(stackKey(s)))).size
  if (mine > others) return true
  const core = stackWordsIn(description, stack.filter((s) => ALL_STACKS.some((a) => stackKey(a) === stackKey(s)))).size
  return core >= 2 || (core >= 1 && mine * 2 > others)
}

/** franc (ISO 639-3) codes of the languages a person may read a posting in (franc often reads Portuguese as Galician). */
const LANGUAGE_CODES: Record<string, string[]> = {
  english: ['eng', 'sco'], german: ['deu'], dutch: ['nld'], french: ['fra'], spanish: ['spa'], italian: ['ita'], swedish: ['swe'], danish: ['dan'], finnish: ['fin'],
  norwegian: ['nob', 'nno'], polish: ['pol'], czech: ['ces'], portuguese: ['por', 'glg'], hungarian: ['hun'], romanian: ['ron'], greek: ['ell'], estonian: ['est', 'ekk'],
  latvian: ['lvs'], lithuanian: ['lit'], ukrainian: ['ukr'], russian: ['rus'], slovak: ['slk'], slovenian: ['slv'], croatian: ['hrv'], serbian: ['srp'],
  bulgarian: ['bul'], turkish: ['tur'], catalan: ['cat'],
}

/** The person as far as the prefilter needs it: where they may work and which languages they read. */
export type PrefilterCandidate = Partial<Pick<CandidateContext, 'citizenships' | 'workAuth' | 'languages'>> | null | undefined

/** Posting languages the person reads: English always (the app writes in English), plus their own languages. */
function readableLanguages(candidate: PrefilterCandidate): Set<string> {
  const out = new Set(ENGLISH_OK)
  for (const l of candidate?.languages ?? []) {
    const c = canonicalLanguage(l.name)
    for (const code of (c && LANGUAGE_CODES[c]) || []) out.add(code)
  }
  return out
}

/** Whether visa rules apply for this place: unknown answers count as yes, so nothing is let through unchecked. */
function needsVisa(candidate: PrefilterCandidate, cc: string | null | undefined): boolean {
  if (!candidate?.workAuth) return true
  return needsSponsorshipFor({ citizenships: candidate.citizenships ?? [], workAuth: candidate.workAuth }, cc || null) !== false
}

/** Returns a human-readable reason to drop the job before any AI spend, or null to keep it. */
export function prefilterReason(job: PrefilterInput, search: SearchConfig, candidate?: PrefilterCandidate): { reason: string | null; language: string | null } {
  const language = detectLanguage(job.description)
  const cc = job.countryCode?.toUpperCase()
  // No country code: the location text decides (emails once went to US, Canadian, Indian and Australian jobs this way).
  const place = cc ?? guessCountry(job.location)?.toUpperCase()
  const visa = needsVisa(candidate, place)

  if (job.visaFlag === false && visa) return { reason: 'Source flags no visa sponsorship', language }

  const kw = excludedTitleKeyword(job.title, search.excludeTitleKeywords)
  if (kw) return { reason: `Title contains "${kw}"`, language }

  const profession = (search.profession ?? 'other') as Profession
  const targets = search.targetTitles ?? []
  if (!matchesAnyTarget(job.title, targets)) {
    const trade = excludedTradeWord(job.title, profession)
    if (trade) return { reason: `Title contains "${trade}"`, language }
  }
  if (!looksLikeProfessionRole(job.title, job.description, profession, targets)) return { reason: `Not a ${professionDictionary(profession).roleLabel} role`, language }

  if (place && !isEuropeanCountry(place)) {
    if (!isOutsideEuropeTarget(place, search)) return { reason: `Outside Europe (${countryName(place)})`, language }
    const why = visa ? outsideEuropeReason(place, job) : null
    if (why) return { reason: why, language }
  } else if (!place) {
    const outside = outsideEurope(job.location)
    if (outside) return { reason: `Outside Europe (${outside})`, language }
  }
  if (place === 'GB' && !search.includeUk) return { reason: 'UK excluded by settings', language }
  if (!cc && job.remote && !search.includeRemote) return { reason: 'Remote roles excluded by settings', language }
  if (search.remoteOnly && job.remote === false) return { reason: 'Not a remote role (remote-only search)', language }

  if (language && !readableLanguages(candidate).has(language)) return { reason: `Posting not in English (${language})`, language }

  const noSponsor = visa ? noSponsorshipReason(job.description) : null
  if (noSponsor) return { reason: noSponsor, language }

  return { reason: null, language }
}
