import { z } from 'zod'
import { NOTIFICATION_TYPES, SOURCE_IDS } from '@/lib/domain'

/**
 * Settings are stored as grouped JSON columns on the singleton `Settings` row.
 * These zod schemas are the source of truth; `.default()` values are the seed.
 */

const sourceToggle = (enabled: boolean, maxPages = 3) =>
  z
    .object({
      enabled: z.boolean().default(enabled),
      maxPages: z.number().int().min(1).max(20).default(maxPages),
    })
    .default({ enabled, maxPages })

/** Profession ids, the same list as PROFESSIONS in src/lib/candidate/context.ts. */
export const PROFESSION_IDS = ['software', 'design', 'data', 'product', 'marketing', 'sales', 'operations', 'other'] as const

/** The countries searched by default: the app's sources are Europe-centred. Onboarding replaces this with the person's choice. */
export const DEFAULT_SEARCH_COUNTRIES = ['IE', 'NL', 'DE', 'SE', 'DK', 'FI', 'PT', 'EE', 'ES', 'AT', 'BE', 'FR', 'PL', 'CZ']

export const searchConfigSchema = z.object({
  /** Search queries; onboarding derives them from the profile's target titles (settings/derive.ts). */
  queries: z.array(z.string().trim().min(2)).default([]),
  /** The person's field: picks the title words, the role check and the default queries (candidate/professions.ts). */
  profession: z.enum(PROFESSION_IDS).default('other'),
  /** Target job titles, copied from the profile at onboarding; titles matching one of them always count as the field. */
  targetTitles: z.array(z.string().trim().min(1)).default([]),
  /** Ordered tiers, highest priority first. Country codes not listed fall into "other EU". */
  priorityTiers: z.array(z.array(z.string().length(2))).default([]),
  /** Countries to actively query on sources that need a location. */
  countries: z
    .array(z.string().length(2))
    .min(1)
    .default([...DEFAULT_SEARCH_COUNTRIES]),
  includeUk: z.boolean().default(true),
  includeRemote: z.boolean().default(true),
  /** Only remote postings (the prefilter drops on-site and hybrid ones). */
  remoteOnly: z.boolean().default(false),
  /**
   * Countries outside Europe to search and apply to as well. For a person who needs sponsorship
   * there, only postings that state sponsorship (Canada: Global Talent Stream / LMIA wording;
   * Australia: 482 / sponsor wording; USA: cap-exempt employers that say they sponsor) get through,
   * because the visa rules allow little else.
   */
  outsideEurope: z.array(z.enum(['CA', 'AU', 'US', 'NZ'])).default([]),
  /**
   * Light runs between the full ones: only company ATS boards and the visa-flagged feeds, so fresh
   * postings are seen within hours. Minutes between them; 0 = off.
   */
  boardsRunEveryMinutes: z.number().int().min(0).max(1440).default(0),
  /**
   * Continuous search: the next run starts as soon as the last one ended plus `pauseMinutes`, until
   * it is switched off. `sources` is where it searches; empty = every enabled source.
   */
  continuous: z
    .object({
      enabled: z.boolean().default(false),
      sources: z.array(z.enum(SOURCE_IDS)).default([]),
      pauseMinutes: z.number().int().min(0).max(120).default(2),
    })
    .default({ enabled: false, sources: [], pauseMinutes: 2 }),
  /** Title words that drop a posting before any AI spend; onboarding fills them from the profession and seniority. */
  excludeTitleKeywords: z.array(z.string().trim().min(1)).default([]),
  maxJobsPerRun: z.number().int().min(10).max(5000).default(400),
  maxDaysOld: z.number().int().min(1).max(365).default(45),
  /** Open short listings (snippet-only sources) in the browser to read the full posting + any email. */
  deepFetch: z.boolean().default(true),
  deepFetchLimit: z.number().int().min(0).max(300).default(40),
  deepFetchMinChars: z.number().int().min(100).max(5000).default(600),
  /** For high-scoring jobs without an email: look on the company site, then guess (careers@ …). */
  contactDiscovery: z.boolean().default(true),
  contactDiscoveryLimit: z.number().int().min(0).max(300).default(40),
  /**
   * Search rotation: instead of the same few queries every run, each run takes the
   * least-recently-searched (query × country) combinations per source, continues from
   * the result page where the previous run stopped, and lets an exhausted combination
   * rest for `cycleDays` before starting over.
   */
  rotation: z
    .object({
      enabled: z.boolean().default(true),
      /** Query × country combinations one source runs per search run. */
      combosPerSource: z.number().int().min(1).max(40).default(10),
      /** Days a fully paged combination rests before it is searched again from page 1. */
      cycleDays: z.number().int().min(1).max(30).default(3),
      /** Add query variants derived from the profile's target titles and main skills. */
      autoVariants: z.boolean().default(true),
    })
    .prefault({}),
  sources: z
    .object({
      arbeitnow: sourceToggle(true, 5),
      arbeitnow_uk: sourceToggle(true, 2),
      eures: sourceToggle(true, 3),
      /** freehire.me: per-country pages of developer jobs, filtered by the skills in Settings (50 a page; software only). */
      freehire: sourceToggle(true, 4),
      /** Jobnet.dk and Jobindex.dk (Denmark): each page searches every search keyword (50 / 20 a keyword). */
      jobnet: sourceToggle(true, 2),
      jobindex: sourceToggle(true, 3),
      /** Bundesagentur fuer Arbeit job search (Germany's official job board), English postings only. */
      bundesagentur: sourceToggle(true, 2),
      /** Hacker News "Who is hiring" monthly threads (Algolia API), posts that mention visa or relocation. */
      hn: sourceToggle(true, 1),
      landingjobs: sourceToggle(true, 4),
      themuse: sourceToggle(true, 2),
      jobicy: sourceToggle(true, 1),
      himalayas: sourceToggle(true, 2),
      remoteok: sourceToggle(true, 1),
      workingnomads: sourceToggle(true, 1),
      reed: sourceToggle(false, 2),
      francetravail: sourceToggle(false, 2),
      /** Public logged-out LinkedIn pages; off by default (see SOURCE_NOTES). */
      linkedin: sourceToggle(false, 1),
      jooble: sourceToggle(true, 3),
      adzuna: sourceToggle(true, 2),
      jsearch: z
        .object({
          enabled: z.boolean().default(false),
          maxPages: z.number().int().min(1).max(5).default(1),
          dailyBudget: z.number().int().min(0).max(50).default(2),
        })
        .default({ enabled: false, maxPages: 1, dailyBudget: 2 }),
      ats: sourceToggle(true, 1),
      remotive: sourceToggle(false, 1),
      /** Playwright-driven visits of the ScrapeTargets list (needs Chromium on the worker). */
      scrape: sourceToggle(true, 1),
    })
    .prefault({}),
})
export type SearchConfig = z.infer<typeof searchConfigSchema>

