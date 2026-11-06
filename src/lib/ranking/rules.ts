import { needsSponsorshipFor, type CandidateContext, type Profession } from '@/lib/candidate/context'
import {
  isCoreSoftwareEngineerTitle,
  isDevTitle,
  isExactTargetTitle,
  matchesAnyTarget,
  professionDictionary,
  seniorityAllowed,
  seniorityOf,
  titleInField,
  titleMatchesTarget,
  normalizeSeniority,
} from '@/lib/candidate/professions'
import { isEuropeanCountry, type Seniority, type SponsorshipLevel } from '@/lib/domain'
import { isOutsideEuropeTarget } from '@/lib/regions'
import type { RankingConfig, SearchConfig } from '@/lib/settings/schema'
import { normalizeTitle } from '@/lib/text'

// Software title helpers moved to candidate/professions.ts; re-exported so existing imports keep working.
export { isCoreSoftwareEngineerTitle, isDevTitle }

export interface RuleJobInput {
  title: string
  description: string
  countryCode?: string | null
  remote?: boolean | null
  sponsorship: SponsorshipLevel | string
  seniority?: string | null
  requiredLanguages?: string[]
  salaryMin?: number | null
  salaryMax?: number | null
  currency?: string | null
  relocationSupport?: boolean | null
  postedAt?: Date | null
  mustHaveSkills?: string[]
  tags?: string[]
  knownSponsor?: boolean
}

/** The parts of the candidate the rule score reads. Without `candidate`, Settings > Search decides the profession. */
export interface RuleProfileInput {
  titles: string[]
  skills: string[]
  candidate?: Partial<Pick<CandidateContext, 'profession' | 'seniority' | 'citizenships' | 'workAuth' | 'languages'>> | null
}

export interface ScoreLine {
  label: string
  points: number
  detail?: string
}

export interface RuleScoreResult {
  score: number
  breakdown: ScoreLine[]
  /** When set, the job should be excluded (status REJECTED_RULE) regardless of score. */
  excludedReason?: string
}

/** Rough FX to EUR for salary sanity checks (not for display). */
const FX_TO_EUR: Record<string, number> = {
  EUR: 1,
  GBP: 1.17,
  USD: 0.92,
  CHF: 1.05,
  SEK: 0.088,
  DKK: 0.134,
  NOK: 0.086,
  PLN: 0.23,
  CZK: 0.04,
  HUF: 0.0025,
  RON: 0.2,
  BGN: 0.51,
  ISK: 0.0067,
}

export function toAnnualEur(amount: number | null | undefined, currency?: string | null): number | null {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return null
  let a = amount
  // Values under 15k are almost always monthly (or hourly noise) — treat as monthly.
  if (a < 15000) a = a * 12
  const fx = FX_TO_EUR[(currency ?? 'EUR').toUpperCase()] ?? 1
  return Math.round(a * fx)
}

/** Title words that mark a software role in the title-match check (software profession only). */
const SOFTWARE_TITLE_TOKENS = [
  'software engineer',
  'software developer',
  'full stack',
  'full-stack',
  'fullstack',
  'frontend',
  'front-end',
  'front end',
  'backend',
  'back-end',
  'back end',
  'web developer',
  'web engineer',
  'application engineer',
  'product engineer',
  'platform engineer',
]

/** Title rules from Settings > Browser: only target titles, and the levels allowed. */
export interface TitleRules {
  targetTitlesOnly?: boolean
  seniority?: string[]
}

/** What the person looks for: Settings > Search (profession, targetTitles) has this shape. */
export interface TitleTarget {
  targetTitles?: string[]
  profession?: Profession | string | null
}

/**
 * The title rule from Settings: the level must be allowed (when levels are set) and, with
 * `targetTitlesOnly`, the title must fit the target titles or the profession. Without a target
 * (an older caller) only the level rule applies.
 */
export function titleAllowed(rules: TitleRules, title: string, target?: TitleTarget | null): boolean {
  const profession = (target?.profession ?? null) as Profession | null
  if (rules.seniority?.length && !seniorityAllowed(title, rules.seniority, profession)) return false
  if (rules.targetTitlesOnly && target) return titleMatchesTarget(title, target.targetTitles ?? [], profession ?? 'other')
  return true
}

