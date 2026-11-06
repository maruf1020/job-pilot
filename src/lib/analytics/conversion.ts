import { db } from '@/lib/db'
import { needsAction } from '@/lib/email/needs-action'
import { recentBounceRate } from '@/lib/email/suppression'
import { regionBucket } from '@/lib/regions'
import { sentByOf, type Experiment } from './experiment'

/**
 * The genuine-reply scoreboard (plan-big.md 1.7). Redirects ("apply on our site", "wrong
 * person") used to look like replies, so only interview, positive and needs-info replies from a
 * person count. Rates use sends at least 7 days old; groups with fewer than 50 delivered
 * applications say "too early" instead of a rate.
 */

export const MATURE_DAYS = 7
export const MIN_GROUP = 50

const GENUINE = new Set(['INTERVIEW_REQUEST', 'POSITIVE', 'NEEDS_INFO'])
const REDIRECT = new Set(['APPLY_VIA_PORTAL', 'WRONG_RECIPIENT'])
const DEMO_RE = /@[^\s>]+\.(example|invalid|test)\b/i

export const DIMENSIONS = ['channel', 'region', 'country', 'addressSource', 'scoreBand', 'month', 'sentBy', 'promptVersion'] as const
export type Dimension = (typeof DIMENSIONS)[number]

export interface SendRow {
  id: string
  sentAt: Date
  submittedVia: string | null
  status: string
  /** The latest send bounced and nothing has been delivered since (bounce rotation clears sentAt). */
  undelivered: boolean
  countryCode: string | null
  addressSource: string | null
  score: number | null
  firstSeenAt: Date
  /** Classes of the inbound messages on this application. */
  classes: string[]
  experiment: Experiment | null
  batchId: string | null
  autoRetry: boolean
}

export interface Outcome {
  delivered: boolean
  bounced: boolean
  genuine: boolean
  redirect: boolean
  rejection: boolean
  interview: boolean
}

export function outcomeOf(r: Pick<SendRow, 'classes' | 'status' | 'undelivered'>): Outcome {
  const genuine = r.classes.some((c) => GENUINE.has(c)) || r.status === 'INTERVIEW' || r.status === 'OFFER'
  const redirect = !genuine && r.classes.some((c) => REDIRECT.has(c))
  const rejection = r.classes.includes('REJECTION') || r.status === 'REJECTED'
  // A person answering means the email arrived, even if an earlier address bounced.
  const heardBack = genuine || redirect || rejection
  const bounced = r.undelivered && !heardBack
  return { delivered: !bounced, bounced, genuine, redirect, rejection, interview: r.classes.includes('INTERVIEW_REQUEST') || r.status === 'INTERVIEW' || r.status === 'OFFER' }
}

export function channelOf(r: Pick<SendRow, 'submittedVia'>): 'email' | 'form' {
  return r.submittedVia === 'agent' || r.submittedVia === 'manual' ? 'form' : 'email'
}

export function scoreBand(score: number | null): string {
  if (score === null) return 'no score'
  if (score >= 80) return '80+'
  if (score >= 70) return '70-79'
  if (score >= 60) return '60-69'
  return 'under 60'
}

function keyOf(r: SendRow, dim: Dimension): string {
  switch (dim) {
    case 'channel':
      return channelOf(r)
    case 'region':
      return regionBucket(r.countryCode)
    case 'country':
      return r.countryCode ?? 'unknown'
    case 'addressSource':
      return channelOf(r) === 'form' ? 'form' : (r.addressSource ?? 'unknown')
    case 'scoreBand':
      return scoreBand(r.score)
    case 'month':
      return r.sentAt.toISOString().slice(0, 7)
    case 'sentBy':
      return r.experiment?.sentBy ?? sentByOf(r)
    case 'promptVersion':
      return r.experiment?.promptVersion ?? 'before tracking'
  }
}

export interface GroupStats {
  key: string
  sent: number
  delivered: number
  bounced: number
  genuine: number
  redirects: number
  rejections: number
  interviews: number
  /** Genuine replies per 100 delivered, or null while the group is too small to judge. */
  rate: number | null
  tooEarly: boolean
}

function emptyGroup(key: string): GroupStats {
  return { key, sent: 0, delivered: 0, bounced: 0, genuine: 0, redirects: 0, rejections: 0, interviews: 0, rate: null, tooEarly: true }
}

function add(g: GroupStats, o: Outcome) {
  g.sent++
  if (o.delivered) g.delivered++
  if (o.bounced) g.bounced++
  if (o.genuine) g.genuine++
  if (o.redirect) g.redirects++
  if (o.rejection) g.rejections++
  if (o.interview) g.interviews++
}

function finish(g: GroupStats): GroupStats {
  g.tooEarly = g.delivered < MIN_GROUP
  g.rate = g.tooEarly || !g.delivered ? null : Math.round((g.genuine / g.delivered) * 1000) / 10
  return g
}

export interface Scoreboard {
  matureBefore: string
  /** Sends at least 7 days old: the ones the rates use. */
  overall: GroupStats
  /** Sends younger than 7 days: not judged yet. */
  pending: number
  groups: Record<Dimension, GroupStats[]>
  measures: {
    genuineRate: { email: GroupStats; form: GroupStats }
    interviews: number
    formApplications: number
    /** Share (0-100) of the last 30 days' applications sent within 7 days of the job being found. */
    appliedWithin7d: number | null
    appliedWithin7dOf: number
  }
}

