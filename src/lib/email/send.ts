import type { Prisma } from '@/generated/prisma/client'
import { emailExperiment } from '@/lib/analytics/experiment'
import { db } from '@/lib/db'
import { smtpConfig } from '@/lib/keys/service-keys'
import { notify } from '@/lib/notifications'
import { getSettings } from '@/lib/settings/service'
import { describeConflict, findCooldownConflict, findSameJob } from '@/lib/pipeline/cooldown'
import { autoSendRecipientProblem, unusableContactReason } from './address'
import { suppressedReason } from './suppression'

const json = (v: unknown) => v as Prisma.InputJsonValue

/** Errors that mean the mailbox connection is broken, not the application. */
export function isMailAuthError(message: string): boolean {
  return /invalid_grant|invalid_client|unauthorized_client|Token has been expired or revoked|Gmail is not connected|Invalid Credentials|EAUTH|535[ -]/i.test(message)
}

/** The provider is throttling the mailbox (Gmail sending limits), which says nothing about the application. */
export function isMailRateLimitError(message: string): boolean {
  return /rate ?limit|user-rate|daily ?limit|quota exceeded|sending (quota|limit)|too many (requests|messages|emails)|\b429\b|\b421[ -]|4\.7\.0|5\.4\.5/i.test(message)
}

/** After the provider throttles sending, the dispatcher waits this long before trying again. */
const RATE_LIMIT_PAUSE_MS = 15 * 60_000

/**
 * How long to pause for a throttling error. Google's per-minute API quota ("Units per minute per
 * user", often used up by reply polling) clears within a minute; a real sending limit does not.
 */
export function rateLimitPauseMs(message: string): number {
  if (/per minute|per second|units per minute|rateLimitExceeded/i.test(message) && !/daily|per day|sending (quota|limit)/i.test(message)) return 90_000
  if (/daily|per day|sending (quota|limit) exceeded/i.test(message)) return 60 * 60_000
  return RATE_LIMIT_PAUSE_MS
}
let pausedUntil = 0

/** One unread notification per title and 6 hours is enough for a problem that repeats every minute. */
async function notifyOnce(title: string, body: string): Promise<boolean> {
  const recent = await db.notification.findFirst({ where: { title, readAt: null, createdAt: { gte: new Date(Date.now() - 6 * 3600_000) } }, select: { id: true } })
  if (!recent) await notify('error', title, body, '/settings/email')
  return !recent
}

export const GMAIL_EXPIRED_HELP =
  'Google ended the Gmail connection (an OAuth app in "Testing" mode loses it every 7 days). Reconnect in Settings → Email; queued applications wait and go out right after. Publishing the OAuth app in Google Cloud stops the weekly expiry (see Settings → Email).'

/**
 * The mailbox connection itself is broken (expired or revoked Google token, refused SMTP login).
 * For Gmail the dead token is forgotten, so every sender and poller sees "not connected" instead
 * of retrying it, and you are asked once to reconnect. Returns true when this call found it first.
 */
export async function markMailboxDisconnected(message: string): Promise<boolean> {
  const settings = await getSettings()
  if (settings.email.provider === 'gmail') {
    const removed = await db.oAuthToken.deleteMany({ where: { provider: 'gmail' } })
    if (removed.count === 0) return false // another check got there first; one notification is enough
    await notify('error', 'Gmail connection expired', GMAIL_EXPIRED_HELP, '/settings/email')
    return true
  }
  return notifyOnce('SMTP login failed', `The mail server refused the login (${message.slice(0, 200)}). Check SMTP_USER / SMTP_PASS; queued applications wait.`)
}

/**
 * Live check of the stored Gmail connection: one cheap API call. A token Google no longer accepts
 * is forgotten and reported (see markMailboxDisconnected); a network hiccup does not count.
 */
export async function verifyMailbox(): Promise<{ ready: boolean; reason?: string }> {
  const settings = await getSettings()
  if (settings.email.provider !== 'gmail') return { ready: true }
  try {
    await gmailTestConnection()
    return { ready: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!isMailAuthError(message)) return { ready: true }
    await markMailboxDisconnected(message)
    return { ready: false, reason: 'the Gmail connection has expired; reconnect in Settings → Email' }
  }
}

export class CooldownError extends Error {
  status = 400
  constructor(message: string) {
    super(message)
    this.name = 'CooldownError'
  }
}
import { gmailSend, gmailTestConnection } from './gmail'
import { buildMime, textToHtml, type MailAttachment, type MailInput } from './mime'
import { smtpSend } from './smtp'

