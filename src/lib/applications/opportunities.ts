import { db } from '@/lib/db'
import type { ReplyMeta } from '@/lib/email/reply'
import { leads, NEXT_STEP, type LeadItem } from '@/lib/email/needs-action'
import type { HiringStage } from './hiring'
import { manualTodo, type TodoItem } from './manual-todo'

/**
 * The Opportunities page (one menu with only the important ones): companies
 * that want something from you now, and every hiring process under way, so nothing warm goes cold.
 */
export interface ProgressItem {
  applicationId: string
  company: string
  title: string
  countryCode: string | null
  location: string | null
  status: string
  /** The latest hiring-process stage list (application events of type "process"), empty when none was set. */
  stages: HiringStage[]
  current: HiringStage | null
  /** Their latest real reply (not an auto-reply or bounce). */
  lastReply: { classification: string; summary: string | null; receivedAt: string } | null
  /** Your last email to them. */
  lastOutAt: string | null
  /** Days since your last email when they have not answered it yet. */
  quietDays: number | null
  lastActivityAt: string
}

/** A company that once wrote back with interest, where something came after it (a no, "location", "apply on our site"). */
export interface EarlierItem {
  applicationId: string
  company: string
  title: string
  countryCode: string | null
  status: string
  /** Their interested email (the latest one). */
  interest: { classification: string; summary: string | null; receivedAt: string }
  /** What came after it, when anything did. */
  outcome: { classification: string; summary: string | null; receivedAt: string } | null
}

export interface OpportunitiesData {
  /** Interview requests, interest and questions you have not answered yet. */
  yourMove: LeadItem[]
  inProgress: ProgressItem[]
  /** Every other company that ever showed interest, so the page covers all of them. */
  earlier: EarlierItem[]
  /** What only you can do, most important first (the highlighted box at the top right). */
  todo: TodoItem[]
}

type ReplyRef = { classification: string | null; classificationMeta: unknown; subject: string; receivedAt: Date | null; createdAt: Date }
const replyRef = (m: ReplyRef) => ({
  classification: m.classification ?? 'OTHER',
  summary: ((m.classificationMeta ?? {}) as ReplyMeta).summary ?? m.subject,
  receivedAt: (m.receivedAt ?? m.createdAt).toISOString(),
})

const asStages = (meta: unknown): HiringStage[] => {
  const stages = (meta as { stages?: unknown } | null)?.stages
  return Array.isArray(stages) ? (stages as HiringStage[]).filter((s) => s && typeof s.name === 'string') : []
}

const RANK: Record<string, number> = { OFFER: 0, INTERVIEW: 1 }
const CLOSED = ['REJECTED', 'SKIPPED']

