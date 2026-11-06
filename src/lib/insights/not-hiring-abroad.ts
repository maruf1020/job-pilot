import { db } from '@/lib/db'
import { leads } from '@/lib/email/needs-action'

/**
 * "Not hiring from abroad" (plan-ui-redesign.md 7.3): companies that cannot take a candidate who
 * needs a visa. (a) Replies that said so (LOCATION_ISSUE), (b) companies whose postings were filtered
 * because they ask for existing work rights, refuse sponsorship, or say nothing about it outside Europe.
 */

export interface LocationReply {
  messageId: string
  applicationId: string
  company: string
  title: string
  countryCode: string | null
  receivedAt: string
  /** The sentence that says it (the classifier's summary, else the matching sentence of the email). */
  sentence: string
  /** You replied after it arrived (or marked it done). */
  replied: boolean
  /** An AI reply is drafted and waits for your review. */
  hasDraft: boolean
}

export interface BlockedCompany {
  companyId: string
  company: string
  jobs: number
  /** The most common reason, as a short label. */
  reason: string
  reasons: Array<{ label: string; count: number }>
  lastSeenAt: string
  sampleTitles: string[]
}

export interface NotHiringAbroad {
  replies: LocationReply[]
  companies: BlockedCompany[]
  totals: { replies: number; companies: number; jobs: number }
}

/** Filter reasons that mean "this employer does not take candidates from abroad". */
export const BLOCKED_REASON_SQL_PATTERNS = ['Outside Europe%', '%work rights%', '%does not say the employer sponsors%', '%no visa sponsorship%', '%only universities%']

/** A short label for a job filter reason, or null when the reason is not about work rights or location. Pure. */
export function reasonCategory(reason: string | null | undefined): string | null {
  const r = (reason ?? '').trim()
  if (!r) return null
  if (/existing work rights/i.test(r)) return 'Asks for existing work rights'
  if (/no visa sponsorship/i.test(r)) return 'Says it does not sponsor visas'
  if (/does not say the employer sponsors/i.test(r)) return 'No sponsorship stated (outside Europe)'
  if (/only universities/i.test(r)) return 'US employer inside the H-1B lottery'
  if (/^outside europe/i.test(r)) return 'Outside your target countries'
  return null
}

const LOCATION_SENTENCE_RE = /[^.!?\n]*(sponsor|relocat|based in|right to work|work permit|visa|located in|reside|eligible to work|local candidates|time ?zone)[^.!?\n]*[.!?]?/i

/** The sentence of an email that turns down the location. Pure. */
export function locationSentence(summary: string | null | undefined, body: string | null | undefined): string {
  if (summary?.trim()) return summary.trim()
  const m = LOCATION_SENTENCE_RE.exec((body ?? '').replace(/\s+/g, ' '))
  return m ? m[0].trim().slice(0, 300) : 'They can only hire locally or cannot sponsor.'
}

const REGION_ONLY = 'Outside your target countries'

/**
 * Group filtered jobs per company. Companies that said no themselves (work rights, no sponsorship)
 * come before the ones that are only outside the user's countries; within that, most jobs first. Pure.
 */
export function groupBlockedJobs(rows: Array<{ companyId: string; companyName: string; filterReason: string | null; firstSeenAt: Date; title: string }>, limit = Number.POSITIVE_INFINITY): BlockedCompany[] {
  const by = new Map<string, { company: string; jobs: number; reasons: Map<string, number>; last: number; titles: string[] }>()
  for (const r of rows) {
    const label = reasonCategory(r.filterReason)
    if (!label) continue
    let c = by.get(r.companyId)
    if (!c) {
      c = { company: r.companyName, jobs: 0, reasons: new Map(), last: 0, titles: [] }
      by.set(r.companyId, c)
    }
    c.jobs++
    c.reasons.set(label, (c.reasons.get(label) ?? 0) + 1)
    c.last = Math.max(c.last, r.firstSeenAt.getTime())
    if (c.titles.length < 3 && !c.titles.includes(r.title)) c.titles.push(r.title)
  }
  return [...by.entries()]
    .map(([companyId, c]) => {
      const reasons = [...c.reasons.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
      return { companyId, company: c.company, jobs: c.jobs, reason: reasons[0]?.label ?? '', reasons, lastSeenAt: new Date(c.last).toISOString(), sampleTitles: c.titles }
    })
    .sort((a, b) => explicit(b) - explicit(a) || b.jobs - a.jobs || b.lastSeenAt.localeCompare(a.lastSeenAt))
    .slice(0, limit)
}

/** Jobs where the employer itself ruled out a candidate from abroad. */
function explicit(c: BlockedCompany): number {
  return c.reasons.filter((r) => r.label !== REGION_ONLY).reduce((a, r) => a + r.count, 0)
}

export async function notHiringAbroad(): Promise<NotHiringAbroad> {
  const [hot, jobs] = await Promise.all([
    leads(),
    db.job.findMany({
      where: { status: { in: ['FILTERED', 'REJECTED_RULE'] }, OR: BLOCKED_REASON_SQL_PATTERNS.map((p) => ({ filterReason: p.startsWith('%') ? { contains: p.replace(/%/g, ''), mode: 'insensitive' as const } : { startsWith: p.replace(/%/g, '') } })) },
      select: { companyId: true, companyName: true, filterReason: true, firstSeenAt: true, title: true },
    }),
  ])
  const bodies = hot.locationIssue.length
    ? await db.emailMessage.findMany({ where: { id: { in: hot.locationIssue.map((i) => i.messageId) } }, select: { id: true, bodyText: true } })
    : []
  const bodyOf = new Map(bodies.map((b) => [b.id, b.bodyText]))
  const replies: LocationReply[] = hot.locationIssue.map((i) => ({
    messageId: i.messageId,
    applicationId: i.applicationId,
    company: i.job.companyName,
    title: i.job.title,
    countryCode: i.job.countryCode,
    receivedAt: i.receivedAt,
    sentence: locationSentence(i.summary, bodyOf.get(i.messageId)),
    replied: i.answered,
    hasDraft: i.hasDraft,
  }))
  const all = groupBlockedJobs(jobs)
  return { replies, companies: all.slice(0, 200), totals: { replies: replies.length, companies: all.length, jobs: all.reduce((a, c) => a + c.jobs, 0) } }
}
