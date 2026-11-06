import { PROFESSIONS, type Profession } from '@/lib/candidate/context'
import { DEFAULT_PREFS, DIVERSITY_TOPICS, LANGUAGE_LEVELS, LINK_FIELDS, SENIORITY_OPTIONS, type DiversityKey, type LinkKey, type ProfileField, type SearchPrefs } from './model'

/**
 * The editable copy of the profile in the browser. Every text is a string ('' = empty) so inputs
 * stay controlled; toInput() turns it back into the API shape, one step's fields at a time.
 */

export interface ExperienceDraft {
  company: string
  title: string
  from: string
  to: string
  /** One bullet per line. */
  bullets: string
}

export interface EducationDraft {
  school: string
  degree: string
  year: string
}

export interface ProfileDraft {
  fullName: string
  givenName: string
  familyName: string
  preferredName: string
  pronouns: string
  email: string
  phoneCountryCode: string
  phone: string
  links: Record<LinkKey, string>
  addressLine: string
  postalCode: string
  city: string
  region: string
  country: string
  timezone: string
  citizenships: string[]
  needsSponsorship: boolean | null
  rightToWork: string[]
  authorizationText: string
  relocation: '' | 'yes' | 'no' | 'maybe'
  remote: '' | 'only' | 'ok' | 'no'
  profession: Profession
  field: string
  titles: string[]
  seniority: string[]
  skills: string[]
  stopSkills: string[]
  headline: string
  yearsExperience: number
  summary: string
  languageLevels: Array<{ name: string; level: string }>
  experience: ExperienceDraft[]
  education: EducationDraft[]
  degree: string
  gpa: string
  facts: string[]
  noticePeriod: string
  earliestStart: string
  salaryExpectation: string
  salaryCurrency: string
  salaryOnlyWhenAsked: boolean
  howHeard: string
  motivation: string
  /** '' = Prefer not to say. */
  diversity: Record<DiversityKey, string>
  dateOfBirth: string
  tone: 'warm' | 'direct' | 'formal'
  neverMention: string[]
  leadWith: string[]
  signOff: string
  signature: string
  mindset: string
  /** "Where to look" (Settings, not the profile). */
  prefs: SearchPrefs
}

type Row = Record<string, unknown>

const s = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const obj = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {})
const LEVELS = new Set<string>(LANGUAGE_LEVELS.map((l) => l.value))
const SENIORITY = new Set<string>(SENIORITY_OPTIONS.map((x) => x.value))
/** Unknown levels (e.g. "C1" from an old free-text list) become "professional", which the form can show. */
const level = (v: string) => (LEVELS.has(v.toLowerCase()) ? v.toLowerCase() : 'professional')

/** The browser's own time zone, used as the default answer. */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function toDraft(p: Row | null, opts: { prefs?: SearchPrefs; account?: { name: string; email: string | null } } = {}): ProfileDraft {
  const row = p ?? {}
  const links = obj(row.links)
  const workAuth = obj(row.workAuth)
  const voice = obj(row.emailVoice)
  const diversity = obj(row.diversity)
  const profession = PROFESSIONS.some((x) => x.id === row.profession) ? (row.profession as Profession) : 'software'
  const levels = Array.isArray(row.languageLevels)
    ? (row.languageLevels as unknown[]).map(obj).map((l) => ({ name: s(l.name), level: level(s(l.level)) }))
    : // Older profiles only have "English (fluent)" strings.
      arr(row.languages).map((raw) => {
        const m = /^(.*?)\s*\((\w+)\)\s*$/.exec(raw)
        return { name: m ? m[1] : raw, level: level(m ? m[2] : '') }
      })
  const tone = voice.tone === 'direct' || voice.tone === 'formal' ? voice.tone : 'warm'
  const relocation = row.relocation === 'yes' || row.relocation === 'no' || row.relocation === 'maybe' ? row.relocation : ''
  const remote = row.remote === 'only' || row.remote === 'ok' || row.remote === 'no' ? row.remote : ''
  return {
    fullName: s(row.fullName) || opts.account?.name || '',
    givenName: s(row.givenName),
    familyName: s(row.familyName),
    preferredName: s(row.preferredName),
    pronouns: s(row.pronouns),
    email: s(row.email) || opts.account?.email || '',
    phoneCountryCode: s(row.phoneCountryCode),
    phone: s(row.phone),
    links: Object.fromEntries(LINK_FIELDS.map((l) => [l.key, s(links[l.key])])) as Record<LinkKey, string>,
    addressLine: s(row.addressLine),
    postalCode: s(row.postalCode),
    city: s(row.city),
    region: s(row.region),
    country: s(row.country),
    timezone: s(row.timezone) || browserTimezone(),
    citizenships: arr(row.citizenships),
    needsSponsorship: typeof workAuth.needsSponsorship === 'boolean' ? workAuth.needsSponsorship : null,
    rightToWork: arr(workAuth.rightToWork),
    authorizationText: s(workAuth.authorizationText),
    relocation,
    remote,
    profession,
    field: s(row.field),
    titles: arr(row.titles),
    seniority: arr(row.seniority).filter((x) => SENIORITY.has(x)),
    skills: arr(row.skills),
    stopSkills: arr(row.stopSkills),
    headline: s(row.headline),
    yearsExperience: typeof row.yearsExperience === 'number' ? row.yearsExperience : 0,
    summary: s(row.summary),
    languageLevels: levels,
    experience: (Array.isArray(row.experience) ? (row.experience as unknown[]) : []).map(obj).map((e) => ({
      company: s(e.company),
      title: s(e.title),
      from: s(e.from),
      to: s(e.to),
      bullets: arr(e.bullets).join('\n'),
    })),
    education: (Array.isArray(row.education) ? (row.education as unknown[]) : []).map(obj).map((e) => ({ school: s(e.school), degree: s(e.degree), year: s(e.year) })),
    degree: s(row.degree),
    gpa: s(row.gpa),
    facts: arr(row.facts),
    noticePeriod: s(row.noticePeriod),
    earliestStart: s(row.earliestStart),
    salaryExpectation: s(row.salaryExpectation),
    salaryCurrency: s(row.salaryCurrency) || 'EUR',
    salaryOnlyWhenAsked: row.salaryOnlyWhenAsked !== false,
    howHeard: s(row.howHeard),
    motivation: s(row.motivation),
    diversity: Object.fromEntries(DIVERSITY_TOPICS.map((t) => [t.key, s(diversity[t.key]) || (t.key === 'gender' ? s(row.gender) : '')])) as Record<DiversityKey, string>,
    dateOfBirth: s(row.dateOfBirth),
    tone,
    neverMention: arr(voice.neverMention),
    leadWith: arr(voice.leadWith),
    signOff: s(voice.signOff) || 'Kind regards,',
    signature: s(row.signature),
    mindset: s(row.mindset),
    prefs: opts.prefs ?? DEFAULT_PREFS,
  }
}

