import type { Prisma } from '@/generated/prisma/client'
import { formExperiment } from '@/lib/analytics/experiment'
import { db } from '@/lib/db'
import { cooldownWarning } from '@/lib/pipeline/cooldown'
import { resolveNeedsYou } from '@/lib/notifications'
import { enqueuePortalAttempt } from '@/lib/queue'
import type { AttemptMode } from './types'
import { formTarget } from './urls'

/** Single-job actions of the browser agent, used by the API routes. */

export class PortalActionError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'PortalActionError'
  }
}

const json = (v: unknown) => v as Prisma.InputJsonValue
const ACTIVE = ['QUEUED', 'RUNNING']

/** The job's application, created (channel ats/portal) when the job has none yet. */
export async function ensureApplicationForJob(jobId: string) {
  const job = await db.job.findUnique({ where: { id: jobId }, include: { application: true, sourceLinks: { select: { source: true, externalId: true, url: true } } } })
  if (!job) throw new PortalActionError(404, 'Job not found')
  if (job.application) return job.application
  const t = formTarget(job, job.sourceLinks)
  return db.application.create({ data: { jobId, channel: t.ats ? 'ats' : 'portal', status: 'DRAFT' } })
}

/**
 * Queue an agent run. mode "fill" stops before Submit; mode "submit" is your explicit yes
 * for this one application (the cooldown warning applies like any manual apply).
 */
export async function queuePortalAttempt(applicationId: string, mode: AttemptMode, opts: { ignoreCooldown?: boolean; interactive?: boolean } = {}) {
  const app = await db.application.findUnique({ where: { id: applicationId }, include: { job: { select: { id: true, companyId: true, companyName: true, countryCode: true } } } })
  if (!app) throw new PortalActionError(404, 'Application not found')
  // An earlier email application does not count: employers often answer "apply through our site".
  if (app.sentAt && (app.submittedVia || app.portalStatus === 'SUBMITTED')) throw new PortalActionError(400, 'Already applied to this job through its website')
  if (['QUEUED', 'APPROVED'].includes(app.status)) throw new PortalActionError(400, 'An email for this application is queued. Unqueue it first if you want to apply through the website instead.')
  const active = await db.portalAttempt.findFirst({ where: { applicationId, status: { in: ACTIVE } } })
  if (active) throw new PortalActionError(409, 'The agent is already working on this application')
  if (mode === 'submit') {
    const warning = await cooldownWarning({ companyId: app.job.companyId, countryCode: app.job.countryCode, companyName: app.job.companyName, excludeApplicationId: app.id, toEmail: null })
    if (warning && !opts.ignoreCooldown && !app.cooldownOverride) throw new PortalActionError(409, warning.message, { code: 'cooldown', conflictApplicationId: warning.conflictApplicationId })
    if (warning && opts.ignoreCooldown) {
      await db.application.update({ where: { id: app.id }, data: { cooldownOverride: true, notes: `Applied despite the company cooldown (your choice): ${warning.message}`.slice(0, 1000) } })
    }
  }
  const attempt = await db.portalAttempt.create({ data: { applicationId, mode, status: 'QUEUED' } })
  await db.application.update({ where: { id: applicationId }, data: { portalStatus: 'QUEUED', lastActivityAt: new Date() } })
  await enqueuePortalAttempt({ attemptId: attempt.id, interactive: opts.interactive ?? true })
  return attempt
}

/** Stop a queued or running attempt (a running one stops at its next step). */
export async function cancelPortalAttempt(attemptId: string) {
  const a = await db.portalAttempt.findUnique({ where: { id: attemptId } })
  if (!a) throw new PortalActionError(404, 'Attempt not found')
  if (!ACTIVE.includes(a.status)) return a
  const r = await db.portalAttempt.update({ where: { id: attemptId }, data: { status: 'CANCELLED', error: 'Stopped by you', finishedAt: a.status === 'QUEUED' ? new Date() : null } })
  await db.application.update({ where: { id: a.applicationId }, data: { portalStatus: 'CANCELLED' } })
  return r
}