export function inferSeniority(title: string, explicit?: string | null, profession?: Profession | null): Seniority {
  const e = (explicit ?? '').toLowerCase()
  if (e && e !== 'unknown') return e as Seniority
  return seniorityOf(title, profession)
}

/** Must-have items that are not skills a profile lists (degrees, languages, soft skills, years). */
const GENERIC_MUST_HAVE_RE = /^(english|german|dutch|french|communication|teamwork|team player|agile|scrum|kanban|bachelor|master|degree|bsc|msc|phd|computer science|years?|experience|senior|lead|leadership|mentoring|problem.solving|collaboration|ownership|startup|fast.paced|remote|hybrid|on.?site|eu|right to work|visa)\b/i

/** Language names in English and in their own language, folded to one English name. */
const LANGUAGE_ALIASES: Record<string, string> = {
  english: 'english',
  german: 'german', deutsch: 'german',
  dutch: 'dutch', nederlands: 'dutch', flemish: 'dutch',
  french: 'french', 'français': 'french', francais: 'french',
  spanish: 'spanish', 'español': 'spanish', espanol: 'spanish', castilian: 'spanish',
  italian: 'italian', italiano: 'italian',
  swedish: 'swedish', svenska: 'swedish',
  danish: 'danish', dansk: 'danish',
  finnish: 'finnish', suomi: 'finnish',
  norwegian: 'norwegian', norsk: 'norwegian',
  polish: 'polish', polski: 'polish',
  czech: 'czech',
  portuguese: 'portuguese', 'português': 'portuguese', portugues: 'portuguese',
  hungarian: 'hungarian', romanian: 'romanian', greek: 'greek', estonian: 'estonian', latvian: 'latvian', lithuanian: 'lithuanian',
  ukrainian: 'ukrainian', russian: 'russian', slovak: 'slovak', slovenian: 'slovenian', croatian: 'croatian', serbian: 'serbian',
  bulgarian: 'bulgarian', turkish: 'turkish', icelandic: 'icelandic', catalan: 'catalan', luxembourgish: 'luxembourgish',
  hebrew: 'hebrew', arabic: 'arabic', japanese: 'japanese', chinese: 'chinese', mandarin: 'chinese', cantonese: 'chinese', korean: 'korean',
  hindi: 'hindi', urdu: 'urdu',
}
const LANGUAGE_RE = new RegExp(`(^|[^\\p{L}])(${Object.keys(LANGUAGE_ALIASES).join('|')})(?=$|[^\\p{L}])`, 'iu')

/** The English name of the language a text names ("Deutsch (C1)" -> "german"), or null. */
export function canonicalLanguage(text: string): string | null {
  const m = LANGUAGE_RE.exec(text)
  return m ? LANGUAGE_ALIASES[m[2].toLowerCase()] ?? null : null
}

function spokenSet(spoken: Array<string | { name: string }> | null | undefined): Set<string> {
  const names = (spoken ?? []).map((l) => (typeof l === 'string' ? l : l.name))
  const out = new Set(names.map((n) => canonicalLanguage(n)).filter((n): n is string => !!n))
  if (!out.size) out.add('english')
  return out
}

/** Required languages the person does not speak (English is assumed when no languages are known). */
export function unspokenLanguages(requiredLanguages: string[] | null | undefined, spoken?: Array<string | { name: string }> | null): string[] {
  const have = spokenSet(spoken)
  return (requiredLanguages ?? []).filter((l) => {
    const c = canonicalLanguage(l)
    return !!c && !have.has(c)
  })
}

/** The posting requires a language the person does not speak: a knockout for applying. */
export function requiresOtherLanguage(requiredLanguages: string[] | null | undefined, spoken?: Array<string | { name: string }> | null): boolean {
  return unspokenLanguages(requiredLanguages, spoken).length > 0
}

const LOCAL_LANGUAGE_ASK_RE = /\b(fluent|native|proficient|business level|c1|c2)\b[^.]{0,40}\b(german|dutch|french|spanish|italian|swedish|danish|finnish|polish|czech|portuguese)\b/gi

