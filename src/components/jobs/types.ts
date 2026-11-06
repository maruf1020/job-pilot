import { SOURCE_LABELS, type SourceId } from '@/lib/domain'

/** One line of the rule/LLM score breakdown (JobScore.breakdown JSON). */
export interface ScoreLine {
  label: string
  points: number
  detail?: string
}

export interface JobScoreSummary {
  finalScore: number
  ruleScore: number
  llmScore: number | null
  hook: string | null
}

/** Row shape returned by GET /api/jobs (mirrors JOB_LIST_SELECT). */
export interface JobRow {
  id: string
  title: string
  companyName: string
  companyId: string
  location: string | null
  countryCode: string | null
  remote: boolean
  url: string
  postedAt: string | null
  firstSeenAt: string
  primarySource: string
  sponsorship: string
  applyChannel: string
  contactEmail: string | null
  contactEmailSource: string | null
  seniority: string | null
  status: string
  filterReason: string | null
  salaryMin: number | null
  salaryMax: number | null
  currency: string | null
  score: JobScoreSummary | null
  application: { id: string; status: string } | null
  company: { knownSponsor: boolean; blacklisted: boolean }
}

export interface JobScoreDetail extends JobScoreSummary {
  id: string
  breakdown: unknown
  reasons: string[]
  gaps: string[]
  model: string | null
  scoredAt: string
}

export interface JobCompany {
  id: string
  name: string
  domain: string | null
  countryCode: string | null
  atsType: string | null
  atsSlug: string | null
  careersUrl: string | null
  contactEmail: string | null
  contactEmailSource: string | null
  knownSponsor: boolean
  blacklisted: boolean
  notes: string | null
  lastFetchedAt: string | null
  lastFetchError: string | null
}

export interface JobSourceLink {
  source: string
  externalId: string
  url: string
  firstSeenAt: string
  lastSeenAt: string
}

export interface JobDraft {
  id: string
  kind: string
  version: number
  subject: string
  passed: boolean
  isSelected: boolean
  createdAt: string
}

export interface JobMessage {
  id: string
  direction: string
  subject: string
  classification: string | null
  sentAt: string | null
  receivedAt: string | null
  createdAt: string
}

export interface JobApplication {
  id: string
  jobId: string
  channel: string
  status: string
  toEmail: string | null
  scheduledFor: string | null
  sentAt: string | null
  repliedAt: string | null
  lastActivityAt: string
  notes: string | null
  drafts: JobDraft[]
  messages: JobMessage[]
}

/** Shape returned by GET /api/jobs/[id]. */
export interface JobDetail extends Omit<JobRow, 'score' | 'application' | 'company'> {
  cooldown?: { message: string; conflictApplicationId: string } | null
  contactCandidates: string[]
  description: string
  lastSeenAt: string
  tags: string[]
  visaFlag: boolean | null
  sponsorshipEvidence: string[]
  atsType: string | null
  language: string | null
  mustHaveSkills: string[]
  niceToHaveSkills: string[]
  requiredLanguages: string[]
  relocationSupport: boolean | null
  summary: string | null
  enrichedAt: string | null
  createdAt: string
  updatedAt: string
  score: JobScoreDetail | null
  company: JobCompany
  sourceLinks: JobSourceLink[]
  application: JobApplication | null
}

export type JobAction = 'draft' | 'skip' | 'unskip' | 'mark-applied' | 'blacklist-company' | 'rescore' | 'find-contact'

/** Compact source names for dense table cells (full names live in SOURCE_LABELS). */
export const SOURCE_SHORT: Partial<Record<SourceId, string>> = {
  arbeitnow: 'Arbeitnow',
  arbeitnow_uk: 'Arbeitnow UK',
  jooble: 'Jooble',
  adzuna: 'Adzuna',
  jsearch: 'JSearch',
  ats: 'ATS board',
  remotive: 'Remotive',
  scrape: 'Scraped',
}

/** Short label, falling back to the full label and then the raw id for unknown sources. */
export function sourceShort(source: string): string {
  const id = source as SourceId
  return SOURCE_SHORT[id] ?? SOURCE_LABELS[id] ?? source
}

export const CHANNEL_LABELS: Record<string, string> = {
  email: 'Email',
  ats: 'ATS form',
  portal: 'Portal',
  unknown: 'Unknown',
}

/** Defensive parse of the JSON breakdown column. */
export function parseBreakdown(value: unknown): ScoreLine[] {
  if (!Array.isArray(value)) return []
  const out: ScoreLine[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    if (typeof o.label !== 'string' || typeof o.points !== 'number') continue
    out.push({ label: o.label, points: o.points, detail: typeof o.detail === 'string' ? o.detail : undefined })
  }
  return out
}