/** What was filled in on a website form, so the application page shows it later. */
export interface WebsiteSubmission {
  formUrl?: string | null
  finalUrl?: string | null
  atsType?: string | null
  /** Each answer given on the form and where it came from (profile, answer bank, you). */
  fields?: Array<{ label: string; value: string; source: string }>
  /** Screenshot names relative to the screenshots folder (see `screenshotPath`). */
  screenshots?: string[]
  /** Confirmation text the site showed after Submit. */
  confirmation?: string | null
  /** Who pressed Submit: you in the apply browser, or the assistant on your instruction. */
  by?: 'you' | 'assistant'
}

const STAYS_AFTER_SUBMIT = ['REPLIED', 'INTERVIEW', 'OFFER']

/** You finished the application yourself (in the apply browser or anywhere else). */
export async function markSubmittedByHand(applicationId: string, note?: string | null, details: WebsiteSubmission = {}) {
  const app = await db.application.findUnique({ where: { id: applicationId } })
  if (!app) throw new PortalActionError(404, 'Application not found')
  const now = new Date()
  const last = await db.portalAttempt.findFirst({ where: { applicationId, status: { in: ['AWAITING_REVIEW', 'NEEDS_HUMAN', 'FAILED'] } }, orderBy: { startedAt: 'desc' } })
  const record = {
    status: 'SUBMITTED',
    finishedAt: now,
    tabId: null,
    needsHumanReason: null,
    ...(details.formUrl ? { formUrl: details.formUrl } : {}),
    ...(details.finalUrl ? { finalUrl: details.finalUrl } : {}),
    ...(details.atsType ? { atsType: details.atsType } : {}),
    ...(details.fields ? { fields: json(details.fields.map((f) => ({ ...f, kind: 'text', required: false }))) } : {}),
    ...(details.screenshots?.length ? { screenshots: details.screenshots } : {}),
  }
  // Keep a record of the form either way, so the application page shows what was sent.
  const attempt = last
    ? await db.portalAttempt.update({ where: { id: last.id }, data: record })
    : details.formUrl || details.fields || details.screenshots
      ? await db.portalAttempt.create({ data: { applicationId, mode: 'submit', startUrl: details.formUrl ?? null, startedAt: now, ...record } })
      : null
  const updated = await db.application.update({
    where: { id: applicationId },
    data: {
      // A reply or an interview stays what it is; a website application does not undo it.
      status: STAYS_AFTER_SUBMIT.includes(app.status) ? app.status : 'SENT',
      sentAt: app.sentAt ?? now,
      submittedVia: 'manual',
      portalStatus: 'SUBMITTED',
      experiment: json(formExperiment({ site: attempt ? (details.atsType ?? 'browser') : null, by: 'manual', batchId: null })),
      channel: app.channel === 'email' && attempt ? 'portal' : app.channel,
      lastActivityAt: now,
      followUpDueAt: null,
      followUpApprovedAt: null,
      scheduledFor: null,
      ...(note ? { notes: app.notes ? `${app.notes}\n${note}` : note } : {}),
    },
  })
  // "Apply on our site" / "wrong person" replies are answered by applying there.
  await db.emailMessage.updateMany({ where: { applicationId, direction: 'INBOUND', handledAt: null, classification: { in: ['APPLY_VIA_PORTAL', 'WRONG_RECIPIENT'] } }, data: { handledAt: now, isRead: true } })
  await db.job.update({ where: { id: app.jobId }, data: { status: 'APPLIED' } })
  await resolveNeedsYou(applicationId)
  const where = details.finalUrl ?? details.formUrl
  await db.applicationEvent.create({
    data: {
      applicationId,
      type: 'submitted',
      message: details.by === 'assistant' ? `Applied on their website${where ? ` (${hostOf(where)})` : ''} on your instruction` : 'You submitted the application yourself',
      meta: json({ attemptId: attempt?.id ?? null, url: where ?? null, confirmation: details.confirmation ?? null }),
    },
  })
  return updated
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
