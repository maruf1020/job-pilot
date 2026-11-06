/**
 * The person the app applies for, as one typed object built from CandidateProfile (filled by the
 * onboarding form). Prompts, form rules, the browser agents and the email writer read the candidate
 * ONLY from here: nothing about a person is written in code.
 *
 * Pure helpers (no DB) live at the top so they can be unit-tested; loadCandidateContext() at the
 * bottom reads the profile.
 */

export type Profession = 'software' | 'design' | 'data' | 'product' | 'marketing' | 'sales' | 'operations' | 'other'
export const PROFESSIONS: Array<{ id: Profession; label: string; noun: string }> = [
  { id: 'software', label: 'Software engineering', noun: 'software engineer' },
  { id: 'design', label: 'Design (product, UX, UI, graphic)', noun: 'designer' },
  { id: 'data', label: 'Data (analytics, science, engineering)', noun: 'data professional' },
  { id: 'product', label: 'Product management', noun: 'product manager' },
  { id: 'marketing', label: 'Marketing and content', noun: 'marketer' },
  { id: 'sales', label: 'Sales and customer success', noun: 'sales professional' },
  { id: 'operations', label: 'Operations, HR and finance', noun: 'operations professional' },
  { id: 'other', label: 'Something else', noun: 'professional' },
]

export interface LanguageLevel {
  name: string
  /** native | fluent | professional | conversational | basic */
  level: string
}

export interface CandidateLinks {
  linkedin?: string | null
  github?: string | null
  portfolio?: string | null
  behance?: string | null
  dribbble?: string | null
  x?: string | null
  website?: string | null
}

export interface WorkAuth {
  /** True when the person needs an employer-sponsored visa in countries where they have no right to work. */
  needsSponsorship: boolean | null
  /** ISO2 codes where the person may work without sponsorship (besides citizenship countries). */
  rightToWork: string[]
  /** The person's own sentence for "describe your work authorisation" questions. */
  authorizationText: string | null
}

export interface Diversity {
  gender?: string | null
  orientation?: string | null
  ethnicity?: string | null
  religion?: string | null
  disability?: string | null
  veteran?: string | null
  caring?: string | null
  maritalStatus?: string | null
  ageRange?: string | null
}

export interface EmailVoice {
  tone: 'warm' | 'direct' | 'formal'
  /** Topics never mentioned in any application text (e.g. an old specialism). */
  neverMention: string[]
  /** Skills and products to lead with. */
  leadWith: string[]
  /** Sign-off line before the name. */
  signOff: string
}

export interface ExperienceItem {
  company: string
  title: string
  from?: string | null
  to?: string | null
  bullets?: string[]
}

export interface EducationItem {
  school: string
  degree?: string | null
  year?: string | number | null
}

export interface CandidateContext {
  fullName: string
  givenName: string
  familyName: string
  preferredName: string
  pronouns: string | null
  /** Third-person words for prompts: from pronouns, "they" when unknown. */
  he: string
  him: string
  his: string
  gender: string | null
  dateOfBirth: string | null
  email: string | null
  phone: string | null
  phoneCountryCode: string | null
  /** Full international number, e.g. "+351 912 345 678", or null. */
  phoneIntl: string | null
  /** Digits of the national number without the country code. */
  phoneNational: string | null
  addressLine: string | null
  postalCode: string | null
  city: string | null
  region: string | null
  /** ISO2 of residence. */
  country: string | null
  countryName: string | null
  /** "City, Country" for forms. */
  location: string
  timezone: string
  citizenships: string[]
  citizenshipNames: string[]
  links: CandidateLinks
  headline: string
  profession: Profession
  /** "software engineer", "product designer", ... used in prompts. */
  professionNoun: string
  field: string | null
  seniority: string[]
  yearsExperience: number
  skills: string[]
  titles: string[]
  stopSkills: string[]
  facts: string[]
  experience: ExperienceItem[]
  education: EducationItem[]
  workAuth: WorkAuth
  relocation: 'yes' | 'no' | 'maybe' | null
  remote: 'only' | 'ok' | 'no' | null
  languages: LanguageLevel[]
  degree: string | null
  gpa: string | null
  diversity: Diversity
  voice: EmailVoice
  noticePeriod: string | null
  earliestStart: string | null
  salaryExpectation: string | null
  salaryCurrency: string | null
  salaryOnlyWhenAsked: boolean
  howHeard: string | null
  motivation: string | null
  signature: string | null
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' })
  } catch {
    return null
  }
})()