export async function opportunities(now = new Date()): Promise<OpportunitiesData> {
  const { nextSteps } = await leads(now)
  // A company that has since said no is not waiting for you (Everquote's data-retention mail came after its rejection).
  const yourMove = nextSteps.filter((l) => !l.answered && !CLOSED.includes(l.status))
  const moveIds = yourMove.map((l) => l.applicationId)
  const answered = nextSteps.filter((l) => l.answered).map((l) => l.applicationId)
  const withProcess = await db.applicationEvent.findMany({ where: { type: 'process' }, select: { applicationId: true }, distinct: ['applicationId'] })

  const apps = await db.application.findMany({
    where: {
      id: { notIn: moveIds },
      // The seeded demo applications (Demo Fintech) are not real companies.
      NOT: { id: { startsWith: 'demo-' } },
      status: { notIn: CLOSED },
      OR: [{ status: { in: ['INTERVIEW', 'OFFER'] } }, { id: { in: [...answered, ...withProcess.map((p) => p.applicationId)] } }],
    },
    select: {
      id: true,
      status: true,
      lastActivityAt: true,
      job: { select: { title: true, companyName: true, countryCode: true, location: true } },
      events: { where: { type: 'process' }, orderBy: { createdAt: 'desc' }, take: 1, select: { meta: true, createdAt: true } },
      messages: {
        where: { OR: [{ direction: 'OUTBOUND' }, { classification: { notIn: ['BOUNCE', 'AUTO_REPLY'] } }] },
        orderBy: [{ receivedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        take: 12,
        select: { direction: true, classification: true, classificationMeta: true, subject: true, sentAt: true, receivedAt: true, createdAt: true },
      },
    },
  })

  const inProgress: ProgressItem[] = []
  for (const a of apps) {
    const stages = asStages(a.events[0]?.meta)
    const current = stages.find((s) => s.status === 'current') ?? stages.find((s) => s.status === 'todo') ?? null
    // A process with every step done is over, unless the status still says interview or offer.
    if (stages.length && !current && !(a.status in RANK)) continue
    const inbound = a.messages.find((m) => m.direction === 'INBOUND')
    const outbound = a.messages.find((m) => m.direction === 'OUTBOUND')
    const inAt = inbound ? (inbound.receivedAt ?? inbound.createdAt) : null
    const outAt = outbound ? (outbound.sentAt ?? outbound.createdAt) : null
    const quietDays = outAt && (!inAt || outAt > inAt) ? Math.floor((now.getTime() - outAt.getTime()) / 86_400_000) : null
    const processAt = a.events[0]?.createdAt
    const latest = [a.lastActivityAt, inAt, outAt, processAt].filter((d): d is Date => !!d).reduce((x, y) => (y > x ? y : x))
    inProgress.push({
      applicationId: a.id,
      company: a.job.companyName,
      title: a.job.title,
      countryCode: a.job.countryCode,
      location: a.job.location,
      status: a.status,
      stages,
      current,
      lastReply: inbound ? replyRef(inbound) : null,
      lastOutAt: outAt?.toISOString() ?? null,
      quietDays,
      lastActivityAt: latest.toISOString(),
    })
  }
  // Offers, then interviews, then the rest; the most recent movement first within each.
  inProgress.sort((x, y) => (RANK[x.status] ?? 2) - (RANK[y.status] ?? 2) || y.lastActivityAt.localeCompare(x.lastActivityAt))

  // Everyone else who ever wrote back with interest (all of them, not only the recent ones).
  const shown = new Set([...moveIds, ...inProgress.map((p) => p.applicationId)])
  const interested = await db.emailMessage.findMany({
    where: { direction: 'INBOUND', classification: { in: NEXT_STEP }, applicationId: { notIn: [...shown] }, NOT: { applicationId: { startsWith: 'demo-' } } },
    orderBy: [{ receivedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    select: {
      applicationId: true,
      classification: true,
      classificationMeta: true,
      subject: true,
      receivedAt: true,
      createdAt: true,
      application: {
        select: {
          status: true,
          job: { select: { title: true, companyName: true, countryCode: true } },
          messages: {
            where: { direction: 'INBOUND', classification: { notIn: ['BOUNCE', 'AUTO_REPLY'] } },
            orderBy: [{ receivedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
            take: 1,
            select: { classification: true, classificationMeta: true, subject: true, receivedAt: true, createdAt: true },
          },
        },
      },
    },
  })
  const earlier: EarlierItem[] = []
  const seen = new Set<string>()
  for (const m of interested) {
    if (seen.has(m.applicationId)) continue
    seen.add(m.applicationId)
    const last = m.application.messages[0]
    const interest = replyRef(m)
    const after = last && (last.receivedAt ?? last.createdAt) > (m.receivedAt ?? m.createdAt) && !NEXT_STEP.includes(last.classification ?? '') ? replyRef(last) : null
    earlier.push({ applicationId: m.applicationId, company: m.application.job.companyName, title: m.application.job.title, countryCode: m.application.job.countryCode, status: m.application.status, interest, outcome: after })
  }
  earlier.sort((x, y) => y.interest.receivedAt.localeCompare(x.interest.receivedAt))
  const todo = await manualTodo(yourMove, inProgress).catch(() => [])
  return { yourMove, inProgress, earlier, todo }
}
