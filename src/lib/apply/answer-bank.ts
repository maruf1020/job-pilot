import { db } from '@/lib/db'
import { countryNameOf, type CandidateContext, countryInSentence } from '@/lib/candidate/context'
import { loadCandidateContext } from '@/lib/candidate/load'
import { getProfile } from '@/lib/pipeline/profile'
import { normalizeQuestion, similarity } from './match'

/**
 * The answer bank: your answers to application-form questions, reused on every form.
 * - `std:*` rows are the standard details (name parts, links, address, salary, notice...).
 * - Other rows are questions met on forms, keyed by the normalised question text.
 * answer === null means "waiting for you"; answer === '' means "leave blank on purpose".
 */

export interface StandardEntry {
  key: `std:${string}`
  question: string
  kind: 'text' | 'textarea' | 'number' | 'yesno' | 'date'
  /** Shown in "waiting for you" even before a form asked for it. */
  important?: boolean
}

export const STANDARD_ENTRIES: StandardEntry[] = [
  { key: 'std:first_name', question: 'First name', kind: 'text' },
  { key: 'std:last_name', question: 'Last name (family name)', kind: 'text' },
  { key: 'std:preferred_name', question: 'Preferred name', kind: 'text' },
  { key: 'std:phone', question: 'Phone number with country code', kind: 'text' },
  { key: 'std:phone_country', question: 'Phone country (for country-code dropdowns)', kind: 'text' },
  { key: 'std:city', question: 'City you live in', kind: 'text' },
  { key: 'std:region', question: 'State / region / division', kind: 'text' },
  { key: 'std:country', question: 'Country you live in', kind: 'text' },
  { key: 'std:address_line1', question: 'Street address', kind: 'text', important: true },
  { key: 'std:postal_code', question: 'Postal code', kind: 'text', important: true },
  { key: 'std:nationality', question: 'Nationality / citizenship', kind: 'text' },
  { key: 'std:linkedin', question: 'LinkedIn profile URL', kind: 'text' },
  { key: 'std:github', question: 'GitHub URL', kind: 'text' },
  { key: 'std:twitter', question: 'X (Twitter) profile URL', kind: 'text' },
  { key: 'std:website', question: 'Website or portfolio URL', kind: 'text' },
  { key: 'std:current_company', question: 'Current employer', kind: 'text' },
  { key: 'std:current_title', question: 'Current job title', kind: 'text' },
  { key: 'std:years_experience', question: 'Years of professional experience (number)', kind: 'number' },
  { key: 'std:salary_expectation', question: 'Salary expectation (text, e.g. "EUR 60,000 per year, open to discuss")', kind: 'text', important: true },
  { key: 'std:salary_number', question: 'Salary expectation as a number (yearly, in the job currency)', kind: 'number', important: true },
  { key: 'std:notice_period', question: 'Notice period (e.g. "1 month")', kind: 'text', important: true },
  { key: 'std:earliest_start', question: 'Earliest start date (e.g. "1 month after the offer, plus visa time")', kind: 'text', important: true },
  { key: 'std:requires_sponsorship', question: 'Do you need visa sponsorship to work there? (Yes/No)', kind: 'yesno' },
  { key: 'std:work_authorization', question: 'Work authorisation statement (free text)', kind: 'textarea' },
  { key: 'std:willing_to_relocate', question: 'Willing to relocate? (Yes/No)', kind: 'yesno' },
  { key: 'std:how_heard', question: 'How did you hear about the job?', kind: 'text' },
  { key: 'std:highest_degree', question: 'Highest degree', kind: 'text' },
  { key: 'std:school', question: 'University / school', kind: 'text' },
  { key: 'std:field_of_study', question: 'Field of study', kind: 'text' },
  { key: 'std:graduation_year', question: 'Graduation year', kind: 'number' },
  { key: 'std:gpa', question: 'GPA / CGPA', kind: 'text' },
  { key: 'std:languages', question: 'Languages you speak (with level)', kind: 'text' },
  { key: 'std:gender', question: 'Gender for diversity questions (blank = prefer not to say)', kind: 'text' },
  { key: 'std:pronouns', question: 'Pronouns (blank = leave empty)', kind: 'text' },
  { key: 'std:date_of_birth', question: 'Date of birth (YYYY-MM-DD)', kind: 'date' },
  { key: 'std:current_salary', question: 'Current base salary (yearly, with currency; asked by some forms)', kind: 'text' },
  { key: 'std:sexual_orientation', question: 'Sexual orientation (diversity questions)', kind: 'text' },
  { key: 'std:caring_responsibilities', question: 'Caring responsibilities (diversity questions)', kind: 'text' },
  { key: 'std:disability', question: 'Disability, long-term condition or neurodivergence (diversity questions)', kind: 'text' },
  { key: 'std:ethnicity', question: 'Ethnic background (diversity questions)', kind: 'text' },
  { key: 'std:religion', question: 'Religion (diversity questions)', kind: 'text' },
]