/** "PT" -> "Portugal". Unknown codes come back as given. */
export function countryNameOf(code: string | null | undefined): string | null {
  if (!code) return null
  const c = code.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(c)) return code.trim() || null
  try {
    return regionNames?.of(c) ?? c
  } catch {
    return c
  }
}

const WITH_THE = new Set(['GB', 'US', 'NL', 'AE', 'CZ', 'PH', 'BS', 'GM', 'CF', 'DO', 'MV', 'MH', 'SB', 'KY', 'VG', 'VI', 'FO', 'CD', 'CG', 'KM', 'SC'])

/** "the United Kingdom", "the Netherlands", "Portugal": country names as they read inside a sentence. */
export function countryInSentence(code: string | null | undefined): string | null {
  const name = countryNameOf(code)
  if (!name) return null
  return WITH_THE.has((code ?? '').trim().toUpperCase()) ? `the ${name}` : name
}

/** EU + EEA + Switzerland: citizens of one may work in all the others without a permit. */
export const FREE_MOVEMENT = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'IS', 'LI', 'NO', 'CH',
])

/**
 * Whether the person may work in a country without sponsorship: true (citizen, explicit right, or
 * EU/EEA/CH free movement), false (needs sponsorship there), null (unknown: not enough answers yet).
 */
export function hasRightToWork(ctx: Pick<CandidateContext, 'citizenships' | 'workAuth'>, countryCode: string | null | undefined): boolean | null {
  const c = (countryCode ?? '').trim().toUpperCase()
  if (!c) return null
  const rights = new Set([...ctx.citizenships, ...ctx.workAuth.rightToWork].map((x) => x.toUpperCase()))
  if (rights.has(c)) return true
  if (c === 'GB' && rights.has('UK')) return true
  if (FREE_MOVEMENT.has(c) && [...rights].some((r) => FREE_MOVEMENT.has(r))) return true
  if (ctx.workAuth.needsSponsorship === false) return true
  if (ctx.workAuth.needsSponsorship === true) return false
  return null
}

/** Whether a job in this country needs a visa sponsored by the employer. */
export function needsSponsorshipFor(ctx: Pick<CandidateContext, 'citizenships' | 'workAuth'>, countryCode: string | null | undefined): boolean | null {
  const r = hasRightToWork(ctx, countryCode)
  return r === null ? ctx.workAuth.needsSponsorship : !r
}

/**
 * One truthful sentence about the right to work for a job country, for prompts and forms. Never
 * claims a permit the person does not have.
 */