export function tierForCountry(code: string | null | undefined, search: SearchConfig): number | 'uk' | 'other-eu' | 'outside' | 'none' {
  if (!code) return 'none'
  const c = code.toUpperCase()
  for (let i = 0; i < search.priorityTiers.length; i++) {
    if (search.priorityTiers[i].map((x) => x.toUpperCase()).includes(c)) return i + 1
  }
  if (c === 'GB') return 'uk'
  if (isEuropeanCountry(c)) return 'other-eu'
  // Canada, Australia, the USA when switched on (or listed in the countries); the prefilter already applied the visa rules.
  if (isOutsideEuropeTarget(c, search)) return 'outside'
  return 'none'
}

/**
 * Whether sponsorship matters for this job: true when the person needs a visa for the job's
 * country, and also when that is unknown (no answers yet), so a sponsored job is never ranked
 * lower than before. False only when the person may work there without one.
 */
function sponsorshipMatters(candidate: RuleProfileInput['candidate'], country: string | null | undefined): boolean {
  if (!candidate?.workAuth) return true
  const need = needsSponsorshipFor({ citizenships: candidate.citizenships ?? [], workAuth: candidate.workAuth }, country || null)
  return need !== false
}

/**
 * Deterministic rule score (0–100). Cheap, explainable, tunable from Settings.
 */
