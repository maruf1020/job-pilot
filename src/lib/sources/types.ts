import type { AtsType, SourceId } from '@/lib/domain'
import type { SearchConfig } from '@/lib/settings/schema'

/** One job as returned by any source, before dedupe/enrichment. */
export interface NormalizedJob {
  source: SourceId
  externalId: string
  url: string
  title: string
  company: string
  location?: string
  countryCode?: string
  remote?: boolean
  description: string
  salaryMin?: number
  salaryMax?: number
  currency?: string
  postedAt?: Date
  /** Explicit sponsorship flag from the source, when the source has one. */
  visaSponsorship?: boolean | null
  tags: string[]
  contactEmail?: string
  /** Set by the ATS adapter so the pipeline can link the Company row directly. */
  companyId?: string
  raw?: unknown
}

export interface SearchParams {
  query: string
  countryCode?: string
  maxDaysOld: number
  page: number
}

export interface FetchResult {
  jobs: NormalizedJob[]
  /** Whether another page likely exists. */
  hasMore: boolean
  requests: number
}

export interface AtsCompanyRef {
  id: string
  name: string
  atsType: AtsType
  atsSlug: string
  knownSponsor: boolean
}

export type SourceLogger = (
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  meta?: Record<string, unknown>,
) => void

export interface ScrapeTargetRef {
  id: string
  name: string
  url: string
  linkSelector: string | null
  linkPattern: string | null
  maxLinks: number
  maxPages: number
  requireEmail: boolean
  countryCode: string | null
  waitMs: number
}

export interface SourceContext {
  search: SearchConfig
  /** The person's skills (Settings > Ranking keywords): sources with skill facets search for these. */
  skills?: string[]
  /** Whether the person needs visa sponsorship somewhere they search (adds visa wording to some queries). */
  sponsorship?: boolean
  env: {
    ADZUNA_APP_ID?: string
    ADZUNA_APP_KEY?: string
    JOOBLE_KEY?: string
    RAPIDAPI_KEY?: string
    REED_KEY?: string
    FRANCETRAVAIL_CLIENT_ID?: string
    FRANCETRAVAIL_CLIENT_SECRET?: string
  }
  fetch: typeof fetch
  log: SourceLogger
  /** Companies with ATS boards to poll (only used by the `ats` adapter). */
  atsCompanies?: AtsCompanyRef[]
  /** Pages to visit with a real browser (only used by the `scrape` adapter). */
  scrapeTargets?: ScrapeTargetRef[]
  /** Called by the scrape adapter after each target so the UI can show progress. */
  onScrapeTargetDone?: (targetId: string, result: { status: 'ok' | 'error' | 'skipped'; found: number; error?: string }) => Promise<void> | void
  /** Called by the ATS adapter after each company board (success or failure). */
  onAtsCompanyDone?: (companyId: string, result: { found: number; error?: string }) => Promise<void> | void
  /**
   * ATS postings already in the database (externalId -> jobId), so boards ingest only new ones.
   * Undefined: the adapter reads them from the database itself; null: read every posting.
   */
  atsKnown?: Map<string, string> | null
  /** Refresh "last seen" for known postings a board still lists (default: the database helper). */
  atsTouchKnown?: (externalIds: string[], jobIds: string[]) => Promise<void>
}

export interface JobSourceAdapter {
  id: SourceId
  label: string
  /** True if the adapter can run with the current env/config (e.g. key present). */
  isConfigured(ctx: SourceContext): boolean
  /** Whether the adapter takes a query (false = fetches one global feed). */
  usesQuery: boolean
  /** Whether the adapter takes a country. */
  usesCountry: boolean
  /** Countries this adapter can serve; undefined = any. */
  supportedCountries?: ReadonlySet<string>
  fetch(params: SearchParams, ctx: SourceContext): Promise<FetchResult>
}

export class SourceError extends Error {
  constructor(
    public source: SourceId,
    message: string,
    public status?: number,
  ) {
    super(`[${source}] ${message}`)
    this.name = 'SourceError'
  }
}
