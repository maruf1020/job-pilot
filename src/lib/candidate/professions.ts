import type { Seniority } from '@/lib/domain'
import { normalizeTitle } from '@/lib/text'
import type { Profession } from './context'

/**
 * What a job search looks like per profession: default search queries, the words that mark a
 * title as being in the field, title words that look close but are another trade, and typical
 * skills. Onboarding copies these into Settings (derive.ts), where the person can edit them; the
 * ranker and prefilter use them as fallbacks when Settings say nothing more specific.
 */
export interface ProfessionDictionary {
  id: Profession
  /** "software engineering", "design": used in reasons such as "Not a design role". */
  roleLabel: string
  /** Default search queries when the profile has few target titles. */
  queries: string[]
  /** Words or phrases that mark a title as belonging to the field (any one is enough). */
  titleWords: string[]
  /** Title words of other trades that share a field word ("interior designer" for a product designer). */
  excludeTitleWords: string[]
  /** Description words that mark a posting as being in the field when the title is vague. */
  descriptionWords: string[]
  /** Typical skills, used as ranking keywords when the profile lists few. */
  skills: string[]
  /** "Manager" names an individual role here ("Product Manager", "Account Manager"), not a people-management level. */
  managerIsRole: boolean
}

export const PROFESSION_DICTIONARY: Record<Profession, ProfessionDictionary> = {
  software: {
    id: 'software',
    roleLabel: 'software engineering',
    queries: ['software engineer', 'software developer', 'full stack developer', 'frontend developer', 'backend developer'],
    titleWords: ['software', 'developer', 'engineer', 'programmer', 'full stack', 'fullstack', 'frontend', 'front end', 'backend', 'back end', 'web', 'swe', 'application', 'platform', 'devops', 'sre'],
    excludeTitleWords: ['propulsion', 'mechanical', 'electrical', 'civil', 'avionics', 'hardware', 'manufacturing', 'chemical', 'structural', 'mechatronic', 'sales engineer', 'field engineer', 'service engineer', 'support engineer'],
    descriptionWords: ['software', 'frontend', 'front-end', 'backend', 'back-end', 'full stack', 'full-stack', 'rest api', 'graphql', 'microservices', 'codebase', 'pull request'],
    skills: ['JavaScript', 'TypeScript', 'Python', 'Java', 'Go', 'C#', 'SQL', 'React', 'Node.js', 'Docker', 'Kubernetes', 'AWS', 'Git', 'REST', 'PostgreSQL'],
    managerIsRole: false,
  },
  design: {
    id: 'design',
    roleLabel: 'design',
    queries: ['product designer', 'ux designer', 'ui designer', 'ux ui designer', 'visual designer'],
    titleWords: ['designer', 'design', 'ux', 'ui', 'user experience', 'user interface', 'interaction', 'visual', 'graphic', 'ux researcher', 'user researcher', 'illustrator', 'art director', 'creative director', 'motion'],
    excludeTitleWords: ['interior', 'fashion', 'mechanical design', 'electrical design', 'civil', 'structural', 'architectural', 'landscape', 'chip design', 'asic', 'fpga', 'pcb', 'circuit', 'hardware design', 'design engineer', 'design verification', 'kitchen', 'floral', 'textile', 'hair'],
    descriptionWords: ['figma', 'sketch', 'prototype', 'prototyping', 'wireframe', 'wireframes', 'user research', 'usability', 'design system', 'user experience', 'user interface', 'interaction design'],
    skills: ['Figma', 'Sketch', 'Adobe XD', 'Prototyping', 'Wireframing', 'User research', 'Usability testing', 'Design systems', 'Interaction design', 'Visual design', 'Information architecture', 'Illustrator', 'Photoshop'],
    managerIsRole: false,
  },
  data: {
    id: 'data',
    roleLabel: 'data',
    queries: ['data analyst', 'data scientist', 'data engineer', 'business intelligence analyst', 'analytics engineer'],
    titleWords: ['data', 'analyst', 'analytics', 'scientist', 'machine learning', 'ml', 'bi', 'business intelligence', 'statistician', 'insights', 'quantitative', 'reporting'],
    excludeTitleWords: ['data entry', 'data center technician', 'datacenter technician', 'data centre technician', 'data protection officer'],
    descriptionWords: ['sql', 'python', 'tableau', 'power bi', 'looker', 'dashboards', 'statistics', 'data pipeline', 'data warehouse', 'machine learning', 'dbt', 'pandas'],
    skills: ['SQL', 'Python', 'Excel', 'Tableau', 'Power BI', 'Looker', 'Statistics', 'dbt', 'Spark', 'Pandas', 'R', 'Machine learning', 'Data modelling', 'ETL'],
    managerIsRole: false,
  },
  product: {
    id: 'product',
    roleLabel: 'product management',
    queries: ['product manager', 'product owner', 'senior product manager', 'technical product manager', 'group product manager'],
    titleWords: ['product manager', 'product owner', 'product lead', 'head of product', 'product director', 'director of product', 'vp product', 'vp of product', 'chief product', 'product management', 'group product', 'product operations'],
    excludeTitleWords: ['product designer', 'product marketing', 'product engineer', 'product support', 'production', 'product sales'],
    descriptionWords: ['roadmap', 'product discovery', 'backlog', 'user stories', 'stakeholders', 'product strategy', 'prioritisation', 'prioritization', 'okrs', 'go-to-market'],
    skills: ['Product strategy', 'Roadmapping', 'Product discovery', 'User stories', 'Backlog management', 'Stakeholder management', 'Analytics', 'Jira', 'OKRs', 'Agile', 'SQL', 'User research'],
    managerIsRole: true,
  },
  marketing: {
    id: 'marketing',
    roleLabel: 'marketing',
    queries: ['marketing manager', 'digital marketing manager', 'content marketing manager', 'growth marketing manager', 'seo specialist', 'social media manager'],
    titleWords: ['marketing', 'marketer', 'content', 'seo', 'sem', 'ppc', 'growth', 'brand', 'social media', 'communications', 'copywriter', 'campaign', 'demand generation', 'community manager', 'pr'],
    excludeTitleWords: ['telemarketing', 'door to door', 'multi level'],
    descriptionWords: ['campaigns', 'seo', 'content strategy', 'social media', 'google analytics', 'hubspot', 'paid search', 'brand', 'email marketing', 'marketing automation'],
    skills: ['SEO', 'Google Analytics', 'Content strategy', 'Copywriting', 'Social media', 'Email marketing', 'HubSpot', 'Paid search', 'Campaign management', 'Marketing automation', 'Brand strategy'],
    managerIsRole: true,
  },
  sales: {
    id: 'sales',
    roleLabel: 'sales',
    queries: ['account executive', 'sales manager', 'business development manager', 'customer success manager', 'account manager', 'sales development representative'],
    titleWords: ['sales', 'account executive', 'account manager', 'business development', 'customer success', 'sdr', 'bdr', 'partnerships', 'revenue', 'client partner', 'key account', 'sales development'],
    excludeTitleWords: ['retail sales associate', 'cashier', 'store assistant', 'door to door', 'telemarketing', 'commission only'],
    descriptionWords: ['quota', 'pipeline', 'crm', 'salesforce', 'prospecting', 'closing', 'customer success', 'renewals', 'upsell', 'business development'],
    skills: ['CRM', 'Salesforce', 'HubSpot', 'Negotiation', 'Pipeline management', 'Prospecting', 'Account management', 'Forecasting', 'Cold outreach', 'SaaS sales', 'Customer success'],
    managerIsRole: true,
  },
  operations: {
    id: 'operations',
    roleLabel: 'operations',
    queries: ['operations manager', 'business operations', 'hr manager', 'people partner', 'recruiter', 'financial analyst', 'project manager'],
    titleWords: ['operations', 'ops', 'hr', 'human resources', 'people', 'talent', 'recruiter', 'recruitment', 'finance', 'financial', 'accountant', 'accounting', 'controller', 'payroll', 'project manager', 'program manager', 'programme manager', 'office manager', 'procurement', 'supply chain', 'logistics', 'administrator', 'coordinator'],
    excludeTitleWords: ['forklift', 'warehouse operative', 'machine operator', 'driver'],
    descriptionWords: ['process improvement', 'stakeholders', 'budget', 'reporting', 'recruiting', 'hris', 'payroll', 'vendor', 'operations', 'compliance'],
    skills: ['Project management', 'Process improvement', 'Excel', 'Budgeting', 'Stakeholder management', 'Recruiting', 'HRIS', 'Reporting', 'Vendor management', 'Operations planning'],
    managerIsRole: true,
  },
  other: {
    id: 'other',
    roleLabel: 'matching',
    queries: [],
    titleWords: [],
    excludeTitleWords: [],
    descriptionWords: [],
    skills: [],
    managerIsRole: true,
  },
}

