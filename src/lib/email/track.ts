import type { Prisma } from '@/generated/prisma/client'
import { generateJson } from '@/lib/ai/gemini'
import { classifyReplyPrompt, followUpPrompt } from '@/lib/ai/prompts'
import { draftSchema, replyClassificationSchema } from '@/lib/ai/schemas'
import { db } from '@/lib/db'
import type { ApplicationStatus, ReplyClassification } from '@/lib/domain'
import { notify } from '@/lib/notifications'
import { rotateContactAfterBounce } from '@/lib/pipeline/contacts'
import { mailProviderReady, sentOrQueuedToday } from '@/lib/pipeline/decide'
import { humanizeLoop } from '@/lib/pipeline/humanize/loop'
import { nextSendSlot } from '@/lib/pipeline/send-window'
import { getBannedPhrases } from '@/lib/pipeline/humanize/phrases'
import { getProfileForPrompt } from '@/lib/pipeline/profile'
import { getSettings } from '@/lib/settings/service'
import { gmailGetThread, type GmailMessageLite } from './gmail'
import { deliver, isMailAuthError, isMailRateLimitError, markMailboxDisconnected } from './send'
import { imapFindReplies } from './smtp'

const json = (v: unknown) => v as Prisma.InputJsonValue

const STATUS_FOR: Partial<Record<ReplyClassification, ApplicationStatus>> = {
  INTERVIEW_REQUEST: 'INTERVIEW',
  POSITIVE: 'REPLIED',
  NEEDS_INFO: 'REPLIED',
  OTHER: 'REPLIED',
  // The email channel is closed but the job is open: it shows as a reply with an "apply on their site" action.
  APPLY_VIA_PORTAL: 'REPLIED',
  // Not a flat no (location or sponsorship): kept open for a reply about other roles.
  LOCATION_ISSUE: 'REPLIED',
  // The application never reached recruiting; the status stays as it was (SENT) and the reply asks for action.
  REJECTION: 'REJECTED',
  BOUNCE: 'NEEDS_HUMAN',
}

const REPLY_TITLE: Record<ReplyClassification, string> = {
  INTERVIEW_REQUEST: 'Interview request',
  POSITIVE: 'Reply',
  NEEDS_INFO: 'They ask for information',
  LOCATION_ISSUE: 'Location is the issue',
  REJECTION: 'Rejection',
  APPLY_VIA_PORTAL: 'They ask you to apply on their site',
  WRONG_RECIPIENT: 'Reached the wrong team',
  AUTO_REPLY: 'Auto-reply',
  BOUNCE: 'Bounce',
  OTHER: 'Reply',
}

function looksLikeBounce(from: string, subject: string, text: string): boolean {
  return /mailer-daemon|postmaster|mail delivery (subsystem|failed)/i.test(from) || /delivery status notification|undeliverable|delivery failure|address not found/i.test(`${subject}\n${text.slice(0, 500)}`)
}

function looksLikeAutoReply(subject: string, text: string): boolean {
  return /out of (the )?office|automatic reply|auto-?reply|autoreply|i am currently (away|out)|thank you for (your|contacting)/i.test(`${subject}\n${text.slice(0, 600)}`)
}

async function classify(appId: string, reply: { from: string; subject: string; text: string }) {
  const outbound = await db.emailMessage.findFirst({ where: { applicationId: appId, direction: 'OUTBOUND' }, orderBy: { sentAt: 'asc' } })
  if (looksLikeBounce(reply.from, reply.subject, reply.text)) {
    return { classification: 'BOUNCE' as const, confidence: 0.95, summary: 'Delivery failed', suggestedNextAction: 'Find another contact address', proposedTimes: [] }
  }
  if (looksLikeAutoReply(reply.subject, reply.text) && reply.text.length < 1500) {
    return { classification: 'AUTO_REPLY' as const, confidence: 0.8, summary: 'Automatic reply', suggestedNextAction: null, proposedTimes: [] }
  }
  const p = classifyReplyPrompt({ ourSubject: outbound?.subject ?? '', ourBody: outbound?.bodyText ?? '', replyFrom: reply.from, replySubject: reply.subject, replyBody: reply.text })
  const r = await generateJson({ task: 'classify_reply', model: 'lite', schema: replyClassificationSchema, system: p.system, prompt: p.prompt, temperature: 0.1, maxOutputTokens: 800 })
  return r.data
}

