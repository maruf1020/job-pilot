import type { Prisma } from '@/generated/prisma/client'
import { generateJson } from '@/lib/ai/gemini'
import { replyDraftPrompt } from '@/lib/ai/prompts'
import { replyDraftSchema } from '@/lib/ai/schemas'
import { loadAnswerBank, STANDARD_ENTRIES } from '@/lib/apply/answer-bank'
import { db } from '@/lib/db'
import { lintEmail } from '@/lib/pipeline/humanize/lint'
import { getBannedPhrases } from '@/lib/pipeline/humanize/phrases'
import { getProfileForPrompt } from '@/lib/pipeline/profile'
import { isReservedDomain } from './address'
import type { MailAttachment } from './mime'
import { deliver, resumeAttachment } from './send'

/**
 * Following up on replies: an AI-written answer for you to review, and sending it in the
 * same thread. Nothing here sends on its own; `sendReply` runs only from your click.
 */

const json = (v: unknown) => v as Prisma.InputJsonValue

/** What the classifier stored on an inbound message (older rows have only the first fields). */
export interface ReplyMeta {
  summary?: string
  suggestedNextAction?: string | null
  proposedTimes?: string[]
  applyUrl?: string | null
  contact?: { name: string; email: string | null; role?: string | null } | null
  questions?: string[]
}

export function parseAddress(header: string | null | undefined): { name: string | null; email: string } | null {
  if (!header) return null
  const m = /^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/.exec(header)
  if (m) return { name: m[1]?.trim() || null, email: m[2].trim().toLowerCase() }
  const bare = /[^\s<>,;]+@[^\s<>,;]+/.exec(header)
  return bare ? { name: null, email: bare[0].toLowerCase() } : null
}

/** Every address in a To/Cc header. */
export function splitAddressList(header: string | null | undefined): string[] {
  if (!header) return []
  return (header.match(/[^\s<>,;"]+@[^\s<>,;"]+/g) ?? []).map((e) => e.toLowerCase().replace(/[.,;]+$/, ''))
}

const NOT_A_REPLY = ['BOUNCE', 'AUTO_REPLY']

/** Details you keep in the answer bank, as facts for the reply, plus the ones still missing. */
async function replyFacts(): Promise<{ facts: string[]; unknown: string[] }> {
  const bank = await loadAnswerBank()
  const keys = ['notice_period', 'salary_expectation', 'earliest_start', 'requires_sponsorship', 'work_authorization', 'willing_to_relocate', 'phone', 'linkedin', 'github', 'city', 'country', 'languages']
  const facts: string[] = []
  const unknown: string[] = []
  for (const k of keys) {
    const entry = STANDARD_ENTRIES.find((e) => e.key === `std:${k}`)
    const v = bank.std(k)
    if (v) facts.push(`${entry?.question ?? k}: ${v}`)
    else if (['notice_period', 'salary_expectation', 'earliest_start'].includes(k)) unknown.push(entry?.question ?? k)
  }
  return { facts, unknown }
}

export interface DraftReplyResult {
  draftId: string
  to: string
  cc: string | null
  subject: string
  body: string
  attachCv: boolean
  missing: string[]
  lint: { passed: boolean; errors: Array<{ message: string }>; warnings: Array<{ message: string }> }
  inboundId: string
  model: string
}

/** Write a reply to the latest (or the given) inbound message of an application. Saved as an EmailDraft of kind "reply". */
/** What a nudge should do, for a thread where they stopped answering. */
export function nudgeInstruction(days: number, extra?: string | null): string {
  const base = `NUDGE: they have not answered my last message, sent ${days} day${days === 1 ? '' : 's'} ago. Write a short, polite follow-up (40 to 90 words) in the same thread: one line that refers to my last message, one line that restates my interest in the role, and one easy question about the next step. No pressure, no guilt, no new CV pitch.`
  return extra?.trim() ? `${base}\n${extra.trim()}` : base
}