const STANDARD_KEYS = new Set<string>(STANDARD_ENTRIES.map((e) => e.key))

function urlFrom(text: string, re: RegExp): string | null {
  const m = re.exec(text)
  if (!m) return null
  const u = m[0].replace(/[).,;]+$/, '')
  return u.startsWith('http') ? u : `https://${u.startsWith('www.') ? u : `www.${u}`}`
}

/** "BSc Computer Science" / "Bachelor of Science in Computer Science" -> "Computer Science". */
function fieldOfStudy(degree: string | null | undefined): string | null {
  const d = (degree ?? '').trim()
  if (!d) return null
  const inPart = /\bin (.+)$/i.exec(d)?.[1]
  if (inPart) return inPart.trim()
  const rest = d.replace(/^(b\.?\s?sc|m\.?\s?sc|b\.?\s?a|m\.?\s?a|b\.?\s?eng|m\.?\s?eng|mba|ph\.?\s?d|bachelor('s)?( of \w+)?|master('s)?( of \w+)?|associate('s)?( of \w+)?|diploma)\.?\s*/i, '').trim()
  return rest && rest !== d ? rest : null
}

/** "Bachelor's degree" style level for highest-education lists, or the degree as written. */
function degreeLevel(degree: string | null | undefined): string | null {
  const d = (degree ?? '').trim()
  if (!d) return null
  if (/ph\.?\s?d|doctor/i.test(d)) return 'Doctorate (PhD)'
  if (/master|m\.?\s?sc|\bma\b|mba|m\.?\s?eng/i.test(d)) return "Master's degree"
  if (/bachelor|b\.?\s?sc|\bba\b|b\.?\s?eng|licen/i.test(d)) return "Bachelor's degree"
  return d
}

/**
 * The person's own sentence for "describe your work authorisation" boxes, without naming a job country (the
 * form filler adds a country-specific line where it knows the job's country). Null when the profile does not say.
 */
export function workAuthorizationText(c: CandidateContext): string | null {
  if (c.workAuth.authorizationText) return c.workAuth.authorizationText
  const cit = c.citizenshipNames.length ? `I am a citizen of ${c.citizenships.map((x) => countryInSentence(x) ?? x).join(' and ')}${c.location ? `, based in ${c.location}` : ''}.` : c.location ? `I am based in ${c.location}.` : ''
  const rights = c.workAuth.rightToWork.map((x) => countryNameOf(x)).filter(Boolean)
  const relocate = c.relocation === 'yes' ? ' I am ready to relocate.' : c.relocation === 'maybe' ? ' I am open to relocating.' : ''
  if (c.workAuth.needsSponsorship === true) {
    return `${cit} ${rights.length ? `I may also work in ${rights.join(', ')} without sponsorship. ` : ''}Where I do not hold a work permit I would need visa sponsorship.${relocate}`.trim()
  }
  if (c.workAuth.needsSponsorship === false) return `${cit} I do not need visa sponsorship to work${rights.length ? ` in ${rights.join(', ')}` : ''}.${relocate}`.trim()
  return null
}

/** Defaults taken from the profile (CandidateProfile) and the CV text. Unknowns stay null (waiting for you). */
async function standardDefaults(): Promise<Record<string, string | null>> {
  const [p, c] = await Promise.all([getProfile(), loadCandidateContext({ fresh: true })])
  const text = p?.resumeText ?? ''
  const linkedin = c.links.linkedin ?? urlFrom(text, /(https?:\/\/)?(www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+/i)
  const githubRaw = c.links.github ?? urlFrom(text, /(https?:\/\/)?(www\.)?github\.com\/[A-Za-z0-9_-]+/i)
  const github = githubRaw?.replace('://www.github.com', '://github.com') ?? null
  const current = c.experience.find((e) => !e.to) ?? c.experience[0]
  const edu = c.education[0]
  const dv = (v: string | null | undefined) => (v && v.trim() ? v.trim() : 'Prefer not to say')
  return {
    'std:first_name': c.givenName || null,
    'std:last_name': c.familyName || null,
    'std:preferred_name': c.preferredName || null,
    'std:phone': c.phoneIntl,
    'std:phone_country': c.countryName,
    'std:city': c.city,
    'std:region': c.region,
    'std:country': c.countryName,
    'std:address_line1': c.addressLine,
    'std:postal_code': c.postalCode,
    'std:nationality': c.citizenshipNames[0] ?? null,
    'std:linkedin': linkedin,
    'std:github': github,
    'std:twitter': c.links.x ?? null,
    'std:website': c.links.portfolio ?? c.links.website ?? github ?? linkedin,
    'std:current_company': current?.company ?? null,
    'std:current_title': current?.title ?? (c.headline || null),
    'std:years_experience': c.yearsExperience ? String(Math.floor(c.yearsExperience)) : null,
    'std:salary_expectation': c.salaryExpectation ? `${c.salaryExpectation}${c.salaryCurrency && !c.salaryExpectation.includes(c.salaryCurrency) ? ` ${c.salaryCurrency}` : ''}` : null,
    'std:salary_number': c.salaryExpectation && /^\D*[\d.,]+\D*$/.test(c.salaryExpectation) ? c.salaryExpectation.replace(/[^\d.]/g, '') || null : null,
    'std:notice_period': c.noticePeriod,
    'std:earliest_start': c.earliestStart,
    'std:requires_sponsorship': c.workAuth.needsSponsorship === true ? 'Yes' : c.workAuth.needsSponsorship === false ? 'No' : null,
    'std:work_authorization': workAuthorizationText(c),
    'std:willing_to_relocate': c.relocation === 'yes' || c.relocation === 'maybe' ? 'Yes' : c.relocation === 'no' ? 'No' : null,
    'std:how_heard': c.howHeard,
    'std:highest_degree': degreeLevel(c.degree ?? edu?.degree),
    'std:school': edu?.school?.split(',')[0]?.trim() ?? null,
    'std:field_of_study': fieldOfStudy(c.degree ?? edu?.degree),
    'std:graduation_year': edu?.year != null ? String(edu.year) : null,
    'std:gpa': c.gpa,
    'std:languages': c.languages.length ? c.languages.map((l) => `${l.name} (${l.level})`).join(', ') : null,
    // Blank = prefer not to say / leave empty.
    'std:gender': c.diversity.gender ?? c.gender ?? '',
    'std:pronouns': c.pronouns ?? '',
    'std:date_of_birth': c.dateOfBirth,
    'std:sexual_orientation': dv(c.diversity.orientation),
    'std:caring_responsibilities': dv(c.diversity.caring),
    'std:disability': dv(c.diversity.disability),
    'std:ethnicity': dv(c.diversity.ethnicity),
    'std:religion': dv(c.diversity.religion),
  }
}

/** Create missing standard rows (never overwrites your edits). */
export async function ensureAnswerBankSeeded(): Promise<number> {
  const existing = new Set((await db.answerBank.findMany({ where: { key: { startsWith: 'std:' } }, select: { key: true } })).map((r) => r.key))
  const missing = STANDARD_ENTRIES.filter((e) => !existing.has(e.key))
  if (missing.length === 0) return 0
  const defaults = await standardDefaults()
  await db.answerBank.createMany({
    data: missing.map((e) => ({ key: e.key, question: e.question, kind: e.kind, answer: defaults[e.key] ?? null, source: defaults[e.key] != null ? 'profile' : 'seed', timesSeen: 0 })),
    skipDuplicates: true,
  })
  return missing.length
}

/**
 * Rewrite the std:* rows from the current profile (onboarding and profile saves call it). Answers the person
 * typed themselves (source 'user') are kept.
 */
export async function reseedStandardAnswers(): Promise<void> {
  const defaults = await standardDefaults()
  const rows = await db.answerBank.findMany({ where: { key: { startsWith: 'std:' } }, select: { key: true, source: true } })
  const byKey = new Map(rows.map((r) => [r.key, r.source]))
  for (const e of STANDARD_ENTRIES) {
    const answer = defaults[e.key] ?? null
    const source = answer != null ? 'profile' : 'seed'
    const had = byKey.get(e.key)
    if (had === 'user') continue
    if (had === undefined) await db.answerBank.create({ data: { key: e.key, question: e.question, kind: e.kind, answer, source, timesSeen: 0 } })
    else await db.answerBank.update({ where: { key: e.key }, data: { answer, source } })
  }
}

export interface BankRow {
  key: string
  question: string
  answer: string | null
  kind: string
  options: string[]
  source: string
}

export interface AnswerBank {
  /** Standard detail; undefined = no row, null = waiting for you, '' = leave blank. */
  std(name: string): string | null | undefined
  /** Saved answer to a form question (exact or very similar wording). */
  lookup(label: string): BankRow | null
  rows: BankRow[]
}

export async function loadAnswerBank(): Promise<AnswerBank> {
  await ensureAnswerBankSeeded()
  const rows = await db.answerBank.findMany({ select: { key: true, question: true, answer: true, kind: true, options: true, source: true } })
  const byKey = new Map(rows.map((r) => [r.key, r]))
  const questions = rows.filter((r) => !STANDARD_KEYS.has(r.key))
  return {
    rows,
    std: (name) => {
      const r = byKey.get(name.startsWith('std:') ? name : `std:${name}`)
      return r ? r.answer : undefined
    },
    lookup: (label) => {
      const k = normalizeQuestion(label)
      if (!k) return null
      const exact = byKey.get(k)
      if (exact?.answer) return exact
      // An unanswered row for this exact wording (left by an earlier stop) must not hide a close answered
      // one (NeuralTrust's Barcelona relocation question).
      let best: { r: BankRow; s: number } | null = null
      for (const r of questions) {
        if (!r.answer) continue
        const s = similarity(k, r.key)
        if (!best || s > best.s) best = { r, s }
      }
      return best && best.s >= 0.82 ? best.r : (exact ?? null)
    },
  }
}

/**
 * A label the scanner could not really read: "Unnamed field", no words, or an element id such as
 * "radio-group-_r_46_" (one token with underscores, digits or several hyphens). Never stored in the bank.
 */
export function unreadableLabel(label: string | null | undefined): boolean {
  const t = (label ?? '').trim()
  if (!/\p{L}{2}/u.test(t)) return true
  if (/^unnamed field$/i.test(t)) return true
  return !/\s/.test(t) && (/[_\d]/.test(t) || (t.match(/-/g) ?? []).length >= 2)
}

/** Option labels worth keeping: a radio value like "on" says nothing, and neither does the question repeated. */
export function cleanOptions(options: string[], label?: string): string[] {
  const q = label ? normalizeQuestion(label) : ''
  return options.map((o) => o.trim()).filter((o) => o && !/^(on|off|true|false)$/i.test(o) && (!q || normalizeQuestion(o) !== q))
}

/** An answer that is only a scanner artefact: "on", or the start of the question itself. */
function junkAnswer(label: string, answer: string): boolean {
  const a = normalizeQuestion(answer)
  if (!a || /^(on|off)$/.test(a)) return true
  const q = normalizeQuestion(label)
  return a.length >= 12 && q.startsWith(a)
}

/** A question the agent met but could not answer: it waits in the bank for you. */
export async function recordOpenQuestion(label: string, kind: string, options: string[], company: string | null): Promise<void> {
  if (unreadableLabel(label)) return
  const key = normalizeQuestion(label).slice(0, 300)
  if (!key) return
  const opts = cleanOptions(options, label)
  await db.answerBank.upsert({
    where: { key },
    update: { timesSeen: { increment: 1 }, lastSeenAt: new Date(), lastCompany: company, ...(opts.length ? { options: opts.slice(0, 40) } : {}) },
    create: { key, question: label.slice(0, 500), kind, options: opts.slice(0, 40), answer: null, source: 'user', lastCompany: company },
  })
}

/**
 * Keep an AI answer to a reusable (non-essay) question, so later forms give the same answer
 * without another AI call. Never overwrites an answer you wrote.
 */
export async function rememberAnswer(label: string, kind: string, options: string[], answer: string, company: string | null): Promise<void> {
  if (unreadableLabel(label) || junkAnswer(label, answer)) return
  options = cleanOptions(options, label)
  const key = normalizeQuestion(label).slice(0, 300)
  if (!key || !answer) return
  const row = await db.answerBank.findUnique({ where: { key } })
  if (row) {
    await db.answerBank.update({
      where: { key },
      // A question waiting for you stays yours to answer; existing answers are never replaced.
      data: { timesSeen: { increment: 1 }, lastSeenAt: new Date(), lastCompany: company },
    })
    return
  }
  await db.answerBank.create({ data: { key, question: label.slice(0, 500), kind, options: options.slice(0, 40), answer, source: 'ai', lastCompany: company } })
}

/** An answer you gave on a form yourself: saved for the agents and it replaces an older answer. */
export async function learnFromYou(label: string, kind: string, options: string[], answer: string, company: string | null): Promise<boolean> {
  if (unreadableLabel(label) || junkAnswer(label, answer)) return false
  options = cleanOptions(options, label)
  const key = normalizeQuestion(label).slice(0, 300)
  if (!key || !answer.trim() || STANDARD_KEYS.has(key)) return false
  const row = await db.answerBank.findUnique({ where: { key } })
  if (row?.answer === answer) return false
  await db.answerBank.upsert({
    where: { key },
    update: { answer, source: 'user', timesSeen: { increment: 1 }, lastSeenAt: new Date(), lastCompany: company, ...(options.length ? { options: options.slice(0, 40) } : {}) },
    create: { key, question: label.slice(0, 500), kind, options: options.slice(0, 40), answer, source: 'user', lastCompany: company },
  })
  return true
}

export function isStandardKey(key: string): boolean {
  return STANDARD_KEYS.has(key)
}