async function recordInbound(appId: string, m: { provider: string; providerMessageId: string; threadId: string | null; from: string; to: string; cc?: string | null; subject: string; text: string; date: Date | null }) {
  const exists = await db.emailMessage.findUnique({ where: { provider_providerMessageId: { provider: m.provider, providerMessageId: m.providerMessageId } } })
  if (exists) return false
  const app = await db.application.findUnique({ where: { id: appId }, include: { job: { select: { title: true, companyName: true } } } })
  if (!app) return false
  const c = await classify(appId, m)
  await db.emailMessage.create({
    data: {
      applicationId: appId,
      direction: 'INBOUND',
      provider: m.provider,
      providerMessageId: m.providerMessageId,
      threadId: m.threadId,
      fromAddress: m.from,
      toAddress: m.to,
      ccAddress: m.cc ?? null,
      subject: m.subject,
      bodyText: m.text,
      receivedAt: m.date ?? new Date(),
      classification: c.classification,
      classificationMeta: json(c),
    },
  })
  await db.applicationEvent
    .create({ data: { applicationId: appId, type: 'email', message: `${REPLY_TITLE[c.classification]}: ${m.subject.slice(0, 200)}`, meta: json({ classification: c.classification, from: m.from }) } })
    .catch(() => undefined)
  // A bounce older than the current send belongs to an earlier address: keep it as history,
  // never rotate the address or change the status because of it.
  if (c.classification === 'BOUNCE' && app.sentAt && m.date && m.date < app.sentAt) {
    await db.emailMessage.updateMany({ where: { provider: m.provider, providerMessageId: m.providerMessageId }, data: { handledAt: new Date(), isRead: true } })
    return true
  }
  const next = STATUS_FOR[c.classification]
  if (next && c.classification !== 'AUTO_REPLY') {
    const keep = ['INTERVIEW', 'OFFER'].includes(app.status) && next === 'REPLIED'
    await db.application.update({
      where: { id: appId },
      data: {
        ...(keep ? {} : { status: next }),
        repliedAt: app.repliedAt ?? m.date ?? new Date(),
        lastActivityAt: new Date(),
        followUpDueAt: null,
        ...(c.classification === 'BOUNCE' ? { notes: `Bounced: ${c.summary}` } : {}),
      },
    })
  }
  const label = REPLY_TITLE[c.classification]
  let summary = c.summary
  if (c.classification === 'BOUNCE') {
    const settings = await getSettings()
    const r = await rotateContactAfterBounce(appId, async (cc) => nextSendSlot(settings.email, cc))
    if (r.exhausted) summary = `${c.summary} All candidate addresses bounced; the job needs a manual application.`
    else if (r.next) summary = `${c.summary} Next address ${r.next} ${r.requeued ? 'queued automatically' : 'set; approve the application to resend'}.`
  }
  // Auto-replies and bounces stay in the app; a person writing back goes to the phone too.
  await notify(c.classification === 'INTERVIEW_REQUEST' ? 'interview' : 'reply', `${label}: ${app.job.title} at ${app.job.companyName}`, summary, `/applications/${appId}`, {
    push: !['AUTO_REPLY', 'BOUNCE'].includes(c.classification),
    classification: c.classification,
  })
  return true
}

/** Where the last Gmail poll stopped (quota): the next one starts there, so no thread is skipped forever. */
let pollCursor = 0

