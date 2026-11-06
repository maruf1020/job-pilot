import { buildCandidateContext, diversityAnswer as savedDiversity, FREE_MOVEMENT, hasRightToWork, needsSponsorshipFor, type CandidateContext } from '@/lib/candidate/context'
import { modestAskInCurrency } from '@/lib/pipeline/quality-gate'
import type { AnswerBank } from './answer-bank'
import { regionWords } from './regions'
import { claimsFalseRight } from './work-rights'
import { declineOption, matchOption, normalizeQuestion, rangeOption, yesNo } from './match'
import type { ScannedField } from './types'

/**
 * Deterministic answers for the questions every form asks (identity, contact, links, location,
 * work authorisation, diversity, consent, files). Anything not covered here goes to the answer
 * bank and then to the AI.
 */

export interface StandardContext {
  bank: AnswerBank
  email: string
  fullName: string
  yearsExperience: number
  coverLetter: string | null
  resumePath: string
  coverLetterPath: string | null
  /** The person's photo (storage/photo.jpg) for "Photo" / "Picture" upload fields; none = those stay empty. */
  photoPath?: string | null
  /** Use the cover letter for "Additional information" style boxes too. */
  coverLetterEverywhere: boolean
  /** Salary for this job's country (modestSalaryAsk); null falls back to the answer bank. */
  salaryAsk?: { amount: number; currency: string } | null
  /** The form has its own dial-code picker (Greenhouse flag box, Workday "Country Phone Code"). */
  phoneHasCountryPicker?: boolean
  /** The phone box itself carries the dial code ("+32" typed in by its picker, Recruitee): it takes the full number. */
  phoneTypesDialCode?: boolean
  /** The form asks for city or postcode in their own boxes, so "Address" wants the street only. */
  addressHasParts?: boolean
  /** The job's own location ("London", "Dublin, Ireland") and country name, for "which office" questions. */
  jobLocation?: string | null
  jobCountry?: string | null
  /** ISO2 of the job's country: decides the right-to-work answers. */
  jobCountryCode?: string | null
  /** The person (CandidateProfile): the fallback for every standard detail the answer bank does not hold. */
  candidate?: CandidateContext
}

const NOBODY = buildCandidateContext(null)

/** The person behind the form; an empty profile when the caller has none (every answer then degrades to "needs you"). */
function person(ctx: StandardContext): CandidateContext {
  return ctx.candidate ?? NOBODY
}

/** Numbered link boxes take these in turn. */
const LINK_ORDER = ['linkedin', 'website', 'github', 'behance', 'dribbble', 'twitter']

const LEVEL_TEXT: Record<string, string> = { native: 'Native (C2)', fluent: 'Fluent (C1)', professional: 'Professional working (B2)', conversational: 'Conversational (B1)', basic: 'Basic (A2)' }

/** "English (Fluent), Portuguese (Native)". */
function languagesText(c: CandidateContext): string | null {
  return c.languages.length ? c.languages.map((l) => `${l.name} (${l.level.charAt(0).toUpperCase()}${l.level.slice(1)})`).join(', ') : null
}

/** The profile's value for a std:* key, used when the answer bank has no row for it. */
function fromProfile(c: CandidateContext, key: string): string | null {
  const current = c.experience.find((e) => !e.to) ?? c.experience[0]
  const edu = c.education[0]
  const v: Record<string, string | null | undefined> = {
    first_name: c.givenName,
    last_name: c.familyName,
    preferred_name: c.preferredName,
    phone: c.phoneIntl,
    phone_country: c.countryName,
    city: c.city,
    region: c.region,
    country: c.countryName,
    address_line1: c.addressLine,
    postal_code: c.postalCode,
    nationality: c.citizenshipNames[0],
    linkedin: c.links.linkedin,
    github: c.links.github,
    website: c.links.portfolio ?? c.links.website ?? c.links.github,
    twitter: c.links.x,
    behance: c.links.behance,
    dribbble: c.links.dribbble,
    current_company: current?.company,
    current_title: current?.title ?? c.headline,
    notice_period: c.noticePeriod,
    earliest_start: c.earliestStart,
    how_heard: c.howHeard,
    highest_degree: c.degree,
    school: edu?.school,
    graduation_year: edu?.year != null ? String(edu.year) : null,
    gpa: c.gpa,
    languages: languagesText(c),
    gender: c.diversity.gender ?? c.gender,
    pronouns: c.pronouns,
    date_of_birth: c.dateOfBirth,
    salary_expectation: c.salaryExpectation,
    sexual_orientation: c.diversity.orientation,
    caring_responsibilities: c.diversity.caring,
    disability: c.diversity.disability,
    ethnicity: c.diversity.ethnicity,
    religion: c.diversity.religion,
    marital_status: c.diversity.maritalStatus,
    veteran: c.diversity.veteran,
    willing_to_relocate: c.relocation === 'yes' || c.relocation === 'maybe' ? 'Yes' : c.relocation === 'no' ? 'No' : null,
    work_authorization: c.workAuth.authorizationText,
  }
  const out = v[key]
  return typeof out === 'string' && out.trim() ? out.trim() : null
}

/** A standard detail: the answer bank first (your edits, '' = blank on purpose), then the profile. */
function stdOf(ctx: StandardContext, key: string): string | null | undefined {
  const k = key.replace(/^std:/, '')
  const v = ctx.bank.std(k)
  if (v !== null && v !== undefined) return v
  return fromProfile(person(ctx), k) ?? v
}

/** Whether the person needs sponsorship for this job: from the profile and the job's country, else the saved Yes/No; null = unknown. */
function sponsorshipNeed(ctx: StandardContext): boolean | null {
  const c = person(ctx)
  const fromCtx = ctx.candidate ? needsSponsorshipFor(c, ctx.jobCountryCode) : null
  if (fromCtx !== null) return fromCtx
  const saved = ctx.bank.std('requires_sponsorship')
  if (saved && /^y/i.test(saved)) return true
  if (saved && /^n/i.test(saved)) return false
  return null
}

/** A required question nobody may guess: it waits for the person. */
function needsPerson(f: ScannedField, stdKey: string, reason: string): Resolution {
  return f.required ? { type: 'pending', stdKey, reason } : { type: 'skip', reason }
}

/** Words that mark a company's legal form, left out when a form names the company ("Northwind Labs Ltd"). */
const LEGAL_FORM = /\b(ltd|limited|gmbh|inc|llc|plc|corp|corporation|co|sa|s\.a|bv|b\.v|ag|ab|as|oy|srl|sl|spa|pty|pvt|private|company)\b\.?/gi

/** The person's own employers as normalised names, for "have you worked for X before" questions. */
function ownEmployers(ctx: StandardContext): string[] {
  const names = [...person(ctx).experience.map((e) => e.company), stdOf(ctx, 'current_company') ?? '']
  return [...new Set(names.map((n) => normalizeQuestion(n.replace(LEGAL_FORM, ' '))).filter((n) => n.length >= 3))]
}

/** How many years a degree usually takes, for a required "start year" (three-year bachelors in the Bologna countries). */
function degreeYears(degree: string | null | undefined, country: string | null): number {
  const d = (degree ?? '').toLowerCase()
  if (/ph\.?d|doctor/.test(d)) return 4
  if (/master|m\.?sc|\bma\b|mba|m\.?eng|m\.?a\./.test(d)) return 2
  if (/associate|diploma|certificate|hnd/.test(d)) return 2
  return country && (FREE_MOVEMENT.has(country) || country === 'GB') ? 3 : 4
}

