import { db } from '@/lib/db'
import { STANDARD_ENTRIES } from '@/lib/apply/answer-bank'
import { kindFromReason } from '@/lib/apply/hosts'
import { hostOf } from '@/lib/apply/match'

/**
 * The "Needs you" queue (plan-apply-all.md 7.3 and 11): what only you can do, in one place.
 * CAPTCHA forms, sites that need a sign-in or an account, questions nobody can answer
 * truthfully but you, and forms the agent filled or left for your help.
 */

const CAPTCHA_RE = /captcha|verify you are human|turnstile/i
const WALL_KINDS = new Set(['needs-account', 'sign-in-wall'])
const IMPORTANT_STD = new Set(STANDARD_ENTRIES.filter((e) => e.important).map((e) => e.key as string))
/** Attempts older than this are not brought back; the jobs are probably gone. */
const LOOKBACK_DAYS = 45

export interface QueueAttempt {
  attemptId: string
  applicationId: string
  status: string
  reason: string | null
  /** Gemini's reading of where the form stopped (category, blocker, field, fixHint), when there is one. */
  diagnosis?: unknown
  host: string
  atsType: string | null
  finishedAt: Date | null
  startedAt: Date
  screenshots: number
  hasTab: boolean
  /** The user pressed Open with AI and that run is queued or working in their Chrome (the row stays, marked). */
  opening?: 'QUEUED' | 'RUNNING' | null
  job: {
    id: string
    title: string
    companyName: string
    countryCode: string | null
    finalScore: number | null
    url: string
  }
}

export interface WallHost {
  host: string
  kind: string
  loggedIn: boolean
  skipUntil: Date | null
  attempts: number
  submitted: number
  /** Applications waiting behind this wall right now. */
  waiting: number
  examples: Array<{ applicationId: string; title: string; companyName: string }>
  lastReason: string | null
}

export interface QueueQuestion {
  id: string
  question: string
  kind: string
  options: string[]
  timesSeen: number
  lastCompany: string | null
}

/** Choice labels worth showing: radios read as "on" and empty labels say nothing. */
export function usableOptions(options: string[]): string[] {
  return [...new Set(options.map((o) => o.trim()).filter((o) => o && !/^(on|off)$/i.test(o)))]
}

export type QueueCategory = 'captcha' | 'wall' | 'waiting' | null

/** Which queue section an application's latest attempt belongs to. */
export function categorize(a: { status: string; reason: string | null }): QueueCategory {
  if (!['NEEDS_HUMAN', 'AWAITING_REVIEW', 'CANCELLED', 'FAILED'].includes(a.status)) return null
  if (a.reason && CAPTCHA_RE.test(a.reason)) return 'captcha'
  const kind = kindFromReason(a.reason)
  if (kind && WALL_KINDS.has(kind)) return a.status === 'AWAITING_REVIEW' ? 'waiting' : 'wall'
  if (a.status === 'NEEDS_HUMAN' || a.status === 'AWAITING_REVIEW') return 'waiting'
  return null
}

/** Keep the newest attempt per application (rows must come newest first). */
export function latestPerApplication<T extends { applicationId: string }>(rows: T[]): T[] {
  const seen = new Set<string>()
  return rows.filter((r) => !seen.has(r.applicationId) && !!seen.add(r.applicationId))
}

/**
 * Like latestPerApplication, but a run the user started with Open with AI (no batch) that is still queued or working
 * does not hide the job: the row keeps the attempt before it, marked as opening.
 */
export function latestForQueue<T extends { applicationId: string; status: string; batchId: string | null; error?: string | null }>(rows: T[]): Array<T & { opening: 'QUEUED' | 'RUNNING' | null }> {
  const out: Array<T & { opening: 'QUEUED' | 'RUNNING' | null }> = []
  const opening = new Map<string, 'QUEUED' | 'RUNNING'>()
  const done = new Set<string>()
  for (const r of rows) {
    if (done.has(r.applicationId)) continue
    // A worker restart that cancelled a waiting run says nothing about the job: the attempt before it counts.
    if (r.status === 'CANCELLED' && r.error?.startsWith('Worker restarted')) continue
    if (!r.batchId && (r.status === 'QUEUED' || r.status === 'RUNNING') && !opening.has(r.applicationId)) {
      opening.set(r.applicationId, r.status)
      continue
    }
    done.add(r.applicationId)
    out.push({ ...r, opening: opening.get(r.applicationId) ?? null })
  }
  return out
}

