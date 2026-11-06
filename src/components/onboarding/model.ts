import { z } from 'zod'
import { PROFESSIONS, type Profession } from '@/lib/candidate/context'

/**
 * The onboarding form and Settings > Profile share one model: the zod schema the API validates
 * with, the steps and the fields each one writes, and the rule for "what is still missing".
 * Pure module (no DB, no React), so the route handlers and the client both import it.
 */

// ---------------------------------------------------------------------------
// Option lists
// ---------------------------------------------------------------------------

export const PRONOUN_OPTIONS = ['he/him', 'she/her', 'they/them'] as const

export const LANGUAGE_LEVELS = [
  { value: 'native', label: 'Native' },
  { value: 'fluent', label: 'Fluent' },
  { value: 'professional', label: 'Professional' },
  { value: 'conversational', label: 'Conversational' },
  { value: 'basic', label: 'Basic' },
] as const

export const SENIORITY_OPTIONS = [
  { value: 'junior', label: 'Junior' },
  { value: 'mid', label: 'Mid-level' },
  { value: 'senior', label: 'Senior' },
  { value: 'lead', label: 'Lead' },
  { value: 'principal', label: 'Principal / staff' },
  { value: 'manager', label: 'Manager' },
] as const
export type Seniority = (typeof SENIORITY_OPTIONS)[number]['value']

export const RELOCATION_OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'maybe', label: 'Maybe, for the right role' },
  { value: 'no', label: 'No' },
] as const

export const REMOTE_OPTIONS = [
  { value: 'ok', label: 'Remote, hybrid or on site' },
  { value: 'only', label: 'Remote only' },
  { value: 'no', label: 'On site or hybrid' },
] as const

export const TONE_OPTIONS = [
  { value: 'warm', label: 'Warm', help: 'Friendly and personal' },
  { value: 'direct', label: 'Direct', help: 'Short and to the point' },
  { value: 'formal', label: 'Formal', help: 'Polite and traditional' },
] as const

export const CURRENCIES = ['EUR', 'GBP', 'USD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'CAD', 'AUD'] as const

/**
 * Rough EUR value of one unit. Only used to turn the minimum salary into EUR for ranking, where a
 * few percent either way does not change which jobs come first.
 */
const EUR_PER_UNIT: Record<string, number> = { EUR: 1, GBP: 1.17, USD: 0.92, CHF: 1.05, SEK: 0.087, NOK: 0.086, DKK: 0.134, PLN: 0.23, CZK: 0.04, HUF: 0.0025, RON: 0.2, CAD: 0.67, AUD: 0.6 }

export function toEur(amount: number, currency: string): number {
  return Math.round(amount * (EUR_PER_UNIT[currency] ?? 1))
}

export function fromEur(amountEur: number, currency: string): number {
  const rate = EUR_PER_UNIT[currency] ?? 1
  // Round to a clean thousand so a converted value looks like something a person typed.
  return Math.round(amountEur / rate / 1000) * 1000
}

export const PREFER_NOT = 'Prefer not to say'

export type DiversityKey = 'gender' | 'orientation' | 'ethnicity' | 'religion' | 'disability' | 'veteran' | 'caring' | 'maritalStatus' | 'ageRange'

/** Neutral answer options. Missing = "Prefer not to say", which is what forms get. */
export const DIVERSITY_TOPICS: Array<{ key: DiversityKey; label: string; options: string[] }> = [
  { key: 'gender', label: 'Gender', options: ['Woman', 'Man', 'Non-binary', 'Another gender'] },
  { key: 'orientation', label: 'Sexual orientation', options: ['Heterosexual / straight', 'Gay or lesbian', 'Bisexual', 'Another orientation'] },
  { key: 'ethnicity', label: 'Ethnicity', options: ['Asian', 'Black', 'Hispanic or Latino', 'Middle Eastern or North African', 'White', 'Mixed or multiple', 'Another ethnicity'] },
  { key: 'religion', label: 'Religion or belief', options: ['No religion', 'Buddhist', 'Christian', 'Hindu', 'Jewish', 'Muslim', 'Sikh', 'Another religion or belief'] },
  { key: 'disability', label: 'Disability', options: ['No', 'Yes'] },
  { key: 'veteran', label: 'Veteran status', options: ['I am not a veteran', 'I am a veteran'] },
  { key: 'caring', label: 'Caring responsibilities', options: ['No', 'Yes'] },
  { key: 'maritalStatus', label: 'Marital status', options: ['Single', 'Married', 'In a civil partnership', 'Divorced', 'Widowed'] },
  { key: 'ageRange', label: 'Age range', options: ['18-24', '25-34', '35-44', '45-54', '55-64', '65 or older'] },
]

export const LINK_FIELDS = [
  { key: 'linkedin', label: 'LinkedIn', placeholder: 'https://www.linkedin.com/in/alex-rivera' },
  { key: 'github', label: 'GitHub', placeholder: 'https://github.com/alexrivera' },
  { key: 'portfolio', label: 'Portfolio', placeholder: 'https://alexrivera.example.com' },
  { key: 'behance', label: 'Behance', placeholder: 'https://www.behance.net/alexrivera' },
  { key: 'dribbble', label: 'Dribbble', placeholder: 'https://dribbble.com/alexrivera' },
  { key: 'x', label: 'X (Twitter)', placeholder: 'https://x.com/alexrivera' },
  { key: 'website', label: 'Website', placeholder: 'https://example.com' },
] as const
export type LinkKey = (typeof LINK_FIELDS)[number]['key']

/** Title suggestions per profession, shown under the target-titles field. */
export const TITLE_SUGGESTIONS: Record<Profession, string[]> = {
  software: ['Software Engineer', 'Senior Software Engineer', 'Full Stack Developer', 'Frontend Engineer', 'Backend Engineer', 'Mobile Developer', 'DevOps Engineer'],
  design: ['Product Designer', 'UX Designer', 'UI Designer', 'UX Researcher', 'Graphic Designer', 'Visual Designer', 'Design Lead'],
  data: ['Data Analyst', 'Data Scientist', 'Data Engineer', 'Analytics Engineer', 'Machine Learning Engineer', 'BI Developer'],
  product: ['Product Manager', 'Senior Product Manager', 'Product Owner', 'Technical Product Manager', 'Group Product Manager'],
  marketing: ['Marketing Manager', 'Content Marketing Manager', 'Growth Marketer', 'SEO Specialist', 'Copywriter', 'Social Media Manager'],
  sales: ['Account Executive', 'Sales Manager', 'Customer Success Manager', 'Business Development Representative', 'Account Manager'],
  operations: ['Operations Manager', 'HR Business Partner', 'Recruiter', 'Financial Analyst', 'Project Manager', 'Office Manager'],
  other: [],
}

// ---------------------------------------------------------------------------
// Schema for profile writes (onboarding steps and Settings > Profile)
// ---------------------------------------------------------------------------

/** Optional text: trimmed, '' becomes null. */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v ? v : null))
    .optional()