export function workRightsSentence(ctx: CandidateContext, countryCode: string | null | undefined): string {
  const where = countryInSentence(countryCode) ?? "the job's country"
  const right = hasRightToWork(ctx, countryCode)
  const cit = ctx.citizenshipNames.length ? `${ctx.he === 'they' ? 'They are' : `${cap(ctx.he)} is`} a citizen of ${ctx.citizenships.map((c) => countryInSentence(c) ?? c).join(' and ')}` : null
  const lives = ctx.location ? `living in ${ctx.location}` : null
  const intro = [cit, lives].filter(Boolean).join(', ')
  if (right === true) return `${intro ? `${intro}. ` : ''}${cap(ctx.he)} ${verb(ctx, 'has', 'have')} the right to work in ${where} and ${verb(ctx, 'does', 'do')} not need visa sponsorship there.`
  if (right === false)
    return `${intro ? `${intro}. ` : ''}${cap(ctx.he)} ${verb(ctx, 'has', 'have')} no right to work in ${where} yet and ${verb(ctx, 'needs', 'need')} employer visa sponsorship there (answer Yes to "will you need sponsorship" and No to "are you authorised / legally allowed to work"). Never pick an option that says citizen, resident, settled or "no sponsorship needed" for ${where}.`
  return `${intro ? `${intro}. ` : ''}${cap(ctx.he)} has not said whether ${ctx.he} may work in ${where} without sponsorship: work-authorisation questions for ${where} need ${ctx.him} (status needs_human).`
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** "he has" / "they have". */
export function verb(ctx: Pick<CandidateContext, 'he'>, singular: string, plural: string): string {
  return ctx.he === 'they' ? plural : singular
}

/** he/him/his from a pronouns string ("she/her", "he/him", "they/them"); "they" when unknown. */
export function pronounWords(pronouns: string | null | undefined): { he: string; him: string; his: string } {
  const p = (pronouns ?? '').toLowerCase()
  if (/^\s*she\b/.test(p)) return { he: 'she', him: 'her', his: 'her' }
  if (/^\s*he\b/.test(p)) return { he: 'he', him: 'him', his: 'his' }
  return { he: 'they', him: 'them', his: 'their' }
}

/** "+351" + "912 345 678" -> "+351 912 345 678"; a number that already starts with + is kept. */
export function internationalPhone(code: string | null | undefined, phone: string | null | undefined): string | null {
  const raw = (phone ?? '').trim()
  if (!raw) return null
  if (raw.startsWith('+')) return raw
  const cc = (code ?? '').trim().replace(/^00/, '+')
  if (!cc) return raw
  const national = raw.replace(/^0+/, '')
  return `${cc.startsWith('+') ? cc : `+${cc}`} ${national}`
}

/** National digits without the country code: "+351 912 345 678" -> "912345678". */
export function nationalDigits(code: string | null | undefined, phone: string | null | undefined): string | null {
  const intl = internationalPhone(code, phone)
  if (!intl) return null
  const digits = intl.replace(/\D/g, '')
  const cc = (code ?? '').replace(/\D/g, '')
  if (cc && digits.startsWith(cc)) return digits.slice(cc.length)
  return digits
}

/** Splits "Alex Rivera Costa" into given/family names when the profile has no name parts. */
export function splitName(fullName: string): { given: string; family: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return { given: parts[0] ?? '', family: '' }
  return { given: parts.slice(0, -1).join(' '), family: parts[parts.length - 1] }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim()) : []
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** The CandidateProfile row (or a partial one, e.g. in tests) as a CandidateContext. */
export function buildCandidateContext(p: Record<string, unknown> | null | undefined, fallbackTimezone = 'UTC'): CandidateContext {
  const row = p ?? {}
  const fullName = str(row.fullName) ?? ''
  const split = splitName(fullName)
  const givenName = str(row.givenName) ?? split.given
  const familyName = str(row.familyName) ?? split.family
  const pronouns = str(row.pronouns)
  const words = pronounWords(pronouns)
  const country = str(row.country)?.toUpperCase() ?? null
  const city = str(row.city)
  const countryName = countryNameOf(country)
  const location = str(row.location) ?? [city, countryName].filter(Boolean).join(', ')
  const citizenships = strArr(row.citizenships).map((c) => c.toUpperCase())
  const wa = obj(row.workAuth)
  const voice = obj(row.emailVoice)
  const profession = (PROFESSIONS.some((x) => x.id === row.profession) ? row.profession : 'software') as Profession
  const field = str(row.field)
  const languageLevels = Array.isArray(row.languageLevels)
    ? (row.languageLevels as unknown[]).map((l) => obj(l)).filter((l) => str(l.name)).map((l) => ({ name: str(l.name)!, level: str(l.level) ?? 'professional' }))
    : strArr(row.languages).map((name) => ({ name, level: 'professional' }))
  const experience = Array.isArray(row.experience) ? (row.experience as ExperienceItem[]).filter((e) => e && typeof e === 'object' && (e.company || e.title)) : []
  const education = Array.isArray(row.education) ? (row.education as EducationItem[]).filter((e) => e && typeof e === 'object' && e.school) : []
  const tone = voice.tone === 'direct' || voice.tone === 'formal' ? voice.tone : 'warm'
  return {
    fullName,
    givenName,
    familyName,
    preferredName: str(row.preferredName) ?? givenName.split(/\s+/)[0] ?? '',
    pronouns,
    ...words,
    gender: str(row.gender),
    dateOfBirth: str(row.dateOfBirth),
    email: str(row.email),
    phone: str(row.phone),
    phoneCountryCode: str(row.phoneCountryCode),
    phoneIntl: internationalPhone(str(row.phoneCountryCode), str(row.phone)),
    phoneNational: nationalDigits(str(row.phoneCountryCode), str(row.phone)),
    addressLine: str(row.addressLine),
    postalCode: str(row.postalCode),
    city,
    region: str(row.region),
    country,
    countryName,
    location,
    timezone: str(row.timezone) ?? fallbackTimezone,
    citizenships,
    citizenshipNames: citizenships.map((c) => countryNameOf(c) ?? c),
    links: obj(row.links) as CandidateLinks,
    headline: str(row.headline) ?? '',
    profession,
    professionNoun: profession === 'other' && field ? field : (PROFESSIONS.find((x) => x.id === profession)?.noun ?? 'professional'),
    field,
    seniority: strArr(row.seniority),
    yearsExperience: typeof row.yearsExperience === 'number' ? row.yearsExperience : 0,
    skills: strArr(row.skills),
    titles: strArr(row.titles),
    stopSkills: strArr(row.stopSkills),
    facts: strArr(row.facts),
    experience,
    education,
    workAuth: {
      needsSponsorship: typeof wa.needsSponsorship === 'boolean' ? wa.needsSponsorship : null,
      rightToWork: strArr(wa.rightToWork).map((c) => c.toUpperCase()),
      authorizationText: str(wa.authorizationText),
    },
    relocation: row.relocation === 'yes' || row.relocation === 'no' || row.relocation === 'maybe' ? row.relocation : null,
    remote: row.remote === 'only' || row.remote === 'ok' || row.remote === 'no' ? row.remote : null,
    languages: languageLevels,
    degree: str(row.degree) ?? (education[0]?.degree ? String(education[0].degree) : null),
    gpa: str(row.gpa),
    diversity: obj(row.diversity) as Diversity,
    voice: { tone, neverMention: strArr(voice.neverMention), leadWith: strArr(voice.leadWith), signOff: str(voice.signOff) ?? 'Kind regards,' },
    noticePeriod: str(row.noticePeriod),
    earliestStart: str(row.earliestStart),
    salaryExpectation: str(row.salaryExpectation),
    salaryCurrency: str(row.salaryCurrency),
    salaryOnlyWhenAsked: row.salaryOnlyWhenAsked !== false,
    howHeard: str(row.howHeard),
    motivation: str(row.motivation),
    signature: str(row.signature),
  }
}

/** Short lines for prompts: who the person is and where they may work. Empty answers are left out. */
export function identityFacts(ctx: CandidateContext): string[] {
  const facts: string[] = []
  if (ctx.fullName) facts.push(`Full name: ${ctx.fullName} (first/given name "${ctx.givenName}", family name "${ctx.familyName}", preferred name "${ctx.preferredName}")`)
  if (ctx.pronouns) facts.push(`Pronouns: ${ctx.pronouns}`)
  if (ctx.email) facts.push(`Email: ${ctx.email}`)
  if (ctx.phoneIntl) facts.push(`Phone: ${ctx.phoneIntl} (international format; national part ${ctx.phoneNational ?? ''})`)
  if (ctx.location) facts.push(`Lives in: ${ctx.location}${ctx.timezone ? ` (time zone ${ctx.timezone})` : ''}`)
  if (ctx.addressLine) facts.push(`Address: ${[ctx.addressLine, ctx.postalCode, ctx.city].filter(Boolean).join(', ')}`)
  if (ctx.citizenshipNames.length) facts.push(`Citizenship: ${ctx.citizenshipNames.join(', ')}`)
  if (ctx.workAuth.authorizationText) facts.push(`Work authorisation, in ${ctx.his} words: ${ctx.workAuth.authorizationText}`)
  if (ctx.relocation) facts.push(`Willing to relocate: ${ctx.relocation === 'yes' ? 'Yes' : ctx.relocation === 'no' ? 'No' : 'Open to it'}`)
  if (ctx.remote) facts.push(`Remote work: ${ctx.remote === 'only' ? 'only remote roles' : ctx.remote === 'ok' ? 'happy to work remotely, on site or hybrid' : 'prefers on site or hybrid'}`)
  if (ctx.languages.length) facts.push(`Languages: ${ctx.languages.map((l) => `${l.name} (${l.level})`).join(', ')}`)
  if (ctx.degree) facts.push(`Highest degree: ${ctx.degree}${ctx.education[0]?.school ? ` at ${ctx.education[0].school}` : ''}${ctx.education[0]?.year ? ` (${ctx.education[0].year})` : ''}`)
  if (ctx.gpa) facts.push(`Grade / GPA: ${ctx.gpa}`)
  for (const [k, label] of Object.entries(LINK_LABELS)) {
    const v = ctx.links[k as keyof CandidateLinks]
    if (v) facts.push(`${label}: ${v}`)
  }
  if (ctx.noticePeriod) facts.push(`Notice period: ${ctx.noticePeriod}`)
  if (ctx.earliestStart) facts.push(`Earliest start: ${ctx.earliestStart}`)
  if (ctx.salaryExpectation) facts.push(`Expected salary: ${ctx.salaryExpectation}${ctx.salaryCurrency ? ` ${ctx.salaryCurrency}` : ''}`)
  if (ctx.howHeard) facts.push(`How ${ctx.he} usually finds jobs: ${ctx.howHeard}`)
  if (ctx.motivation) facts.push(`Why ${ctx.he} ${verb(ctx, 'is', 'are')} looking: ${ctx.motivation}`)
  return facts
}

export const LINK_LABELS: Record<keyof CandidateLinks, string> = {
  linkedin: 'LinkedIn',
  github: 'GitHub',
  portfolio: 'Portfolio',
  behance: 'Behance',
  dribbble: 'Dribbble',
  x: 'X (Twitter)',
  website: 'Website',
}

/** The diversity answer for a topic, or null when the person prefers not to say. */
export function diversityAnswer(ctx: CandidateContext, topic: keyof Diversity): string | null {
  const v = ctx.diversity[topic]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/**
 * Personal values that must never be written into shared knowledge (site lessons, notes): the
 * scrubber replaces them with {placeholders}. Longest first so "Alex Rivera" wins over "Alex".
 */
export function personalTokens(ctx: CandidateContext): Array<{ value: string; placeholder: string }> {
  const out: Array<{ value: string; placeholder: string }> = []
  const add = (value: string | null | undefined, placeholder: string, min = 3) => {
    const v = (value ?? '').trim()
    if (v.length >= min) out.push({ value: v, placeholder })
  }
  add(ctx.fullName, '{fullName}')
  add(ctx.givenName, '{givenName}')
  add(ctx.familyName, '{familyName}')
  add(ctx.preferredName, '{preferredName}')
  add(ctx.email, '{email}')
  add(ctx.phoneIntl, '{phone}', 6)
  add(ctx.phone, '{phone}', 6)
  add(ctx.phoneNational, '{phone}', 6)
  add(ctx.addressLine, '{address}')
  add(ctx.postalCode, '{postalCode}', 4)
  add(ctx.city, '{city}')
  add(ctx.dateOfBirth, '{dateOfBirth}', 6)
  for (const v of Object.values(ctx.links)) if (typeof v === 'string') add(v, '{link}', 8)
  return out.sort((a, b) => b.value.length - a.value.length)
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Replaces the person's own values with placeholders, so a lesson can be shared. Values match as
 * whole words only (a given name "Sam" must not turn "Samsung" into "{givenName}sung").
 */
export function scrubPersonal(text: string, ctx: CandidateContext): string {
  let out = text
  for (const t of personalTokens(ctx)) {
    const v = escapeRe(t.value)
    const start = /^[\p{L}\p{N}]/u.test(t.value) ? '(?<![\\p{L}\\p{N}])' : ''
    const end = /[\p{L}\p{N}]$/u.test(t.value) ? '(?![\\p{L}\\p{N}])' : ''
    out = out.replace(new RegExp(`${start}${v}${end}`, 'giu'), t.placeholder)
  }
  // Any e-mail address that is left, and long phone-looking numbers (an international "+..." number,
  // or 9+ digits with spaces/dashes) - but never a date like 2026-10-29.
  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '{email}')
  out = out.replace(/(?<![\w-])\+\d[\d\s().-]{7,}\d(?![\w-])/g, '{phone}')
  out = out.replace(/(?<![\w.-])\d(?:[\s().-]?\d){8,}(?![\w.-])/g, (m) => (/^\d{4}-\d{2}-\d{2}$/.test(m) ? m : '{phone}'))
  return out
}

/** Fills {placeholders} in a shared lesson with the person's values (unknown ones stay readable). */
export function fillPlaceholders(text: string, ctx: CandidateContext): string {
  const map: Record<string, string | null> = {
    fullName: ctx.fullName,
    givenName: ctx.givenName,
    familyName: ctx.familyName,
    preferredName: ctx.preferredName,
    email: ctx.email,
    phone: ctx.phoneIntl,
    address: ctx.addressLine,
    postalCode: ctx.postalCode,
    city: ctx.city,
    country: ctx.countryName,
    location: ctx.location,
    dateOfBirth: ctx.dateOfBirth,
    link: ctx.links.linkedin ?? ctx.links.portfolio ?? null,
    region: ctx.region,
    phoneCountryCode: ctx.phoneCountryCode,
    nationality: ctx.citizenshipNames[0] ?? null,
    school: ctx.education[0]?.school ?? null,
    employer: ctx.experience[0]?.company ?? null,
    language: ctx.languages.find((l) => !/^english$/i.test(l.name))?.name ?? ctx.languages[0]?.name ?? null,
  }
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in map ? (map[k] ?? `(${k} from the profile)`) : m))
}
