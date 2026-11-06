import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings/service'

/**
 * Per-company history (plan-ui-redesign.md 7.4): every application to a company, how it went, and
 * when the company rule (one application per company per N days, Settings → Browser) allows the next one.
 */

export interface CompanyHistoryItem {
  applicationId: string
  jobId: string
  title: string
  countryCode: string | null
  channel: string
  status: string
  submittedVia: string | null
  sentAt: string | null
  repliedAt: string | null
  lastActivityAt: string
  /** Latest classified reply from the company (INTERVIEW_REQUEST, REJECTION...). */
  reply: { classification: string; receivedAt: string | null } | null
}

export interface CompanyRuleStatus {
  maxPerCompany: number
  windowDays: number
  /** Applications sent inside the window. */
  sentInWindow: number
  /** An application is queued, filling or waiting for you right now. */
  inProgress: boolean
  /** When the next application becomes possible; null = possible now. */
  availableAt: string | null
}

export interface CompanyHistory {
  items: CompanyHistoryItem[]
  sentTotal: number
  lastSentAt: string | null
  rule: CompanyRuleStatus
}

const IN_FLIGHT_PORTAL = ['QUEUED', 'RUNNING', 'AWAITING_REVIEW', 'NEEDS_HUMAN']
const DAY = 86_400_000

/** When the window rule frees up, given the send dates inside the window (pure, tested). */
export function nextAvailable(sentDates: Date[], maxPerCompany: number, windowDays: number, now = new Date()): Date | null {
  if (windowDays <= 0) return null
  const since = now.getTime() - windowDays * DAY
  const inWindow = sentDates.filter((d) => d.getTime() >= since).sort((a, b) => a.getTime() - b.getTime())
  if (inWindow.length < maxPerCompany) return null
  // The oldest send that keeps the count at the limit has to leave the window first.
  const blocking = inWindow[inWindow.length - maxPerCompany]
  return new Date(blocking.getTime() + windowDays * DAY)
}

export async function companyHistory(companyId: string): Promise<CompanyHistory> {
  const settings = await getSettings()
  const apps = await db.application.findMany({
    where: { job: { companyId } },
    orderBy: [{ sentAt: { sort: 'desc', nulls: 'last' } }, { lastActivityAt: 'desc' }],
    take: 200,
    select: {
      id: true,
      channel: true,
      status: true,
      submittedVia: true,
      sentAt: true,
      repliedAt: true,
      lastActivityAt: true,
      portalStatus: true,
      job: { select: { id: true, title: true, countryCode: true } },
      messages: { where: { direction: 'INBOUND', classification: { not: null } }, orderBy: { createdAt: 'desc' }, take: 1, select: { classification: true, receivedAt: true } },
    },
  })
  const { maxPerCompany, companyWindowDays } = settings.portal
  const sent = apps.filter((a) => a.sentAt).map((a) => a.sentAt as Date)
  const now = new Date()
  const availableAt = nextAvailable(sent, maxPerCompany, companyWindowDays, now)
  const inProgress = apps.some((a) => !a.sentAt && (['QUEUED', 'APPROVED'].includes(a.status) || IN_FLIGHT_PORTAL.includes(a.portalStatus ?? '')))
  return {
    items: apps.map((a) => ({
      applicationId: a.id,
      jobId: a.job.id,
      title: a.job.title,
      countryCode: a.job.countryCode,
      channel: a.channel,
      status: a.status,
      submittedVia: a.submittedVia,
      sentAt: a.sentAt?.toISOString() ?? null,
      repliedAt: a.repliedAt?.toISOString() ?? null,
      lastActivityAt: a.lastActivityAt.toISOString(),
      reply: a.messages[0]?.classification ? { classification: a.messages[0].classification, receivedAt: a.messages[0].receivedAt?.toISOString() ?? null } : null,
    })),
    sentTotal: sent.length,
    lastSentAt: sent.length ? new Date(Math.max(...sent.map((d) => d.getTime()))).toISOString() : null,
    rule: {
      maxPerCompany,
      windowDays: companyWindowDays,
      sentInWindow: sent.filter((d) => d.getTime() >= now.getTime() - companyWindowDays * DAY).length,
      inProgress,
      availableAt: availableAt?.toISOString() ?? null,
    },
  }
}

export interface CompanyApplicationStats {
  count: number
  lastSentAt: string | null
}

/** Sent applications per company, for the Companies table (one query for the page's rows). */
export async function applicationStatsFor(companyIds: string[]): Promise<Map<string, CompanyApplicationStats>> {
  const out = new Map<string, CompanyApplicationStats>()
  if (!companyIds.length) return out
  const rows = await db.application.findMany({
    where: { sentAt: { not: null }, job: { companyId: { in: companyIds } } },
    select: { sentAt: true, job: { select: { companyId: true } } },
  })
  for (const r of rows) {
    const id = r.job.companyId
    const cur = out.get(id) ?? { count: 0, lastSentAt: null }
    const sent = r.sentAt!.toISOString()
    out.set(id, { count: cur.count + 1, lastSentAt: !cur.lastSentAt || sent > cur.lastSentAt ? sent : cur.lastSentAt })
  }
  return out
}
