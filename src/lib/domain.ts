/**
 * Domain constants: string "enums" stored in Postgres + TS unions used everywhere.
 */

export const JOB_STATUSES = [
  'NEW',
  'FILTERED',
  'RANKED',
  'DRAFTING',
  'REVIEW',
  'APPLIED',
  'SKIPPED',
  'REJECTED_RULE',
] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

export const SPONSORSHIP_LEVELS = ['yes', 'likely', 'unknown', 'no'] as const
export type SponsorshipLevel = (typeof SPONSORSHIP_LEVELS)[number]

export const APPLY_CHANNELS = ['email', 'ats', 'portal', 'unknown'] as const
export type ApplyChannel = (typeof APPLY_CHANNELS)[number]

export const APPLICATION_STATUSES = [
  'DRAFT',
  'REVIEW',
  'NEEDS_HUMAN',
  'APPROVED',
  'QUEUED',
  'SENT',
  'REPLIED',
  'INTERVIEW',
  'OFFER',
  'REJECTED',
  'NO_RESPONSE',
  'SKIPPED',
] as const
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number]

/** Statuses that count as "in flight" (sent, waiting on the other side). */
export const APPLICATION_OPEN_STATUSES: ApplicationStatus[] = ['SENT', 'REPLIED', 'INTERVIEW']

export const REPLY_CLASSIFICATIONS = [
  'INTERVIEW_REQUEST',
  'POSITIVE',
  'NEEDS_INFO',
  /** Not a flat no: they like the candidate but location, relocation or sponsorship is the problem. Worth a reply. */
  'LOCATION_ISSUE',
  'REJECTION',
  /** "Please apply through our careers page": the email channel is closed, the job is not. */
  'APPLY_VIA_PORTAL',
  /** Reached the wrong team (support, billing, a job board): the application never got to recruiting. */
  'WRONG_RECIPIENT',
  'AUTO_REPLY',
  'BOUNCE',
  'OTHER',
] as const
export type ReplyClassification = (typeof REPLY_CLASSIFICATIONS)[number]

/** What a reply to a LOCATION_ISSUE email should do (prefilled in the reply composer and used by the Inbox button). */
export const LOCATION_REPLY_INSTRUCTION =
  'Thank them, say what I genuinely like about the company, ask to be considered for any other role or team that can hire from abroad, sponsor a permit or work remotely, and say I am ready to relocate. Very politely ask whether they know a recruiter, a friend or another company looking for someone like me, and if so whether they would kindly pass my profile on.'

/** What a reply to a plain "no" should do, when you choose to answer one. */
export const DECLINE_REPLY_INSTRUCTION =
  'Thank them warmly for the answer and their time, say I would still love to work with them on a future role, and very politely ask whether they know a recruiter, a friend or another company looking for someone like me, and if so whether they would kindly pass my profile on.'

export const SENIORITIES = ['junior', 'mid', 'senior', 'lead', 'staff', 'manager', 'unknown'] as const
export type Seniority = (typeof SENIORITIES)[number]

