import type { JudgeOutput } from '@/lib/ai/schemas'
import type { HiringConversation } from '@/lib/applications/conversations'
import type { HiringInfo } from '@/lib/applications/hiring'
import type { LintIssue, LintStats } from '@/lib/pipeline/humanize/lint'

/** Lint output as persisted on `EmailDraft.lintResult` and under `Application.answers.lint`. */
export interface StoredLintResult {
  passed: boolean
  errors: LintIssue[]
  warnings: LintIssue[]
  stats?: LintStats
}

/** Row shape of GET /api/applications (mirrors the route's `select`). */
export interface ApplicationListRow {
  id: string
  channel: string
  status: string
  toEmail: string | null
  scheduledFor: string | null
  sentAt: string | null
  repliedAt: string | null
  followUpSentAt: string | null
  lastActivityAt: string
  createdAt: string
  job: {
    id: string
    title: string
    companyName: string
    countryCode: string | null
    url: string
    score: { finalScore: number } | null
  }
  drafts: Array<{ id: string; subject: string; passed: boolean }>
  _count: { messages: number }
}

export interface JobScoreDetail {
  id: string
  jobId: string
  ruleScore: number
  llmScore: number | null
  finalScore: number
  breakdown: unknown
  reasons: string[]
  gaps: string[]
  hook: string | null
  model: string | null
  scoredAt: string
  updatedAt: string
}

export interface CompanySummary {
  id: string
  name: string
  knownSponsor: boolean
  blacklisted: boolean
  domain: string | null
}

/** `job` as included by GET /api/applications/[id] (Job + score + company summary). */
export interface JobDetail {
  id: string
  title: string
  companyId: string
  companyName: string
  url: string
  location: string | null
  countryCode: string | null
  remote: boolean
  description: string
  salaryMin: number | null
  salaryMax: number | null
  currency: string | null
  postedAt: string | null
  sponsorship: string
  sponsorshipEvidence: string[]
  applyChannel: string
  contactEmail: string | null
  seniority: string | null
  mustHaveSkills: string[]
  niceToHaveSkills: string[]
  requiredLanguages: string[]
  summary: string | null
  status: string
  score: JobScoreDetail | null
  company: CompanySummary
}

export interface DraftDetail {
  id: string
  applicationId: string
  kind: string
  version: number
  subject: string
  body: string
  lintResult: StoredLintResult | null
  judgeResult: JudgeOutput | null
  externalAiScore: number | null
  passed: boolean
  isSelected: boolean
  generatedBy: string | null
  promptVersion: string | null
  feedback: string | null
  createdAt: string
}

/** `EmailMessage.classificationMeta` (see replyClassificationSchema). */
export interface ReplyClassificationMeta {
  classification?: string
  confidence?: number
  summary?: string
  suggestedNextAction?: string | null
  proposedTimes?: string[]
  /** The careers page or form they ask you to use. */
  applyUrl?: string | null
  /** The person now handling the application (handed over or copied in). */
  contact?: { name: string; email: string | null; role?: string | null } | null
  /** What they ask you to send or answer. */
  questions?: string[]
}

export interface MessageDetail {
  id: string
  applicationId: string
  direction: string
  provider: string
  providerMessageId: string
  threadId: string | null
  fromAddress: string
  toAddress: string
  ccAddress?: string | null
  subject: string
  bodyText: string
  sentAt: string | null
  receivedAt: string | null
  classification: string | null
  classificationMeta: ReplyClassificationMeta | null
  isRead: boolean
  /** Set once you replied, applied on their site, or dismissed the reply. */
  handledAt?: string | null
  createdAt: string
}

export const ANSWER_FIELDS = [
  { key: 'whyCompany', label: 'Why this company' },
  { key: 'whyRole', label: 'Why this role' },
  { key: 'noticePeriod', label: 'Notice period' },
  { key: 'salaryExpectation', label: 'Salary expectation' },
  { key: 'visaStatus', label: 'Visa status' },
  { key: 'location', label: 'Location' },
  { key: 'earliestStart', label: 'Earliest start' },
] as const
export type AnswerKey = (typeof ANSWER_FIELDS)[number]['key']

/** `Application.answers` JSON for ATS/portal applications. */
export interface ApplicationAnswers {
  whyCompany?: string
  whyRole?: string
  noticePeriod?: string
  salaryExpectation?: string
  visaStatus?: string
  location?: string
  earliestStart?: string
  lint?: StoredLintResult
  [key: string]: unknown
}

/** Payload of GET /api/applications/[id]. */
export interface ApplicationDetail {
  id: string
  /** Set when this company (and location) was applied to within the cooldown. */
  cooldown?: { message: string; conflictApplicationId: string } | null
  jobId: string
  channel: string
  status: string
  toEmail: string | null
  threadId: string | null
  scheduledFor: string | null
  sentAt: string | null
  repliedAt: string | null
  followUpDueAt: string | null
  followUpSentAt: string | null
  lastActivityAt: string
  coverLetter: string | null
  answers: ApplicationAnswers | null
  notes: string | null
  createdAt: string
  updatedAt: string
  job: JobDetail
  drafts: DraftDetail[]
  messages: MessageDetail[]
  /** Browser agent: latest attempt status, how it was sent, candidate portal page. */
  portalStatus?: string | null
  submittedVia?: string | null
  portalStatusUrl?: string | null
  /** Timeline entries (newest first): filled, submitted, confirmation, status changes. */
  events?: Array<{ id: string; type: string; message: string; createdAt: string }>
  /** The company's hiring stages and saved write-ups (assessment reviews, interview notes). */
  hiring?: HiringInfo
  /** Hiring chats and interviews kept word for word (question and answer). */
  conversations?: HiringConversation[]
}

export type ApplicationAction = 'approve' | 'send-now' | 'unqueue' | 'skip' | 'regenerate' | 'mark-applied' | 'select-draft' | 'save-draft' | 'lint' | 'draft-reply' | 'send-reply' | 'mark-handled'

/** Body of POST /api/applications/[id]/actions. */
export interface ActionVars {
  action: ApplicationAction
  note?: string
  ignoreCooldown?: boolean
  draftId?: string
  subject?: string
  body?: string
  to?: string
  cc?: string | null
  attachResume?: boolean
  instruction?: string | null
  messageId?: string | null
  handled?: boolean
  nudge?: boolean
}

/** Loose union of what the actions route returns (fields depend on the action). */
export interface ActionResult {
  scheduledFor?: string | null
  status?: string
  selected?: string
  queued?: boolean
}

/** Body of PATCH /api/applications/[id]. */
export interface PatchVars {
  status?: string
  notes?: string | null
  toEmail?: string | null
  coverLetter?: string | null
  answers?: Record<string, unknown>
}