export const rankingWeightsSchema = z.object({
  sponsorshipYes: z.number().default(30),
  sponsorshipLikely: z.number().default(15),
  countryTier1: z.number().default(20),
  countryTier2: z.number().default(12),
  countryTier3: z.number().default(8),
  countryOtherEu: z.number().default(8),
  countryUk: z.number().default(6),
  /** Canada, Australia, the USA (for a person who needs sponsorship, only postings that state it get this far). */
  countryOutsideEurope: z.number().default(2),
  remoteEu: z.number().default(5),
  titleMatch: z.number().default(15),
  /** The job's title is one of the target titles (levels aside): the titles you aim at come first. */
  titleExact: z.number().default(20),
  /** Title has no words of the person's field at all (a procurement title for a designer). Name kept for stored settings. */
  titleNotSoftware: z.number().default(-25),
  senioritySeniorLead: z.number().default(5),
  seniorityStaff: z.number().default(-5),
  seniorityJunior: z.number().default(-10),
  stackPerHit: z.number().default(3),
  stackMax: z.number().default(15),
  languageRequired: z.number().default(-25),
  salaryGood: z.number().default(5),
  salaryBelowCsep: z.number().default(-15),
  /** Listed salary below the person's minimum (ranking.minSalaryEur). */
  salaryBelowMin: z.number().default(-15),
  /** Per must-have skill the profile does not have (drafts that claim a missing skill fail the honesty check). */
  mustHaveMissing: z.number().default(-6),
  mustHaveMissingMax: z.number().default(-18),
  relocation: z.number().default(5),
  fresh: z.number().default(5),
  stale: z.number().default(-10),
  knownSponsor: z.number().default(10),
})
export type RankingWeights = z.infer<typeof rankingWeightsSchema>