export function computeRuleScore(
  job: RuleJobInput,
  profile: RuleProfileInput,
  ranking: RankingConfig,
  search: SearchConfig,
  now: Date = new Date(),
): RuleScoreResult {
  const w = ranking.weights
  const lines: ScoreLine[] = []
  let score = ranking.base
  const push = (label: string, points: number, detail?: string) => {
    if (points === 0) return
    lines.push({ label, points, detail })
    score += points
  }
  const profession = (profile.candidate?.profession ?? search.profession ?? 'other') as Profession
  const country = (job.countryCode ?? '').toUpperCase()
  const needsVisa = sponsorshipMatters(profile.candidate, country)

  // Sponsorship (only for a person who needs it in the job's country)
  const sp = (job.sponsorship ?? 'unknown').toLowerCase()
  if (needsVisa) {
    if (sp === 'no') {
      return { score: 0, breakdown: [{ label: 'Sponsorship explicitly not offered', points: 0 }], excludedReason: 'Employer states no visa sponsorship' }
    }
    if (sp === 'yes') push('Sponsorship offered', w.sponsorshipYes)
    else if (sp === 'likely') push('Sponsorship likely', w.sponsorshipLikely)
    if (job.knownSponsor) push('Known sponsor company', w.knownSponsor)
  }

  // Country
  const tier = tierForCountry(job.countryCode, search)
  if (tier === 'none') {
    if (job.remote && search.includeRemote) push('Remote (country unknown)', w.remoteEu)
    else if (!country) push('Location unknown', 0)
    else return { score: 0, breakdown: [{ label: `Outside Europe (${country})`, points: 0 }], excludedReason: `Outside Europe (${country})` }
  } else if (tier === 'uk') {
    if (!search.includeUk) return { score: 0, breakdown: [{ label: 'UK excluded by settings', points: 0 }], excludedReason: 'UK excluded by settings' }
    push('United Kingdom', w.countryUk)
  } else if (tier === 'other-eu') {
    push(`Europe (${country})`, w.countryOtherEu)
  } else if (tier === 'outside') {
    push(needsVisa ? `Outside Europe, sponsorship stated (${country})` : `Outside Europe (${country})`, w.countryOutsideEurope)
  } else if (tier === 1) push(`Priority country (${country})`, w.countryTier1)
  else if (tier === 2) push(`Priority tier 2 (${country})`, w.countryTier2)
  else push(`Priority tier ${tier} (${country})`, w.countryTier3)

  // Title
  const nt = normalizeTitle(job.title)
  const targets = [...new Set([...profile.titles, ...(search.targetTitles ?? [])].filter(Boolean))]
  const titleHit =
    matchesAnyTarget(job.title, targets) ||
    targets.some((t) => nt.includes(normalizeTitle(t))) ||
    (profession === 'software' ? SOFTWARE_TITLE_TOKENS.some((t) => nt.includes(t)) : profession !== 'other' && titleMatchesTarget(job.title, [], profession))
  if (titleHit) push('Title matches target roles', w.titleMatch)
  if (isExactTargetTitle(job.title, targets)) push('Exact target title (your focus)', w.titleExact)
  else if (profession !== 'other' && !titleInField(job.title, profession) && !matchesAnyTarget(job.title, targets)) {
    push(`Title does not look like a ${professionDictionary(profession).roleLabel} role`, w.titleNotSoftware)
  }

  // Seniority, against the levels the person wants (no points either way when unknown)
  const wanted = normalizeSeniority(profile.candidate?.seniority ?? [])
  if (wanted.length) {
    const sen = inferSeniority(job.title, job.seniority, profession)
    if (sen !== 'mid' && sen !== 'unknown') {
      if ((wanted as string[]).includes(sen)) push(`Seniority: ${sen}`, w.senioritySeniorLead)
      else if (sen === 'junior') push('Seniority: junior', w.seniorityJunior)
      else if (sen === 'staff') push('Seniority: staff/principal', w.seniorityStaff)
      else if (sen === 'manager' && !wanted.includes('manager')) push('Seniority: manager', w.seniorityStaff)
    }
  }

  // Skill overlap
  const hay = `${job.title}\n${job.description}\n${(job.tags ?? []).join(' ')}\n${(job.mustHaveSkills ?? []).join(' ')}`.toLowerCase()
  const keywords = new Set([...ranking.stackKeywords, ...profile.skills].map((s) => s.toLowerCase().trim()).filter((s) => s.length > 1))
  const hits: string[] = []
  for (const k of keywords) {
    const re = new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i')
    if (re.test(hay)) hits.push(k)
  }
  if (hits.length) push(profession === 'software' ? 'Stack overlap' : 'Skill overlap', Math.min(w.stackMax, hits.length * w.stackPerHit), hits.slice(0, 8).join(', '))

  // Must-have skills the profile does not have: the email would have to claim them, and the
  // honesty check then rejects it. Better to rank the job lower than to draft and fail.
  if (keywords.size) {
    const profileHay = ` ${[...keywords].join(' | ')} `
    const missing = (job.mustHaveSkills ?? []).filter((s) => {
      const k = s.toLowerCase().trim()
      if (k.length < 2 || GENERIC_MUST_HAVE_RE.test(k)) return false
      return !new RegExp(`(^|[^a-z0-9+#.])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9+#.]|$)`, 'i').test(profileHay)
    })
    if (missing.length) push(`Must-have skills not on your profile`, Math.max(w.mustHaveMissingMax, missing.length * w.mustHaveMissing), missing.slice(0, 6).join(', '))
  }

  // Language requirement: languages the person does not speak
  const spoken = profile.candidate?.languages
  const langs = unspokenLanguages(job.requiredLanguages, spoken)
  if (langs.length) push(`Requires ${langs.join('/')}`, w.languageRequired)
  else {
    const have = spokenSet(spoken)
    const asked = [...job.description.matchAll(LOCAL_LANGUAGE_ASK_RE)].map((m) => m[2].toLowerCase()).filter((l) => !have.has(l))
    if (asked.length) push('Description asks for a local language', Math.round(w.languageRequired / 2))
  }

  // Salary
  const annual = toAnnualEur(job.salaryMin ?? job.salaryMax, job.currency)
  if (annual != null) {
    // Ireland's Critical Skills Employment Permit has a salary floor; it only matters for a permit.
    if (country === 'IE' && needsVisa && annual < ranking.csepThresholdEur) push(`Salary below Irish CSEP threshold (~€${annual.toLocaleString()})`, w.salaryBelowCsep)
    else if (ranking.minSalaryEur && annual < ranking.minSalaryEur) push(`Salary below your minimum (~€${annual.toLocaleString()})`, w.salaryBelowMin ?? -15)
    else if (annual >= ranking.goodSalaryEur) push(`Salary listed (~€${annual.toLocaleString()})`, w.salaryGood)
  }

  // Relocation
  if (job.relocationSupport || /\b(relocation (package|support|assistance|bonus)|we relocate|help you relocate)\b/i.test(job.description)) {
    push('Relocation support mentioned', w.relocation)
  }

  // Freshness
  if (job.postedAt) {
    const days = (now.getTime() - job.postedAt.getTime()) / 86_400_000
    if (days <= ranking.freshDays) push('Posted recently', w.fresh)
    else if (days > ranking.staleDays) push(`Posted ${Math.round(days)} days ago`, w.stale)
  }

  // Developers only: a title built on another stack ("Golang Backend Engineer" for a TypeScript developer)
  // is capped so the final score stays under the fit threshold whatever the AI says.
  if (profession === 'software' && keywords.size) {
    const otherStack = offStackTitle(job.title, [...keywords])
    if (otherStack) {
      const cap = (w as Partial<Record<string, number>>).titleOtherStackCap ?? OFF_STACK_TITLE_CAP
      if (score > cap) push(`Title names another stack (${otherStack})`, cap - score)
    }
  }

  return { score: clamp(Math.round(score), 0, 100), breakdown: lines }
}