export async function draftReply(applicationId: string, opts: { messageId?: string | null; instruction?: string | null; nudge?: boolean } = {}): Promise<DraftReplyResult> {
  const app = await db.application.findUnique({
    where: { id: applicationId },
    include: { job: { select: { title: true, companyName: true, countryCode: true, summary: true, description: true } }, messages: { orderBy: { createdAt: 'asc' } } },
  })
  if (!app) throw new Error('Application not found')
  const inbound = opts.messageId
    ? app.messages.find((m) => m.id === opts.messageId && m.direction === 'INBOUND')
    : [...app.messages].reverse().find((m) => m.direction === 'INBOUND' && !NOT_A_REPLY.includes(m.classification ?? ''))
  if (!inbound) throw new Error('There is no reply to answer yet')

  const profile = await getProfileForPrompt()
  const { facts, unknown } = await replyFacts()
  const meta = (inbound.classificationMeta ?? {}) as ReplyMeta
  // A nudge follows my own last message, so the thread runs to the end.
  const lastOut = [...app.messages].reverse().find((m) => m.direction === 'OUTBOUND')
  const nudge = Boolean(opts.nudge && lastOut && app.messages.indexOf(lastOut) > app.messages.indexOf(inbound))
  const upTo = nudge ? app.messages.length - 1 : app.messages.indexOf(inbound)
  const quietDays = lastOut ? Math.max(1, Math.round((Date.now() - (lastOut.sentAt ?? lastOut.createdAt).getTime()) / 86_400_000)) : 0
  const instruction = nudge ? nudgeInstruction(quietDays, opts.instruction) : (opts.instruction ?? null)
  const thread = app.messages.slice(Math.max(0, upTo - 5), upTo + 1).map((m) => ({
    direction: m.direction as 'OUTBOUND' | 'INBOUND',
    from: m.fromAddress,
    subject: m.subject,
    body: m.bodyText,
  }))
  const p = replyDraftPrompt({
    profile,
    job: { title: app.job.title, company: app.job.companyName, countryCode: app.job.countryCode },
    posting: app.job.summary || app.job.description,
    thread,
    classification: inbound.classification,
    summary: meta.summary ?? null,
    questions: meta.questions ?? [],
    contactName: meta.contact?.name ?? null,
    facts,
    unknown,
    instruction,
  })
  const r = await generateJson({ task: 'reply', model: 'primary', schema: replyDraftSchema, system: p.system, prompt: p.prompt, temperature: 0.6, maxOutputTokens: 2048 })
  const lint = lintEmail(r.data.subject, r.data.body, {
    companyName: app.job.companyName,
    mustHaveSkills: [],
    profileFacts: profile.facts,
    profileName: profile.fullName,
    stopSkills: profile.stopSkills,
    bannedPhrases: await getBannedPhrases(),
    kind: 'follow_up',
    minWords: 30,
    maxWords: 240,
  })

  // Who to answer: the person now handling it when the reply named one, else the sender.
  const sender = parseAddress(inbound.fromAddress)
  const me = profile.fullName.toLowerCase()
  const contactEmail = meta.contact?.email?.toLowerCase()
  const to = (nudge ? parseAddress(lastOut?.toAddress ?? '')?.email : null) ?? (contactEmail &&/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(contactEmail) ? contactEmail : null) ?? sender?.email ?? ''
  const cc = splitAddressList(inbound.ccAddress).filter((e) => e !== to && !e.includes(me)).join(', ') || null
  const subject = /^re:/i.test(lint.fixedSubject) ? lint.fixedSubject : `Re: ${(inbound.subject || `${app.job.title} application`).replace(/^(re|aw|sv|fwd?):\s*/i, '')}`

  const last = await db.emailDraft.findFirst({ where: { applicationId, kind: 'reply' }, orderBy: { version: 'desc' }, select: { version: true } })
  await db.emailDraft.updateMany({ where: { applicationId, kind: 'reply', isSelected: true }, data: { isSelected: false } })
  const draft = await db.emailDraft.create({
    data: {
      applicationId,
      kind: 'reply',
      version: (last?.version ?? 0) + 1,
      subject,
      body: lint.fixedBody,
      lintResult: json({ passed: lint.passed, errors: lint.errors, warnings: lint.warnings, stats: lint.stats }),
      passed: lint.passed,
      isSelected: true,
      generatedBy: r.model,
      feedback: instruction,
    },
  })
  return {
    draftId: draft.id,
    to,
    cc,
    subject,
    body: lint.fixedBody,
    attachCv: r.data.attachCv,
    missing: r.data.missing,
    lint: { passed: lint.passed, errors: lint.errors, warnings: lint.warnings },
    inboundId: inbound.id,
    model: r.model,
  }
}

