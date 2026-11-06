import { db } from '@/lib/db'
import { gateEnabled, gateReason } from '@/lib/pipeline/quality-gate'
import { getSettings } from '@/lib/settings/service'
import { loadCandidateContext } from '@/lib/candidate/load'
import { autoSendRecipientProblem } from './address'
import { withoutSuppressed } from './suppression'

/**
 * Follow-ups wait for your approval. The list shows the applications whose follow-up is due
 * and worth sending (no reply, no bounce, a real address); approving writes `followUpApprovedAt`
 * and the worker sends only those (see `sendDueFollowUps` in track.ts).
 */

/** Address sources a follow-up is worth sending to; guessed careers@ addresses got 0 replies from 49 emails. */
const GOOD_SOURCES = ['posting', 'website', 'verified', 'manual']

export interface DueFollowUp {
  applicationId: string
  toEmail: string
  source: string | null
  sentAt: string | null
  daysSinceSent: number
  followUpCount: number
  dueAt: string | null
  approved: boolean
  job: { id: string; title: string; companyName: string; countryCode: string | null; finalScore: number | null }
}

export async function dueFollowUps(now = new Date()): Promise<DueFollowUp[]> {
  const settings = await getSettings()
  const max = settings.email.followUp.second ? 2 : 1
  const rows = await db.application.findMany({
    where: {
      status: 'SENT',
      channel: 'email',
      repliedAt: null,
      bounceCount: 0,
      toEmail: { not: null },
      followUpDueAt: { lte: now },
      followUpCount: { lt: max },
      job: { OR: [{ contactEmailSource: null }, { contactEmailSource: { in: GOOD_SOURCES } }] },
    },
    orderBy: { followUpDueAt: 'asc' },
    take: 200,
    select: {
      id: true,
      toEmail: true,
      sentAt: true,
      followUpDueAt: true,
      followUpCount: true,
      followUpApprovedAt: true,
      job: {
        select: {
          id: true,
          title: true,
          companyName: true,
          countryCode: true,
          finalScore: true,
          contactEmailSource: true,
          sponsorship: true,
          salaryMin: true,
          salaryMax: true,
          currency: true,
          company: { select: { domain: true, knownSponsor: true } },
        },
      },
    },
  })
  const allowed = new Set(await withoutSuppressed(rows.map((r) => r.toEmail!)))
  const gate = gateEnabled(settings.email)
  const candidate = await loadCandidateContext()
  return rows
    .filter((r) => allowed.has(r.toEmail!))
    // Same bar as a new automatic send: the company's own recruiting mailbox (not a privacy,
    // opt-out or sales address) and a job that can still lead to a permit.
    .filter((r) => !autoSendRecipientProblem(r.toEmail!, { name: r.job.companyName, domain: r.job.company.domain }, r.job.contactEmailSource))
    .filter((r) => !(gate && gateReason(r.job, { candidate })))
    .map((r) => ({
      applicationId: r.id,
      toEmail: r.toEmail!,
      source: r.job.contactEmailSource,
      sentAt: r.sentAt?.toISOString() ?? null,
      daysSinceSent: r.sentAt ? Math.floor((now.getTime() - r.sentAt.getTime()) / 86_400_000) : 0,
      followUpCount: r.followUpCount,
      dueAt: r.followUpDueAt?.toISOString() ?? null,
      approved: Boolean(r.followUpApprovedAt),
      job: { id: r.job.id, title: r.job.title, companyName: r.job.companyName, countryCode: r.job.countryCode, finalScore: r.job.finalScore },
    }))
}

/** Your approval for these follow-ups (the worker sends them within the daily cap and gaps). */
export async function approveFollowUps(applicationIds: string[]): Promise<number> {
  if (applicationIds.length === 0) return 0
  // Only what the list offers: an id from elsewhere (stale tab, wrong address) is ignored.
  const due = new Set((await dueFollowUps()).map((d) => d.applicationId))
  const ids = applicationIds.filter((id) => due.has(id))
  if (ids.length === 0) return 0
  const r = await db.application.updateMany({ where: { id: { in: ids }, status: 'SENT', repliedAt: null }, data: { followUpApprovedAt: new Date() } })
  return r.count
}

/** No follow-up for these (the due date is cleared; nothing else changes). */
export async function skipFollowUps(applicationIds: string[]): Promise<number> {
  if (applicationIds.length === 0) return 0
  const r = await db.application.updateMany({ where: { id: { in: applicationIds } }, data: { followUpDueAt: null, followUpApprovedAt: null } })
  return r.count
}