export interface SendOptions {
  /** Send a specific draft instead of the selected one. */
  draftId?: string
  /** Bypass the QUEUED/APPROVED status check (manual "send now"). */
  force?: boolean
  /** You confirmed "apply anyway" despite the company cooldown (manual only). */
  ignoreCooldown?: boolean
}

export async function resolveSender(): Promise<{ name: string; email: string; provider: 'gmail' | 'smtp' }> {
  const settings = await getSettings()
  const profile = await db.candidateProfile.findUnique({ where: { id: 1 }, select: { fullName: true } })
  const name = profile?.fullName ?? 'Job Pilot'
  if (settings.email.provider === 'gmail') {
    const t = await db.oAuthToken.findUnique({ where: { provider: 'gmail' } })
    if (!t?.accountEmail) throw new Error('Gmail is not connected')
    return { name, email: t.accountEmail, provider: 'gmail' }
  }
  const from = (await smtpConfig())?.from
  if (!from) throw new Error('SMTP is not configured (sender address missing)')
  return { name, email: from, provider: 'smtp' }
}

export async function resumeAttachment(): Promise<MailAttachment | null> {
  const file = await db.resumeFile.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'desc' } })
  if (!file) return null
  return { filename: file.fileName.replace(/[^\w. -]+/g, '_'), mimeType: file.mimeType || 'application/pdf', data: Buffer.from(file.data) }
}

/** Low-level send used for both initial emails and follow-ups. */
export async function deliver(input: Omit<MailInput, 'from'> & { threadId?: string | null }) {
  const sender = await resolveSender()
  const mail: MailInput = { ...input, from: { name: sender.name, email: sender.email }, html: input.html ?? textToHtml(input.text) }
  const { raw, messageId } = buildMime(mail)
  if (sender.provider === 'gmail') {
    const r = await gmailSend(raw, input.threadId)
    return { provider: 'gmail' as const, providerMessageId: r.id, threadId: r.threadId, messageIdHeader: messageId, from: sender.email }
  }
  const r = await smtpSend(mail, raw)
  return { provider: 'smtp' as const, providerMessageId: r.messageId, threadId: input.threadId ?? messageId, messageIdHeader: messageId, from: sender.email }
}

/**
 * Send the selected draft of an application: builds the MIME (resume attached),
 * sends via Gmail or SMTP, records the outbound message, moves statuses along.
 */