const lines = (t: string) =>
  t
    .split('\n')
    .map((x) => x.replace(/^\s*[-*•]\s*/, '').trim())
    .filter(Boolean)

/** The API body for the given profile fields (all fields when none are given). */
export function toInput(d: ProfileDraft, fields?: ProfileField[]): Record<string, unknown> {
  const all: Partial<Record<ProfileField, unknown>> = {
    fullName: d.fullName,
    givenName: d.givenName,
    familyName: d.familyName,
    preferredName: d.preferredName,
    pronouns: d.pronouns,
    email: d.email,
    phoneCountryCode: d.phoneCountryCode,
    phone: d.phone,
    links: d.links,
    addressLine: d.addressLine,
    postalCode: d.postalCode,
    city: d.city,
    region: d.region,
    country: d.country || null,
    timezone: d.timezone,
    citizenships: d.citizenships.slice(0, 10),
    workAuth: { needsSponsorship: d.needsSponsorship, rightToWork: d.rightToWork, authorizationText: d.authorizationText },
    relocation: d.relocation || null,
    remote: d.remote || null,
    profession: d.profession,
    field: d.profession === 'other' ? d.field : '',
    titles: d.titles.slice(0, 20),
    seniority: d.seniority,
    skills: d.skills.slice(0, 60),
    stopSkills: d.stopSkills.slice(0, 60),
    headline: d.headline,
    yearsExperience: d.yearsExperience,
    summary: d.summary,
    languageLevels: d.languageLevels.filter((l) => l.name.trim()).map((l) => ({ name: l.name.trim(), level: l.level })),
    experience: d.experience
      .filter((e) => e.company.trim() || e.title.trim())
      .map((e) => ({ company: e.company, title: e.title, from: e.from, to: e.to, bullets: lines(e.bullets) })),
    education: d.education.filter((e) => e.school.trim()).map((e) => ({ school: e.school, degree: e.degree, year: e.year })),
    degree: d.degree,
    gpa: d.gpa,
    facts: d.facts.slice(0, 30),
    noticePeriod: d.noticePeriod,
    earliestStart: d.earliestStart,
    salaryExpectation: d.salaryExpectation,
    salaryCurrency: d.salaryCurrency || null,
    salaryOnlyWhenAsked: d.salaryOnlyWhenAsked,
    howHeard: d.howHeard,
    motivation: d.motivation,
    diversity: Object.fromEntries(Object.entries(d.diversity).map(([k, v]) => [k, v || null])),
    dateOfBirth: d.dateOfBirth,
    emailVoice: { tone: d.tone, neverMention: d.neverMention, leadWith: d.leadWith, signOff: d.signOff },
    signature: d.signature,
    mindset: d.mindset,
  }
  if (!fields) return all
  return Object.fromEntries(fields.map((f) => [f, all[f]]))
}
