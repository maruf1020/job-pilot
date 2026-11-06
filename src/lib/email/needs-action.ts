import { db } from '@/lib/db'
import type { ReplyMeta } from './reply'

/**
 * Replies that wait for you: the latest reply of each application that nobody answered yet,
 * best first (interviews, then questions, then "apply on our site"). Plus the threads where you
 * replied and the other side went quiet.
 */

/** Latest replies after which a nudge makes no sense. */
export const NO_NUDGE = new Set(['APPLY_VIA_PORTAL', 'WRONG_RECIPIENT', 'REJECTION'])

const PRIORITY: Record<string, number> = { INTERVIEW_REQUEST: 0, NEEDS_INFO: 1, POSITIVE: 2, LOCATION_ISSUE: 3, APPLY_VIA_PORTAL: 4, OTHER: 5, WRONG_RECIPIENT: 6 }
const IGNORED = ['BOUNCE', 'AUTO_REPLY', 'REJECTION']

export interface NeedsActionItem {
  messageId: string
  applicationId: string
  classification: string
  from: string
  subject: string
  receivedAt: string
  ageDays: number
  summary: string | null
  suggestedNextAction: string | null
  applyUrl: string | null
  contact: { name: string; email: string | null; role?: string | null } | null
  questions: string[]
  proposedTimes: string[]
  job: { id: string; title: string; companyName: string; countryCode: string | null; url: string; atsType: string | null }
  status: string
}

/** Replies that move an application one step ahead: an interview, interest or a request for details. */
export const NEXT_STEP = ['INTERVIEW_REQUEST', 'POSITIVE', 'NEEDS_INFO']

/** A next-step or location reply, kept on the list after you answer so you can follow it through. */
export interface LeadItem extends NeedsActionItem {
  /** You replied after it arrived, or marked it done. */
  answered: boolean
  /** An AI reply is drafted and waits for your review on the application page. */
  hasDraft: boolean
}

export interface WaitingItem {
  applicationId: string
  to: string
  sentAt: string
  ageDays: number
  job: { id: string; title: string; companyName: string; countryCode: string | null }
  status: string
}

function toItem(
  m: { id: string; applicationId: string; classification: string | null; fromAddress: string; subject: string; classificationMeta: unknown },
  received: Date,
  app: { status: string; job: NeedsActionItem['job'] },
  now: Date,
): NeedsActionItem {
  const meta = (m.classificationMeta ?? {}) as ReplyMeta
  return {
    messageId: m.id,
    applicationId: m.applicationId,
    classification: m.classification ?? 'OTHER',
    from: m.fromAddress,
    subject: m.subject,
    receivedAt: received.toISOString(),
    ageDays: Math.floor((now.getTime() - received.getTime()) / 86_400_000),
    summary: meta.summary ?? null,
    suggestedNextAction: meta.suggestedNextAction ?? null,
    applyUrl: meta.applyUrl ?? null,
    contact: meta.contact ?? null,
    questions: meta.questions ?? [],
    proposedTimes: meta.proposedTimes ?? [],
    job: app.job,
    status: app.status,
  }
}

/**
 * The applications that moved forward (interview, interest, questions) and the ones where only the
 * location stands in the way, judged by each application's latest real reply. Answered ones stay
 * on the list, flagged, until the next reply changes the picture.
 */