export const RUN_STATUSES = ['RUNNING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

export const RUN_TRIGGERS = ['SCHEDULED', 'MANUAL', 'CONTINUOUS'] as const
export type RunTrigger = (typeof RUN_TRIGGERS)[number]

export const SOURCE_IDS = [
  'arbeitnow',
  'arbeitnow_uk',
  'eures',
  'ats',
  'freehire',
  'jobnet',
  'jobindex',
  'bundesagentur',
  'hn',
  'landingjobs',
  'themuse',
  'jobicy',
  'himalayas',
  'remoteok',
  'workingnomads',
  'remotive',
  'jooble',
  'adzuna',
  'reed',
  'francetravail',
  'jsearch',
  'linkedin',
  'scrape',
] as const
export type SourceId = (typeof SOURCE_IDS)[number]

export const SOURCE_LABELS: Record<SourceId, string> = {
  arbeitnow: 'Arbeitnow (EU)',
  arbeitnow_uk: 'Arbeitnow (UK)',
  eures: 'EURES (official EU portal)',
  ats: 'Company ATS boards',
  freehire: 'freehire.me (EU/UK tech, ~50 ATS)',
  jobnet: 'Jobnet (Denmark, official)',
  jobindex: 'Jobindex (Denmark)',
  bundesagentur: 'Bundesagentur (Germany, official)',
  hn: 'Hacker News "Who is hiring"',
  landingjobs: 'Landing.jobs (Portugal/EU)',
  themuse: 'The Muse',
  jobicy: 'Jobicy (remote Europe)',
  himalayas: 'Himalayas (remote)',
  remoteok: 'Remote OK',
  workingnomads: 'Working Nomads',
  remotive: 'Remotive',
  jooble: 'Jooble',
  adzuna: 'Adzuna',
  reed: 'Reed (UK)',
  francetravail: 'France Travail',
  jsearch: 'JSearch (LinkedIn/Indeed/Glassdoor)',
  linkedin: 'LinkedIn public jobs',
  scrape: 'Browser scraping',
}

/** Short operator notes shown next to each source in Settings → Search. */
export const SOURCE_NOTES: Partial<Record<SourceId, { note: string; needs?: string; warning?: string }>> = {
  arbeitnow: { note: 'Free. Only postings flagged "visa sponsorship", mostly Germany.' },
  arbeitnow_uk: { note: 'Free. Visa-sponsoring UK postings.' },
  eures: { note: 'Free, official EU job portal: every EEA country, employer and location. English postings only.' },
  ats: { note: 'Free. Public Greenhouse / Lever / Ashby / Workable / SmartRecruiters / Recruitee / Personio / Teamtailor / Workday boards of the companies list. Boards are added automatically from the links of the jobs found, and for known sponsors by probing.' },
  freehire: { note: 'Free, no key. Tech jobs from ~50 ATS platforms (Greenhouse, Ashby, Lever...), searched per country for your JavaScript/TypeScript stack; links go to the employer form. Visa and relocation flags are used.' },
  jobnet: { note: "Free, no key. Denmark's official job portal (public and private employers), searched with your JavaScript/TypeScript stack; links go to the employer's own form. English postings only." },
  jobindex: { note: "Free, no key. Denmark's largest job board, searched with your JavaScript/TypeScript stack; links go to the employer's form or posting. Teasers only (deep fetch reads the rest). English postings only." },
  bundesagentur: { note: "Free, public key. Germany's official job board (Bundesagentur fuer Arbeit), searched with your queries; English postings only. Some networks get HTTP 403, then it is skipped quietly." },
  hn: { note: 'Free. The monthly Hacker News "Who is hiring" threads: posts naming your stack that mention visa, relocation or one of your countries.' },
  landingjobs: { note: 'Free. Portugal and EU tech jobs; "relocation paid" is treated as a sponsorship signal.' },
  themuse: { note: 'Free. Larger employers; searched per hub city of your priority countries.' },
  jobicy: { note: 'Free. Remote jobs open to Europe.' },
  himalayas: { note: 'Free. Remote jobs; kept when open to Europe or worldwide.' },
  remoteok: { note: 'Free. Remote jobs; kept when open to Europe or worldwide.' },
  workingnomads: { note: 'Free. Remote development jobs open to Europe or anywhere.' },
  remotive: { note: 'Free. Remote software jobs.' },
  jooble: { note: 'Aggregator across Europe.', needs: 'JOOBLE_KEY (free)' },
  adzuna: { note: 'Aggregator (UK, DE, NL, FR, AT, BE, CH, ES, IT, PL, and CA, AU, US, NZ when switched on). No Ireland.', needs: 'ADZUNA_APP_ID + ADZUNA_APP_KEY (free)' },
  reed: { note: 'UK jobs from reed.co.uk.', needs: 'REED_KEY (free at reed.co.uk/developers)' },
  francetravail: { note: 'French public employment service (mostly French-language postings).', needs: 'FRANCETRAVAIL_CLIENT_ID + SECRET (free at francetravail.io)' },
  jsearch: { note: 'Google for Jobs data: LinkedIn, Indeed, Glassdoor and company sites, legitimately.', needs: 'RAPIDAPI_KEY + JSearch subscription (free tier ~200 requests/month)' },
  linkedin: {
    note: 'Reads the public, logged-out job search pages. Never uses your account.',
    warning: "Off by default: LinkedIn's terms forbid automated access and its robots file disallows crawling. Low volume, your account is never involved, but LinkedIn may block the IP for a while. Prefer JSearch when you can.",
  },
  scrape: { note: 'Opens the pages under Settings → Scraping in a headless browser (needs Chromium on the worker).' },
}

export const ATS_TYPES = ['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'recruitee', 'personio', 'teamtailor', 'workday', 'bamboohr', 'breezy', 'pinpoint', 'join'] as const
export type AtsType = (typeof ATS_TYPES)[number]

export const DRAFT_KINDS = ['initial', 'follow_up', 'reply'] as const
export type DraftKind = (typeof DRAFT_KINDS)[number]

export const NOTIFICATION_TYPES = [
  'reply',
  'interview',
  'review_needed',
  'run_complete',
  'quota',
  'error',
  'digest',
  'sent',
] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

export const AI_TASKS = [
  'enrich',
  'rank',
  'draft',
  'judge',
  'rewrite',
  'classify_reply',
  'parse_resume',
  'follow_up',
  'reply',
  'cover_letter',
  'form_answers',
  'portal_nav',
  'portal_status',
  'submit_check',
  'form_fix',
  'form_diagnose',
  'panel_chat',
  'inbox_match',
  'transcript',
  'test',
] as const
export type AiTask = (typeof AI_TASKS)[number]

/** What each AI task is for, in plain words (Stats and Settings → AI). */
export const AI_TASK_LABEL: Record<AiTask, string> = {
  enrich: 'Reading job postings',
  rank: 'Ranking jobs',
  draft: 'Writing emails',
  judge: 'Checking drafts',
  rewrite: 'Rewriting drafts',
  classify_reply: 'Sorting replies',
  parse_resume: 'Reading your CV',
  follow_up: 'Follow-ups',
  reply: 'Answering replies',
  cover_letter: 'Cover letters',
  form_answers: 'Form answers',
  portal_nav: 'Finding the form',
  portal_status: 'Portal status',
  submit_check: 'Checking submissions',
  form_fix: 'Filling forms (screenshot driver)',
  form_diagnose: 'Explaining failed forms',
  panel_chat: 'Chatting with you on forms',
  inbox_match: 'Matching emails',
  transcript: 'Reading interview chats',
  test: 'Key tests',
}

/** Countries considered "Europe" for this app (EU/EEA + UK + CH). */
export const EUROPE_COUNTRIES: Record<string, string> = {
  IE: 'Ireland',
  GB: 'United Kingdom',
  DE: 'Germany',
  NL: 'Netherlands',
  SE: 'Sweden',
  DK: 'Denmark',
  FI: 'Finland',
  NO: 'Norway',
  PT: 'Portugal',
  ES: 'Spain',
  FR: 'France',
  BE: 'Belgium',
  LU: 'Luxembourg',
  AT: 'Austria',
  CH: 'Switzerland',
  IT: 'Italy',
  PL: 'Poland',
  CZ: 'Czechia',
  EE: 'Estonia',
  LV: 'Latvia',
  LT: 'Lithuania',
  HU: 'Hungary',
  RO: 'Romania',
  BG: 'Bulgaria',
  HR: 'Croatia',
  SI: 'Slovenia',
  SK: 'Slovakia',
  GR: 'Greece',
  CY: 'Cyprus',
  MT: 'Malta',
  IS: 'Iceland',
}

export const EU_COUNTRY_CODES = Object.keys(EUROPE_COUNTRIES)

export function isEuropeanCountry(code: string | null | undefined): boolean {
  return !!code && code.toUpperCase() in EUROPE_COUNTRIES
}

/** Countries outside Europe the app can be switched on for (Settings → Search). */
export const OTHER_TARGET_COUNTRIES: Record<string, string> = { CA: 'Canada', AU: 'Australia', NZ: 'New Zealand', US: 'United States' }

export function countryName(code: string | null | undefined): string {
  if (!code) return 'Unknown'
  const c = code.toUpperCase()
  return EUROPE_COUNTRIES[c] ?? OTHER_TARGET_COUNTRIES[c] ?? c
}

/** IANA timezone per country, used for send windows. */
export const COUNTRY_TIMEZONES: Record<string, string> = {
  IE: 'Europe/Dublin',
  GB: 'Europe/London',
  PT: 'Europe/Lisbon',
  IS: 'Atlantic/Reykjavik',
  FI: 'Europe/Helsinki',
  EE: 'Europe/Tallinn',
  LV: 'Europe/Riga',
  LT: 'Europe/Vilnius',
  GR: 'Europe/Athens',
  CY: 'Asia/Nicosia',
  RO: 'Europe/Bucharest',
  BG: 'Europe/Sofia',
  CA: 'America/Toronto',
  US: 'America/New_York',
  AU: 'Australia/Sydney',
  NZ: 'Pacific/Auckland',
}

export function countryTimezone(code: string | null | undefined): string {
  if (!code) return 'Europe/Dublin'
  return COUNTRY_TIMEZONES[code.toUpperCase()] ?? 'Europe/Berlin'
}