export const rankingConfigSchema = z.object({
  weights: rankingWeightsSchema.prefault({}),
  base: z.number().default(40),
  llmWeight: z.number().min(0).max(1).default(0.4),
  csepThresholdEur: z.number().default(40904),
  goodSalaryEur: z.number().default(55000),
  /** The person's minimum yearly salary in EUR (from onboarding); null = no minimum. */
  minSalaryEur: z.number().nullable().default(null),
  freshDays: z.number().int().default(3),
  staleDays: z.number().int().default(30),
  draftThreshold: z.number().int().min(0).max(100).default(60),
  autoSendThreshold: z.number().int().min(0).max(100).default(78),
  maxDraftsPerRun: z.number().int().min(0).max(200).default(20),
  /**
   * Skills that earn ranking points when a posting names them; onboarding copies the profile's main
   * skills here. salaryBelowCsep / csepThresholdEur only apply when the person needs sponsorship in Ireland.
   */
  stackKeywords: z.array(z.string()).default([]),
})
export type RankingConfig = z.infer<typeof rankingConfigSchema>

export const emailConfigSchema = z.object({
  provider: z.enum(['gmail', 'smtp']).default('gmail'),
  /**
   * Master switch for the automatic sender. While off, queued applications and follow-ups are
   * never dispatched by the worker; only an explicit "Send now" click sends anything.
   */
  sendingEnabled: z.boolean().default(false),
  autoSend: z.boolean().default(false),
  // Up to 400: a personal Gmail account may send to about 500 recipients a day, and going over blocks
  // sending (applications and replies) for 24 hours.
  dailySendCap: z.number().int().min(0).max(400).default(10),
  /** Send as soon as an application is ready (keeps the random gap between emails) instead of waiting for the send window. */
  sendImmediately: z.boolean().default(false),
  sendWindow: z
    .object({
      /** 0 = Sunday … 6 = Saturday, in the job's country timezone. */
      days: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
      start: z.string().regex(/^\d{2}:\d{2}$/).default('09:00'),
      end: z.string().regex(/^\d{2}:\d{2}$/).default('12:00'),
    })
    .default({ days: [1, 2, 3, 4, 5], start: '09:00', end: '12:00' }),
  /** Random gap between emails, in minutes (fractions allowed, e.g. 0.3 = 18 s). */
  minGapMinutes: z.number().min(0).default(2),
  maxGapMinutes: z.number().min(0).default(9),
  /** Only one application per company (per location, see scope) within this many days. */
  companyCooldownDays: z.number().int().min(0).max(180).default(15),
  /** company_country: one per company per country; company: one per company anywhere. */
  companyCooldownScope: z.enum(['company_country', 'company']).default('company_country'),
  attachResume: z.boolean().default(true),
  followUp: z
    .object({
      enabled: z.boolean().default(true),
      afterDays: z.number().int().min(1).max(60).default(7),
      /** A second follow-up the same number of days after the first one (two touches in total). */
      second: z.boolean().default(true),
    })
    .default({ enabled: true, afterDays: 7, second: true }),
  replyPollMinutes: z.number().int().min(5).max(1440).default(30),
  noResponseAfterDays: z.number().int().min(1).default(21),
  ccSelf: z.boolean().default(false),
  /** Let auto-send use addresses that were guessed (careers@, jobs@ …) rather than found. */
  allowGuessedEmails: z.boolean().default(false),
  /** Automatic sending pauses when bounces in the last 7 days exceed this share of sends (percent; 0 = off). */
  bounceBrakePercent: z.number().min(0).max(50).default(5),
  /** Automatic applications only to jobs that can lead to a permit (country known, sponsor evidence for IE/GB/NL, IND for NL, salary floors). */
  eligibilityGate: z.boolean().default(true),
})
export type EmailConfig = z.infer<typeof emailConfigSchema>

const effortEnum = z.enum(['low', 'medium', 'high'])

/**
 * AI routing. Keys (any provider) live in the AiKey table with their own priority, plan, daily cap
 * and primary/lite models; this block only holds the provider-neutral knobs. Values from older
 * versions parse leniently (unknown enum values fall back to the default).
 */