/** The dictionary for a profession id; unknown ids get the open "other" entry. */
export function professionDictionary(profession: string | null | undefined): ProfessionDictionary {
  return PROFESSION_DICTIONARY[(profession ?? 'other') as Profession] ?? PROFESSION_DICTIONARY.other
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** One regex matching any of the words as whole words (spaces and hyphens interchangeable), or null for no words. */
export function wordsRegex(words: string[]): RegExp | null {
  const parts = [...new Set(words.map((w) => w.toLowerCase().trim()).filter(Boolean))].map((w) => escapeRe(w).replace(/\\?[\s-]+/g, '[\\s-]?'))
  if (!parts.length) return null
  return new RegExp(`(^|[^\\p{L}\\p{N}])(${parts.join('|')})(?=$|[^\\p{L}\\p{N}])`, 'iu')
}

const regexCache = new Map<string, RegExp | null>()
function cachedRegex(key: string, words: string[]): RegExp | null {
  if (!regexCache.has(key)) regexCache.set(key, wordsRegex(words))
  return regexCache.get(key) ?? null
}

// ---------------------------------------------------------------------------
// Seniority
// ---------------------------------------------------------------------------

/** Levels a person can pick in Settings, lowest first. */
export const SENIORITY_LEVELS = ['junior', 'mid', 'senior', 'lead', 'staff', 'manager'] as const
export type SeniorityLevel = (typeof SENIORITY_LEVELS)[number]

/** The words that put a title at each level. */
export const SENIORITY_WORDS: Record<SeniorityLevel, string[]> = {
  junior: ['intern', 'internship', 'trainee', 'working student', 'werkstudent', 'graduate', 'new grad', 'entry level', 'entry-level', 'junior', 'jr', 'apprentice'],
  mid: ['mid', 'mid-level', 'intermediate'],
  senior: ['senior', 'sr', 'experienced'],
  lead: ['lead', 'tech lead', 'team lead'],
  staff: ['staff', 'principal', 'distinguished', 'architect', 'fellow'],
  manager: ['head of', 'director', 'vp', 'vice president', 'chief', 'cto', 'cpo', 'cmo', 'manager'],
}

/** Words that mark a junior posting: excluded from search titles unless the person picked the junior level. */
export const JUNIOR_TITLE_WORDS = ['intern', 'internship', 'working student', 'werkstudent', 'trainee', 'apprentice', 'graduate', 'junior']

/**
 * The level a title names. "Manager" counts as a level only in fields where it is not the
 * role itself (an "Engineering Manager" manages people; a "Product Manager" usually does not).
 */
export function seniorityOf(title: string, profession?: Profession | null): Seniority {
  const t = normalizeTitle(title)
  if (/\b(intern|internship|trainee|working student|werkstudent|graduate|new grad|entry[- ]level|junior|jr\.?|apprentice)\b/.test(t)) return 'junior'
  if (/\b(staff|principal|distinguished|architect|fellow)\b/.test(t)) return 'staff'
  if (/\b(head of|director|vp|vice president|chief|cto|cpo|cmo)\b/.test(t)) return 'manager'
  const managerIsRole = professionDictionary(profession ?? 'software').managerIsRole
  if (/\bmanager\b/.test(t) && (!managerIsRole || /\b(engineering|development|design|people|team|data science|analytics) manager\b/.test(t))) return 'manager'
  if (/\b(lead|tech lead|team lead)\b/.test(t)) return 'lead'
  if (/\b(senior|sr\.?)\b/.test(t)) return 'senior'
  return 'mid'
}

/** Free-text levels from the profile ("Senior", "entry level", "principal") as Settings levels. */
export function normalizeSeniority(levels: string[]): SeniorityLevel[] {
  const out = new Set<SeniorityLevel>()
  for (const raw of levels) {
    const l = raw.toLowerCase().trim()
    if (!l) continue
    if ((SENIORITY_LEVELS as readonly string[]).includes(l)) out.add(l as SeniorityLevel)
    else if (/intern|junior|entry|graduate|trainee|apprentice/.test(l)) out.add('junior')
    else if (/mid|intermediate|regular/.test(l)) out.add('mid')
    else if (/senior|experienced/.test(l)) out.add('senior')
    else if (/lead/.test(l)) out.add('lead')
    else if (/staff|principal|architect/.test(l)) out.add('staff')
    else if (/manager|head|director|vp|chief|executive/.test(l)) out.add('manager')
  }
  return SENIORITY_LEVELS.filter((l) => out.has(l))
}

/**
 * Whether a title's level is one the person allows. A title with no level word ("UX Designer")
 * always passes: many such postings are open to every level.
 */
export function seniorityAllowed(title: string, allowed: string[] | null | undefined, profession?: Profession | null): boolean {
  const levels = normalizeSeniority(allowed ?? [])
  if (!levels.length) return true
  const s = seniorityOf(title, profession)
  if (s === 'mid' || s === 'unknown') return true
  return levels.includes(s as SeniorityLevel)
}

// ---------------------------------------------------------------------------
// Title matching
// ---------------------------------------------------------------------------

const LEVEL_TOKENS = new Set(['senior', 'sr', 'sr.', 'junior', 'jr', 'jr.', 'lead', 'staff', 'principal', 'mid', 'i', 'ii', 'iii', 'iv', '1', '2', '3', '4', 'l1', 'l2', 'l3', 'l4', 'experienced'])
const FILLER_TOKENS = new Set(['and', 'the', 'of', 'for', 'in', 'a', 'an', 'with', 'to', '&', '+'])

/** The meaningful words of a title, without levels, filler or gender tags. */
export function titleTokens(title: string): string[] {
  return normalizeTitle(title)
    .split(/[\s/]+/)
    .map((w) => w.replace(/^[.#+]+|[.]+$/g, ''))
    .filter((w) => w && !LEVEL_TOKENS.has(w) && !FILLER_TOKENS.has(w))
}

/** The title before a team or place ("Senior Product Designer - Payments" -> "Senior Product Designer"). */
export function coreTitle(title: string): string {
  return title.split(/\s[-–—|]\s|[-–—|]\s+|,|\(|\[|:|@/)[0] ?? title
}

/** Every word of a target title appears in the job title ("UX Designer" matches "Senior UX/UI Designer"). */
export function matchesAnyTarget(title: string, targets: string[]): boolean {
  if (!targets.length) return false
  const have = new Set(titleTokens(title).map(stem))
  return targets.some((target) => {
    const need = titleTokens(target).map(stem)
    return need.length > 0 && need.every((w) => have.has(w))
  })
}

/** The job's core title equals a target title, levels aside ("Product Designer II" for "Product Designer"). */
export function isExactTargetTitle(title: string, targets: string[]): boolean {
  const core = titleTokens(coreTitle(title)).map(stem).join(' ')
  return !!core && targets.some((t) => titleTokens(t).map(stem).join(' ') === core)
}

/** Plural and a few spelling variants fold together ("engineers" -> "engineer", "front-end" -> "frontend"). */
function stem(w: string): string {
  return w.replace(/-/g, '').replace(/(?<=\w{3})s$/, '')
}

/** The excluded word of another trade the title names, or null. */
export function excludedTradeWord(title: string, profession: Profession | null | undefined): string | null {
  const dict = professionDictionary(profession)
  const re = cachedRegex(`x:${dict.id}`, dict.excludeTitleWords)
  const m = re?.exec(normalizeTitle(title))
  return m ? m[2] : null
}

/** The title has a word of the field ("designer", "analyst", "account executive"). */
export function titleInField(title: string, profession: Profession | null | undefined): boolean {
  const dict = professionDictionary(profession)
  if (dict.id === 'other') return true
  if (dict.id === 'software') return SOFTWARE_TITLE_RE.test(title)
  const re = cachedRegex(`t:${dict.id}`, dict.titleWords)
  return !!re?.test(normalizeTitle(title))
}

/**
 * Whether a job title fits what the person looks for: one of their target titles, or (when the
 * field has a dictionary) a role title of the field that is not another trade. Software uses the
 * stricter developer-title rule, because "engineer" alone also names many non-software jobs.
 * With no targets and the open "other" profession, every title fits.
 */
export function titleMatchesTarget(title: string, targets: string[], profession: Profession | null | undefined): boolean {
  const p = (profession ?? 'other') as Profession
  if (matchesAnyTarget(title, targets)) return true
  if (excludedTradeWord(title, p)) return false
  if (p === 'other') return !targets.length
  if (p === 'software') return isDevTitle(title, { allowLead: true, anyLevel: true }) || ENGINEERING_MANAGER_RE.test(normalizeTitle(title))
  return titleInField(title, p) && ROLE_NOUN[p].test(normalizeTitle(title))
}

/** The role nouns that make a field word into a job title ("design" alone is also "design engineer"). */
const ROLE_NOUN: Record<Exclude<Profession, 'software' | 'other'>, RegExp> = {
  design: /\b(designers?|design (lead|director|manager)|head of design|ux|ui|researchers?|illustrators?|art director|creative director|animators?)\b/,
  data: /\b(analysts?|scientists?|data engineers?|analytics engineers?|ml engineers?|machine learning engineers?|statisticians?|data (lead|manager|architect)|head of (data|analytics)|bi (developer|engineer)s?)\b/,
  product: /\b(product (manager|owner|lead|director)s?|head of product|director of product|vp (of )?product|chief product|group product|product operations)\b/,
  marketing: /\b(market(ing|er)s?|seo|sem|ppc|content|copywriters?|social media|brand|communications|campaign|growth|demand generation|community manager|pr)\b/,
  sales: /\b(sales|account (executive|manager)s?|business development|customer success|sdr|bdr|partnerships|client partner|key account|revenue)\b/,
  operations: /\b(operations|ops|hr|human resources|people|talent|recruit(er|ment)|finance|financial|accountants?|accounting|controller|payroll|(project|program|programme|office) managers?|procurement|supply chain|logistics|administrators?|coordinators?)\b/,
}

const ENGINEERING_MANAGER_RE = /\b(engineering|software|development) manager\b|\bhead of (engineering|software|development)\b|\bvp (of )?engineering\b|\bcto\b/

// ---------------------------------------------------------------------------
// Software titles (a developer search needs a stricter rule than "has a field word")
// ---------------------------------------------------------------------------

/** Title words of software work, for the prefilter and the ranker. */
export const SOFTWARE_TITLE_RE = /(software|developer|dev\b|engineer|programmer|full.?stack|front.?end|back.?end|web|typescript|javascript|react|node|nestjs|next\.?js|application|platform|product engineer|swe\b|technical lead|tech lead|architect)/i

/**
 * "Software Engineer", "Software Engineer I/II/III", "Senior Software Engineer (I)", with a team or
 * place after a dash, comma, bar or bracket ("Senior Software Engineer - Payments").
 */
export function isCoreSoftwareEngineerTitle(title: string): boolean {
  const core = title.split(/\s[-–—|]\s|,|\(|\[|:/)[0] ?? ''
  return /^(senior |sr\.? )?software engineer( (i{1,3}|[123]|l[1-4]))?$/.test(normalizeTitle(core))
}

const NOT_IC_LEVEL = /\b(lead|leader|staff|principal|principle|manager|head|director|architect|vp|chief|cto|intern|internship|junior|jr|graduate|grad|new grad|entry level|trainee|apprentice|working student|werkstudent)\b/
/** The same without lead / staff / principal, for when lead engineering titles are allowed. */
const NOT_IC_LEVEL_EXCEPT_LEAD = /\b(manager|head|director|architect|vp|chief|cto|intern|internship|junior|jr|graduate|grad|new grad|entry level|trainee|apprentice|working student|werkstudent)\b/
/** Words that never make a developer title, whatever the level ("Engineering Manager", "Solutions Architect"). */
const NOT_DEV_ROLE = /\b(manager|head|director|architect|vp|chief|cto)\b/
const DEV_AREA = /\b(software|frontend|front end|front|full ?stack|fullstack|backend|back end|back|web|react|react\.js|typescript|javascript|js|node|node\.js|nodejs|next\.js|nextjs|vue|vue\.js|angular|product|application|ui|shopify|e-?commerce|ai|applied ai|forward deployed|platform|python|java|golang|kotlin|scala|ruby|rails|php|\.net|c#|rust|elixir|ios|android|mobile)\b/
// Typos and short forms seen on real postings ("Full Stack Developper", "Full Stack Enginer", "Fullstack SWE").
const DEV_ROLE = /\b(engineers?|enginers?|developers?|developpers?|programmers?|swes?)\b/
/** "Senior Developer - Shopify": a developer title without an area word. */
const PLAIN_DEVELOPER = /^(senior |sr\.? )?developers?$/
/** "Fullstack React Typescript": a stack with no role word. */
const STACK_ONLY = /^(senior |sr\.? )?(full ?stack|fullstack)\b.*\b(react|typescript|javascript|node|node\.js|angular|vue|next\.js)\b/
/** "Senior Engineer", "Founding Engineer", "Experienced Webdeveloper": developer titles with no area word. */
const PLAIN_ENGINEER = /^(senior |sr\.? |founding |experienced |senior founding )?(engineers?|software developers?)$/
const WEB_DEVELOPER_WORD = /\b(webdevelopers?|webentwickler(in)?|webontwikkelaar)\b/
/** With lead titles allowed: "Lead Engineer", "Principal Engineer", "Tech Lead", "Lead Developer". */
const LEAD_PLAIN = /^(senior |sr\.? )?((lead|staff|principal) (engineers?|developers?)|(tech|technical|team|engineering|development|dev) lead)$/
/** "Software Engineering Lead", "Frontend Lead", "Full Stack Lead": an area word plus Lead. */
const LEAD_AREA = /^(senior |sr\.? )?(software|frontend|front end|full ?stack|fullstack|backend|back end|web|platform|application)( engineering| engineer| development| developer)? lead\b/
/** "Technical Lead with React", "Tech Lead - Node.js": a tech lead title that names a stack or area. */
const LEAD_WITH_STACK = /^(senior |sr\.? )?(tech|technical|team|engineering|development|dev) lead\b.*\b(react|typescript|javascript|node|node\.js|nodejs|next\.js|nextjs|vue|angular|full ?stack|fullstack|front ?end|back ?end|web|python|java|golang|ruby|php|\.net|c#|kotlin|rust|platform|backend|frontend)\b/

/**
 * Developer titles: Software Engineer, Frontend, Full-stack, Backend, Web, a language or framework
 * plus developer or engineer. By default only regular and senior levels pass; `allowLead` lets lead,
 * staff and principal developer titles through; `anyLevel` skips the level check (the seniority
 * setting decides levels then). Managers, heads and architects are never developer titles.
 */
export function isDevTitle(title: string, opts: { allowLead?: boolean; anyLevel?: boolean } = {}): boolean {
  const t = normalizeTitle(title)
  // The level check covers the whole title: "Software Engineer I (New Grad)" is a graduate title.
  const levelRe = opts.anyLevel ? NOT_DEV_ROLE : opts.allowLead ? NOT_IC_LEVEL_EXCEPT_LEAD : NOT_IC_LEVEL
  if (levelRe.test(t)) return false
  if (isCoreSoftwareEngineerTitle(title)) return true
  const core = normalizeTitle(coreTitle(title))
  const lead = !!opts.allowLead || !!opts.anyLevel
  return (
    (DEV_AREA.test(t) && DEV_ROLE.test(t)) ||
    PLAIN_DEVELOPER.test(core) ||
    STACK_ONLY.test(t) ||
    PLAIN_ENGINEER.test(core) ||
    WEB_DEVELOPER_WORD.test(t) ||
    (lead && (LEAD_PLAIN.test(core) || LEAD_WITH_STACK.test(t) || LEAD_AREA.test(core)))
  )
}

/** Description check for software when the title is vague ("Technical Lead"). */
export const SOFTWARE_DESC_RE = /\b(typescript|javascript|react|node\.?js|nestjs|next\.?js|python|java|golang|kotlin|ruby|php|c#|\.net|frontend|front-end|backend|back-end|full[- ]?stack|rest api|graphql|postgres|microservices)/i

/**
 * Whether a posting is in the person's field: the title names the field or a target title, or
 * (when the title is vague) the description names at least two words of the field.
 */
export function looksLikeProfessionRole(title: string, description: string, profession: Profession | null | undefined, targets: string[] = []): boolean {
  const p = (profession ?? 'other') as Profession
  if (p === 'other') return true
  if (matchesAnyTarget(title, targets)) return true
  if (titleInField(title, p)) return true
  const desc = description.slice(0, 6000)
  if (p === 'software') return SOFTWARE_DESC_RE.test(desc)
  const re = cachedRegex(`d:${p}`, professionDictionary(p).descriptionWords)
  if (!re) return true
  const g = new RegExp(re.source, 'giu')
  const hits = new Set([...desc.matchAll(g)].map((m) => m[2].toLowerCase()))
  return hits.size >= 2
}
