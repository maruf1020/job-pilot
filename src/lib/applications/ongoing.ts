import { db } from '@/lib/db'
import type { HiringStage } from './hiring'

/**
 * Ongoing applications (plan-ui-redesign.md 7.2): the ones a company is actively talking about
 * (replied, interview, offer) or with a hiring process saved, with the stage you are on and what
 * to do next.
 */

export type NextActionKind = 'reply' | 'prepare' | 'offer' | 'waiting'

export interface NextAction {
  kind: NextActionKind
  label: string
  /** The date the action is about (interview date, waiting since), ISO. */
  at: string | null
}

export interface OngoingApplication {
  applicationId: string
  company: string
  title: string
  countryCode: string | null
  status: string
  channel: string
  /** Current hiring stage, else a label for the status. */
  stage: string
  /** Stages done / total, when a hiring process is saved. */
  progress: { done: number; total: number } | null
  lastActivityAt: string
  sentAt: string | null
  nextAction: NextAction
}

const STATUS_STAGE: Record<string, string> = { REPLIED: 'Replied', INTERVIEW: 'Interview', OFFER: 'Offer', SENT: 'Applied' }
const ACTIVE_STATUSES = ['REPLIED', 'INTERVIEW', 'OFFER']
const NOT_ONGOING = ['REJECTED', 'SKIPPED', 'NO_RESPONSE']
/** Replies that need no answer from you. */
const NO_ANSWER_NEEDED = new Set(['AUTO_REPLY', 'BOUNCE', 'REJECTION'])

const REPLY_LABEL: Record<string, string> = {
  INTERVIEW_REQUEST: 'Reply: book the interview',
  NEEDS_INFO: 'Reply: they asked for details',
  POSITIVE: 'Reply: they are interested',
  LOCATION_ISSUE: 'Reply: ask about other roles',
  APPLY_VIA_PORTAL: 'Apply on their site',
}

const shortDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** The stage the process is on: the one marked current, else the first not done, else the last done. */
export function currentStage(stages: HiringStage[]): HiringStage | null {
  return stages.find((s) => s.status === 'current') ?? stages.find((s) => s.status === 'todo') ?? [...stages].reverse().find((s) => s.status === 'done') ?? null
}

/** What to do next for one ongoing application. Pure. */
export function deriveNextAction(input: {
  status: string
  stages: HiringStage[]
  lastInbound: { at: Date; classification: string | null; handled: boolean } | null
  lastOutboundAt: Date | null
  lastActivityAt: Date
  now?: Date
}): NextAction {
  const now = input.now ?? new Date()
  if (input.status === 'OFFER') return { kind: 'offer', label: 'Decide on the offer', at: null }
  const inbound = input.lastInbound
  const unanswered = inbound && !inbound.handled && !NO_ANSWER_NEEDED.has(inbound.classification ?? '') && (!input.lastOutboundAt || input.lastOutboundAt < inbound.at)
  if (unanswered) return { kind: 'reply', label: REPLY_LABEL[inbound.classification ?? ''] ?? 'Reply to them', at: inbound.at.toISOString() }
  const stage = currentStage(input.stages)
  if (stage && stage.status !== 'done') {
    const at = stage.at ? new Date(stage.at) : null
    if (at && !Number.isNaN(at.getTime()) && at >= new Date(now.getTime() - 86_400_000)) return { kind: 'prepare', label: `Prepare for ${stage.name} on ${shortDate(at)}`, at: at.toISOString() }
    if (input.status === 'INTERVIEW' || stage.status === 'current') return { kind: 'prepare', label: `Prepare for ${stage.name}`, at: null }
  } else if (input.status === 'INTERVIEW') return { kind: 'prepare', label: 'Prepare for the interview', at: null }
  const since = [input.lastOutboundAt, inbound?.at ?? null].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? input.lastActivityAt
  return { kind: 'waiting', label: `Waiting for them since ${shortDate(since)}`, at: since.toISOString() }
}

const asStages = (meta: unknown): HiringStage[] => {
  const stages = (meta as { stages?: unknown } | null)?.stages
  return Array.isArray(stages) ? (stages as HiringStage[]).filter((s) => s && typeof s.name === 'string') : []
}

/** Ongoing applications, newest activity first. */
export async function ongoingApplications(limit = 200): Promise<OngoingApplication[]> {
  const apps = await db.application.findMany({
    where: {
      status: { notIn: NOT_ONGOING },
      OR: [{ status: { in: ACTIVE_STATUSES } }, { events: { some: { type: 'process' } } }],
    },
    orderBy: { lastActivityAt: 'desc' },
    take: limit,
    select: {
      id: true,
      status: true,
      channel: true,
      sentAt: true,
      lastActivityAt: true,
      job: { select: { companyName: true, title: true, countryCode: true } },
      events: { where: { type: 'process' }, orderBy: { createdAt: 'desc' }, take: 1, select: { meta: true } },
      messages: {
        where: { OR: [{ direction: 'OUTBOUND' }, { direction: 'INBOUND', classification: { notIn: ['AUTO_REPLY', 'BOUNCE'] } }] },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { direction: true, classification: true, handledAt: true, sentAt: true, receivedAt: true, createdAt: true },
      },
    },
  })
  const now = new Date()
  return apps.map((a) => {
    const stages = asStages(a.events[0]?.meta)
    const inbound = a.messages.find((m) => m.direction === 'INBOUND')
    const outbound = a.messages.filter((m) => m.direction === 'OUTBOUND').map((m) => m.sentAt ?? m.createdAt)
    const stage = currentStage(stages)
    return {
      applicationId: a.id,
      company: a.job.companyName,
      title: a.job.title,
      countryCode: a.job.countryCode,
      status: a.status,
      channel: a.channel,
      stage: stage?.name ?? STATUS_STAGE[a.status] ?? a.status,
      progress: stages.length ? { done: stages.filter((s) => s.status === 'done').length, total: stages.length } : null,
      lastActivityAt: a.lastActivityAt.toISOString(),
      sentAt: a.sentAt?.toISOString() ?? null,
      nextAction: deriveNextAction({
        status: a.status,
        stages,
        lastInbound: inbound ? { at: inbound.receivedAt ?? inbound.createdAt, classification: inbound.classification, handled: !!inbound.handledAt } : null,
        lastOutboundAt: outbound.length ? new Date(Math.max(...outbound.map((d) => d.getTime()))) : null,
        lastActivityAt: a.lastActivityAt,
        now,
      }),
    }
  })
}