const tags = (max: number, len = 200) => z.array(z.string().trim().min(1).max(len)).max(max).optional()
const iso2 = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, 'Use a two-letter country code')
  .transform((v) => v.toUpperCase())

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const profileInputSchema = z.object({
  fullName: z.string().trim().max(120).optional(),
  givenName: text(80),
  familyName: text(80),
  preferredName: text(80),
  pronouns: text(40),
  email: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .refine((v) => !v || EMAIL_RE.test(v), 'Enter an email address like alex@example.com')
    .transform((v) => (v ? v.toLowerCase() : null))
    .optional(),
  phoneCountryCode: z
    .string()
    .trim()
    .max(6)
    .nullable()
    .refine((v) => !v || /^\+?\d{1,4}$/.test(v), 'Use a country code like +351')
    .transform((v) => (v ? (v.startsWith('+') ? v : `+${v}`) : null))
    .optional(),
  phone: text(40),
  links: z.record(z.string(), z.string().trim().max(300)).optional(),
  /** "City, Country"; filled from city and country when those are saved. */
  location: z.string().trim().max(120).optional(),
  addressLine: text(200),
  postalCode: text(20),
  city: text(80),
  region: text(80),
  country: iso2.nullable().optional(),
  timezone: text(64),
  citizenships: z.array(iso2).max(10).optional(),
  workAuth: z
    .object({
      needsSponsorship: z.boolean().nullable(),
      rightToWork: z.array(iso2).max(40),
      authorizationText: text(600),
    })
    .optional(),
  relocation: z.enum(['yes', 'no', 'maybe']).nullable().optional(),
  remote: z.enum(['only', 'ok', 'no']).nullable().optional(),
  profession: z.enum(PROFESSIONS.map((p) => p.id) as [Profession, ...Profession[]]).optional(),
  field: text(80),
  titles: tags(20, 120),
  seniority: z.array(z.enum(SENIORITY_OPTIONS.map((s) => s.value) as [Seniority, ...Seniority[]])).max(6).optional(),
  skills: tags(60, 80),
  stopSkills: tags(60, 80),
  headline: z.string().trim().max(160).optional(),
  yearsExperience: z.number().min(0).max(60).optional(),
  summary: z.string().max(2000).optional(),
  languageLevels: z
    .array(z.object({ name: z.string().trim().min(1).max(40), level: z.enum(LANGUAGE_LEVELS.map((l) => l.value) as [string, ...string[]]) }))
    .max(10)
    .optional(),
  /** Legacy "English (fluent)" list; kept in step with languageLevels on save. */
  languages: tags(10, 60),
  experience: z
    .array(
      z.object({
        company: z.string().trim().max(120),
        title: z.string().trim().max(120),
        from: text(20),
        to: text(20),
        bullets: z.array(z.string().trim().min(1).max(400)).max(12).optional(),
      }),
    )
    .max(20)
    .optional(),
  education: z
    .array(z.object({ school: z.string().trim().max(160), degree: text(160), year: text(10) }))
    .max(10)
    .optional(),
  degree: text(120),
  gpa: text(20),
  facts: tags(30, 300),
  noticePeriod: text(120),
  earliestStart: text(120),
  salaryExpectation: text(160),
  salaryCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Use a three-letter currency code like EUR')
    .nullable()
    .optional(),
  salaryOnlyWhenAsked: z.boolean().optional(),
  howHeard: text(300),
  motivation: text(1000),
  diversity: z.record(z.string(), z.string().trim().max(80).nullable()).optional(),
  dateOfBirth: z
    .string()
    .trim()
    .nullable()
    .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Use the date picker (YYYY-MM-DD)')
    .transform((v) => (v ? v : null))
    .optional(),
  emailVoice: z
    .object({
      tone: z.enum(['warm', 'direct', 'formal']),
      neverMention: z.array(z.string().trim().min(1).max(120)).max(30),
      leadWith: z.array(z.string().trim().min(1).max(120)).max(30),
      signOff: z.string().trim().max(80),
    })
    .optional(),
  signature: text(600),
  mindset: text(600),
})
export type ProfileInput = z.infer<typeof profileInputSchema>
export type ProfileField = keyof ProfileInput

