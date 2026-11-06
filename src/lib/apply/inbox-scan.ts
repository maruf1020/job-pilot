import type { Prisma } from '@/generated/prisma/client'
import { generateJson } from '@/lib/ai/gemini'
import { NoKeyAvailableError } from '@/lib/ai/key-pool'
import { classifyReplyPrompt } from '@/lib/ai/prompts'
import { replyClassificationSchema } from '@/lib/ai/schemas'
import { db } from '@/lib/db'
import type { ApplicationStatus, ReplyClassification } from '@/lib/domain'
import { getGmailClient, toLite, type GmailMessageLite } from '@/lib/email/gmail'
import { isMailRateLimitError } from '@/lib/email/send'
import { notify } from '@/lib/notifications'
import { getSettings } from '@/lib/settings/service'
import { gmailConnected } from './email-codes'
import { ATS_SENDER_QUERY, fromDomain, isNoise, isVerificationMail, matchApplication, type ApplicationRef } from './inbox-match'

/**
 * Read new Gmail messages from application sites and from the companies you applied to,
 * match each one to its application and update the status (rejection, interview, offer...).
 * Covers applications sent through websites (no email thread) and replies that start a new
 * thread. Every message is read once (InboxMessage).
 */

const json = (v: unknown) => v as Prisma.InputJsonValue

const STATUS_FOR: Partial<Record<ReplyClassification, ApplicationStatus>> = {
  INTERVIEW_REQUEST: 'INTERVIEW',
  POSITIVE: 'REPLIED',
  NEEDS_INFO: 'REPLIED',
  APPLY_VIA_PORTAL: 'REPLIED',
  LOCATION_ISSUE: 'REPLIED',
  REJECTION: 'REJECTED',
}

const KIND_FOR: Record<ReplyClassification, string> = {
  INTERVIEW_REQUEST: 'interview',
  POSITIVE: 'positive',
  NEEDS_INFO: 'needs_info',
  LOCATION_ISSUE: 'location_issue',
  REJECTION: 'rejection',
  APPLY_VIA_PORTAL: 'apply_via_portal',
  WRONG_RECIPIENT: 'wrong_recipient',
  AUTO_REPLY: 'confirmation',
  BOUNCE: 'other',
  OTHER: 'other',
}

/** Order of statuses, so a late "thanks for applying" never moves an interview back. */
const RANK: Record<string, number> = { SENT: 1, NO_RESPONSE: 1, REPLIED: 2, INTERVIEW: 3, OFFER: 4, REJECTED: 5 }

async function listMessageIds(q: string, maxPages = 3): Promise<Array<{ id: string; threadId: string | null }>> {
  const { gmail } = await getGmailClient()
  const out: Array<{ id: string; threadId: string | null }> = []
  let pageToken: string | undefined
  for (let i = 0; i < maxPages; i++) {
    const res = await gmail.users.messages.list({ userId: 'me', q, maxResults: 100, pageToken })
    for (const m of res.data.messages ?? []) if (m.id) out.push({ id: m.id, threadId: m.threadId ?? null })
    pageToken = res.data.nextPageToken ?? undefined
    if (!pageToken) break
  }
  return out
}

async function getMessage(id: string): Promise<GmailMessageLite> {
  const { gmail } = await getGmailClient()
  const res = await gmail.users.messages.get({ userId: 'me', id, format: 'full' })
  return toLite(res.data)
}

