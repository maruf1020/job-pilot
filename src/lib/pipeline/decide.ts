import { db } from '@/lib/db'
import { autoSendRecipientProblem, unusableContactReason } from '@/lib/email/address'
import { recentBounceRate, suppressedReason } from '@/lib/email/suppression'
import { notify } from '@/lib/notifications'

let brakeNotifiedAt = 0
import { describeConflict, findCooldownConflict, findSameJob } from './cooldown'
import { isGmailConfigured } from '@/lib/env'
import { smtpConfig } from '@/lib/keys/service-keys'
import { getSettings } from '@/lib/settings/service'
import { nextSendSlot } from './send-window'

export type DecideOutcome = 'queued' | 'review' | 'not_eligible'

function startOfTodayUtc(): Date {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d
}

/**
 * How many emails are sent or queued for today (UTC day). Only emails: forms the browser agents or the user
 * submitted also carry a sentAt, and once ~112 of them made "Daily send cap of 200 reached" show
 * after 73 emails.
 */
export async function sentOrQueuedToday(): Promise<number> {
  const since = startOfTodayUtc()
  return db.application.count({
    where: {
      OR: [
        { sentAt: { gte: since }, submittedVia: 'email' },
        // Older email sends left submittedVia empty (NOT IN would drop them too); a website submission marks portalStatus.
        { sentAt: { gte: since }, submittedVia: null, OR: [{ portalStatus: null }, { portalStatus: { not: 'SUBMITTED' } }] },
        { status: 'QUEUED', scheduledFor: { lt: new Date(since.getTime() + 86_400_000) } },
      ],
    },
  })
}

/** @deprecated use findCooldownConflict; kept for callers that only need a yes/no. */
export async function companyCooldownActive(companyId: string, days: number): Promise<boolean> {
  return Boolean(await findCooldownConflict({ companyId, countryCode: null }, { companyCooldownDays: days, companyCooldownScope: 'company' }))
}

export async function mailProviderReady(): Promise<{ ready: boolean; reason?: string }> {
  const settings = await getSettings()
  if (settings.email.provider === 'gmail') {
    if (!isGmailConfigured) return { ready: false, reason: 'GOOGLE_CLIENT_ID/SECRET not set' }
    const token = await db.oAuthToken.findUnique({ where: { provider: 'gmail' } })
    if (!token) return { ready: false, reason: 'Gmail not connected (Settings → Email)' }
    return { ready: true }
  }
  if (!(await smtpConfig())) return { ready: false, reason: 'SMTP not configured (Settings > Keys: host, user, password and from address)' }
  return { ready: true }
}

/**
 * Queue an application for sending if it meets every auto-send condition;
 * otherwise leave it in REVIEW. Used after drafting and by the "Approve" action
 * (with `force` to bypass score/autoSend checks but keep caps and cooldowns).
 */