export async function sendApplication(applicationId: string, opts: SendOptions = {}) {
  const settings = await getSettings()
  const app = await db.application.findUnique({
    where: { id: applicationId },
    include: {
      job: { select: { id: true, title: true, companyName: true, countryCode: true, companyId: true, contactEmail: true, contactEmailSource: true, company: { select: { domain: true } } } },
      drafts: { where: opts.draftId ? { id: opts.draftId } : { isSelected: true }, take: 1 },
    },
  })
  if (!app) throw new Error('Application not found')
  if (app.sentAt) throw new Error('Already sent')
  if (!opts.force && !['QUEUED', 'APPROVED'].includes(app.status)) throw new Error(`Application is ${app.status}, not queued`)
  if (!app.toEmail) throw new Error('No recipient email')
  // Last line of defence, even for "Send now": never mail an accommodation/privacy/support mailbox.
  const unusable = unusableContactReason(app.toEmail)
  if (unusable) throw new Error(`Refusing to send: ${unusable}`)
  const blocked = await suppressedReason(app.toEmail)
  if (blocked) throw new Error(`Refusing to send: ${blocked}`)
  // Automatic sends (batches, auto-send) only go to the company's own domain; "Send now" is your call.
  const typedByYou = app.job.contactEmailSource === 'manual' || app.toEmail.toLowerCase() !== (app.job.contactEmail ?? '').toLowerCase()
  if (!opts.force && (app.batchId || app.autoRetry) && !typedByYou) {
    const mismatch = autoSendRecipientProblem(app.toEmail, { name: app.job.companyName, domain: app.job.company.domain }, app.job.contactEmailSource)
    if (mismatch) throw new Error(`Refusing to send automatically: ${mismatch}. Check the address and send it yourself if it is right.`)
  }
  // One application per company (per country) per cooldown window, even for "Send now".
  const conflict = opts.ignoreCooldown || app.cooldownOverride ? await findSameJob(app.id) : await findCooldownConflict({ companyId: app.job.companyId, countryCode: app.job.countryCode, excludeApplicationId: app.id, toEmail: app.toEmail }, settings.email)
  if (conflict) throw new CooldownError(describeConflict(app.job.companyName, app.job.countryCode, conflict, settings.email))
  const draft = app.drafts[0]
  if (!draft) throw new Error('No draft to send')

  const attachments: MailAttachment[] = []
  if (settings.email.attachResume) {
    const a = await resumeAttachment()
    if (a) attachments.push(a)
  }
  const sender = await resolveSender()
  const result = await deliver({
    to: app.toEmail,
    cc: settings.email.ccSelf ? sender.email : undefined,
    subject: draft.subject,
    text: draft.body,
    attachments,
    headers: { 'X-Job-Finder-Application': app.id },
  })

  const now = new Date()
  await db.$transaction([
    db.emailMessage.create({
      data: {
        applicationId: app.id,
        direction: 'OUTBOUND',
        provider: result.provider,
        providerMessageId: result.providerMessageId,
        threadId: result.threadId,
        fromAddress: result.from,
        toAddress: app.toEmail,
        subject: draft.subject,
        bodyText: draft.body,
        sentAt: now,
        isRead: true,
      },
    }),
    db.application.update({
      where: { id: app.id },
      data: {
        status: 'SENT',
        sentAt: now,
        threadId: result.threadId,
        lastActivityAt: now,
        followUpDueAt: settings.email.followUp.enabled ? new Date(now.getTime() + settings.email.followUp.afterDays * 86_400_000) : null,
        experiment: json(
          emailExperiment({
            subject: draft.subject,
            body: draft.body,
            jobTitle: app.job.title,
            promptVersion: draft.promptVersion,
            model: draft.generatedBy,
            cvAttached: attachments.length > 0,
            batchId: app.batchId,
            autoRetry: app.autoRetry,
          }),
        ),
      },
    }),
    db.emailDraft.updateMany({ where: { applicationId: app.id, kind: 'initial' }, data: { isSelected: false } }),
    db.emailDraft.update({ where: { id: draft.id }, data: { isSelected: true } }),
    db.job.update({ where: { id: app.job.id }, data: { status: 'APPLIED' } }),
  ])
  await notify('sent', `Sent: ${app.job.title} at ${app.job.companyName}`, `To ${app.toEmail}`, `/applications/${app.id}`)
  return { ...result, sentAt: now }
}

/** A dispatcher run sends what is due within this window ahead, each email at its own second. */
export const DISPATCH_LOOKAHEAD_MS = 55_000
/** While emails keep coming due, a run keeps going (the window slides) for at most this long. */
export const DISPATCH_MAX_RUN_MS = 5 * 60_000

export interface DispatchOptions {
  lookaheadMs?: number
  maxRunMs?: number
  sleep?: (ms: number) => Promise<void>
}

/**
 * Sends everything QUEUED whose time has come, honouring the daily cap. Started every minute by the
 * worker. Each email goes out at its scheduled second, never closer than the minimum gap to the
 * previous one, so second-level gaps hold and a backlog that piled up while the mailbox was
 * disconnected is paced rather than sent in one burst. While more emails come due within the next
 * minute (a running auto-apply batch) the run keeps going, up to DISPATCH_MAX_RUN_MS.
 */