/** Highest rule score for a title naming another stack: 0.6 x 30 + 0.4 x 100 = 58, below the fit line of 60. */
const OFF_STACK_TITLE_CAP = 30
const STACK_WORDS = ['golang', 'go', 'java', 'kotlin', 'scala', 'ruby', 'rails', 'php', '.net', 'dotnet', 'c#', 'python', 'django', 'rust', 'elixir', 'c++', 'swift', 'objective-c', 'javascript', 'typescript', 'react', 'node', 'vue', 'angular']
const OFF_STACK_RE = /(?:^|[^\w.])(golang|go(?![- ]?to[- ]market|[- ]live)|java(?!\s*script)|kotlin|scala|ruby|rails|php|\.net|dotnet|c#|python|django|rust|elixir|c\+\+|swift|objective-c)(?![\w+#])/i
/** Titles that span stacks ("Full Stack Engineer (Java/React)") are not single-stack titles. */
const MULTI_STACK_RE = /\b(full[- ]?stack|front[- ]?end)\b/i
/** Short names folded to the stack word a title uses ("Node.js" -> "node", "Golang" -> "go"). */
const STACK_ALIASES: Record<string, string> = { 'node.js': 'node', nodejs: 'node', 'next.js': 'react', nextjs: 'react', 'react.js': 'react', golang: 'go', go: 'go', 'ruby on rails': 'ruby', rails: 'ruby', dotnet: '.net', 'c#': '.net', 'asp.net': '.net', django: 'python', flask: 'python', 'spring': 'java', 'spring boot': 'java', ts: 'typescript', js: 'javascript' }

function stackOf(word: string): string {
  const w = word.toLowerCase().trim()
  return STACK_ALIASES[w] ?? w
}

/**
 * The other stack a title is built on ("Golang", "Java", "Ruby on Rails"), or null when the title
 * names one of the person's skills, spans stacks, or names none.
 */
export function offStackTitle(title: string, skills: string[] = []): string | null {
  if (MULTI_STACK_RE.test(title)) return null
  const mine = new Set(skills.map(stackOf).filter((s) => STACK_WORDS.includes(s) || s === '.net'))
  const t = title.toLowerCase()
  for (const s of mine) {
    const re = new RegExp(`(^|[^\\w.])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\.js|js)?(?![\\w+#])`, 'i')
    if (re.test(t)) return null
  }
  if (/\b(javascript|typescript|react|node(\.js|js)?|next\.?js|nestjs|vue|angular)\b/i.test(title) && [...mine].some((s) => ['javascript', 'typescript', 'react', 'node', 'vue', 'angular'].includes(s))) return null
  const m = OFF_STACK_RE.exec(title)
  if (!m) return null
  const found = m[1].toLowerCase()
  return mine.has(stackOf(found)) ? null : found
}

export function combineScores(ruleScore: number, llmScore: number | null | undefined, llmWeight: number): number {
  if (llmScore == null) return clamp(Math.round(ruleScore), 0, 100)
  return clamp(Math.round((1 - llmWeight) * ruleScore + llmWeight * llmScore), 0, 100)
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}