export async function evaluateAutoSend(
  applicationId: string,
  opts: { force?: boolean; requirePassed?: boolean; dryRun?: boolean; ignoreCooldown?: boolean } = {},
): Promise<{ outcome: DecideOutcome; reason?: string; scheduledFor?: Date }> {
  const settings = await getSettings()
  const app = await db.application.findUnique({
    where: { id: applicationId },
    include: { job: { include: { score: true, company: { select: { domain: true } } } }, drafts: { where: { isSelected: true }, take: 1 } },
  })
  if (!app) return { outcome: 'not_eligible', reason: 'Application not found' }
  if (app.channel !== 'email') return { outcome: 'not_eligible', reason: 'Not an email application' }
  if (!app.toEmail) return { outcome: 'not_eligible', reason: 'No recipient email' }
  const unusable = unusableContactReason(app.toEmail)
  if (unusable) return { outcome: 'not_eligible', reason: unusable }
  const blocked = await suppressedReason(app.toEmail)
  if (blocked) return { outcome: 'not_eligible', reason: blocked }
  // Automatic queuing (auto-send, batches, bulk) only mails the company's own domain; your own
  // Approve, or an address you typed yourself, is trusted.
  const automatic = !opts.force || opts.requirePassed === true
  // Bounce brake: too many bounces lately means the address data is bad; stop automatic sends
  // before Gmail starts treating the account as a spammer. Your own Approve still works. Addresses
  // from the posting, the company's site or confirmed by its mail server are not what bounces (1 of
  // 309 sent, against 11 of 60 guessed ones), so the brake holds only the others.
  // No recorded source: addresses kept before sources were recorded, from the posting (0 of 122 bounced).
  const source = app.job.contactEmailSource
  const trustedAddress = !source || ['posting', 'company', 'website', 'verified', 'apply-page', 'manual'].includes(source)
  if (automatic && settings.email.bounceBrakePercent > 0 && !trustedAddress) {
    const b = await recentBounceRate()
    if (b.sent >= 20 && b.rate * 100 > settings.email.bounceBrakePercent) {
      const reason = `Automatic sending paused: ${b.bounced} of ${b.sent} emails bounced in the last 7 days (${(b.rate * 100).toFixed(1)}%, brake at ${settings.email.bounceBrakePercent}%). Fix the addresses, then approve by hand or change the brake in Settings → Email.`
      if (Date.now() - brakeNotifiedAt > 6 * 3_600_000) {
        brakeNotifiedAt = Date.now()
        await notify('error', 'Automatic sending paused: too many bounces', reason, '/applications')
      }
      return { outcome: 'review', reason }
    }
  }
  const typedByYou = app.job.contactEmailSource === 'manual' || app.toEmail.toLowerCase() !== (app.job.contactEmail ?? '').toLowerCase()
  if (automatic && !typedByYou) {
    const mismatch = autoSendRecipientProblem(app.toEmail, { name: app.job.companyName, domain: app.job.company.domain }, app.job.contactEmailSource)
    if (mismatch) return { outcome: 'review', reason: `${mismatch}; check the address and approve it yourself if it is right` }
  }
  const draft = app.drafts[0]
  if (!draft) return { outcome: 'not_eligible', reason: 'No draft selected' }
  if (!draft.passed && (!opts.force || opts.requirePassed)) return { outcome: 'review', reason: 'Draft did not pass the humanizer' }
  if (!opts.force) {
    if (!settings.email.sendingEnabled) return { outcome: 'review', reason: 'Sending is paused (Settings → Email → Allow sending)' }
    if (!settings.email.autoSend) return { outcome: 'review', reason: 'Auto-send is off' }
    const score = app.job.score?.finalScore ?? 0
    if (score < settings.ranking.autoSendThreshold) return { outcome: 'review', reason: `Score ${score} below auto-send threshold ${settings.ranking.autoSendThreshold}` }
    if (app.job.contactEmailSource === 'guessed' && !settings.email.allowGuessedEmails) return { outcome: 'review', reason: 'Recipient address is a guess (allow guessed addresses in Settings → Email, or approve manually)' }
  }
  const provider = await mailProviderReady()
  if (!provider.ready) return { outcome: 'review', reason: provider.reason }
  if ((await sentOrQueuedToday()) >= settings.email.dailySendCap) return { outcome: 'review', reason: `Daily send cap (${settings.email.dailySendCap}) reached` }
  const conflict = opts.ignoreCooldown || app.cooldownOverride ? await findSameJob(app.id) : await findCooldownConflict({ companyId: app.job.companyId, countryCode: app.job.countryCode, excludeApplicationId: app.id, toEmail: app.toEmail }, settings.email)
  if (conflict) return { outcome: 'review', reason: describeConflict(app.job.companyName, app.job.countryCode, conflict, settings.email) }

  const lastQueued = await db.application.findFirst({ where: { status: 'QUEUED' }, orderBy: { scheduledFor: 'desc' }, select: { scheduledFor: true } })
  const notBefore = lastQueued?.scheduledFor && lastQueued.scheduledFor > new Date() ? lastQueued.scheduledFor : new Date()
  const scheduledFor = nextSendSlot(settings.email, app.job.countryCode, notBefore)
  // Dry run (tests, previews): report the decision without touching the application.
  if (opts.dryRun) return { outcome: 'queued', scheduledFor }
  // Queued by the system (auto-send or bulk): a bounce may rotate to the next guessed address on its own.
  await db.application.update({ where: { id: applicationId }, data: { status: 'QUEUED', scheduledFor, autoRetry: true, lastActivityAt: new Date() } })
  return { outcome: 'queued', scheduledFor }
}