export const aiConfigSchema = z.object({
  /** priority = keys in their priority order (equal priorities take turns); round_robin = every enabled key takes turns. */
  routing: z.enum(['priority', 'round_robin']).default('priority').catch('priority'),
  /** Thinking effort where the model supports it (Anthropic effort, OpenAI reasoning_effort), per task tier. */
  effort: z
    .object({ primary: effortEnum.default('medium').catch('medium'), lite: effortEnum.default('low').catch('low') })
    .prefault({}),
  /** Spending guard: calls per day for a key without a free tier and without its own daily cap. */
  defaultDailyCallCap: z.number().int().min(0).max(100000).default(600).catch(600),
  /**
   * Models tried per provider after a key's own model is overloaded, empty or out of today's quota.
   * Writing (primary) tasks never fall back to a lite model: a weaker draft is worse than a deferred one.
   */
  fallbackModels: z.record(z.string(), z.array(z.string())).default({ gemini: ['gemini-3.7-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash-lite'] }).catch({}),
  /** Free-tier requests/day per model id, overriding the provider defaults (any provider; `default` = unknown models of free-tier providers). */
  modelDailyLimits: z.record(z.string(), z.number().int().min(0)).default({}).catch({}),
  /** @deprecated Ignored since keys of any provider are routed by priority; kept so older saved settings and forms still parse. */
  provider: z.enum(['auto', 'claude', 'gemini']).default('auto').catch('auto'),
  /** @deprecated Per-key models replace this (AiKey.primaryModel / liteModel). */
  claude: z
    .object({
      primary: z.string().default('claude-opus-5-5'),
      lite: z.string().default('claude-haiku-5-5'),
      primaryEffort: effortEnum.default('medium').catch('medium'),
      liteEffort: effortEnum.default('low').catch('low'),
      dailyCallCap: z.number().int().min(0).max(20000).default(600).catch(600),
    })
    .prefault({}),
  /** @deprecated Per-key models replace this; `fallbacks` moved to fallbackModels.gemini. */
  models: z
    .object({
      primary: z.string().default('gemini-3.8-flash'),
      lite: z.string().default('gemini-3.5-flash-lite'),
      fallbacks: z.array(z.string()).default(['gemini-3.7-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash-lite']),
    })
    .prefault({}),
  /** Which model class ranks jobs; lite keeps the scarce primary quota for drafting. */
  rankModel: z.enum(['lite', 'primary']).default('lite'),
  judgeThreshold: z.number().int().min(0).max(100).default(30),
  maxRewriteRounds: z.number().int().min(0).max(6).default(1),
  enrichBatchSize: z.number().int().min(1).max(25).default(10),
  rankBatchSize: z.number().int().min(1).max(25).default(8),
  concurrency: z.number().int().min(1).max(8).default(2),
  saplingEnabled: z.boolean().default(false),
  saplingMaxScore: z.number().min(0).max(1).default(0.3),
  promptVersion: z.string().default('v1'),
  tone: z.enum(['direct', 'warm', 'formal']).default('warm'),
  targetWords: z
    .object({ min: z.number().int().default(120), max: z.number().int().default(180) })
    .default({ min: 120, max: 180 }),
})
export type AiConfig = z.infer<typeof aiConfigSchema>

/** Sites the browser agent knows; "other" = any employer career page reached from a posting. */
export const PORTAL_SITES = ['greenhouse', 'ashby', 'lever', 'workable', 'smartrecruiters', 'recruitee', 'teamtailor', 'personio', 'workday', 'linkedin', 'other'] as const
export type PortalSite = (typeof PORTAL_SITES)[number]