export interface SendReplyInput {
  to: string
  cc?: string | null
  subject: string
  body: string
  attachResume?: boolean
  /** The inbound message this answers (for threading and for marking it handled). */
  replyToMessageId?: string | null
}

/** Send your reply in the application's thread. Only called from your explicit click. */
export async function sendReply(applicationId: string, input: SendReplyInput) {
  const app = await db.application.findUnique({
    where: { id: applicationId },
    include: { job: { select: { title: true, companyName: true } }, messages: { orderBy: { createdAt: 'asc' } } },
  })
  if (!app) throw new Error('Application not found')
  const to = input.to.trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(to)) throw new Error('The recipient address is not valid')
  if (isReservedDomain(to)) throw new Error('The recipient address is a reserved test domain')
  if (/\[[^\]]{2,60}\]/.test(input.body)) throw new Error('The reply still has a placeholder in square brackets; fill it in first')
  const cc = splitAddressList(input.cc).filter((e) => e !== to)
  const inbound = input.replyToMessageId ? app.messages.find((m) => m.id === input.replyToMessageId) : [...app.messages].reverse().find((m) => m.direction === 'INBOUND')
  const attachments: MailAttachment[] = []
  if (input.attachResume) {
    const a = await resumeAttachment()
    if (a) attachments.push(a)
  }
  const subject = input.subject.trim() || `Re: ${app.job.title} application`
  const r = await deliver({
    to,
    cc: cc.length ? cc.join(', ') : undefined,
    subject,
    text: input.body,
    attachments,
    threadId: app.threadId,
    // IMAP/SMTP threads by Message-ID; Gmail threads by threadId.
    inReplyTo: inbound?.provider === 'imap' ? inbound.providerMessageId : undefined,
    references: inbound?.provider === 'imap' ? [inbound.providerMessageId] : undefined,
    headers: { 'X-Job-Finder-Application': app.id },
  })
  const now = new Date()
  await db.$transaction([
    db.emailMessage.create({
      data: {
        applicationId: app.id,
        direction: 'OUTBOUND',
        provider: r.provider,
        providerMessageId: r.providerMessageId,
        threadId: r.threadId,
        fromAddress: r.from,
        toAddress: to,
        ccAddress: cc.length ? cc.join(', ') : null,
        subject,
        bodyText: input.body,
        sentAt: now,
        isRead: true,
      },
    }),
    db.emailMessage.updateMany({ where: { applicationId: app.id, direction: 'INBOUND', handledAt: null }, data: { handledAt: now, isRead: true } }),
    db.application.update({ where: { id: app.id }, data: { lastActivityAt: now, followUpDueAt: null, ...(app.threadId ? {} : { threadId: r.threadId }) } }),
    db.applicationEvent.create({ data: { applicationId: app.id, type: 'email', message: `You replied to ${to}${attachments.length ? ' (CV attached)' : ''}`, meta: json({ messageId: r.providerMessageId, subject }) } }),
  ])
  return { providerMessageId: r.providerMessageId, threadId: r.threadId, to }
}

/** Mark a reply (or every reply of an application) as dealt with, or reopen it. */
export async function markHandled(where: { messageId?: string; applicationId?: string }, handled: boolean): Promise<number> {
  const r = await db.emailMessage.updateMany({
    where: { direction: 'INBOUND', ...(where.messageId ? { id: where.messageId } : {}), ...(where.applicationId ? { applicationId: where.applicationId } : {}) },
    data: { handledAt: handled ? new Date() : null, isRead: true },
  })
  return r.count
}