/** "University of Lisbon" -> "Lisbon": a shorter word to type into a school search that did not find the full name. */
function schoolKeyword(school: string): string | null {
  const rest = school
    .replace(/\b(university|universidade|universidad|universit[aäé]t?|college|institute|instituto|school|of|the|de|do|da|del)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return rest && rest.toLowerCase() !== school.toLowerCase() ? rest : null
}

/** Option wordings per language level, best first ("Fluent", "C1", "Full professional"...). */
const LEVEL_OPTIONS: Record<string, RegExp[]> = {
  native: [/native|mother tongue|first language/i, /bilingual/i, /\bc2\b/i, /fluent/i],
  fluent: [/^fluent\b|\bfluent\b/i, /\bc1\b/i, /full professional/i, /advanced|proficient/i, /\bc2\b/i],
  professional: [/professional working/i, /\bb2\b|upper.?intermediate/i, /advanced|proficient/i, /fluent/i],
  conversational: [/conversational/i, /\bb1\b|intermediate/i, /limited working/i],
  basic: [/basic|elementary|beginner/i, /\ba2\b/i, /\ba1\b/i],
}

/** The option for a language level, or null when none fits. */
function levelOption(level: string, opts: string[]): string | null {
  for (const re of LEVEL_OPTIONS[level] ?? LEVEL_OPTIONS.professional) {
    const m = opts.find((o) => re.test(o))
    if (m) return m
  }
  return null
}

/** The person's language a question is about ("English level", a level list in an "English" section). */
function languageAsked(c: CandidateContext, text: string): { name: string; level: string } | null {
  const t = text.toLowerCase()
  return c.languages.find((l) => l.name && new RegExp(`\\b${l.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t)) ?? null
}

/**
 * Start date for date fields, from the person's earliest start ("2026-03-01", "2 months") or notice period,
 * plus about two months of visa processing when this job needs sponsorship: the 1st of the month after
 * (YYYY-MM-DD). Null when the profile says nothing (the field then waits for the person).
 */
export function earliestStartDate(c: Pick<CandidateContext, 'earliestStart' | 'noticePeriod'>, opts: { now?: Date; needsVisa?: boolean | null } = {}): string | null {
  const now = opts.now ?? new Date()
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(c.earliestStart ?? '')
  if (iso && new Date(`${iso[0]}T00:00:00Z`).getTime() > now.getTime()) return iso[0]
  const days = (c.earliestStart ? durationDays(c.earliestStart) : null) ?? (c.noticePeriod ? durationDays(c.noticePeriod) : null)
  if (days === null) return null
  const total = days + (opts.needsVisa ? 60 : 0)
  if (total === 0) return new Date(now.getTime() + 7 * 86_400_000).toISOString().slice(0, 10)
  const at = new Date(now.getTime() + total * 86_400_000)
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + (at.getUTCDate() === 1 ? 0 : 1), 1)).toISOString().slice(0, 10)
}

/** Whether the form picks the phone's country code separately from the number. */
/** City or postcode boxes of their own on the page. */
export function hasAddressParts(fields: ScannedField[]): boolean {
  return fields.some((f) => /\b(city|town|postal|zip|post ?code|postcode)\b/i.test(f.label))
}

/** A dial-code list beside the phone box ("Country Phone Code", Factorial's "Phone prefix"). */
export function isDialCodePicker(f: ScannedField): boolean {
  return (
    CHOICE_KINDS.has(f.kind) &&
    (/(phone|dial|calling) ?(code|prefix)|country (phone )?code|phone country|^prefix$/i.test(f.label.trim()) || /dial.?code|calling.?code|phone.?(code|prefix|country)/i.test(`${f.id} ${f.name}`))
  )
}

/**
 * A dial-code picker preset to someone else's country ("Spain (+34)" at THEKER): the form reads it as
 * answered, and the number then fails validation. The person's own code or country counts as right.
 */
export function wrongDialCode(f: ScannedField, phone: string | null, country: string | null): boolean {
  if (!isDialCodePicker(f) || !f.value.trim()) return false
  const cc = /^\+(\d{1,3})/.exec((phone ?? '').replace(/\s/g, ''))?.[1]
  if (!cc && !country) return false
  const v = f.value.toLowerCase()
  return !((cc && new RegExp(`\\+?\\b${cc}\\b`).test(v)) || (country && v.includes(country.toLowerCase())))
}

/**
 * A phone box that holds only the dial code its picker wrote in ("+32" on Recruitee): not answered yet.
 * Typing the whole international number there makes the site switch the country itself (Famly switched
 * to the number's country once the full number was in), so the picker beside it is left alone.
 */
export function onlyDialCode(f: ScannedField): boolean {
  return f.kind === 'tel' && /^\+\d{1,4}\s*$/.test(f.value.trim())
}

/** A site error asking for a plain number: "Only use digits (0-9), dashes (-) or parentheses ()." */
const DIGITS_ONLY_RE = /only (use )?(digits|numbers|numeric)|digits \(0-9\)|numbers only|must be (a )?(number|numeric)|invalid (phone|number) format|whole number|decimal number/i

export function hasPhoneCountryPicker(fields: ScannedField[]): boolean {
  return fields.some(
    (f) =>
      // A typed "Country code" box beside the phone (Eightfold, Taleo) is a picker too.
      (!CHOICE_KINDS.has(f.kind) && /^(phone |dial(ling)? )?country\W*(region\W*)?code$|^dial(ling)? code$/i.test(f.label.trim())) ||
      /iti-\d+__|intl-tel|phone.?country|country.?phone|dial.?code|calling.?code|phone.?code|phone.?prefix/i.test(`${f.id} ${f.name} ${f.hint}`) ||
      isDialCodePicker(f) ||
      // Greenhouse: a "Country" box beside the phone whose value or options are dial codes ("+351").
      (CHOICE_KINDS.has(f.kind) && /^country$/i.test(f.label.trim()) && /\+\d{1,3}\b/.test(`${f.value} ${f.options.slice(0, 5).map((o) => o.label).join(' ')}`)),
  )
}

/** Common dial codes, for numbers whose own code is not known; longest match wins. */
const DIAL_CODES = new Set(
  '1 7 20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98 212 216 234 254 351 352 353 354 356 357 358 359 370 371 372 380 385 386 420 421 886 971 972 974 977'.split(
    ' ',
  ),
)

/** "+351 912-345-678" → "912345678" when the form already has the +351 picked; the person's own dial code is stripped first. */
export function nationalNumber(phone: string, dialCode?: string | null): string {
  const digits = phone.replace(/[^\d+]/g, '')
  if (!digits.startsWith('+')) return digits.replace(/^0/, '')
  const own = (dialCode ?? '').replace(/\D/g, '')
  if (own && digits.slice(1).startsWith(own)) return digits.slice(1 + own.length).replace(/^0/, '')
  for (const len of [3, 2, 1]) {
    const code = digits.slice(1, 1 + len)
    if (DIAL_CODES.has(code)) return digits.slice(1 + len).replace(/^0/, '')
  }
  return digits.slice(1)
}

export type Resolution =
  /** Put this in the field (text, or the option label to pick). */
  | { type: 'value'; value: string; source: 'profile' | 'bank' | 'rule' | 'cover_letter'; fallbacks?: string[]; within?: string }
  | { type: 'choices'; choices: string[]; source: 'rule' }
  | { type: 'checked'; checked: boolean; source: 'rule' }
  | { type: 'file'; path: string; source: 'resume' | 'cover_letter' | 'photo' }
  /** A standard detail you have not filled in yet (salary, notice period...). */
  | { type: 'pending'; stdKey: string; reason: string }
  /** Leave this field as it is (optional, nothing sensible to put). */
  | { type: 'skip'; reason: string }

const CHOICE_KINDS = new Set(['select', 'radio', 'combobox', 'listbox', 'buttons'])

/** "I have read / understood / been informed about" a privacy or data-processing notice. */
const READ_NOTICE_RE = /\b(read|reviewed|understood|received|been informed (about|of))\b.{0,100}\b(privacy|data protection|gdpr|personal (data|information)|data processing|processing|notice|policy|statement|information (notice|sheet|clause)|candidate (notice|information))/
/** Agreeing to the processing or storage of the person's data for this application. */
const DATA_CONSENT_RE = /\b(consent|agree|accept|authori[sz]e|allow)\b.{0,60}\b(process(ing)?|stor(e|age|ing)|retain|retention|use|collect(ion)?|handl(e|ing))\b.{0,60}\b(personal )?(data|information|details|application|cv|resume)\b/
/** Opt-ins for marketing, newsletters and alerts: always No. */
const MARKETING_OPT_IN_RE = /(newsletter|marketing|promotional|advertis|\bsms\b|text message|whatsapp|subscribe|job alerts?|receive (job )?(alerts|updates|news|offers))/
/** Signatures, compliance and conduct questions: never decided by the declaration rule (BNY incident). */
const DECLARATION_EXCLUDE_RE = /(signature|sign (below|here)|signed|e ?sign|criminal|convict|offen[cs]e|relative|family member|spouse|government|public official|politically exposed|conflict of interest|compliance|sanction|export control|insider|securities|bribe|disciplinary|dismissed|terminated|background check|drug test|security clearance)/


/** A YYYY-MM-DD date in the order a text date box shows in its placeholder ("DD/MM/YYYY", "MM.DD.YYYY"); ISO otherwise. */
export function dateInFormat(iso: string, placeholder: string): string {
  const [y, m, d] = iso.split('-')
  const p = placeholder.toLowerCase()
  const sep = p.match(/(?:dd|mm|jj|tt)\s*([./-])/)?.[1] ?? '/'
  if (/yyyy\s*[./-]\s*mm/.test(p)) return [y, m, d].join(p.match(/yyyy\s*([./-])/)?.[1] ?? '-')
  if (/(dd|jj|tt)\s*[./-]\s*mm/.test(p)) return [d, m, y].join(sep)
  if (/mm\s*[./-]\s*(dd|jj|tt)/.test(p)) return [m, d, y].join(sep)
  return iso
}

function optionLabels(f: ScannedField): string[] {
  return f.options.map((o) => o.label).filter(Boolean)
}

const DOC_RE = /\.(pdf|docx?|rtf|odt)\b|^(pdf|docx?|doc)\s/i
const COVER_RE = /cover|motivation|anschreiben|lettre|carta|letter/i

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

/** A list of uploaded documents to choose from ("PDF Alex-Rivera-CV.pdf 10/29/2026"). */
export function isDocumentChoice(labels: string[]): boolean {
  const docs = labels.filter((l) => DOC_RE.test(l.trim()))
  return docs.length > 0 && docs.length >= Math.ceil(labels.filter(Boolean).length / 2)
}

/** The CV among uploaded documents: its own file name first, then any CV / resume, never a cover letter; null when none. */
export function pickResumeOption(options: string[], cvFile: string): string | null {
  const stem = cvFile.replace(/\.[a-z0-9]+$/i, '').toLowerCase()
  const candidates = options.filter((o) => DOC_RE.test(o.trim()) && !COVER_RE.test(o))
  return (
    candidates.find((o) => stem && o.toLowerCase().includes(stem)) ??
    candidates.find((o) => /\bcv\b|resume|résumé|lebenslauf|curriculum/i.test(o.replace(/[-_]/g, ' '))) ??
    candidates[0] ??
    null
  )
}

/** Value for a choice field: the matching option when options are known, else the raw text (typed into comboboxes). */
function choose(f: ScannedField, wanted: string, source: 'profile' | 'bank' | 'rule'): Resolution | null {
  const opts = optionLabels(f)
  if (CHOICE_KINDS.has(f.kind) && opts.length) {
    const m = matchOption(wanted, opts)
    return m ? { type: 'value', value: m, source } : null
  }
  return { type: 'value', value: wanted, source }
}

const UNIT_DAYS: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 }

/** "2 months" → 60, "4 weeks" → 28, "Immediately" → 0; null when it names no length of time. */
export function durationDays(text: string): number | null {
  const t = text.toLowerCase()
  if (/immediate|right away|^now$|no notice/.test(t)) return 0
  const m = /(\d+(?:\.\d+)?)\s*(day|week|month|year)/.exec(t)
  return m ? Math.round(Number(m[1]) * UNIT_DAYS[m[2]]) : null
}

/** The option whose span holds `days` ("1-2 months", "30-60 days", "Less than 1 month", "3+ months"), else the nearest. */
export function durationOption(options: string[], days: number): string | null {
  let best: { label: string; dist: number } | null = null
  for (const label of options) {
    const t = label.toLowerCase()
    const unit = /(day|week|month|year)/.exec(t)?.[1]
    const nums = [...t.matchAll(/\d+(?:\.\d+)?/g)].map((x) => Number(x[0]) * (unit ? UNIT_DAYS[unit] : 1))
    let lo: number
    let hi: number
    if (/immediate|right away|no notice/.test(t) && !nums.length) [lo, hi] = [0, 0]
    else if (!unit || !nums.length) continue
    else if (/less than|under|up to|within|<|fewer than/.test(t)) [lo, hi] = [0, nums[0]]
    else if (/more than|over|\+|longer than|>|at least/.test(t)) [lo, hi] = [nums[0], Infinity]
    else [lo, hi] = [nums[0], nums[1] ?? nums[0]]
    const dist = days >= lo && days <= hi ? 0 : Math.min(Math.abs(days - lo), Math.abs(days - hi))
    if (!best || dist < best.dist) best = { label, dist }
  }
  return best?.label ?? null
}

function yesNoAnswer(f: ScannedField, yes: boolean): Resolution | null {
  const opts = optionLabels(f)
  if (opts.length) {
    const m = yesNo(opts, yes)
    return m ? { type: 'value', value: m, source: 'rule' } : null
  }
  if (f.kind === 'checkbox') return { type: 'checked', checked: yes, source: 'rule' }
  return { type: 'value', value: yes ? 'Yes' : 'No', source: 'rule' }
}

/** A standard detail from the bank; missing → pending when required, skip when optional. */
function fromStd(f: ScannedField, ctx: StandardContext, key: string, label: string, transform?: (v: string) => string): Resolution {
  const v = stdOf(ctx, key)
  if (v === '' ) return f.required ? { type: 'pending', stdKey: `std:${key}`, reason: `${label} is set to blank, but this form requires it` } : { type: 'skip', reason: `${label}: left blank by choice` }
  if (v === null || v === undefined) return f.required ? { type: 'pending', stdKey: `std:${key}`, reason: `${label} is not in your answers yet` } : { type: 'skip', reason: `${label}: not set` }
  const value = transform ? transform(v) : v
  return choose(f, value, 'bank') ?? (f.required ? { type: 'pending', stdKey: `std:${key}`, reason: `"${value}" is not one of the options for ${label}` } : { type: 'skip', reason: `no option matches ${value}` })
}

const DIVERSITY_RE = /\b(gender|sex|sexual orientation|sexuality|transgender|lgbt|race|racial|ethnic|ethnicity|hispanic|latino|latinx|veteran|disability|disabled|neurodiverg\w*|caste|religion|religious|faith|military status|caring responsibilit(y|ies)|carer|marital status|relationship status|age (bracket|range|group|band))\b/

/**
 * "Age Bracket" (Energy Aspects): the option whose range holds the person's age, from the date of birth.
 * Reads "25-34", "25 - 34", "25 to 34", "35+", "Under 25"; with no options yet, the usual 10-year band.
 */
export function ageBracketWords(age: number, options: string[]): string[] {
  const range = options.find((o) => {
    const r = /(\d{2})\s*(?:-|–|to)\s*(\d{2})/.exec(o)
    return !!r && age >= Number(r[1]) && age <= Number(r[2])
  })
  if (range) return [range]
  const open = options.find((o) => {
    const r = /(\d{2})\s*(\+|and (over|above)|or (older|over))/i.exec(o)
    return !!r && age >= Number(r[1])
  })
  if (open) return [open]
  const lo = age < 25 ? 18 : 25 + Math.floor((age - 25) / 10) * 10
  return [`${lo}-${lo + 9}`, `${lo} - ${lo + 9}`, `${lo} to ${lo + 9}`]
}

function ageFromBirth(dob: string | null | undefined, now = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob ?? '')
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  let age = now.getFullYear() - y
  if (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)) age--
  return age
}

/** A question that wants yes or no ("Do you...", "...are you able to..."), on a normalised label. */
const ASKS_YES_NO_RE = /^(do|does|did|are|is|was|were|have|has|will|would|can|could)\b|\b(do|does|did|are|have|will|would|can|could) you\b/

/** "Do you know anyone who works at (or is joining) ...", on a normalised label. */
const KNOWS_SOMEONE_RE = /\bknow (anyone|anybody|someone|somebody|any (current )?(employees?|staff|people))\b.{0,120}\b(works?|working|employed|joining)\b/

/** The "nobody / no" option of a people-you-know question. */
const NONE_OPTION_RE = /^(no|none|nobody|no one|n\/a|not applicable|nein|non)\b|\b(do not|don.?t) know (anyone|anybody)\b/i

/** A Yes/No (Ja/Nein) choice: a question about a country, not a box for one ("rechtlich zur Arbeit berechtigt in dem Land"). */
function isYesNoList(f: ScannedField): boolean {
  const opts = optionLabels(f)
  return opts.length > 0 && opts.length <= 4 && opts.every((o) => /^(yes|no|ja|nein|oui|non|si|sí)\b/i.test(o.trim()) && o.length < 40)
}

/** Wordings forms use for the same answer: [pattern on the saved answer, option wordings to try]. */
type Synonyms = Array<[RegExp, string[]]>

const ORIENTATION: Synonyms = [
  [/straight|hetero/i, ['Straight', 'Hetero']],
  [/^gay|homosexual/i, ['Gay', 'Gay man', 'Gay or lesbian', 'Gay or Lesbian', 'Homosexual']],
  [/lesbian/i, ['Lesbian', 'Gay woman', 'Gay or lesbian', 'Gay or Lesbian']],
  [/^bi/i, ['Bisexual', 'Bi']],
  [/pan/i, ['Pansexual', 'Bisexual or pansexual']],
  [/^a(sexual|ce)/i, ['Asexual', 'Ace']],
  [/queer/i, ['Queer']],
]
const CARING: Synonyms = [
  [/^(none|no)$/i, ['None', 'No caring responsibilities', 'I do not have caring responsibilities', 'No', 'Not applicable']],
  [/^yes|primary|carer/i, ['Yes', 'Primary carer', 'Yes - primary carer']],
]
const DISABILITY: Synonyms = [
  [/^no$/i, ['No, I do not have a disability', 'I do not have a disability', 'No, I don’t have a disability', 'No']],
  [/^yes$/i, ['Yes, I have a disability (or previously had a disability)', 'Yes, I have a disability', 'I have a disability', 'Yes']],
]
const ETHNICITY: Synonyms = [
  [/asian/i, ['Asian', 'Asian or Asian British', 'Asian or Pacific Islander', 'Asian - other']],
  [/black|african|caribbean/i, ['Black', 'Black or African American', 'Black or Black British', 'Black, African, Caribbean or Black British']],
  [/white|caucasian|european/i, ['White', 'White - other', 'Caucasian', 'White European']],
  [/hispanic|latin/i, ['Hispanic or Latino', 'Hispanic/Latino', 'Latino', 'Hispanic']],
  [/mixed|multi|two or more/i, ['Mixed', 'Mixed or multiple ethnic groups', 'Two or more races', 'Multiracial']],
  [/arab|middle east|north africa/i, ['Middle Eastern or North African', 'Middle Eastern', 'Arab']],
  [/native|indigenous|aboriginal/i, ['Indigenous', 'American Indian or Alaska Native', 'Native Hawaiian or Other Pacific Islander']],
]
const MARITAL: Synonyms = [
  [/^single$/i, ['Single, never married', 'Never married', 'Unmarried']],
  [/married|civil partner/i, ['Married', 'Married or in a civil partnership', 'Civil partnership']],
  [/divorc/i, ['Divorced', 'Divorced or civil partnership dissolved']],
  [/widow/i, ['Widowed', 'Widowed or surviving civil partner']],
  [/separat/i, ['Separated']],
]
const RELIGION: Synonyms = [
  [/^(none|no religion|atheis|agnost)/i, ['No religion', 'No religion or belief', 'None', 'Atheist', 'Agnostic']],
  [/christ|catholic|protestant|orthodox/i, ['Christian', 'Christianity', 'Catholic', 'Protestant']],
  [/islam|musl/i, ['Islam', 'Islamic']],
  [/hindu/i, ['Hindu', 'Hinduism']],
  [/jew|juda/i, ['Jewish', 'Judaism']],
  [/buddh/i, ['Buddhist', 'Buddhism']],
  [/sikh/i, ['Sikh', 'Sikhism']],
]

/** The saved answer, its usual wordings, and "<answer> community" (some lists name communities). */
function synonyms(table: Synonyms, extra: (v: string) => string[] = () => []): (v: string) => string[] {
  return (v) => [...new Set([v, ...(table.find(([re]) => re.test(v.trim()))?.[1] ?? []), ...extra(v)])]
}

/** An option of the same family as the saved answer ("Straight" -> "Hetero... / straight"), when no wording matched. */
function familyOption(f: ScannedField, table: Synonyms, v: string): Resolution | null {
  const re = table.find(([r]) => r.test(v.trim()))?.[0]
  const m = re ? optionLabels(f).find((o) => re.test(o.trim()) && !/prefer not|decline|rather not/i.test(o)) : undefined
  return m ? { type: 'value', value: m, source: 'bank' } : null
}

/** Diversity topics answered from the person's saved answers, with the usual wordings of each answer. */
const DIVERSITY_TOPICS: Array<{ re: RegExp; key: string; table: Synonyms; words: (v: string) => string[] }> = [
  { re: /sexual orientation|sexuality/, key: 'sexual_orientation', table: ORIENTATION, words: synonyms(ORIENTATION) },
  { re: /caring responsibilit|\bcarer\b/, key: 'caring_responsibilities', table: CARING, words: synonyms(CARING) },
  { re: /disab|neurodiverg|long.?term (health )?condition/, key: 'disability', table: DISABILITY, words: synonyms(DISABILITY) },
  { re: /ethnic|\brace\b|racial/, key: 'ethnicity', table: ETHNICITY, words: synonyms(ETHNICITY) },
  { re: /marital status|relationship status|civil status/, key: 'marital_status', table: MARITAL, words: synonyms(MARITAL) },
  { re: /religio|\bfaith\b|belief/, key: 'religion', table: RELIGION, words: synonyms(RELIGION, (v) => [`${v} community`]) },
]

/** Gender wordings: "Male" may be offered as "Man" or "Cisgender man", and so on. */
const GENDER: Synonyms = [
  [/^(male|man)$/i, ['Male', 'Man', 'Cisgender man', 'Cis man']],
  [/^(female|woman)$/i, ['Female', 'Woman', 'Cisgender woman', 'Cis woman']],
  [/non.?binary|enby|genderqueer/i, ['Non-binary', 'Nonbinary', 'Non binary', 'Genderqueer/Non-binary', 'Gender non-conforming']],
  [/trans\w* (wo)?man/i, ['Transgender', 'Trans']],
]

/**
 * The first wording the options know. A list that loads only while typing (SmartRecruiters) has no options
 * yet: type the first wording and let the filler try the others ("Male", then "Man").
 */
function oneOf(f: ScannedField, words: string[], source: 'bank' | 'rule'): Resolution | null {
  if (CHOICE_KINDS.has(f.kind) && !optionLabels(f).length) return { type: 'value', value: words[0], source, ...(words.length > 1 ? { fallbacks: words.slice(1) } : {}) }
  return words.map((w) => choose(f, w, source)).find(Boolean) ?? null
}

function diversityAnswer(f: ScannedField, l: string, ctx: StandardContext): Resolution | null {
  const topic = DIVERSITY_TOPICS.find((t) => t.re.test(l))
  const v = topic ? stdOf(ctx, topic.key) : null
  if (!topic || !v) return null
  if (/prefer not|decline|rather not/i.test(v)) {
    const d = declineOption(optionLabels(f))
    if (d) return { type: 'value', value: d, source: 'bank' }
    return optionLabels(f).length ? null : oneOf(f, [v, 'Prefer not to say', 'I prefer not to say', 'Prefer not to disclose', 'Decline to self-identify'], 'bank')
  }
  return oneOf(f, topic.words(v), 'bank') ?? familyOption(f, topic.table, v)
}


/**
 * The "I need sponsorship" entry of a status list. Never a "do not require" one, and never one that
 * claims a visa or right the person does not have ("I have a visa that gives me temporary right to work in
 * the UK, and might need sponsorship in the future"); "I do not currently have ... and will require
 * sponsorship" is the one.
 */
export function sponsorshipOption(opts: string[]): string | undefined {
  const needs = (o: string) => /(requir|need)\w*.{0,40}(sponsor|visa|permit)|sponsorship (is )?(required|needed)|^sponsorship$/i.test(o)
  const deniesNeed = (o: string) => /\b(do not|don.?t|does not|doesn.?t|will not|won.?t)\s+(currently\s+)?(require|need)|\bno sponsorship|without (visa |any )?sponsorship/i.test(o)
  const deniesRight = (o: string) => /\b(do not|don.?t)\s+(currently\s+)?(have|hold)\b/i.test(o)
  // "Non-EU citizen requiring sponsorship" names a citizenship the person does not claim.
  const claimsRight = (raw: string) => {
    const o = raw.replace(/\bnon[- ]?[\w/]+ (citizen|national)s?\b/gi, '')
    return !deniesRight(o) && /\b(i (already |currently )?(have|hold)|gives me|i.?m an? |i am an? |citizen|permanent resident|indefinite leave|settled status)\b/i.test(o)
  }
  return opts.find((o) => needs(o) && !deniesNeed(o) && !claimsRight(o))
}

/**
 * The status-list entry for someone with the right to work in the job's country ("EU citizen", "I do not
 * require sponsorship"), never one that claims a citizenship or permit the person does not hold.
 */
export function rightToWorkOption(opts: string[], c: CandidateContext, countryCode: string | null | undefined): string | undefined {
  const needs = (o: string) => /(requir|need)\w*.{0,40}(sponsor|visa|permit)/i.test(o) && !/\b(do not|don.?t|does not|will not|won.?t|no)\s+(currently\s+)?(require|need)/i.test(o)
  const fits = opts.filter((o) => !needs(o) && !claimsFalseRight(o, c, countryCode))
  const own = c.citizenshipNames.map((n) => n.slice(0, 5).toLowerCase()).filter(Boolean)
  return (
    fits.find((o) => own.some((n) => o.toLowerCase().includes(n))) ??
    fits.find((o) => /\b(eu|eea)\b|european union/i.test(o) && c.citizenships.some((x) => FREE_MOVEMENT.has(x))) ??
    fits.find((o) => /(do not|don.?t|no)\s+(currently\s+)?(require|need)|without (visa |any )?sponsorship|authori[sz]ed to work|right to work|eligible to work/i.test(o))
  )
}

/** A first-person sentence about the right to work in the job's country, or null when the profile does not say. */
function workRightsLine(ctx: StandardContext): string | null {
  const c = person(ctx)
  const where = ctx.jobCountry || 'this country'
  const right = ctx.candidate ? hasRightToWork(c, ctx.jobCountryCode) : null
  const cit = c.citizenshipNames.length ? `I am a citizen of ${c.citizenshipNames.join(' and ')}` : ''
  if (right === true) return `${cit ? `${cit}. ` : ''}I have the right to work in ${where} and do not need visa sponsorship.`
  if (right === false) return `${cit ? `${cit}${c.location ? `, based in ${c.location}` : ''}. ` : ''}I do not hold a work permit for ${where} yet and would need visa sponsorship.`
  return null
}

/** Work authorisation as text. A short box gets a short truthful line instead of a cut-off statement. */
function workAuthText(f: ScannedField, ctx: StandardContext): Resolution {
  const need = sponsorshipNeed(ctx)
  const own = person(ctx).workAuth.authorizationText
  // With the right to work there, the country-specific line beats a general statement written for other countries.
  const statement = need === false ? (workRightsLine(ctx) ?? stdOf(ctx, 'work_authorization')) : (own ?? stdOf(ctx, 'work_authorization') ?? workRightsLine(ctx))
  if (!statement) return needsPerson(f, 'std:work_authorization', 'Work authorisation is not in your profile yet')
  if (f.maxLength && statement.length > f.maxLength) {
    if (need === true) return { type: 'value', value: 'None yet - I would need visa sponsorship', source: 'rule' }
    if (need === false) return { type: 'value', value: 'Yes - no sponsorship needed', source: 'rule' }
  }
  return { type: 'value', value: statement, source: 'bank' }
}

/** A box for the code a site emails after Submit (Greenhouse "security code", "enter the 8-character code"). */
export function isEmailedCodeField(f: Pick<ScannedField, 'kind' | 'label'>): boolean {
  if (f.kind !== 'text' && f.kind !== 'number' && f.kind !== 'tel') return false
  return /(security|verification|confirmation|one.?time) code|\bpasscode\b|\botp\b|enter the \d+.?(character|digit) code/i.test(f.label)
}

const CV_WORD = /resume|\bcv\b|curriculum|lebenslauf/i
const COVER_WORD = /cover.?letter|motivation(al)? letter|letter of motivation|anschreiben|lettre de motivation/i

/**
 * A form step that is only about the cover letter (JOIN's /apply/coverLetter, "Upload your cover letter"):
 * its heading, or null. Its upload box says only "Upload file" and its input is named like the CV box, so
 * the CV went in there (xHeron, WePush).
 */
export function coverLetterStep(scan: { url: string; headings: string[] }): string | null {
  let path = ''
  try {
    path = decodeURIComponent(new URL(scan.url).pathname)
  } catch {
    // Not a web page.
  }
  const heading = scan.headings.find((h) => COVER_WORD.test(h) && !CV_WORD.test(h))
  if (heading) return heading.slice(0, 120)
  if (/cover.?letter|anschreiben|motivation/i.test(path) && !scan.headings.some((h) => CV_WORD.test(h))) return 'Cover letter'
  return null
}

export function resolveStandard(f: ScannedField, ctx: StandardContext): Resolution | null {
  const l = normalizeQuestion(f.label)
  const h = `${f.name} ${f.id} ${f.hint}`.toLowerCase()
  const both = `${l} ${h}`
  const opts = optionLabels(f)

  // ---- "Recommendation by (last name, first name)" / "Referred by": nobody referred the person ----
  // (Thieme got the family name from the last-name rule.)
  if ((f.kind === 'text' || f.kind === 'textarea') && /\b(recommend(ation|ed)? by|referred by|referr(al|er)('s)? (name|email)|who referred|(name|email) of (the )?(person|employee|colleague) who (referred|recommended))\b/.test(l)) {
    return f.required ? { type: 'value', value: 'Not applicable', source: 'rule' } : { type: 'skip', reason: 'not referred by anyone' }
  }

  // ---- one-time codes ("A verification code was sent to ...", "Security code") --------------
  // Never a saved answer: Submit reads the code the site just emailed from Gmail (submitAndConfirm).
  if (isEmailedCodeField(f)) return { type: 'skip', reason: 'emailed code, read from Gmail at Submit' }

  // ---- Workday date of signature (self-identification page) ----------------
  if (/datesection(month|day|year)/i.test(f.hint)) {
    const v = workdayDateValue(f)
    if (v) return { type: 'value', value: v, source: 'rule' }
  }
  // A signature line ("Name" + "Date" under a declaration): today's date.
  if (/^(date|today.?s date|date signed|signature date|date of signature)$/.test(l) && (f.kind === 'text' || f.kind === 'date')) {
    return { type: 'value', value: signatureDate(f), source: 'rule' }
  }

  // ---- export control ("Is your citizenship one of the following countries: Cuba, Iran...?") ----
  if (/one of the following (countries|regions|countries or regions)/.test(l) && (opts.length === 0 || opts.every((o) => /^(yes|no)\b/i.test(o.trim())))) {
    const mine = [stdOf(ctx, 'country'), stdOf(ctx, 'nationality')].filter((c): c is string => !!c).map((c) => normalizeQuestion(c).replace(/i$/, ''))
    return yesNoAnswer(f, mine.some((c) => c.length > 3 && l.includes(c)))
  }
  // "Do you have an EU citizenship?" / "Are you a UK citizen or passport holder?" (Yes/No): yes only for the person's own.
  if (/\b(citizen(ship)?|passport|nationality)\b/.test(l) && opts.length && opts.every((o) => /^(yes|no|ja|nein|oui|non)\b/i.test(o.trim()))) {
    const mine = [stdOf(ctx, 'nationality'), ...person(ctx).citizenshipNames].filter((c): c is string => !!c).map((c) => normalizeQuestion(c).replace(/i$/, ''))
    const words = mine.flatMap((c) => [c, c.slice(0, Math.max(4, Math.min(6, c.length)))])
    const eu = /\beu\b|european union|\beea\b/.test(l) && person(ctx).citizenships.some((x) => FREE_MOVEMENT.has(x))
    return yesNoAnswer(f, eu || words.some((c) => c.length > 3 && l.includes(c)))
  }

  // ---- files -------------------------------------------------------------
  if (f.kind === 'file') {
    // A photo box first: Scalable's "Upload profile image" mentions the resume in its hint and got the CV.
    if (/\b(photo|picture|headshot|portrait|foto|bewerbungsfoto|bild)\b|profile (image|pic)/.test(l)) {
      if (ctx.photoPath) return { type: 'file', path: ctx.photoPath, source: 'photo' }
      return f.required ? { type: 'pending', stdKey: 'photo', reason: 'A photo is required but none is saved (storage/photo.jpg)' } : { type: 'skip', reason: 'optional photo' }
    }
    // A box on a cover-letter step ("Upload your cover letter" over "Upload file"): the letter, never the CV,
    // whatever the input's name says (JOIN reuses its CV box there). Only the box's own words can say CV.
    if (COVER_WORD.test(f.section) && !CV_WORD.test(`${l} ${f.section}`)) {
      if (ctx.coverLetterPath) return { type: 'file', path: ctx.coverLetterPath, source: 'cover_letter' }
      return f.required ? { type: 'pending', stdKey: 'cover_letter', reason: 'A cover letter file is required but none is ready' } : { type: 'skip', reason: 'optional cover letter file' }
    }
    // The site's own message counts too: "Browse on your Device" with "Please upload your resume file." (Picnic).
    if (/resume|\bcv\b|curriculum|lebenslauf/.test(`${both} ${(f.error ?? '').toLowerCase()}`)) return { type: 'file', path: ctx.resumePath, source: 'resume' }
    // A box labelled only "Choose a file or drop it here" under a "Resume" heading (SmartRecruiters).
    const generic = !l || /choose a file|drop (it|a file|files|your file)? ?here|^upload|^attach|^browse/.test(l)
    if (generic && /resume|\bcv\b|curriculum|lebenslauf/.test(f.section.toLowerCase())) return { type: 'file', path: ctx.resumePath, source: 'resume' }
    // A box labelled only by its file rules, "Accepted file format: docx or pdf" (Eightfold, John Deere): the CV box.
    if (/^(accepted|allowed|supported) (file )?(formats?|types?)|^file (formats?|types?)|^max(imum)? (file )?size|^(pdf|docx?)( or | | and )?(pdf|docx?)?$/.test(l) && !/cover|motivation|anschreiben/.test(both)) {
      return { type: 'file', path: ctx.resumePath, source: 'resume' }
    }
    // A photo field (Recruitee/Signifly "Photo", German "Foto/Bewerbungsfoto") gets the person's photo, never the CV.
    if (/\b(photo|picture|headshot|portrait|foto|bewerbungsfoto|bild)\b|profile (image|pic)/.test(both) && !/resume|\bcv\b|cover/.test(both)) {
      if (ctx.photoPath) return { type: 'file', path: ctx.photoPath, source: 'photo' }
      return f.required ? { type: 'pending', stdKey: 'photo', reason: 'A photo is required but none is saved (storage/photo.jpg)' } : { type: 'skip', reason: 'optional photo' }
    }
    if (/cover|motivation|anschreiben/.test(both)) {
      if (ctx.coverLetterPath) return { type: 'file', path: ctx.coverLetterPath, source: 'cover_letter' }
      return f.required ? { type: 'pending', stdKey: 'cover_letter', reason: 'A cover letter file is required but none is ready' } : { type: 'skip', reason: 'optional cover letter file' }
    }
    // "Other documents" / "Additional files" / "Övriga dokument": the cover letter goes there.
    if (/other|additional|further|supporting|övriga|weitere|autres|overige|more (documents|files)/.test(`${both} ${f.section.toLowerCase()}`) && ctx.coverLetterPath) return { type: 'file', path: ctx.coverLetterPath, source: 'cover_letter' }
    if (!f.required) return { type: 'skip', reason: 'optional attachment' }
    // One unnamed required upload on a form is almost always the CV. So is one that borrowed another
    // question's label ("What is your full name?" on Alcor's careers page).
    if (!l || /attach|upload|file|document|dokument|browse|choose|your device/.test(l)) return { type: 'file', path: ctx.resumePath, source: 'resume' }
    if (!/certificat|diploma|transcript|reference|portfolio|passport|\bid\b|identity|photo|picture|work sample|writing sample/.test(both)) return { type: 'file', path: ctx.resumePath, source: 'resume' }
    return null
  }

  // ---- "choose a resume" lists of documents already uploaded (LinkedIn Easy Apply) ----------
  // LinkedIn pre-selects the newest upload: a cover letter uploaded once became the default "resume"
  // and once went out with 8 applications. Always pick the CV; never a cover letter.
  if ((f.kind === 'radio' || f.kind === 'select') && isDocumentChoice([f.label, ...opts])) {
    const pick = pickResumeOption(opts.length ? opts : [f.label], basename(ctx.resumePath))
    if (pick) return { type: 'value', value: pick, source: 'rule' }
    return { type: 'pending', stdKey: 'resume_choice', reason: 'The resume list offers only cover letters; upload or pick your CV there' }
  }

  // ---- single checkboxes (consent, marketing, talent pool) ----------------
  if (f.kind === 'checkbox') {
    if (/(newsletter|marketing|promotional|\bsms\b|text message|whatsapp|receive (job )?(alerts|updates|news|offers)|subscribe|job alerts)/.test(l)) {
      return { type: 'checked', checked: f.required, source: 'rule' }
    }
    if (/(future (job )?(opportunit|role|position|vacanc|opening)|talent (pool|community|network)|keep (my )?(data|application|information|details|cv|resume)|retain my|other (suitable )?(roles|positions|vacancies)|contact me about)/.test(l)) {
      return { type: 'checked', checked: true, source: 'rule' }
    }
    if (/(privacy|data protection|gdpr|datenschutz|consent|i agree|agree to|accept|acknowledge|terms|processing|certify|attest|confirm that|declare|i understand|i have read|read and|einwilligung|zustimmung|concordo|aceito|acepto|accetto|j.?accepte|ich stimme|ich erkläre|ich bestätige|erkläre hiermit|bestätige hiermit|je (déclare|certifie|confirme)|ik verklaar|declaro|akkoord|godk[aä]nner|accepterer)/.test(l)) {
      return { type: 'checked', checked: true, source: 'rule' }
    }
    if (/(18|eighteen) (years|or older)|at least 18|over 18/.test(l)) return { type: 'checked', checked: true, source: 'rule' }
    return null
  }

  // "Please confirm that all information provided is accurate and up to date" as Yes/No: it is
  // (Simon-Kucher's form got "No" and would not submit).
  if (CHOICE_KINDS.has(f.kind) && opts.length && opts.every((o) => /^(yes|no|ja|nein|oui|non)\b/i.test(o.trim())) && /(confirm|certify|attest|declare|verify).{0,80}(accurate|true|correct|complete|up to date)/.test(l)) {
    return yesNoAnswer(f, true)
  }

  // ---- reading / data-processing declarations as Yes/No ---------------------
  // "You declare that you have read the information on the processing of your personal data" got No on one form and Yes
  // on a similar one. Having read a privacy notice, or agreeing to the processing of the person's data for this application, is
  // Yes; marketing opt-ins are No. Signatures, compliance and conduct questions are never decided here.
  if (CHOICE_KINDS.has(f.kind) && opts.length && opts.length <= 4 && opts.some((o) => /^(yes|no)\b/i.test(o.trim())) && !DECLARATION_EXCLUDE_RE.test(l)) {
    if (MARKETING_OPT_IN_RE.test(l)) return yesNoAnswer(f, false)
    if (READ_NOTICE_RE.test(l) || DATA_CONSENT_RE.test(l)) return yesNoAnswer(f, true)
  }

  // ---- privacy statements as a dropdown ("I have read and acknowledge") -----
  if (CHOICE_KINDS.has(f.kind) && opts.length && /(privacy|data protection|gdpr|consent|terms|policy|statement|notice|acknowledg)/.test(l) && !MARKETING_OPT_IN_RE.test(l) && !DECLARATION_EXCLUDE_RE.test(l)) {
    // "I have read", "I've read it 👍", "Yes, I agree".
    const yes = opts.find((o) => /\bi(['’]ve| have)? (read|acknowledge|agree|accept|consent|understand|confirm)|^(yes|agree|accept|acknowledge|i do|confirmed?)\b/i.test(o.trim()))
    if (yes) return { type: 'value', value: yes, source: 'rule' }
  }

  // ---- email -------------------------------------------------------------
  if ((f.kind === 'email' || /\be ?mail\b/.test(l) || /email/.test(h)) && !/(consent|receive|subscribe|marketing|newsletter|alert|referr|recruiter|manager)/.test(l) && !CHOICE_KINDS.has(f.kind)) {
    return { type: 'value', value: ctx.email, source: 'profile' }
  }

  // ---- names -------------------------------------------------------------
  if (!CHOICE_KINDS.has(f.kind) && f.kind !== 'textarea') {
    if (/middle name/.test(l)) return { type: 'skip', reason: 'middle name' }
    if (/preferred (first )?name|nickname|known as|name you go by|preferred full name/.test(l)) return fromStd(f, ctx, 'preferred_name', 'Preferred name')
    // One box for both ("Name & Surname" at NoFluffJobs got only the family name): the whole name.
    if (/(first )?name (and |& |\+ |\/ )?(sur|last |family )name|first (and |& )?last name|imię i nazwisko|vor.? und nachname|nom et prénom|prénom et nom|nombre y apellidos?/.test(l)) {
      return { type: 'value', value: ctx.fullName, source: 'profile' }
    }
    if (/(^|\b)(legal )?(first|given) name|forename|vorname|prénom|^first$|first_name|firstname/.test(both) && !/last|family/.test(l)) return fromStd(f, ctx, 'first_name', 'First name')
    if (/last name|surname|family name|nachname|nom de famille|^nom$|last_name|lastname/.test(both)) return fromStd(f, ctx, 'last_name', 'Last name')
    if (/^(full |your |legal |candidate |applicant )?name$|full (legal )?name|vollständiger name|nom complet|^name name$|_systemfield_name/.test(both) || (l === 'name' && f.kind === 'text')) {
      return { type: 'value', value: ctx.fullName, source: 'profile' }
    }
  }

  // ---- phone -------------------------------------------------------------
  if (/phone device type|device type/.test(l)) return choose(f, 'Mobile', 'rule')
  // Workday "Phone Extension" is optional; the number must never land in it.
  if (/^(phone )?extension$/.test(l)) return { type: 'skip', reason: 'no phone extension' }
  // "Country/Region Code" typed beside the phone (Taleo, SuccessFactors): the dial code.
  if (!CHOICE_KINDS.has(f.kind) && /^country\W*(region\W*)?code$/.test(l)) {
    const cc = person(ctx).phoneCountryCode?.replace(/\D/g, '') || /^\+(\d{1,3})/.exec((stdOf(ctx, 'phone') ?? '').replace(/\s/g, ''))?.[1]
    // "Only use digits (0-9), dashes or parentheses" (Eightfold): no plus sign.
    if (cc) return { type: 'value', value: DIGITS_ONLY_RE.test(f.error ?? '') ? cc : `+${cc}`, source: 'bank' }
  }
  // The number typed with its dial code was meant to set this picker on its own (Recruitee), but it once
  // stayed on "Netherlands" / "United Kingdom" and Recruitee answered 422 "Something went wrong"
  // (DPG Media, Delta Capita); by hand, with the right country picked, the same form went through. Leave the
  // picker only when it already shows the person's country; otherwise pick it below.
  if (ctx.phoneTypesDialCode && isDialCodePicker(f)) {
    const country = (stdOf(ctx, 'phone_country') || stdOf(ctx, 'country') || '').toLowerCase()
    if (!country || `${f.label} ${f.value}`.toLowerCase().includes(country)) return { type: 'skip', reason: 'the country code already matches the phone number' }
  }
  // "Phone prefix" (Factorial) left on its default "Spain (+34)" made the number invalid (THEKER).
  if ((CHOICE_KINDS.has(f.kind) && /(phone|country|dial|calling)\W*(region\W*)?(code|prefix)|phone country|country of (your )?phone|^country code|^prefix$/.test(l)) || (CHOICE_KINDS.has(f.kind) && /phone/.test(l))) {
    const country = stdOf(ctx, 'phone_country') || stdOf(ctx, 'country') || ''
    const byName = opts.find((o) => country && o.toLowerCase().includes(country.toLowerCase()))
    if (byName) return { type: 'value', value: byName, source: 'bank' }
    const phone = stdOf(ctx, 'phone') ?? ''
    const cc = person(ctx).phoneCountryCode?.replace(/\D/g, '') || /^\+(\d{1,3})/.exec(phone.replace(/\s/g, ''))?.[1]
    const byCode = cc ? opts.find((o) => new RegExp(`\\+?\\b${cc}\\b`).test(o)) : undefined
    if (byCode) return { type: 'value', value: byCode, source: 'bank' }
    if (opts.length === 0 && country) return { type: 'value', value: country, source: 'bank' }
    return null
  }
  if (f.kind === 'tel' || /\b(phone|mobile|telephone|telefon|telefonnummer|téléphone|cell|handy|contact number)\b/.test(l)) {
    if (!CHOICE_KINDS.has(f.kind) && f.kind !== 'textarea') {
      const digitsOnly = DIGITS_ONLY_RE.test(f.error ?? '')
      const dial = person(ctx).phoneCountryCode
      const national = ctx.phoneHasCountryPicker && !onlyDialCode(f) && !ctx.phoneTypesDialCode ? (v: string) => nationalNumber(v, dial) : undefined
      return fromStd(f, ctx, 'phone', 'Phone number', digitsOnly ? (v) => (national ? national(v) : v).replace(/\D/g, '') : national)
    }
  }

  // ---- links -------------------------------------------------------------
  // "Link 1", "Link 2", "Website 3": numbered boxes take the person's links in turn, LinkedIn first, then
  // portfolio, GitHub, Behance, Dribbble, X (a blank "Link 2" failed the site's URL check).
  const numbered = /^(link|url|website|web link|profile link|additional link|social link)\s*(\d)$/.exec(l)
  if (numbered && !CHOICE_KINDS.has(f.kind)) {
    const links = [...new Set(LINK_ORDER.map((k) => stdOf(ctx, k)).filter((v): v is string => !!v))]
    const link = links.length ? links[(Number(numbered[2]) - 1) % links.length] : null
    return link ? { type: 'value', value: link, source: 'bank' } : needsPerson(f, 'std:website', 'No links in your profile yet')
  }
  if (/linkedin/.test(both) && !CHOICE_KINDS.has(f.kind)) return fromStd(f, ctx, 'linkedin', 'LinkedIn URL')
  if (/github|git hub/.test(both) && !CHOICE_KINDS.has(f.kind)) return fromStd(f, ctx, 'github', 'GitHub URL')
  // Profiles the person saved (X, Behance, Dribbble) go in their own boxes; other social profiles stay empty.
  if (/twitter|\bx com\b|^x( twitter| formerly twitter)?( profile| handle| account)?( url| link)?$/.test(l) && !CHOICE_KINDS.has(f.kind)) return fromStd(f, ctx, 'twitter', 'X (Twitter) URL')
  if (/behance/.test(both) && !CHOICE_KINDS.has(f.kind)) return fromStd(f, ctx, 'behance', 'Behance URL')
  if (/dribbble/.test(both) && !CHOICE_KINDS.has(f.kind)) return fromStd(f, ctx, 'dribbble', 'Dribbble URL')
  if (/facebook|instagram|stack ?overflow|tiktok|youtube/.test(l) && !CHOICE_KINDS.has(f.kind)) {
    return f.required ? null : { type: 'skip', reason: 'social profile not used' }
  }
  if ((f.kind === 'url' || /portfolio|personal (website|site|page)|\bwebsite\b|homepage|\bblog\b|^url$|other (link|website|url)|urls other|urls portfolio/.test(both)) && !CHOICE_KINDS.has(f.kind) && f.kind !== 'textarea') {
    return fromStd(f, ctx, 'website', 'Website')
  }

  // "Which location are you applying for?": the job's own office, not where the person lives now.
  if (/(which|what) (office |work )?(location|office|city|hub)s? (are you|would you like to be|do you want to be|you are|you re) (applying|interested|considered)|location (you are|you re) applying|preferred (office|work location)|which of (our|the|these) (offices|locations)|location you will be based in/.test(l)) {
    const place = (ctx.jobLocation ?? '').split(/,|\/|\bor\b|;|\|/)[0].replace(/\s*\(.*\)\s*/g, ' ').trim()
    const tries = [place, ctx.jobCountry].filter((x): x is string => !!x)
    if (CHOICE_KINDS.has(f.kind) && opts.length) {
      for (const t of tries) {
        const m = matchOption(t, opts) ?? opts.find((o) => normalizeQuestion(o).includes(normalizeQuestion(t)))
        if (m) return { type: 'value', value: m, source: 'rule' }
      }
      return null
    }
    if (place) return { type: 'value', value: place, source: 'rule' }
  }

  // ---- location ----------------------------------------------------------
  const isWorkQuestion = /(authori[sz]|eligib|permit|visa|sponsor|rights? to work|legally|relocat|willing|work in|based in .* office)/.test(l)
  if (!isWorkQuestion) {
    if (/address line 2|address 2|apartment|suite|^apt/.test(l)) {
      if (!f.required) return { type: 'skip', reason: 'second address line' }
      // Required anyway: the area from the street address ("12 Example Road, Old Town" → "Old Town"), else the city.
      const parts = (stdOf(ctx, 'address_line1') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
      const area = parts.length > 1 ? parts.at(-1) : stdOf(ctx, 'city')
      return area ? { type: 'value', value: area, source: 'bank' } : fromStd(f, ctx, 'address_line1', 'Street address')
    }
    // One box for the whole address ("Address", "Home address"): all of it, unless the form asks for city/postcode apart.
    if (/^((home|full|residential|current|permanent|mailing|postal|your|your home|current home|full home) )?address$/.test(l) && !CHOICE_KINDS.has(f.kind)) {
      if (ctx.addressHasParts) return fromStd(f, ctx, 'address_line1', 'Street address')
      const line1 = stdOf(ctx, 'address_line1')
      if (!line1) return fromStd(f, ctx, 'address_line1', 'Street address')
      const town = [stdOf(ctx, 'city'), stdOf(ctx, 'postal_code')].filter(Boolean).join(' ')
      return { type: 'value', value: [line1, town, stdOf(ctx, 'country')].filter(Boolean).join(', '), source: 'bank' }
    }
    if (/postal|zip|post code|postcode|\bplz\b|code postal/.test(both)) return fromStd(f, ctx, 'postal_code', 'Postal code')
    if (/(street|address line 1|address 1|^address$|street address|adresse|anschrift|addressline1|address_line_1)/.test(both) && f.kind !== 'textarea') return fromStd(f, ctx, 'address_line1', 'Street address')
    if (/nationality|citizenship|staatsangeh|nationalit|country of citizenship/.test(l)) {
      const nat = stdOf(ctx, 'nationality')
      if (nat && opts.length) {
        const country = stdOf(ctx, 'country') ?? ''
        const m = matchOption(nat, opts) ?? (country ? matchOption(country, opts) : null)
        if (m) return { type: 'value', value: m, source: 'bank' }
        // Diversity-style lists ("Please specify" / "I don't wish to answer") have no country to pick.
        const decline = declineOption(opts)
        if (decline) return { type: 'value', value: decline, source: 'rule' }
        // Export-control lists ("N/A" / "Iran, Cuba, Syria or North Korea" / "another country"): one citizenship, none of those.
        const na = opts.find((o) => /^(n\/?a|not applicable)\b/i.test(o.trim()))
        if (na) return { type: 'value', value: na, source: 'rule' }
      }
      return fromStd(f, ctx, 'nationality', 'Nationality')
    }
    // The label alone too: "Location" named "location" reads "location location " together and slipped
    // through to an old "Locations: Dublin, Ireland" answer (HYPE).
    const whereLives = /^(current )?(location|city)( city)?$|location city|where (are you|do you) (currently )?(based|located|live)|city of residence|current (city|location)|\bwohnort\b|\bville\b|^city|^town|candidate location/
    if (whereLives.test(l) || whereLives.test(both) || /^currently (based|located|living)( in)?$/.test(l)) {
      const city = stdOf(ctx, 'city')
      const country = stdOf(ctx, 'country')
      if (!city) return fromStd(f, ctx, 'city', 'City')
      const full = country ? `${city}, ${country}` : city
      // Fixed region lists ("EMEA - Other", "Rest of world") may not name the city: the filler tries the country
      // and its region next. A City search box only takes the city or "Other" (SmartRecruiters typed a region
      // word and offered a village of that name).
      const cityBox = /\bcity\b|\btown\b|wohnort|ville|residence/.test(l)
      // A city box never gets another word typed: the city's first suggestion, or nothing ("Other" once picked a wrong town).
      const fallbacks = (cityBox ? [] : [country, ...regionWords(person(ctx).country)]).filter((x): x is string => !!x)
      if (f.kind === 'combobox') {
        const known = f.asyncOptions || opts.length === 0 ? null : [full, city, ...fallbacks].map((w) => matchOption(w, opts)).find(Boolean)
        return { type: 'value', value: known ?? city, source: 'bank', fallbacks, ...(country && !known ? { within: country } : {}) }
      }
      if (CHOICE_KINDS.has(f.kind)) return choose(f, city, 'bank') ?? (country ? choose(f, country, 'bank') : null)
      return { type: 'value', value: /city|town|ville|ort/.test(l) && !/location/.test(l) ? city : full, source: 'bank' }
    }
    if (/^country|country of residence|country you (live|reside)|current country|residence country|\bland\b|\bpays\b|addresssection country|country region|(home |postal |mailing |residential )?address country|home country/.test(both) && !/phone|code|dial/.test(l) && !isYesNoList(f)) return fromStd(f, ctx, 'country', 'Country')
    // "What Country/US-State do you currently reside?" is a country question (it got the region).
    // "Your basic annual gross salary expectation (Please state currency)" got the region (Kpler): "state" the verb is no region.
    if (/\b(state|province|region|county|division|bundesland)\b/.test(l) && !/united states|statement|\bcountry\b|salary|compensation|currency|\bpay\b|\brate\b|please state|state (your|the|in|which|what|how|why|whether|if)\b/.test(l)) return fromStd(f, ctx, 'region', 'Region')
  }

  // ---- current job -------------------------------------------------------
  // "Where are you currently employed or where were you last employed?" (OKX on Greenhouse).
  if (!CHOICE_KINDS.has(f.kind) && /where (are|do) you (currently )?(employed|work(ing)?)|(currently|last|most recently) employed|who (is|was) your (current|last|most recent) employer|name of (your )?(current|last) employer/.test(l)) {
    return fromStd(f, ctx, 'current_company', 'Current employer')
  }
  if (!CHOICE_KINDS.has(f.kind) && f.kind !== 'textarea') {
    if (/current (company|employer)|present (company|employer)|most recent (company|employer)|^company( name)?$|^employer( name)?$|current organi[sz]ation|^org$|^organi[sz]ation$/.test(both) || f.name === 'org') return fromStd(f, ctx, 'current_company', 'Current employer')
    if (/current (job )?title|current (position|role)|^(job )?title$|most recent (job )?title|^headline$|current designation/.test(l)) return fromStd(f, ctx, 'current_title', 'Current job title')
  }

  // ---- experience --------------------------------------------------------
  if (/(years of (professional |relevant |work |industry |total |software |engineering )?experience|how many years|total experience|experience in years|years experience)/.test(l) && !/\b(with|using|in) [a-z]/.test(l.replace(/years of (professional |relevant |work |industry |total |software |engineering )?experience in (software|the industry|engineering)/, ''))) {
    const years = ctx.yearsExperience
    if (opts.length) {
      const r = rangeOption(years, opts)
      return r ? { type: 'value', value: r, source: 'profile' } : null
    }
    return { type: 'value', value: String(Math.floor(years)), source: 'profile' }
  }

  // ---- salary, notice, start ---------------------------------------------
  // Your current pay is a fact only you know: never a guess (Version 1 got "5").
  if (/(current|present|existing) (base )?(salary|ctc|compensation|pay|remuneration)/.test(l)) return fromStd(f, ctx, 'current_salary', 'Current salary')
  if (/(salary|compensation|pay (expectation|range)|desired (pay|salary)|expected (pay|ctc|salary)|gehalt|remuneration|prétention|rémunération|\bctc\b|salary expectations?)/.test(l)) {
    // "Expected salary in GBP?": answer in the currency the question names, even if the job's country is unknown.
    const named = /\bgbp\b|£|pounds?\b/i.test(f.label)
      ? 'GBP'
      : /\beur\b|€|euros?\b/i.test(f.label)
        ? 'EUR'
        : /\bpln\b|zł|zloty/i.test(f.label)
          ? 'PLN'
          : /\busd\b|us\$|\$|dollars?\b/i.test(f.label)
            ? 'USD'
            : /\bchf\b|swiss francs?/i.test(f.label)
              ? 'CHF'
              : /\bsek\b|swedish kronor/i.test(f.label)
                ? 'SEK'
                : /\bdkk\b|danish kroner/i.test(f.label)
                  ? 'DKK'
                  : /\bnok\b|norwegian kroner/i.test(f.label)
                    ? 'NOK'
                    : null
    const ask = named && ctx.salaryAsk?.currency !== named ? (modestAskInCurrency(named, ctx.salaryAsk) ?? ctx.salaryAsk) : ctx.salaryAsk
    // "Expected gross monthly salary": the yearly figure / 12, never the yearly figure itself.
    const monthly = /monthly|per month|a month|\/ ?month|\bp\.? ?m\.?\b|monatlich|pro monat|mensuel|par mois|per maand/i.test(f.label)
    // "Daily salary expectations" (contract roles, UniSystems): the yearly figure over ~220 working days.
    const daily = !monthly && /daily|per day|a day|day rate|\/ ?day|tagessatz|par jour|per dag/i.test(f.label)
    const perPeriod = (yearly: number) => (monthly ? Math.round(yearly / 12 / 100) * 100 : daily ? Math.round(yearly / 220 / 10) * 10 : yearly)
    // LinkedIn's salary box is a text input whose id ends in "-numeric" and rejects "EUR 50,000 per year".
    if (f.kind === 'number' || /numeric/i.test(f.id) || DIGITS_ONLY_RE.test(`${f.error ?? ''} ${f.hint}`)) {
      return ask ? { type: 'value', value: String(perPeriod(ask.amount)), source: 'rule' } : fromStd(f, ctx, 'salary_number', 'Salary (number)', (v) => String(perPeriod(Number(v.replace(/[^\d.]/g, '')))))
    }
    if (opts.length) return null // ranges: the AI picks using your number
    if (ask) {
      const amount = perPeriod(ask.amount)
      const full = `${ask.currency} ${amount.toLocaleString('en-US')} ${monthly ? 'per month (gross)' : daily ? 'per day' : 'per year'}, open to discuss`
      // A short box (20 characters): "EUR 55,000", or just the number.
      const short = `${ask.currency} ${amount.toLocaleString('en-US')}`
      const value = !f.maxLength || full.length <= f.maxLength ? full : short.length <= f.maxLength ? short : String(amount)
      return { type: 'value', value, source: 'rule' }
    }
    if (monthly) {
      const n = Number((stdOf(ctx, 'salary_number') ?? '').replace(/[^\d.]/g, ''))
      if (n > 0) return { type: 'value', value: `EUR ${perPeriod(n).toLocaleString('en-US')} per month (gross), open to discuss`, source: 'rule' }
    }
    return fromStd(f, ctx, 'salary_expectation', 'Salary expectation')
  }
  if (/notice period|kündigungsfrist|preavis|préavis|\bnotice\b/.test(l) && !/privacy|data protection|gdpr|policy|statement/.test(l)) {
    // Lists in spans ("1-2 months", "30-60 days", "3+ months"): the saved notice in days picks one.
    const saved = stdOf(ctx, 'notice_period')
    const days = saved ? durationDays(saved) : null
    if (CHOICE_KINDS.has(f.kind) && opts.length && days !== null && !matchOption(saved!, opts)) {
      const m = durationOption(opts, days)
      if (m) return { type: 'value', value: m, source: 'bank' }
    }
    return fromStd(f, ctx, 'notice_period', 'Notice period')
  }
  // Education years on Greenhouse ("Start date year" / "End date year" under Education): the university,
  // not when the person can start work (OKX got "2 months after the offer" typed into the year box).
  const eduYear = /^(start|end)( date)? year$|^(year (started|ended|of (start|completion)))$/.exec(l)
  if (eduYear) {
    const grad = stdOf(ctx, 'graduation_year')
    if (/^end|ended|completion/.test(l)) return grad ? { type: 'value', value: grad, source: 'bank' } : f.required ? null : { type: 'skip', reason: 'education end year unknown' }
    // The usual length of the degree before the graduation year; asked only when required.
    const years = degreeYears(stdOf(ctx, 'highest_degree') ?? person(ctx).degree, person(ctx).country)
    return f.required && grad && /^\d{4}$/.test(grad) ? { type: 'value', value: String(Number(grad) - years), source: 'bank' } : { type: 'skip', reason: 'education start year left blank' }
  }
  if (/(earliest|possible|available|availability|when can you|when could you)( to)? (start|join)|start date|date available|available from|joining date|start working|eintrittsdatum|date de début/.test(l)) {
    // A date field needs a real date, not "2 months after the offer...". Date pickers are often
    // text boxes (Ashby's react-datepicker "Pick date..."): the placeholder gives them away and the format.
    const startIso = earliestStartDate({ earliestStart: stdOf(ctx, 'earliest_start') ?? null, noticePeriod: stdOf(ctx, 'notice_period') ?? null }, { needsVisa: sponsorshipNeed(ctx) })
    if (f.kind === 'date') return startIso ? { type: 'value', value: startIso, source: 'rule' } : needsPerson(f, 'std:earliest_start', 'Earliest start date is not in your answers yet')
    // The format can also sit in the label ("Earliest starting date (YYYY-MM-DD)") or in the site's error
    // ("Please enter the date in the format DD.MM.YYYY", Thieme), which wins. A bare "Available from" (Personio) wants a date too.
    const format = [f.error, f.placeholder, f.hint, f.label].find((s) => s && /\b(dd|mm|jj|tt)\b|yyyy/i.test(s)) ?? ''
    if (f.kind === 'text' && (format || /\bdate\b/i.test(`${f.placeholder} ${f.hint}`) || /^(available from|start date|starting date|earliest start(ing)? date|verfügbar ab|eintrittsdatum|date available)$/.test(l))) {
      return startIso ? { type: 'value', value: dateInFormat(startIso, format || f.placeholder), source: 'rule' } : needsPerson(f, 'std:earliest_start', 'Earliest start date is not in your answers yet')
    }
    return fromStd(f, ctx, 'earliest_start', 'Earliest start date')
  }

  // ---- work authorisation & sponsorship ----------------------------------
  const plainYesNo = opts.length === 0 || opts.every((o) => /^(yes|no|ja|nein|oui|non|si|sí|sim|não|nao|nej|nee|tak|nie)(?!\p{L})/iu.test(o.trim()) && o.length < 40)
  // A follow-up box labelled only "Additional details" whose help text is about visas ("for example: Graduate visa valid until...").
  if ((f.kind === 'textarea' || f.kind === 'text') && /^((additional|further|more) )?(details|information|info)$|^please (specify|explain|provide details)$/.test(l) && /visa|sponsor|permission to work|right to work|work permit|immigration/i.test(`${f.hint} ${f.error ?? ''} ${f.section}`)) {
    return workAuthText(f, ctx)
  }
  // "In what countries do you have the unrestricted right to work?": a country, not Yes/No.
  if (/^(in )?(what|which) countr(y|ies)\b.{0,60}(right to work|authori[sz]ed|eligible|permit)/.test(l) && !(opts.length && plainYesNo)) return fromStd(f, ctx, 'country', 'Country')
  // "Will you require Elastic's sponsorship to continue or extend your work authorization?" is a sponsorship question,
  // "Are you authorized to work ... without (future) visa sponsorship?" stays an authorisation question (No).
  const withoutSponsorship = /without (requiring |needing |the need for |future |any |current or future )?(visa |employer |company |employment )?sponsor/.test(l)
  if ((withoutSponsorship || !/sponsor/.test(l)) && /(legally )?(authori[sz]ed|eligible|permitted|entitled) to work|rights? to work|work authori[sz]ation|have (a |the )?(valid )?(work permit|work visa)|arbeitserlaubnis|arbeitsgenehmigung|arbeitsberechtigung|zur arbeit berechtigt|berechtigt.{0,30}zu arbeiten|autoris\w* à travailler|permis de travail|currently (hold|have) .{0,40}(permit|visa)/.test(l)) {
    // "Which right to work document do you hold?" wants a statement, not "No".
    if (f.kind === 'textarea' || (f.kind === 'text' && !ASKS_YES_NO_RE.test(l))) return workAuthText(f, ctx)
    const need = sponsorshipNeed(ctx)
    if (need === null) return needsPerson(f, 'std:requires_sponsorship', 'Whether you may work in this country without sponsorship is not in your profile yet')
    if (plainYesNo) return yesNoAnswer(f, !need)
    // Status lists ("Citizen / Permanent Resident / Work Permit / Requires Sponsorship"): the true entry.
    const opt = need ? sponsorshipOption(opts) : rightToWorkOption(opts, person(ctx), ctx.jobCountryCode)
    return opt ? { type: 'value', value: opt, source: 'rule' } : null
  }
  if (/(require|need|requiring|will you need|now or in the future).{0,80}(sponsor|visa)|sponsorship|visa support|work permit support|visa assistance/.test(l)) {
    const yes = sponsorshipNeed(ctx)
    if (f.kind === 'textarea') return workAuthText(f, ctx)
    if (yes === null) return needsPerson(f, 'std:requires_sponsorship', 'Whether you need visa sponsorship is not in your profile yet')
    if (plainYesNo) return yesNoAnswer(f, yes)
    const opt = yes ? sponsorshipOption(opts) : rightToWorkOption(opts, person(ctx), ctx.jobCountryCode)
    return opt ? { type: 'value', value: opt, source: 'rule' } : null
  }
  if (/relocat/.test(l) && plainYesNo) {
    const r = stdOf(ctx, 'willing_to_relocate')
    if (!r) return needsPerson(f, 'std:willing_to_relocate', 'Willingness to relocate is not in your answers yet')
    return yesNoAnswer(f, !/^no/i.test(r))
  }
  // "Are you currently based in Prague or nearby?" (Innovecs): only Yes when it names where the person lives.
  const basedIn = /(are you|do you) (currently )?(based|located|living|live|reside|residing) (in|near|around) (.+)/.exec(l)
  if (basedIn && plainYesNo) {
    const home = [stdOf(ctx, 'city'), stdOf(ctx, 'country')].filter(Boolean).map((s) => s!.toLowerCase())
    return yesNoAnswer(f, home.some((h) => basedIn[5].includes(h)))
  }
  if (/(able|willing|happy|comfortable|open|prepared) to (work|commute|come|be|attend)\b.{0,50}(office|on.?site|hybrid|in.?person)|work (from|in|at) (the|our) office|(on.?site|hybrid|in.?office).{0,40}(ok|okay|possible|work for you|comfortable)/.test(l) && plainYesNo) {
    // Truthful from the profile: someone who wants remote-only work says No; unknown is left to the person.
    const remote = person(ctx).remote
    if (remote) return yesNoAnswer(f, remote !== 'only')
    return needsPerson(f, 'remote', 'Whether you would work in an office is not in your profile yet')
  }
  if (/(18|eighteen) (years|or older)|over (the age of )?18|legal (working )?age|at least 18/.test(l) && plainYesNo) return yesNoAnswer(f, true)

  // ---- diversity (prefer not to say) -------------------------------------
  if (/pronoun/.test(l)) {
    const p = stdOf(ctx, 'pronouns')
    // "They/them" may be listed as "They/Them/Theirs", "they / them" or just "They".
    if (p) return [p, p.replace(/\s*\/\s*/g, ' / '), p.split('/')[0]].map((w) => choose(f, w, 'bank')).find(Boolean) ?? choose(f, p, 'bank')
    if (opts.length) {
      const d = declineOption(opts)
      if (d) return { type: 'value', value: d, source: 'rule' }
    }
    return f.required ? null : { type: 'skip', reason: 'pronouns left blank' }
  }
  if (DIVERSITY_RE.test(l) || /eeo|demographic|self.?identif/.test(`${f.section.toLowerCase()} ${h}`)) {
    // "What is your gender?" in any wording; not "Does your gender identity match your sex at birth?".
    const asksGender = (/^(gender|sex)\b/.test(l) || /\b(what|which|select|indicate|specify|state)\b.{0,40}\bgender\b|\bgender( identity)?$/.test(l)) && !/match|same as|assigned|at birth|transgender|\btrans\b/.test(l)
    if (asksGender) {
      // The saved gender, also where "prefer not to say" is offered; no saved answer: prefer not to say.
      const g = stdOf(ctx, 'gender') || savedDiversity(person(ctx), 'gender')
      if (g && !/prefer not|decline|rather not/i.test(g)) {
        const words = synonyms(GENDER)(g)
        const m = oneOf(f, words, 'bank') ?? familyOption(f, GENDER, g)
        if (m) return m
      }
      const decline = opts.length ? declineOption(opts) : null
      if (decline) return { type: 'value', value: decline, source: 'rule' }
    }
    // Age bracket from the date of birth (Energy Aspects asked for "25-34").
    if (/\bage (bracket|range|group|band)\b|^age$/.test(l)) {
      const age = ageFromBirth(stdOf(ctx, 'date_of_birth'))
      if (age !== null) {
        const m = oneOf(f, ageBracketWords(age, opts), 'bank')
        if (m) return m
      }
    }
    // The person's own saved answers: orientation, caring, disability, ethnicity, religion, marital status.
    const own = diversityAnswer(f, l, ctx)
    if (own) return own
    if (opts.length) {
      // Veteran questions: the saved answer picks "not a veteran" or "a veteran"; none saved: decline below.
      if (/veteran/.test(l)) {
        const vet = stdOf(ctx, 'veteran') || savedDiversity(person(ctx), 'veteran')
        if (vet && /^(no|not|none|i am not|i.?m not)\b/i.test(vet.trim())) {
          const notVet = opts.find((o) => /not a (protected )?veteran|i am not|no military/i.test(o)) ?? yesNo(opts, false)
          if (notVet) return { type: 'value', value: notVet, source: 'bank' }
        } else if (vet && !/prefer|decline/i.test(vet)) {
          const isVet = opts.find((o) => /^(yes\b|i am a (protected )?veteran|i identify as (one or more|a protected) )/i.test(o.trim()))
          if (isVet) return { type: 'value', value: isVet, source: 'bank' }
        }
      }
      const d = declineOption(opts)
      if (d) return { type: 'value', value: d, source: 'rule' }
      return null
    }
    return f.required ? null : { type: 'skip', reason: 'diversity question left blank' }
  }

  // ---- former employee of this company -----------------------------------
  // "Please select if you were a previous Unity employee", "Have you previously been employed by Elekta?",
  // "Are you a former employee of GE HealthCare": Yes only when it names one of the person's own employers.
  if (/\b(previous|former|ex|past)[- ]?(\w+ ){0,3}(employee|employed|worker|staff)\b|\b(previously|ever|before) (been )?(employed|worked) (by|for|at|with)\b|have you (ever )?worked (for|at|with) (us|our|\w+)/.test(l) && !/referr|know (anyone|someone)|family|relative|government|contractor/.test(l)) {
    const own = ownEmployers(ctx).some((e) => l.includes(e))
    if (opts.length) {
      const pick = own ? opts.find((o) => /^yes\b/i.test(o.trim())) : opts.find((o) => /^(no\b|none\b|never\b|i have not|i am not|not\b)|\b(have not|haven.?t|never|not been|not previously)\b/i.test(o.trim()))
      if (pick) return { type: 'value', value: pick, source: 'rule' }
    }
    if (plainYesNo || f.kind === 'radio' || f.kind === 'buttons') return yesNoAnswer(f, own)
    if (f.kind === 'text' || f.kind === 'textarea') return { type: 'value', value: own ? 'Yes' : 'No', source: 'rule' }
  }

  // ---- how did you hear, referrals ----------------------------------------
  // Not "...how did you find it?" inside an essay question about a bug.
  if (l.length <= 140 && /how did you (first |initially |originally )?(hear|learn|come across)|how did you find (out )?(about )?(us|this|the (job|role|position|vacancy|opening|posting))|where did you (first |initially |originally )?(hear|find|see|learn)|source of (application|referral)|referral source|how you heard|how did you find out/.test(l)) {
    const pref = stdOf(ctx, 'how_heard') || 'Online job board'
    if (opts.length) {
      // The saved answer first; otherwise the usual true ones for an online search: job boards, online search, company sites.
      const ORDER = [/job ?(board|site|portal)|jobs? (website|platform)/i, /online|internet|google|search engine/i, /careers? (page|site)|company (website|site)|website/i, /^other\b/i]
      const m = matchOption(pref, opts) ?? ORDER.map((re) => opts.find((o) => re.test(o))).find(Boolean)
      return m ? { type: 'value', value: m, source: 'rule' } : null
    }
    // A list that loads only while typing (Ashby at Perk): "Online job search" matches no entry, so try the
    // usual true ones in turn.
    if (f.kind === 'combobox') return { type: 'value', value: pref, source: 'bank', fallbacks: ['Job board', 'Job Board', 'Online', 'Internet', 'Other', 'Website', 'Company website'] }
    return { type: 'value', value: pref, source: 'bank' }
  }
  if (/referred by|referr(al|er)( name)?|employee referral|who referred|name of (the )?referr/.test(l)) {
    if (plainYesNo && opts.length) return yesNoAnswer(f, false)
    return f.required ? null : { type: 'skip', reason: 'no referral' }
  }

  // ---- history / conflicts -------------------------------------------------
  if (/((previously|ever|formerly|before) (worked|been employed|employed|been an employee|interned)|former (employee|intern|contractor)|current or former employee|worked (for|at|with) .{0,40} before|have you worked (for|at))/.test(l) && plainYesNo) return yesNoAnswer(f, false)
  // People at the company: the truthful answer is nobody, also in "select all that apply" lists.
  if (KNOWS_SOMEONE_RE.test(l) || /(relative|related|family member|spouse).{0,60}(employ|work|board)/.test(l)) {
    const none = opts.find((o) => NONE_OPTION_RE.test(o.trim()))
    if (f.kind === 'checkboxes') return none ? { type: 'choices', choices: [none], source: 'rule' } : null
    if (none && CHOICE_KINDS.has(f.kind)) return { type: 'value', value: none, source: 'rule' }
    if (plainYesNo) return yesNoAnswer(f, false)
  }
  if (/(relative|related|family member|spouse).{0,60}(employ|work|board)|government official|politically exposed|public official|conflict of interest/.test(l) && plainYesNo) return yesNoAnswer(f, false)
  if (/non.?compete|restrictive covenant|non.?solicit/.test(l) && plainYesNo) return yesNoAnswer(f, false)

  // ---- education -----------------------------------------------------------
  if (/highest (level of )?(education|degree|qualification)|education level|degree level|level of education/.test(l)) {
    const d = stdOf(ctx, 'highest_degree')
    if (!d) return needsPerson(f, 'std:highest_degree', 'Highest degree is not in your profile yet')
    if (opts.length) {
      const level = /ph\.?d|doctor/i.test(d) ? /ph\.?d|doctor/i : /master|m\.?sc|\bma\b|mba|m\.?eng/i.test(d) ? /master|m\.?sc|postgraduate|graduate degree/i : /bachelor|b\.?sc|\bba\b|b\.?eng|licen/i.test(d) ? /bachelor|b\.?sc|undergraduate|licen/i : null
      const m = matchOption(d, opts) ?? (level ? opts.find((o) => level.test(o)) : undefined)
      return m ? { type: 'value', value: m, source: 'bank' } : null
    }
    return { type: 'value', value: d, source: 'bank' }
  }
  // Greenhouse's School list is a search box that shows only the first schools until you type: type the
  // person's school and pick it, else a shorter part of its name, else "Other" (OKX left School empty).
  if (f.kind === 'combobox' && /^(school|university|college|institution)( name)?$/.test(l)) {
    const school = stdOf(ctx, 'school')
    if (school) {
      const m = opts.length ? matchOption(school, opts) : null
      const short = schoolKeyword(school)
      return m ? { type: 'value', value: m, source: 'bank' } : { type: 'value', value: school, source: 'bank', fallbacks: [...(short ? [short] : []), 'Other'] }
    }
  }
  if (!CHOICE_KINDS.has(f.kind) || opts.length) {
    if (/^(school|university|college|institution)( name)?$|^name of (school|university|institution)|alma mater/.test(l)) return fromStd(f, ctx, 'school', 'University')
    if (/field of study|^major$|^discipline$|area of study|degree subject|course of study/.test(l)) return fromStd(f, ctx, 'field_of_study', 'Field of study')
    if (/graduation (year|date)|year of graduation|when did you graduate/.test(l)) return fromStd(f, ctx, 'graduation_year', 'Graduation year')
  }
  // The grade / GPA from the profile whenever a form asks; none saved: required ones wait for the person.
  if (/\bgpa\b|grade point|cgpa/.test(l)) return fromStd(f, ctx, 'gpa', 'GPA')
  if (/date of birth|birth ?date|birthday|\bdob\b|geburtsdatum|date de naissance|fecha de nacimiento/.test(l)) return fromStd(f, ctx, 'date_of_birth', 'Date of birth')
  // "Age" as a plain number box: worked out from the date of birth, so it stays right every year.
  if (/^(your |what is your |what s your )?(current )?age$|^how old are you$|^alter$/.test(l) && !CHOICE_KINDS.has(f.kind)) {
    const born = new Date(stdOf(ctx, 'date_of_birth') ?? '')
    if (!Number.isNaN(born.getTime())) {
      const now = new Date()
      const age = now.getFullYear() - born.getFullYear() - (now < new Date(now.getFullYear(), born.getMonth(), born.getDate()) ? 1 : 0)
      return { type: 'value', value: String(age), source: 'bank' }
    }
  }

  // ---- languages -----------------------------------------------------------
  if (/(languages? (do you speak|spoken|skills|you speak)|which languages|what languages|language\(?s\)? are you fluent|languages? you are fluent)/.test(l) && !opts.length) return fromStd(f, ctx, 'languages', 'Languages')
  // A tick list of languages ("What language(s) are you fluent in?", OKX): the person's languages.
  const me = person(ctx)
  if (f.kind === 'checkboxes' && /language/.test(l) && opts.length) {
    const names = me.languages.length ? me.languages.map((x) => x.name) : (stdOf(ctx, 'languages') ?? '').split(/,|;|\band\b/).map((s) => s.replace(/\(.*?\)/g, '').trim())
    const picks = opts.filter((o) => names.some((n) => n.length >= 3 && o.trim().toLowerCase().startsWith(n.toLowerCase())))
    if (picks.length) return { type: 'choices', choices: picks, source: 'rule' }
  }
  // A language level, in a list ("Select your level" beside an "English" box: Wise on SmartRecruiters picked
  // "Beginner") or a text box: the person's own level for that language, the nearest option.
  if (/\blevel\b|proficien|fluen|speak|command|skill/.test(l)) {
    const lang = languageAsked(me, `${l} ${f.section}`) ?? (/\blevel\b|proficiency/.test(l) && opts.some((o) => /beginner|basic|native|fluent/i.test(o)) ? languageAsked(me, f.section) : null)
    if (lang && opts.length) {
      const m = levelOption(lang.level, opts)
      if (m) return { type: 'value', value: m, source: 'profile' }
    }
    if (lang && !opts.length && !CHOICE_KINDS.has(f.kind) && f.kind !== 'textarea' && languageAsked(me, l)) {
      return { type: 'value', value: LEVEL_TEXT[lang.level] ?? lang.level, source: 'profile' }
    }
  }

  // ---- cover letter text ---------------------------------------------------
  if (f.kind === 'textarea' || f.kind === 'text') {
    if (/cover letter|motivation(al)? letter|anschreiben|lettre de motivation|cover note|letter of motivation/.test(l)) {
      if (ctx.coverLetter) return { type: 'value', value: ctx.coverLetter, source: 'cover_letter' }
      return f.required ? null : { type: 'skip', reason: 'no cover letter text' }
    }
    if (f.kind === 'textarea' && !f.required && /^(additional information|anything else|comments?|additional comments|message( to (the )?(hiring|recruit\w*)( team| manager)?)?|notes?)$/.test(l)) {
      if (ctx.coverLetterEverywhere && ctx.coverLetter) return { type: 'value', value: ctx.coverLetter, source: 'cover_letter' }
      return { type: 'skip', reason: 'optional comments box' }
    }
  }

  return null
}

/** Today's date for the "Date" fields on Workday's self-identification page. */
export function workdayDateValue(f: ScannedField, today = new Date()): string | null {
  const id = `${f.hint} ${f.label}`.toLowerCase()
  if (/datesectionmonth|\bmonth\b/.test(id)) return String(today.getMonth() + 1).padStart(2, '0')
  if (/datesectionday|\bday\b/.test(id)) return String(today.getDate()).padStart(2, '0')
  if (/datesectionyear|\byear\b/.test(id)) return String(today.getFullYear())
  return null
}

/** Today's date for a signature line, in the format the field hints at (DD/MM/YYYY by default). */
export function signatureDate(f: ScannedField, today = new Date()): string {
  const dd = String(today.getDate()).padStart(2, '0')
  const mm = String(today.getMonth() + 1).padStart(2, '0')
  const yyyy = String(today.getFullYear())
  const hint = f.hint.toLowerCase()
  if (f.kind === 'date' || /yyyy-mm-dd/.test(hint)) return `${yyyy}-${mm}-${dd}`
  if (/mm\/dd/.test(hint)) return `${mm}/${dd}/${yyyy}`
  return `${dd}/${mm}/${yyyy}`
}

/** Optional fields not worth an AI call (short labels like "Twitter", "Address line 2"). */
export function worthAsking(f: ScannedField): boolean {
  if (f.required) return true
  if (f.kind === 'file' || f.kind === 'password') return false
  const l = normalizeQuestion(f.label)
  if (!l) return false
  // Real questions (sentences) are worth answering even when optional; short labels are not.
  if (f.kind === 'textarea') return l.split(' ').length >= 4
  if (CHOICE_KINDS.has(f.kind) || f.kind === 'checkboxes') return l.split(' ').length >= 3
  return /\?$/.test(f.label.trim()) && l.split(' ').length >= 4
}