/** Poll every open application's thread (or just `applicationIds`) for new inbound messages. */
export async function pollReplies(log: (m: string) => void = console.log, opts: { applicationIds?: string[] } = {}): Promise<number> {
  const settings = await getSettings()
  const open = await db.application.findMany({
    where: { status: { in: ['SENT', 'REPLIED', 'INTERVIEW', 'OFFER'] }, threadId: { not: null }, ...(opts.applicationIds ? { id: { in: opts.applicationIds } } : {}) },
    orderBy: { id: 'asc' },
    select: { id: true, threadId: true, sentAt: true, messages: { where: { direction: 'OUTBOUND' }, select: { providerMessageId: true, provider: true } } },
  })
  if (open.length === 0) return 0
  let found = 0
  if (settings.email.provider === 'gmail') {
    const token = await db.oAuthToken.findUnique({ where: { provider: 'gmail' }, select: { accountEmail: true } })
    if (!token) {
      log('Gmail is not connected; reply polling resumes after you reconnect (Settings → Email)')
      return 0
    }
    const me = token.accountEmail?.toLowerCase() ?? ''
    const start = opts.applicationIds ? 0 : pollCursor % open.length
    const order = [...open.slice(start), ...open.slice(0, start)]
    let polled = 0
    for (const app of order) {
      // Seeded demo applications carry fake thread ids that Gmail cannot know.
      if (app.threadId!.startsWith('demo-')) continue
      let messages: GmailMessageLite[]
      try {
        messages = await gmailGetThread(app.threadId!)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (isMailAuthError(message)) {
          // A dead connection fails for every thread alike: report it now (long before the next
          // send would find out) instead of trying each remaining thread.
          log(`Gmail refused the stored connection (${message}); reply polling stops until you reconnect`)
          await markMailboxDisconnected(message)
          break
        }
        if (isMailRateLimitError(message)) {
          // Google's per-minute API quota: stop this round so sending (which shares the quota) is not starved.
          log(`Gmail API quota reached while polling replies; the remaining threads wait for the next poll`)
          break
        }
        log(`thread ${app.threadId} fetch failed: ${message}`)
        continue
      }
      polled++
      if (!opts.applicationIds) pollCursor = (start + polled) % open.length
      // Spread thread reads out: a burst of 150 reads uses up the per-minute quota that sending needs.
      await new Promise((r) => setTimeout(r, 250))
      for (const m of messages) {
        if (me && m.from.toLowerCase().includes(me)) continue
        if (m.labelIds.includes('SENT')) continue
        const ok = await recordInbound(app.id, { provider: 'gmail', providerMessageId: m.id, threadId: m.threadId, from: m.from, to: m.to, cc: m.cc, subject: m.subject, text: m.text, date: m.date })
        if (ok) found++
      }
    }
  } else {
    const ids = open.flatMap((a) => a.messages.map((m) => m.providerMessageId))
    const since = new Date(Math.min(...open.map((a) => a.sentAt?.getTime() ?? Date.now())) - 86_400_000)
    let replies: Awaited<ReturnType<typeof imapFindReplies>> = []
    try {
      replies = await imapFindReplies(ids, since)
    } catch (err) {
      log(`imap poll failed: ${err instanceof Error ? err.message : err}`)
    }
    for (const r of replies) {
      const app = open.find((a) => a.messages.some((m) => r.inReplyTo === m.providerMessageId || r.references.includes(m.providerMessageId)))
      if (!app) continue
      const ok = await recordInbound(app.id, { provider: 'imap', providerMessageId: r.messageId, threadId: app.threadId, from: r.from, to: r.to, subject: r.subject, text: r.text, date: r.date })
      if (ok) found++
    }
  }
  return found
}

