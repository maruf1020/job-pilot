import { formatDistanceToNowStrict, isValid } from 'date-fns'
import type { ApplicationStatus, JobStatus, ReplyClassification, RunStatus, SponsorshipLevel } from '@/lib/domain'

export function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return isValid(d) ? d : null
}

export function fmtDate(v: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  const d = toDate(v)
  return d ? new Intl.DateTimeFormat('en-GB', opts).format(d) : '—'
}

export function fmtDateTime(v: string | Date | null | undefined): string {
  return fmtDate(v, { dateStyle: 'medium', timeStyle: 'short' })
}

export function fmtAgo(v: string | Date | null | undefined): string {
  const d = toDate(v)
  if (!d) return '—'
  return `${formatDistanceToNowStrict(d)} ago`
}

export function fmtIn(v: string | Date | null | undefined): string {
  const d = toDate(v)
  if (!d) return '—'
  if (d.getTime() < Date.now()) return 'now'
  return `in ${formatDistanceToNowStrict(d)}`
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms} ms`
  const s = Math.round(ms / 1000)
  if (s < 90) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s - m * 60}s`
}

export function fmtNumber(n: number | null | undefined): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-GB').format(n)
}

export function fmtSalary(min: number | null | undefined, max: number | null | undefined, currency: string | null | undefined): string {
  if (min == null && max == null) return '—'
  const c = currency ?? 'EUR'
  const f = (n: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(n)
  if (min != null && max != null && max !== min) return `${f(min)} – ${f(max)}`
  return f((min ?? max)!)
}

export function fmtPercent(n: number | null | undefined): string {
  return n == null ? '—' : `${Math.round(n)}%`
}

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'muted' | 'accent'

export const JOB_STATUS_LABEL: Record<JobStatus, { label: string; tone: BadgeTone }> = {
  NEW: { label: 'New', tone: 'info' },
  FILTERED: { label: 'Filtered out', tone: 'muted' },
  RANKED: { label: 'Ranked', tone: 'accent' },
  DRAFTING: { label: 'Drafting', tone: 'info' },
  REVIEW: { label: 'Review', tone: 'warning' },
  APPLIED: { label: 'Applied', tone: 'success' },
  SKIPPED: { label: 'Skipped', tone: 'muted' },
  REJECTED_RULE: { label: 'Excluded', tone: 'danger' },
}

export const APP_STATUS_LABEL: Record<ApplicationStatus, { label: string; tone: BadgeTone }> = {
  DRAFT: { label: 'Drafting', tone: 'info' },
  REVIEW: { label: 'Needs review', tone: 'warning' },
  NEEDS_HUMAN: { label: 'Needs a human', tone: 'danger' },
  APPROVED: { label: 'Approved', tone: 'accent' },
  QUEUED: { label: 'Queued', tone: 'accent' },
  SENT: { label: 'Sent', tone: 'success' },
  REPLIED: { label: 'Replied', tone: 'success' },
  INTERVIEW: { label: 'Interview', tone: 'success' },
  OFFER: { label: 'Offer', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  NO_RESPONSE: { label: 'No response', tone: 'muted' },
  SKIPPED: { label: 'Skipped', tone: 'muted' },
}

export const RUN_STATUS_LABEL: Record<RunStatus, { label: string; tone: BadgeTone }> = {
  RUNNING: { label: 'Running', tone: 'info' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  COMPLETED_WITH_ERRORS: { label: 'Completed with errors', tone: 'warning' },
  FAILED: { label: 'Failed', tone: 'danger' },
  CANCELLED: { label: 'Stopped', tone: 'muted' },
}

export const SPONSORSHIP_LABEL: Record<SponsorshipLevel, { label: string; tone: BadgeTone }> = {
  yes: { label: 'Sponsors', tone: 'success' },
  likely: { label: 'Likely', tone: 'accent' },
  unknown: { label: 'Unknown', tone: 'muted' },
  no: { label: 'No sponsorship', tone: 'danger' },
}

export const REPLY_LABEL: Record<ReplyClassification, { label: string; tone: BadgeTone }> = {
  INTERVIEW_REQUEST: { label: 'Interview request', tone: 'success' },
  POSITIVE: { label: 'Positive', tone: 'success' },
  NEEDS_INFO: { label: 'Needs info', tone: 'warning' },
  LOCATION_ISSUE: { label: 'Location issue', tone: 'warning' },
  REJECTION: { label: 'Rejection', tone: 'danger' },
  APPLY_VIA_PORTAL: { label: 'Apply on their site', tone: 'accent' },
  WRONG_RECIPIENT: { label: 'Wrong recipient', tone: 'muted' },
  AUTO_REPLY: { label: 'Auto-reply', tone: 'muted' },
  BOUNCE: { label: 'Bounce', tone: 'danger' },
  OTHER: { label: 'Other', tone: 'neutral' },
}

export function scoreTone(score: number | null | undefined): BadgeTone {
  if (score == null) return 'muted'
  if (score >= 78) return 'success'
  if (score >= 60) return 'accent'
  if (score >= 45) return 'warning'
  return 'danger'
}

export function flagEmoji(countryCode: string | null | undefined): string {
  if (!countryCode || countryCode.length !== 2) return '🌐'
  const cc = countryCode.toUpperCase()
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}