export async function scanInbox(log: (m: string) => void = console.log, opts: { days?: number; max?: number } = {}): Promise<{ scanned: number; matched: number }> {
  const settings = await getSettings()
  if (!settings.portal.inboxScan) return { scanned: 0, matched: 0 }
  if (!(await gmailConnected())) return { scanned: 0, matched: 0 }
  const since = new Date(Date.now() - 150 * 86_400_000)
  const apps = await db.application.findMany({
    where: { sentAt: { gte: since }, status: { in: ['SENT', 'REPLIED', 'INTERVIEW', 'OFFER', 'NO_RESPONSE'] } },
    // Most recent activity first, so the 40 company domains below include today's applications.
    orderBy: { lastActivityAt: 'desc' },
    select: { id: true, sentAt: true, status: true, coverLetter: true, job: { select: { title: true, companyName: true, company: { select: { domain: true } } } } },
  })
  if (apps.length === 0) return { scanned: 0, matched: 0 }
  const refs: ApplicationRef[] = apps.map((a) => ({ id: a.id, sentAt: a.sentAt!, title: a.job.title, company: a.job.companyName, domain: a.job.company.domain }))

  // Senders: application systems plus the domains of companies you applied to (most recent first).
  const domains = [...new Set(apps.map((a) => a.job.company.domain).filter((d): d is string => Boolean(d)))].slice(0, 40)
  const senders = [...ATS_SENDER_QUERY, ...domains].map((d) => `from:${d}`).join(' OR ')
  const q = `newer_than:${opts.days ?? 21}d -in:sent -in:chats -in:drafts (${senders} OR subject:(application OR applying OR interview OR candidacy OR bewerbung OR candidature))`
  const me = (await db.oAuthToken.findUnique({ where: { provider: 'gmail' }, select: { accountEmail: true } }))?.accountEmail?.toLowerCase() ?? ''

  const listed = await listMessageIds(q)
  const ids = listed.map((m) => m.id)
  const [seen, recorded] = await Promise.all([
    db.inboxMessage.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    db.emailMessage.findMany({ where: { provider: 'gmail', providerMessageId: { in: ids } }, select: { providerMessageId: true } }),
  ])
  const done = new Set([...seen.map((s) => s.id), ...recorded.map((r) => r.providerMessageId)])
  const todo = listed.filter((m) => !done.has(m.id)).slice(0, opts.max ?? 60)

  let matched = 0
  for (const item of todo) {
    let m: GmailMessageLite
    try {
      m = await getMessage(item.id)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (isMailRateLimitError(message)) {
        log('Gmail API quota reached; the inbox scan continues next time')
        break
      }
      log(`could not read message ${item.id}: ${message}`)
      continue
    }
    // Spread reads out so sending keeps its share of Gmail's per-minute quota.
    await new Promise((r) => setTimeout(r, 200))
    const base = { id: m.id, threadId: m.threadId || null, fromAddress: m.from.slice(0, 300), subject: m.subject.slice(0, 500), receivedAt: m.date }
    if ((me && m.from.toLowerCase().includes(me)) || m.labelIds.includes('SENT')) {
      await db.inboxMessage.create({ data: { ...base, kind: 'other' } }).catch(() => undefined)
      continue
    }
    if (isVerificationMail(m)) {
      await db.inboxMessage.create({ data: { ...base, kind: 'verification' } }).catch(() => undefined)
      continue
    }
    const hit = isNoise(m) ? null : matchApplication(m, refs)
    if (!hit) {
      await db.inboxMessage.create({ data: { ...base, kind: 'unmatched' } }).catch(() => undefined)
      continue
    }
    const app = apps.find((a) => a.id === hit.id)!
    let classification: ReplyClassification = 'OTHER'
    let meta: Record<string, unknown> = {}
    try {
      const p = classifyReplyPrompt({
        ourSubject: `Application for ${app.job.title} at ${app.job.companyName}`,
        ourBody: app.coverLetter?.slice(0, 1200) ?? '(application sent through the company website)',
        replyFrom: m.from,
        replySubject: m.subject,
        replyBody: m.text.slice(0, 6000),
      })
      const r = await generateJson({ task: 'classify_reply', model: 'lite', schema: replyClassificationSchema, system: p.system, prompt: p.prompt, temperature: 0.1, maxOutputTokens: 800 })
      classification = r.data.classification
      meta = r.data as unknown as Record<string, unknown>
    } catch (err) {
      if (err instanceof NoKeyAvailableError) {
        log('AI quota used up; the inbox scan continues later')
        break // not marked as seen, so it is classified on the next scan
      }
      log(`classification failed for "${m.subject.slice(0, 60)}": ${err instanceof Error ? err.message : err}`)
    }
    if (/thank you for (applying|your application|your interest)|we (have )?received your application|application (was )?received/i.test(`${m.subject}\n${m.text.slice(0, 500)}`) && classification === 'OTHER') {
      classification = 'AUTO_REPLY'
    }
    const kind = KIND_FOR[classification]
    await db.$transaction([
      db.inboxMessage.create({ data: { ...base, kind, applicationId: app.id } }),
      db.emailMessage.create({
        data: {
          applicationId: app.id,
          direction: 'INBOUND',
          provider: 'gmail',
          providerMessageId: m.id,
          threadId: m.threadId || null,
          fromAddress: m.from,
          toAddress: m.to,
          ccAddress: m.cc,
          subject: m.subject,
          bodyText: m.text,
          receivedAt: m.date ?? new Date(),
          classification,
          classificationMeta: json({ ...meta, source: 'inbox-scan', domain: fromDomain(m.from) }),
        },
      }),
    ])
    matched++
    const next = STATUS_FOR[classification]
    const current = app.status as ApplicationStatus
    const moves = next && (RANK[next] ?? 0) > (RANK[current] ?? 0) && !(current === 'REJECTED')
    if (moves) {
      await db.application.update({ where: { id: app.id }, data: { status: next, repliedAt: m.date ?? new Date(), lastActivityAt: new Date(), followUpDueAt: null } })
      app.status = next
    }
    const label = classification === 'AUTO_REPLY' ? 'Confirmation received' : classification === 'REJECTION' ? 'Rejection' : classification === 'INTERVIEW_REQUEST' ? 'Interview request' : 'Reply'
    await db.applicationEvent.create({ data: { applicationId: app.id, type: classification === 'AUTO_REPLY' ? 'confirmation' : 'email', message: `${label}: ${m.subject.slice(0, 200)}`, meta: json({ messageId: m.id, classification }) } })
    if (classification !== 'AUTO_REPLY') {
      await notify(classification === 'INTERVIEW_REQUEST' ? 'interview' : 'reply', `${label}: ${app.job.title} at ${app.job.companyName}`, String(meta.summary ?? m.subject).slice(0, 300), `/applications/${app.id}`, { classification })
    }
    log(`${label.toLowerCase()} for ${app.job.companyName}: "${m.subject.slice(0, 80)}"`)
  }
  return { scanned: todo.length, matched }
}