export async function dispatchDueSends(log: (m: string) => void = console.log, opts: DispatchOptions = {}): Promise<number> {
  if (Date.now() < pausedUntil) {
    log(`sending paused until ${new Date(pausedUntil).toISOString()} after the mail provider limited sends; queued applications wait`)
    return 0
  }
  const settings = await getSettings()
  const started = Date.now()
  const horizon = () => Math.min(started + (opts.maxRunMs ?? DISPATCH_MAX_RUN_MS), Date.now() + (opts.lookaheadMs ?? DISPATCH_LOOKAHEAD_MS))
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  // With the master switch off, only applications of a running auto-apply batch may go out:
  // starting the batch was the permission for exactly those applications.
  const allowed = settings.email.sendingEnabled ? {} : { batch: { status: 'RUNNING', cancelRequested: false } }
  const findDue = () =>
    db.application.findMany({
      where: { status: 'QUEUED', scheduledFor: { lte: new Date(horizon()) }, ...allowed },
      orderBy: { scheduledFor: 'asc' },
      select: { id: true, scheduledFor: true },
    })
  let due = await findDue()
  if (due.length === 0) {
    const waiting = await db.application.count({ where: { status: 'QUEUED', scheduledFor: { lte: new Date() } } })
    if (!settings.email.sendingEnabled) {
      if (waiting) log(`sending is paused (Settings → Email → Allow sending); ${waiting} queued application(s) are waiting`)
    } else if (waiting) {
      log(`${waiting} queued application(s) are overdue but none counted as due (horizon ${new Date(horizon()).toISOString()})`)
    }
    return 0
  }
  const since = new Date()
  since.setUTCHours(0, 0, 0, 0)
  const { mailProviderReady } = await import('@/lib/pipeline/decide')
  const ready = await mailProviderReady()
  if (!ready.ready) {
    log(`email not ready (${ready.reason}); ${due.length} queued application(s) wait`)
    return 0
  }
  let sentToday = await db.application.count({ where: { sentAt: { gte: since } } })
  let sent = 0
  const gapMs = Math.max(0, settings.email.minGapMinutes) * 60_000
  // The gap also holds across runs: start from the last email that went out.
  const last = await db.application.findFirst({ where: { sentAt: { not: null } }, orderBy: { sentAt: 'desc' }, select: { sentAt: true } })
  // A send time ahead of this machine's clock (database and Windows clocks disagree) must not hold the queue.
  let lastSentAt = Math.min(last?.sentAt?.getTime() ?? 0, Date.now())
  const tried = new Set<string>()
  while (due.length) {
    for (const a of due) {
      tried.add(a.id)
      if (sentToday >= settings.email.dailySendCap) {
        log(`daily send cap reached (${settings.email.dailySendCap}); the rest stays queued`)
        return sent
      }
      const at = Math.max(a.scheduledFor?.getTime() ?? 0, lastSentAt + gapMs)
      if (at > horizon()) {
        // The next run carries on.
        if (!sent) log(`next email at ${new Date(at).toISOString()} (scheduled ${a.scheduledFor?.toISOString()}, last sent ${new Date(lastSentAt).toISOString()})`)
        return sent
      }
      if (at > Date.now()) await sleep(at - Date.now())
      // Still queued and allowed? Stop, Send now or a reschedule may have happened while waiting.
      const still = await db.application.findFirst({ where: { id: a.id, status: 'QUEUED', sentAt: null, scheduledFor: { lte: new Date(Date.now() + 1_000) }, ...allowed }, select: { id: true } })
      if (!still) continue
      try {
        await sendApplication(a.id)
        sent++
        sentToday++
        lastSentAt = Date.now()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (err instanceof CooldownError) {
          log(`held ${a.id}: ${message}`)
          await db.application.update({ where: { id: a.id }, data: { status: 'REVIEW', scheduledFor: null, notes: message.slice(0, 1000), lastActivityAt: new Date() } })
          continue
        }
        if (isMailAuthError(message)) {
          // The mailbox connection itself is broken (expired or revoked Google token). Nothing is wrong
          // with this application: keep it and the rest of the queue as they are, mark the mailbox as
          // disconnected so nothing else tries to send, and ask you to reconnect.
          log(`mail account connection expired (${message}); stopping sends until it is reconnected`)
          await markMailboxDisconnected(message)
          return sent
        }
        if (isMailRateLimitError(message)) {
          // Google's sending limits, not this application: keep it and the rest queued and pause a while.
          const pause = rateLimitPauseMs(message)
          pausedUntil = Date.now() + pause
          const minutes = Math.max(1, Math.round(pause / 60_000))
          log(`mail provider is limiting sends (${message}); pausing ${minutes} minute(s), queued applications wait`)
          // A per-minute API quota clears by itself; only real sending limits are worth a notification.
          if (pause > 90_000) {
            await notifyOnce('Sending paused: mail provider limit', `The mail provider limited sending (${message.slice(0, 200)}). Queued applications wait and sending retries in ${minutes} minutes. If this repeats, use a larger gap between emails (Settings → Email).`)
          }
          return sent
        }
        log(`send failed for ${a.id}: ${message}`)
        await db.application.update({ where: { id: a.id }, data: { status: 'NEEDS_HUMAN', notes: `Send failed: ${message}`.slice(0, 1000), lastActivityAt: new Date() } })
        await notify('error', 'Send failed', message, `/applications/${a.id}`)
      }
    }
    // Applications queued while this run was sending (an auto-apply batch right after a reconnect) go
    // out in it too, so a busy queue never waits for the next scheduled run.
    due = (await findDue()).filter((a) => !tried.has(a.id))
  }
  return sent
}