export function computeScoreboard(rows: SendRow[], now = new Date()): Scoreboard {
  const matureBefore = new Date(now.getTime() - MATURE_DAYS * 86_400_000)
  const mature = rows.filter((r) => r.sentAt <= matureBefore)
  const overall = emptyGroup('all')
  const groups = Object.fromEntries(DIMENSIONS.map((d) => [d, new Map<string, GroupStats>()])) as Record<Dimension, Map<string, GroupStats>>
  for (const r of mature) {
    const o = outcomeOf(r)
    add(overall, o)
    for (const dim of DIMENSIONS) {
      const k = keyOf(r, dim)
      const g = groups[dim].get(k) ?? emptyGroup(k)
      add(g, o)
      groups[dim].set(k, g)
    }
  }
  const sorted = (dim: Dimension) => {
    const list = [...groups[dim].values()].map(finish)
    return dim === 'month' ? list.sort((a, b) => b.key.localeCompare(a.key)) : list.sort((a, b) => b.sent - a.sent)
  }
  const byChannel = (c: 'email' | 'form') => groups.channel.get(c) ?? emptyGroup(c)

  const monthAgo = new Date(now.getTime() - 30 * 86_400_000)
  const recent = rows.filter((r) => r.sentAt >= monthAgo)
  const fresh = recent.filter((r) => r.sentAt.getTime() - r.firstSeenAt.getTime() <= 7 * 86_400_000).length

  return {
    matureBefore: matureBefore.toISOString(),
    overall: finish(overall),
    pending: rows.length - mature.length,
    groups: Object.fromEntries(DIMENSIONS.map((d) => [d, sorted(d)])) as Record<Dimension, GroupStats[]>,
    measures: {
      genuineRate: { email: finish(byChannel('email')), form: finish(byChannel('form')) },
      interviews: rows.filter((r) => outcomeOf(r).interview).length,
      formApplications: rows.filter((r) => channelOf(r) === 'form').length,
      appliedWithin7d: recent.length ? Math.round((fresh / recent.length) * 100) : null,
      appliedWithin7dOf: recent.length,
    },
  }
}

/**
 * Every real application that went out (email or form), with what came back. Demo data excluded.
 * A bounce with no address left clears sentAt, so the first outbound email dates those.
 */
export async function loadSendRows(): Promise<SendRow[]> {
  const apps = await db.application.findMany({
    where: { OR: [{ sentAt: { not: null } }, { messages: { some: { direction: 'OUTBOUND' } } }] },
    select: {
      id: true,
      sentAt: true,
      submittedVia: true,
      status: true,
      bounceCount: true,
      toEmail: true,
      batchId: true,
      autoRetry: true,
      experiment: true,
      job: { select: { countryCode: true, contactEmailSource: true, finalScore: true, firstSeenAt: true, url: true } },
      messages: { orderBy: { createdAt: 'asc' }, select: { direction: true, classification: true, sentAt: true, createdAt: true } },
      drafts: { where: { kind: 'initial', isSelected: true }, select: { promptVersion: true, generatedBy: true }, take: 1 },
    },
  })
  return apps
    .filter((a) => a.sentAt || a.messages.some((m) => m.direction === 'OUTBOUND'))
    .filter((a) => !DEMO_RE.test(a.toEmail ?? '') && !/\.(example|invalid|test)\//i.test(a.job.url))
    .map((a) => ({
      id: a.id,
      sentAt: a.sentAt ?? firstOutbound(a.messages),
      submittedVia: a.submittedVia,
      status: a.status,
      undelivered: a.sentAt === null && a.bounceCount > 0,
      countryCode: a.job.countryCode,
      addressSource: a.job.contactEmailSource,
      score: a.job.finalScore,
      firstSeenAt: a.job.firstSeenAt,
      classes: a.messages.filter((m) => m.direction === 'INBOUND').map((m) => m.classification).filter((c): c is string => !!c),
      // Sends from before the experiment field: the selected draft still knows its prompt version.
      experiment: (a.experiment as Experiment | null) ?? (a.drafts[0] ? { promptVersion: a.drafts[0].promptVersion, model: a.drafts[0].generatedBy } : null),
      batchId: a.batchId,
      autoRetry: a.autoRetry,
    }))
}

function firstOutbound(messages: Array<{ direction: string; sentAt: Date | null; createdAt: Date }>): Date {
  const m = messages.find((x) => x.direction === 'OUTBOUND')
  return m?.sentAt ?? m?.createdAt ?? new Date(0)
}

export async function loadScoreboard(now = new Date()) {
  const [rows, bounce, actions] = await Promise.all([loadSendRows(), recentBounceRate(7), needsAction(now)])
  const board = computeScoreboard(rows, now)
  const dayAgo = now.getTime() - 86_400_000
  return {
    ...board,
    measures: {
      ...board.measures,
      bounceRate7d: { sent: bounce.sent, bounced: bounce.bounced, rate: Math.round(bounce.rate * 1000) / 10 },
      repliesWaitingOver24h: actions.needsYou.filter((m) => new Date(m.receivedAt).getTime() < dayAgo).length,
    },
  }
}

export type ScoreboardPayload = Awaited<ReturnType<typeof loadScoreboard>>