/** One polite follow-up per application after N days with no reply. */
export async function sendDueFollowUps(log: (m: string) => void = console.log): Promise<number> {
  const settings = await getSettings()
  if (!settings.email.followUp.enabled) return 0
  // Your approval on the Applications page is the permission for each follow-up (the master
  // "Allow sending" switch covers automatic first emails, not these).
  const due = await db.application.findMany({
    where: { status: 'SENT', followUpDueAt: { lte: new Date() }, followUpApprovedAt: { not: null }, repliedAt: null, bounceCount: 0 },
    include: { job: true, messages: { where: { direction: 'OUTBOUND' }, orderBy: { sentAt: 'asc' }, take: 1 } },
    take: 5,
  })
  if (due.length === 0) return 0
  if ((await sentOrQueuedToday()) >= settings.email.dailySendCap) {
    log('follow-ups wait: the daily send cap is reached')
    return 0
  }
  // Nothing can go out while the mailbox is disconnected: do not spend AI calls writing follow-ups.
  if (!(await mailProviderReady()).ready) return 0
  const profile = await getProfileForPrompt()
  const bannedPhrases = await getBannedPhrases()
  let sent = 0
  for (const app of due) {
    const original = app.messages[0]
    if (!original || !app.toEmail) {
      await db.application.update({ where: { id: app.id }, data: { followUpDueAt: null } })
      continue
    }
    const sentDaysAgo = Math.max(1, Math.round((Date.now() - (app.sentAt?.getTime() ?? Date.now())) / 86_400_000))
    try {
      const result = await humanizeLoop({
        ai: settings.ai,
        company: app.job.companyName,
        log: (m) => log(`[follow-up ${app.id.slice(-6)}] ${m}`),
        lintCtx: { companyName: app.job.companyName, profileName: profile.fullName, stopSkills: profile.stopSkills, bannedPhrases, kind: 'follow_up', mustHaveSkills: [] },
        generate: async (rewrite) => {
          const p = followUpPrompt({
            profile,
            job: { id: app.job.id, title: app.job.title, company: app.job.companyName, countryCode: app.job.countryCode, description: app.job.description },
            originalSubject: original.subject,
            originalBody: original.bodyText,
            sentDaysAgo,
            rewrite,
          })
          const r = await generateJson({ task: 'follow_up', model: 'primary', schema: draftSchema, system: p.system, prompt: p.prompt, temperature: 0.8, maxOutputTokens: 2048 })
          return { subject: r.data.subject, body: r.data.body, model: r.model }
        },
      })
      const last = await db.emailDraft.findFirst({ where: { applicationId: app.id, kind: 'follow_up' }, orderBy: { version: 'desc' } })
      const draft = await db.emailDraft.create({
        data: {
          applicationId: app.id,
          kind: 'follow_up',
          version: (last?.version ?? 0) + 1,
          subject: result.subject,
          body: result.body,
          passed: result.passed,
          isSelected: true,
          lintResult: json({ passed: result.versions.at(-1)?.lint.passed, errors: result.versions.at(-1)?.lint.errors, warnings: result.versions.at(-1)?.lint.warnings }),
          judgeResult: result.versions.at(-1)?.judge ? json(result.versions.at(-1)!.judge) : undefined,
          generatedBy: result.versions.at(-1)?.generatedBy ?? null,
        },
      })
      if (!result.passed) {
        await db.application.update({ where: { id: app.id }, data: { followUpDueAt: null } })
        await notify('review_needed', `Follow-up needs a human: ${app.job.title} at ${app.job.companyName}`, 'The generated follow-up did not pass the checks. Send it manually from the application page.', `/applications/${app.id}`)
        continue
      }
      const subject = original.subject.toLowerCase().startsWith('re:') ? original.subject : `Re: ${original.subject}`
      const r = await deliver({
        to: app.toEmail,
        subject,
        text: result.body,
        threadId: app.threadId,
        inReplyTo: original.provider === 'gmail' ? undefined : original.providerMessageId,
        references: original.provider === 'gmail' ? undefined : [original.providerMessageId],
        headers: { 'X-Job-Finder-Application': app.id },
      })
      await db.emailMessage.create({
        data: { applicationId: app.id, direction: 'OUTBOUND', provider: r.provider, providerMessageId: r.providerMessageId, threadId: r.threadId, fromAddress: r.from, toAddress: app.toEmail, subject, bodyText: result.body, sentAt: new Date(), isRead: true },
      })
      // A second touch (if turned on) waits the same number of days and needs your approval again.
      const count = app.followUpCount + 1
      const again = settings.email.followUp.second && count < 2
      await db.application.update({
        where: { id: app.id },
        data: { followUpSentAt: new Date(), followUpCount: count, followUpApprovedAt: null, followUpDueAt: again ? new Date(Date.now() + settings.email.followUp.afterDays * 86_400_000) : null, lastActivityAt: new Date() },
      })
      await db.applicationEvent.create({ data: { applicationId: app.id, type: 'email', message: `Follow-up ${count} sent to ${app.toEmail}` } }).catch(() => undefined)
      void draft
      sent++
      // Keep the usual gap between emails (capped so one poll run stays within its time limit).
      await new Promise((r) => setTimeout(r, Math.min(90_000, Math.max(5_000, settings.email.minGapMinutes * 60_000))))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (isMailAuthError(message)) {
        // The mailbox connection broke, not this follow-up: keep it due and stop until you reconnect.
        log(`follow-ups stopped: mail account connection expired (${message})`)
        await markMailboxDisconnected(message)
        break
      }
      log(`follow-up failed for ${app.id}: ${message}`)
      await db.application.update({ where: { id: app.id }, data: { followUpDueAt: new Date(Date.now() + 86_400_000) } })
    }
  }
  return sent
}