/** Merge the host table with hosts seen behind sign-in or account walls in recent attempts. */
export function mergeWalls(
  profiles: Array<{
    host: string
    kind: string
    loggedIn: boolean
    skipUntil: Date | null
    attempts: number
    submitted: number
    lastReason: string | null
  }>,
  walled: QueueAttempt[],
): WallHost[] {
  const byHost = new Map<string, WallHost>()
  for (const p of profiles) {
    if (!WALL_KINDS.has(p.kind)) continue
    byHost.set(p.host, { ...p, waiting: 0, examples: [] })
  }
  for (const a of walled) {
    if (!a.host) continue
    const profile = profiles.find((p) => p.host === a.host)
    const w = byHost.get(a.host) ?? {
      host: a.host,
      kind: kindFromReason(a.reason) ?? 'sign-in-wall',
      loggedIn: profile?.loggedIn ?? false,
      skipUntil: profile?.skipUntil ?? null,
      attempts: profile?.attempts ?? 0,
      submitted: profile?.submitted ?? 0,
      lastReason: a.reason,
      waiting: 0,
      examples: [],
    }
    w.waiting++
    if (w.examples.length < 3)
      w.examples.push({ applicationId: a.applicationId, title: a.job.title, companyName: a.job.companyName })
    byHost.set(a.host, w)
  }
  return [...byHost.values()].sort((a, b) => b.waiting - a.waiting || b.attempts - a.attempts)
}

export async function loadNeedsYouQueue(now = new Date()) {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000)
  const [rows, profiles, questions] = await Promise.all([
    db.portalAttempt.findMany({
      where: {
        startedAt: { gte: since },
        application: { sentAt: null, status: { notIn: ['SKIPPED', 'SENT', 'REJECTED', 'NO_RESPONSE'] } },
      },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        applicationId: true,
        status: true,
        atsType: true,
        host: true,
        startUrl: true,
        formUrl: true,
        finalUrl: true,
        tabId: true,
        batchId: true,
        screenshots: true,
        needsHumanReason: true,
        error: true,
        diagnosis: true,
        startedAt: true,
        finishedAt: true,
        application: {
          select: {
            job: {
              select: {
                id: true,
                title: true,
                companyName: true,
                countryCode: true,
                finalScore: true,
                url: true,
              },
            },
          },
        },
      },
    }),
    db.hostProfile.findMany({
      select: {
        host: true,
        kind: true,
        loggedIn: true,
        skipUntil: true,
        attempts: true,
        submitted: true,
        lastReason: true,
      },
    }),
    db.answerBank.findMany({
      where: { answer: null },
      orderBy: [{ timesSeen: 'desc' }, { lastSeenAt: 'desc' }],
      select: {
        id: true,
        key: true,
        question: true,
        kind: true,
        options: true,
        timesSeen: true,
        lastCompany: true,
      },
    }),
  ])
  const latest: QueueAttempt[] = latestForQueue(rows).map((r) => ({
    attemptId: r.id,
    applicationId: r.applicationId,
    status: r.status,
    reason: r.needsHumanReason ?? r.error,
    diagnosis: r.diagnosis ?? null,
    host: r.host ?? hostOf(r.formUrl ?? r.finalUrl ?? r.startUrl ?? r.application.job.url),
    atsType: r.atsType,
    finishedAt: r.finishedAt,
    startedAt: r.startedAt,
    screenshots: r.screenshots.length,
    hasTab: !!r.tabId,
    opening: r.opening,
    job: r.application.job,
  }))
  const captcha: QueueAttempt[] = []
  const walled: QueueAttempt[] = []
  const waiting: QueueAttempt[] = []
  for (const a of latest) {
    const c = categorize(a)
    if (c === 'captcha') captcha.push(a)
    else if (c === 'wall') walled.push(a)
    else if (c === 'waiting') waiting.push(a)
  }
  const walls = mergeWalls(profiles, walled)
  // Standard details only count when a form asked for them or the agent needs them to apply at all.
  const open: QueueQuestion[] = questions
    .filter((q) => !q.key.startsWith('std:') || IMPORTANT_STD.has(q.key) || q.timesSeen > 0)
    // A field without a label cannot be answered from here; it is a scanner problem, not a question.
    .filter((q) => !/^unnamed field$/i.test(q.question.trim()))
    .map((q) => ({ id: q.id, question: q.question, kind: q.kind, options: usableOptions(q.options), timesSeen: q.timesSeen, lastCompany: q.lastCompany }))
  const waitingWalls = walls.filter((w) => w.waiting > 0).length
  return {
    captcha,
    walls,
    questions: open,
    waiting,
    counts: {
      captcha: captcha.length,
      walls: waitingWalls,
      questions: open.length,
      waiting: waiting.length,
      total: captcha.length + waitingWalls + open.length + waiting.length,
    },
  }
}

export type NeedsYouQueue = Awaited<ReturnType<typeof loadNeedsYouQueue>>