export const portalConfigSchema = z.object({
  /** Browser apply agent on/off (single-job buttons, batches, status checks). */
  enabled: z.boolean().default(true),
  /** Chrome executable; empty = find Google Chrome, then Playwright's Chromium. */
  browserPath: z.string().max(500).default(''),
  /** Local DevTools port of the apply browser (127.0.0.1 only). */
  debugPort: z.number().int().min(1024).max(65535).default(9343),
  /** Profile folder (absolute, or relative to the app folder). Logins, cookies and extensions are kept here. */
  profileDir: z.string().min(1).max(500).default('storage/chrome-profile'),
  /**
   * Work in your everyday Chrome instead: its open window gets new tabs (your logins come
   * along) and no separate apply browser is ever started. Needs "Allow remote debugging"
   * ticked at chrome://inspect/#remote-debugging; Chrome asks you to allow the connection.
   */
  useMyChrome: z.boolean().default(false),
  /**
   * Batch agents working at once, one Gemini key each. Above 1 they fill forms in a hidden
   * browser (background tabs of a visible Chrome stall), so your window is never touched.
   */
  parallelAgents: z.number().int().min(1).max(12).default(1),
  /**
   * The parallel agents work in their own visible Chrome window (separate profile, never yours) with
   * background-tab throttling off, so every form keeps moving. A visible browser meets fewer CAPTCHAs
   * than the hidden one, and you can watch them work. Off = hidden (headless).
   */
  agentsWindow: z.boolean().default(true),
  /**
   * Only titles that fit the target titles or the profession (Settings > Search: profession and
   * target titles), e.g. design roles for a designer. Off = any title that passed the search filters.
   */
  targetTitlesOnly: z.boolean().default(false),
  /** Levels allowed in a title (junior, mid, senior, lead, staff, manager). Empty = any; titles with no level word always pass. */
  seniority: z.array(z.enum(['junior', 'mid', 'senior', 'lead', 'staff', 'manager'])).default([]),
  /** Batches only apply when the title or description names one of these skills. Empty = any. */
  stackFocus: z.array(z.string().trim().min(1)).default([]),
  /** Automatic submissions per day (batches); your own Submit clicks are not counted against it. */
  maxSubmissionsPerDay: z.number().int().min(1).max(1000).default(40),
  /** Pause between automatic submissions, in seconds. */
  gapSeconds: z
    .object({ min: z.number().int().min(5).max(3600).default(45), max: z.number().int().min(5).max(7200).default(120) })
    .prefault({}),
  /** Sites the agent may apply on. Indeed and Xing are never automated; LinkedIn only with linkedinEasyApply. */
  sites: z.array(z.enum(PORTAL_SITES)).default([...PORTAL_SITES]),
  /**
   * LinkedIn Easy Apply in your own Chrome (you are signed in there), one job at a time. Off by
   * default: LinkedIn's terms forbid automation and applying fast can get the account restricted.
   */
  linkedinEasyApply: z.boolean().default(false),
  /** LinkedIn Easy Apply submissions per day. */
  linkedinDailyCap: z.number().int().min(1).max(60).default(20),
  /** Minutes between two LinkedIn applications: a random gap between this and linkedinGapMaxMinutes. */
  linkedinGapMinutes: z.number().min(0).max(120).default(3),
  linkedinGapMaxMinutes: z.number().min(0).max(240).default(8),
  /**
   * Browser applications to one company within companyWindowDays (different roles only; the same
   * title is never applied to twice). Email keeps its own one-per-company cooldown.
   */
  maxPerCompany: z.number().int().min(1).max(10).default(1),
  companyWindowDays: z.number().int().min(0).max(180).default(30),
  /** Upload the CV variant that fits the title (one CV per kind of role) instead of the main CV. */
  cvVariants: z.boolean().default(false),
  /** A host whose forms failed this many times in a row for the same reason is skipped for a week. */
  skipHostAfterFails: z.number().int().min(1).max(20).default(3),
  /** Paste or upload a tailored cover letter when the form has a field for one. */
  coverLetter: z.boolean().default(true),
  /** When an agent gets stuck on a form, the AI looks at a screenshot once and tries a few small fixes. */
  secondLook: z.boolean().default(true),
  /** Tabs kept open for your review or help; older ones close (their answers are kept and re-filled on Submit). */
  maxOpenTabs: z.number().int().min(1).max(30).default(6),
  /** Single-job runs: minutes to wait for you to solve a CAPTCHA in the browser before giving up. */
  captchaWaitMinutes: z.number().int().min(0).max(30).default(3),
  /** Read candidate portals (Workday "My applications") once a day and update statuses. */
  statusCheck: z.boolean().default(true),
  /** Read new Gmail messages from application sites and companies, and update the matching application. */
  inboxScan: z.boolean().default(true),
  /** Keep screenshots of each filled form and confirmation page. */
  screenshots: z.boolean().default(true),
})
export type PortalConfig = z.infer<typeof portalConfigSchema>

export const generalSettingsSchema = z.object({
  searchIntervalMinutes: z.number().int().min(30).max(10080).default(720),
  searchEnabled: z.boolean().default(true),
  timezone: z.string().default('UTC'),
  digestEnabled: z.boolean().default(true),
  digestHourLocal: z.number().int().min(0).max(23).default(9),
  digestEmail: z.email().optional().nullable(),
  /** Phone notifications (ntfy or Telegram, configured in .env) and which kinds go to the phone. */
  pushEnabled: z.boolean().default(true),
  pushTypes: z.array(z.enum(NOTIFICATION_TYPES)).default(['interview', 'reply', 'review_needed', 'error']),
})
export type GeneralSettings = z.infer<typeof generalSettingsSchema>

export const DEFAULT_SEARCH: SearchConfig = searchConfigSchema.parse({})
export const DEFAULT_RANKING: RankingConfig = rankingConfigSchema.parse({})
export const DEFAULT_EMAIL: EmailConfig = emailConfigSchema.parse({})
export const DEFAULT_AI: AiConfig = aiConfigSchema.parse({})
export const DEFAULT_PORTAL: PortalConfig = portalConfigSchema.parse({})
export const DEFAULT_GENERAL: GeneralSettings = generalSettingsSchema.parse({})

export interface AppSettings extends GeneralSettings {
  search: SearchConfig
  ranking: RankingConfig
  email: EmailConfig
  ai: AiConfig
  portal: PortalConfig
  updatedAt: Date
}