/** SENT applications with no reply after N days → NO_RESPONSE. */
export async function markNoResponse(): Promise<number> {
  const settings = await getSettings()
  const cutoff = new Date(Date.now() - settings.email.noResponseAfterDays * 86_400_000)
  const r = await db.application.updateMany({
    where: { status: 'SENT', sentAt: { lt: cutoff }, repliedAt: null, OR: [{ followUpSentAt: { not: null } }, { followUpDueAt: null }] },
    data: { status: 'NO_RESPONSE', lastActivityAt: new Date() },
  })
  return r.count
}

/** Classify an inbound message again (after a prompt change or a wrong guess). Does not change the application status. */
/**
 * You corrected a reply's class in the Inbox. The application moves as a new reply of that
 * class would (never down from an interview or offer); a reply corrected to "not a reply"
 * (auto-reply, bounce) puts it back to Sent when no other real reply exists.
 */
export async function correctClassification(messageId: string, classification: ReplyClassification) {
  const m = await db.emailMessage.findUnique({
    where: { id: messageId },
    include: { application: { select: { id: true, status: true, repliedAt: true, messages: { where: { direction: 'INBOUND', id: { not: messageId } }, select: { classification: true } } } } },
  })
  if (!m || m.direction !== 'INBOUND') return null
  if (m.classification === classification) return m
  const meta = { ...((m.classificationMeta ?? {}) as Record<string, unknown>), correctedFrom: m.classification }
  const updated = await db.emailMessage.update({ where: { id: m.id }, data: { classification, classificationMeta: json(meta), isRead: true } })
  const app = m.application
  const next = STATUS_FOR[classification]
  const protectedStatus = ['INTERVIEW', 'OFFER'].includes(app.status)
  if (next && next !== 'NEEDS_HUMAN') {
    if (!(protectedStatus && next === 'REPLIED')) {
      await db.application.update({ where: { id: app.id }, data: { status: next, repliedAt: app.repliedAt ?? m.receivedAt ?? new Date(), followUpDueAt: null, lastActivityAt: new Date() } })
    }
  } else if (['REPLIED', 'REJECTED'].includes(app.status)) {
    const otherReal = app.messages.some((o) => {
      const s = STATUS_FOR[o.classification as ReplyClassification]
      return s && s !== 'NEEDS_HUMAN'
    })
    if (!otherReal) await db.application.update({ where: { id: app.id }, data: { status: 'SENT', repliedAt: null, lastActivityAt: new Date() } })
  }
  await db.applicationEvent
    .create({ data: { applicationId: app.id, type: 'reply', message: `You changed a reply from ${m.classification ?? 'unclassified'} to ${classification}` } })
    .catch(() => undefined)
  return updated
}

export async function reclassifyInbound(messageId: string) {
  const m = await db.emailMessage.findUnique({ where: { id: messageId } })
  if (!m || m.direction !== 'INBOUND') return null
  const c = await classify(m.applicationId, { from: m.fromAddress, subject: m.subject, text: m.bodyText })
  return db.emailMessage.update({ where: { id: m.id }, data: { classification: c.classification, classificationMeta: json(c) } })
}