/** "Where to look" answers as the wizard edits them. */
export const searchPrefsSchema = z.object({
  countries: z.array(iso2).max(40),
  /** First-choice countries: ranked above the rest. Empty = all equal. */
  firstChoice: z.array(iso2).max(40),
  includeRemote: z.boolean(),
  remoteOnly: z.boolean(),
  /** Yearly, in the profile's salary currency (salaryCurrency, EUR when unset). */
  minSalary: z.number().int().min(0).max(10_000_000).nullable(),
})
export type SearchPrefs = z.infer<typeof searchPrefsSchema>

export const DEFAULT_PREFS: SearchPrefs = { countries: [], firstChoice: [], includeRemote: true, remoteOnly: false, minSalary: null }

/** The shape `applyProfileToSettings` (src/lib/settings/derive.ts) takes. */
export interface DerivePrefs {
  countries: string[]
  priorityTiers: string[][]
  includeRemote: boolean
  remoteOnly: boolean
  minSalaryEur: number | null
}

export function toDerivePrefs(p: SearchPrefs, currency: string | null | undefined): DerivePrefs {
  const first = p.firstChoice.filter((c) => p.countries.includes(c))
  const rest = p.countries.filter((c) => !first.includes(c))
  return {
    countries: p.countries,
    priorityTiers: first.length ? [first, ...(rest.length ? [rest] : [])] : [],
    includeRemote: p.includeRemote || p.remoteOnly,
    remoteOnly: p.remoteOnly,
    minSalaryEur: p.minSalary ? toEur(p.minSalary, currency || 'EUR') : null,
  }
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export interface StepDef {
  n: number
  id: 'keys' | 'cv' | 'who' | 'where' | 'want' | 'look' | 'experience' | 'answers' | 'voice' | 'review'
  title: string
  short: string
  description: string
  optional?: boolean
  fields: ProfileField[]
}

export const STEPS: StepDef[] = [
  { n: 1, id: 'keys', title: 'AI keys', short: 'AI keys', optional: true, fields: [], description: 'With an AI key the app reads your CV, ranks jobs and writes applications. You can add one later.' },
  { n: 2, id: 'cv', title: 'Your CV', short: 'CV', optional: true, fields: [], description: 'Upload your CV as a PDF. With an AI key it fills most of the next steps for you.' },
  {
    n: 3,
    id: 'who',
    title: 'Who you are',
    short: 'You',
    fields: ['fullName', 'givenName', 'familyName', 'preferredName', 'pronouns', 'email', 'phoneCountryCode', 'phone', 'links'],
    description: 'Your name and contact details, exactly as application forms should get them.',
  },
  {
    n: 4,
    id: 'where',
    title: 'Where you live and can work',
    short: 'Location',
    fields: ['addressLine', 'postalCode', 'city', 'region', 'country', 'timezone', 'citizenships', 'workAuth', 'relocation', 'remote'],
    description: 'Used for address fields and to answer work-permit questions truthfully for each country.',
  },
  {
    n: 5,
    id: 'want',
    title: 'What you want',
    short: 'Goals',
    fields: ['profession', 'field', 'titles', 'seniority', 'skills', 'stopSkills', 'headline', 'yearsExperience', 'summary'],
    description: 'The kind of work you are after. This decides which jobs are searched and how they are ranked.',
  },
  { n: 6, id: 'look', title: 'Where to look', short: 'Search', fields: ['languageLevels', 'remote', 'salaryCurrency'], description: 'The countries to search in, remote work, your salary floor and the languages you speak.' },
  { n: 7, id: 'experience', title: 'Experience and education', short: 'Experience', optional: true, fields: ['experience', 'education', 'degree', 'gpa', 'facts'], description: 'Check what was read from your CV, or add it by hand.' },
  {
    n: 8,
    id: 'answers',
    title: 'Standard form answers',
    short: 'Answers',
    optional: true,
    fields: ['noticePeriod', 'earliestStart', 'salaryExpectation', 'salaryCurrency', 'salaryOnlyWhenAsked', 'howHeard', 'motivation', 'diversity', 'dateOfBirth'],
    description: 'Answers to the questions most application forms ask. Diversity questions are optional.',
  },
  { n: 9, id: 'voice', title: 'Email voice', short: 'Voice', optional: true, fields: ['emailVoice', 'signature', 'mindset'], description: 'How your application emails should sound and what they should never say.' },
  { n: 10, id: 'review', title: 'Review and finish', short: 'Review', fields: [], description: 'Check everything once more, then start.' },
]

export const STEP_COUNT = STEPS.length

export function stepDef(n: number): StepDef {
  return STEPS[Math.min(Math.max(1, Math.round(n)), STEP_COUNT) - 1]
}

/** Only the fields a step writes, so a PATCH for one step cannot change another step's answers. */
export function stepSchema(n: number) {
  const fields = stepDef(n).fields
  const mask = Object.fromEntries(fields.map((f) => [f, true])) as Partial<Record<ProfileField, true>>
  return profileInputSchema.pick(mask as Record<ProfileField, true>).strict()
}

// ---------------------------------------------------------------------------
// What is filled
// ---------------------------------------------------------------------------

/** The profile columns the completeness rules read (a DB row or a client draft both fit). */
export interface ProfileLike {
  fullName?: string | null
  email?: string | null
  country?: string | null
  profession?: string | null
  titles?: string[] | null
  workAuth?: unknown
  links?: unknown
  languageLevels?: unknown
  experience?: unknown
  education?: unknown
  diversity?: unknown
  emailVoice?: unknown
}

function sponsorshipAnswer(workAuth: unknown): boolean | null {
  if (!workAuth || typeof workAuth !== 'object') return null
  const v = (workAuth as { needsSponsorship?: unknown }).needsSponsorship
  return typeof v === 'boolean' ? v : null
}

/** The answers Finish needs, each with the step where it is asked. Empty = ready to finish. */
export function missingForFinish(p: ProfileLike | null, prefs: Pick<SearchPrefs, 'countries'>): Array<{ step: number; label: string }> {
  const out: Array<{ step: number; label: string }> = []
  if (!p?.fullName?.trim()) out.push({ step: 3, label: 'Full name' })
  if (!p?.email?.trim()) out.push({ step: 3, label: 'Email' })
  if (!p?.country) out.push({ step: 4, label: 'Country you live in' })
  if (sponsorshipAnswer(p?.workAuth) === null) out.push({ step: 4, label: 'Visa sponsorship answer' })
  if (!p?.profession) out.push({ step: 5, label: 'Profession' })
  if (!p?.titles?.length) out.push({ step: 5, label: 'At least one target job title' })
  if (!prefs.countries.length) out.push({ step: 6, label: 'At least one country to search' })
  return out
}

/**
 * The step to resume at: the first one whose answers were never saved. Each step writes a marker
 * column (links, workAuth, languageLevels, ...), even when the person left it empty, so a saved
 * empty step counts as visited.
 */
export function firstIncompleteStep(p: ProfileLike | null, s: { aiKeys: number; hasResume: boolean; prefs: Pick<SearchPrefs, 'countries'> }): number {
  const visited: Record<number, boolean> = {
    1: s.aiKeys > 0 || s.hasResume || p !== null,
    2: s.hasResume || (p?.links ?? null) !== null,
    3: Boolean(p?.fullName?.trim()) && (p?.links ?? null) !== null,
    4: (p?.workAuth ?? null) !== null,
    5: Boolean(p?.titles?.length),
    6: (p?.languageLevels ?? null) !== null && s.prefs.countries.length > 0,
    7: (p?.experience ?? null) !== null || (p?.education ?? null) !== null,
    8: (p?.diversity ?? null) !== null,
    9: (p?.emailVoice ?? null) !== null,
  }
  for (let n = 1; n < STEP_COUNT; n++) if (!visited[n]) return n
  return STEP_COUNT
}
