import { db } from '@/lib/db'
import { needsAction } from '@/lib/email/needs-action'
import type { ReplyMeta } from '@/lib/email/reply'
import { classifyMail, MAIL_FOLDERS, type MailFolder } from './folders'
import type { MailItem, MailList, MailThread } from './types'

const NOT_A_REPLY = ['BOUNCE', 'AUTO_REPLY']
/** Demo data never needs a real reply. */
const DEMO_SENDER = /@[^\s>]+\.(example|invalid|test)\b/i
export const MAIL_PAGE_SIZE = 40

const dayOf = (d: Date | null | undefined) => (d ? d.toISOString() : new Date(0).toISOString())
const oneLine = (s: string, max = 160) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max).trimEnd()}...` : t
}

/** Newest first, except Waiting: the one that unlocks first comes first. */
function sorter(folder: MailFolder): (a: MailItem, b: MailItem) => number {
  if (folder === 'waiting')
    return (a, b) =>
      (a.waitingUntil ?? '').localeCompare(b.waitingUntil ?? '') || a.company.localeCompare(b.company)
  return (a, b) => b.at.localeCompare(a.at)
}

/**
 * Every email application (and any application that got a reply) with its folders. One query plus
 * the inbox's own "needs your answer" rule, classified in memory (the table holds ~1,500 rows).
 */
async function loadItems(now: Date): Promise<Array<MailItem & { folders: MailFolder[] }>> {
  const [apps, needs] = await Promise.all([
    db.application.findMany({
      where: {
        status: { not: 'SKIPPED' },
        OR: [{ channel: 'email' }, { messages: { some: { direction: 'INBOUND' } } }],
      },
      select: {
        id: true,
        channel: true,
        status: true,
        notes: true,
        toEmail: true,
        sentAt: true,
        lastActivityAt: true,
        createdAt: true,
        job: { select: { title: true, companyName: true, countryCode: true, contactEmailSource: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: {
            id: true,
            direction: true,
            subject: true,
            classification: true,
            classificationMeta: true,
            fromAddress: true,
            toAddress: true,
            sentAt: true,
            receivedAt: true,
            createdAt: true,
          },
        },
        drafts: { where: { isSelected: true, kind: 'initial' }, take: 1, select: { subject: true } },
      },
    }),
    needsAction(now),
  ])
  const needsAnswer = new Set(needs.needsYou.map((n) => n.applicationId))

  return apps.map((a) => {
    const inbound = a.messages.find(
      (m) =>
        m.direction === 'INBOUND' &&
        !NOT_A_REPLY.includes(m.classification ?? '') &&
        !DEMO_SENDER.test(m.fromAddress),
    )
    const outbound = a.messages.find((m) => m.direction === 'OUTBOUND')
    const cls = classifyMail(
      {
        channel: a.channel,
        status: a.status,
        notes: a.notes,
        contactEmailSource: a.job.contactEmailSource,
        latestReply: inbound?.classification ?? null,
        needsAnswer: needsAnswer.has(a.id),
      },
      now,
    )
    const meta = (inbound?.classificationMeta ?? {}) as ReplyMeta
    const sentAt = outbound?.sentAt ?? a.sentAt ?? outbound?.createdAt ?? null
    const draftSubject = a.drafts[0]?.subject ?? null
    const note = a.notes ? oneLine(a.notes) : ''
    const pre = cls.folders.some((f) => ['needs-review', 'drafts', 'waiting', 'held'].includes(f))
    const replyLike = cls.folders.some((f) => ['needs-answer', 'important', 'replied'].includes(f)) && inbound
    return {
      applicationId: a.id,
      company: a.job.companyName,
      title: a.job.title,
      countryCode: a.job.countryCode,
      status: a.status,
      subject: replyLike
        ? inbound.subject || '(no subject)'
        : (outbound?.subject ?? draftSubject ?? a.job.title),
      preview: replyLike
        ? (meta.summary ?? oneLine(inbound.fromAddress))
        : pre
          ? note || (a.toEmail ? `To ${a.toEmail}` : '')
          : `To ${outbound?.toAddress ?? a.toEmail ?? 'unknown'}`,
      at: dayOf(
        replyLike
          ? (inbound.receivedAt ?? inbound.createdAt)
          : pre
            ? a.lastActivityAt
            : (sentAt ?? a.lastActivityAt ?? a.createdAt),
      ),
      reply: inbound?.classification ?? null,
      messageId: inbound?.id ?? null,
      folders: cls.folders,
      waitingUntil: cls.waitingUntil,
      heldReason: cls.heldReason,
    }
  })
}

/** One folder page plus the count of every folder. */
export async function loadMail(
  folder: MailFolder,
  page: number,
  now = new Date(),
): Promise<MailList & { page: number; pageSize: number }> {
  const all = await loadItems(now)
  const counts = Object.fromEntries(MAIL_FOLDERS.map((f) => [f, 0])) as Record<MailFolder, number>
  for (const it of all) for (const f of it.folders) counts[f]++
  let inFolder = all.filter((it) => it.folders.includes(folder))
  // Needs answer keeps the inbox order (interviews, questions, then "apply on our site"): by status of the reply, newest first.
  inFolder = inFolder.sort(sorter(folder))
  const start = (page - 1) * MAIL_PAGE_SIZE
  return {
    folder,
    items: inFolder.slice(start, start + MAIL_PAGE_SIZE),
    counts,
    page,
    pageSize: MAIL_PAGE_SIZE,
  }
}

/** The reader pane: the whole thread of one application. */
export async function loadThread(applicationId: string, now = new Date()): Promise<MailThread | null> {
  const [a, needs] = await Promise.all([
    db.application.findUnique({
      where: { id: applicationId },
      select: {
        id: true,
        channel: true,
        status: true,
        notes: true,
        toEmail: true,
        job: { select: { title: true, companyName: true, countryCode: true, contactEmailSource: true } },
        messages: { orderBy: [{ sentAt: 'asc' }, { createdAt: 'asc' }], take: 40 },
        drafts: {
          where: { isSelected: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { subject: true, body: true, passed: true },
        },
      },
    }),
    needsAction(now),
  ])
  if (!a) return null
  const real = a.messages.filter(
    (m) => m.direction === 'INBOUND' && !NOT_A_REPLY.includes(m.classification ?? ''),
  )
  const latestReply = real.at(-1) ?? null
  const cls = classifyMail(
    {
      channel: a.channel,
      status: a.status,
      notes: a.notes,
      contactEmailSource: a.job.contactEmailSource,
      latestReply: latestReply?.classification ?? null,
      needsAnswer: needs.needsYou.some((n) => n.applicationId === a.id),
    },
    now,
  )
  return {
    applicationId: a.id,
    company: a.job.companyName,
    title: a.job.title,
    countryCode: a.job.countryCode,
    status: a.status,
    toEmail: a.toEmail,
    notes: a.notes,
    folders: cls.folders,
    waitingUntil: cls.waitingUntil,
    heldReason: cls.heldReason,
    messages: a.messages.map((m) => ({
      id: m.id,
      direction: m.direction as 'INBOUND' | 'OUTBOUND',
      from: m.fromAddress,
      to: m.toAddress,
      subject: m.subject,
      body: m.bodyText.slice(0, 20_000),
      at: dayOf(m.receivedAt ?? m.sentAt ?? m.createdAt),
      classification: m.classification,
      summary: ((m.classificationMeta ?? {}) as ReplyMeta).summary ?? null,
    })),
    draft: a.drafts[0] ?? null,
    latestReplyId: latestReply?.id ?? null,
    latestReplyClassification: latestReply?.classification ?? null,
  }
}