export async function leads(now = new Date()): Promise<{ nextSteps: LeadItem[]; locationIssue: LeadItem[] }> {
  const inbound = await db.emailMessage.findMany({
    where: { direction: 'INBOUND', classification: { notIn: ['BOUNCE', 'AUTO_REPLY'] } },
    orderBy: { receivedAt: 'desc' },
    take: 500,
    include: {
      application: {
        select: {
          id: true,
          status: true,
          job: { select: { id: true, title: true, companyName: true, countryCode: true, url: true, atsType: true } },
          messages: { where: { direction: 'OUTBOUND' }, orderBy: { sentAt: 'desc' }, take: 1, select: { sentAt: true } },
          drafts: { where: { kind: 'reply', isSelected: true }, orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
        },
      },
    },
  })
  const seen = new Set<string>()
  const nextSteps: LeadItem[] = []
  const locationIssue: LeadItem[] = []
  for (const m of inbound) {
    if (seen.has(m.applicationId)) continue
    seen.add(m.applicationId)
    if (/@[^\s>]+\.(example|invalid|test)\b/i.test(m.fromAddress)) continue
    const bucket = NEXT_STEP.includes(m.classification ?? '') ? nextSteps : m.classification === 'LOCATION_ISSUE' ? locationIssue : null
    if (!bucket) continue
    const received = m.receivedAt ?? m.createdAt
    const lastOut = m.application.messages[0]?.sentAt
    const draftAt = m.application.drafts[0]?.createdAt
    bucket.push({ ...toItem(m, received, m.application, now), answered: !!m.handledAt || (!!lastOut && lastOut > received), hasDraft: !!draftAt && draftAt > received })
  }
  // Unanswered first, then interviews before interest before questions, newest first.
  const order = (x: LeadItem) => (x.answered ? 10 : 0) + (PRIORITY[x.classification] ?? 9)
  for (const list of [nextSteps, locationIssue]) list.sort((a, b) => order(a) - order(b) || b.receivedAt.localeCompare(a.receivedAt))
  return { nextSteps, locationIssue }
}

export async function needsAction(now = new Date()): Promise<{ needsYou: NeedsActionItem[]; waitingForThem: WaitingItem[] }> {
  const inbound = await db.emailMessage.findMany({
    where: { direction: 'INBOUND', handledAt: null, classification: { notIn: IGNORED } },
    orderBy: { receivedAt: 'desc' },
    take: 200,
    include: {
      application: {
        select: {
          id: true,
          status: true,
          job: { select: { id: true, title: true, companyName: true, countryCode: true, url: true, atsType: true } },
          messages: { where: { direction: 'OUTBOUND' }, orderBy: { sentAt: 'desc' }, take: 1, select: { sentAt: true } },
        },
      },
    },
  })
  const seen = new Set<string>()
  const needsYou: NeedsActionItem[] = []
  for (const m of inbound) {
    if (seen.has(m.applicationId)) continue
    seen.add(m.applicationId)
    const received = m.receivedAt ?? m.createdAt
    const lastOut = m.application.messages[0]?.sentAt
    // Already answered after it arrived.
    if (lastOut && lastOut > received) continue
    // Demo data never needs a real reply.
    if (/@[^\s>]+\.(example|invalid|test)\b/i.test(m.fromAddress)) continue
    needsYou.push(toItem(m, received, m.application, now))
  }
  needsYou.sort((a, b) => (PRIORITY[a.classification] ?? 9) - (PRIORITY[b.classification] ?? 9) || b.receivedAt.localeCompare(a.receivedAt))

  // You answered a reply and nothing came back for 4+ days.
  const quiet = new Date(now.getTime() - 4 * 86_400_000)
  const apps = await db.application.findMany({
    where: { status: { in: ['REPLIED', 'INTERVIEW'] }, messages: { some: { direction: 'INBOUND' } } },
    select: {
      id: true,
      status: true,
      job: { select: { id: true, title: true, companyName: true, countryCode: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 8, select: { direction: true, classification: true, sentAt: true, toAddress: true, createdAt: true } },
    },
    take: 200,
  })
  const waitingForThem: WaitingItem[] = []
  for (const a of apps) {
    const last = a.messages[0]
    if (!last || last.direction !== 'OUTBOUND') continue
    // "Apply on our site", "wrong person" or a no: there is nothing to nudge.
    const theirs = a.messages.find((m) => m.direction === 'INBOUND' && !['BOUNCE', 'AUTO_REPLY'].includes(m.classification ?? ''))
    if (theirs && NO_NUDGE.has(theirs.classification ?? '')) continue
    const at = last.sentAt ?? last.createdAt
    if (at > quiet) continue
    waitingForThem.push({ applicationId: a.id, to: last.toAddress, sentAt: at.toISOString(), ageDays: Math.floor((now.getTime() - at.getTime()) / 86_400_000), job: a.job, status: a.status })
  }
  waitingForThem.sort((x, y) => y.ageDays - x.ageDays)
  return { needsYou, waitingForThem }
}
