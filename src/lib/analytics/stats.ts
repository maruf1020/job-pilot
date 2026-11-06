import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings/service'
import { atsFamily } from './apply-engine'

/**
 * Application numbers for Today and Stats: submitted today, this week, this month and in total, in
 * the owner's own timezone (Settings → General), each against the same stretch of the period
 * before; per-day and per-week series by how it went out; the all-time funnel; replies by kind;
 * where applications went (country, email or ATS); where jobs came from; streaks and the best day.
 */

export type Via = 'agent' | 'manual' | 'email'
export const VIAS: Via[] = ['agent', 'email', 'manual']

export interface Split {
  total: number
  agent: number
  manual: number
  email: number
}

export interface DayRow extends Split {
  /** Local day, YYYY-MM-DD. */
  day: string
  found: number
  fit: number
}

export interface WeekRow extends Split {
  /** Monday of the week, YYYY-MM-DD. */
  week: string
}

export interface PeriodTile {
  key: 'today' | 'week' | 'month' | 'all'
  now: Split
  /** The same stretch of the period before (yesterday by this time, last week by now, ...); null for all time. */
  before: Split | null
}

const DAY_MS = 86_400_000

export function viaOf(submittedVia: string | null | undefined): Via {
  return submittedVia === 'agent' ? 'agent' : submittedVia === 'manual' ? 'manual' : 'email'
}

export function emptySplit(): Split {
  return { total: 0, agent: 0, manual: 0, email: 0 }
}

function add(s: Split, via: Via, n = 1): void {
  s[via] += n
  s.total += n
}

/** The local calendar day of an instant, YYYY-MM-DD. */
export function localDay(at: Date, tz: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

/** Day arithmetic on YYYY-MM-DD keys (calendar days, no timezone involved). */
export function shiftDay(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
}

/** Monday of the week the day belongs to. */
export function mondayOf(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay() // 0 = Sunday
  return shiftDay(day, -((dow + 6) % 7))
}

/** Minutes the timezone is ahead of UTC at that instant. */
function offsetMinutes(at: Date, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  )
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second))
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000)
}

/** The instant local midnight starts that day. */
export function startOfLocalDay(day: string, tz: string): Date {
  const guess = Date.parse(`${day}T00:00:00Z`)
  const first = guess - offsetMinutes(new Date(guess), tz) * 60_000
  // A second pass settles days where the offset changes around midnight (DST).
  return new Date(guess - offsetMinutes(new Date(first), tz) * 60_000)
}

/** The local day keys of the last n days, oldest first, ending today. */
export function lastDays(n: number, today: string): string[] {
  return Array.from({ length: n }, (_, i) => shiftDay(today, i - (n - 1)))
}

export interface Sent {
  sentAt: Date
  via: Via
}

/** Submissions per local day by how they went out. */
export function perDay(rows: Sent[], tz: string): Map<string, Split> {
  const map = new Map<string, Split>()
  for (const r of rows) {
    const key = localDay(r.sentAt, tz)
    const s = map.get(key) ?? emptySplit()
    add(s, r.via)
    map.set(key, s)
  }
  return map
}

/** Count the rows sent in [from, to). */
export function countBetween(rows: Sent[], from: Date, to: Date): Split {
  const s = emptySplit()
  const a = from.getTime()
  const b = to.getTime()
  for (const r of rows) {
    const t = r.sentAt.getTime()
    if (t >= a && t < b) add(s, r.via)
  }
  return s
}

/**
 * Today, this week (from Monday), this month and all time, each against the same stretch of the
 * period before up to the same moment: today until 10:30 against yesterday until 10:30, and so on.
 */
export function periodTiles(rows: Sent[], tz: string, now: Date): PeriodTile[] {
  const today = localDay(now, tz)
  const end = new Date(now.getTime() + 1)
  const dayStart = startOfLocalDay(today, tz)
  const weekStart = startOfLocalDay(mondayOf(today), tz)
  const monthFirst = `${today.slice(0, 7)}-01`
  const monthStart = startOfLocalDay(monthFirst, tz)
  const prevMonthFirst = `${shiftDay(monthFirst, -1).slice(0, 7)}-01`
  const prevMonthStart = startOfLocalDay(prevMonthFirst, tz)

  const sameStretch = (start: Date, prevStart: Date, cap: Date) => {
    const to = new Date(Math.min(prevStart.getTime() + (end.getTime() - start.getTime()), cap.getTime()))
    return countBetween(rows, prevStart, to)
  }

  const all = emptySplit()
  for (const r of rows) add(all, r.via)
  return [
    { key: 'today', now: countBetween(rows, dayStart, end), before: sameStretch(dayStart, startOfLocalDay(shiftDay(today, -1), tz), dayStart) },
    { key: 'week', now: countBetween(rows, weekStart, end), before: sameStretch(weekStart, startOfLocalDay(shiftDay(mondayOf(today), -7), tz), weekStart) },
    { key: 'month', now: countBetween(rows, monthStart, end), before: sameStretch(monthStart, prevMonthStart, monthStart) },
    { key: 'all', now: all, before: null },
  ]
}

/** Days in a row with at least one submission: the current run (today counts once it has one) and the best run. */
export function streaks(days: Map<string, Split>, today: string): { current: number; best: number } {
  let current = 0
  let d = days.get(today)?.total ? today : shiftDay(today, -1)
  while (days.get(d)?.total) {
    current++
    d = shiftDay(d, -1)
  }
  let best = 0
  let run = 0
  let prev: string | null = null
  for (const key of [...days.keys()].filter((k) => days.get(k)!.total > 0).sort()) {
    run = prev && shiftDay(prev, 1) === key ? run + 1 : 1
    best = Math.max(best, run)
    prev = key
  }
  return { current, best: Math.max(best, current) }
}

/** Per-week sums of the day rows, the last n weeks, oldest first. */
export function perWeek(days: Map<string, Split>, today: string, n: number): WeekRow[] {
  const thisMonday = mondayOf(today)
  const weeks = Array.from({ length: n }, (_, i) => shiftDay(thisMonday, (i - (n - 1)) * 7))
  return weeks.map((week) => {
    const s = emptySplit()
    for (let i = 0; i < 7; i++) {
      const d = days.get(shiftDay(week, i))
      if (d) for (const v of VIAS) add(s, v, d[v])
    }
    return { week, ...s }
  })
}

/** Top n by count, the rest folded into one "other" row (a 9th slice is never its own colour). */
export function topWithOther<T extends { key: string; count: number }>(rows: T[], n: number, other: Omit<T, 'count'>): T[] {
  const sorted = [...rows].sort((a, b) => b.count - a.count)
  if (sorted.length <= n) return sorted
  const rest = sorted.slice(n).reduce((sum, r) => sum + r.count, 0)
  return [...sorted.slice(0, n), { ...other, count: rest } as T]
}

/** Reply kinds in the order that matters most: next steps first, then answers, then machines. */
export const REPLY_KINDS = [
  { key: 'INTERVIEW_REQUEST', label: 'Interview request', person: true, nextStep: true },
  { key: 'POSITIVE', label: 'Positive', person: true, nextStep: true },
  { key: 'NEEDS_INFO', label: 'Needs more info', person: true, nextStep: true },
  { key: 'APPLY_VIA_PORTAL', label: 'Apply on their site', person: true, nextStep: false },
  { key: 'LOCATION_ISSUE', label: 'Location or visa issue', person: true, nextStep: false },
  { key: 'WRONG_RECIPIENT', label: 'Wrong person', person: true, nextStep: false },
  { key: 'REJECTION', label: 'Rejection', person: true, nextStep: false },
  { key: 'OTHER', label: 'Other reply', person: true, nextStep: false },
  { key: 'AUTO_REPLY', label: 'Auto-reply', person: false, nextStep: false },
  { key: 'BOUNCE', label: 'Bounced', person: false, nextStep: false },
] as const

const PERSON_KEYS: string[] = REPLY_KINDS.filter((k) => k.person).map((k) => k.key)
const NEXT_STEP_KEYS: string[] = REPLY_KINDS.filter((k) => k.nextStep).map((k) => k.key)

const HISTORY_DAYS = 182
const WEEKS = 16

export async function loadStats(now = new Date()) {
  const settings = await getSettings()
  const tz = settings.timezone || 'UTC'
  const threshold = settings.ranking.draftThreshold
  const today = localDay(now, tz)
  const historyStart = startOfLocalDay(shiftDay(today, -(HISTORY_DAYS - 1)), tz)

  const [sentApps, foundRows, replyRows, jobsTotal, jobsKept, jobsFit, interviews, offers, rejected, bySource] = await Promise.all([
    db.application.findMany({
      where: { sentAt: { not: null } },
      select: {
        sentAt: true,
        submittedVia: true,
        channel: true,
        job: { select: { countryCode: true, url: true } },
        attempts: { where: { status: 'SUBMITTED' }, orderBy: { finishedAt: 'desc' }, take: 1, select: { atsType: true, formUrl: true } },
      },
    }),
    db.$queryRaw<Array<{ day: string; found: number; fit: number }>>`
      SELECT to_char(("firstSeenAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS found,
             (COUNT(*) FILTER (WHERE "finalScore" >= ${threshold}))::int AS fit
      FROM "Job" WHERE "firstSeenAt" >= ${historyStart} GROUP BY 1`,
    db.emailMessage.findMany({
      where: { direction: 'INBOUND', classification: { not: null } },
      distinct: ['applicationId', 'classification'],
      select: { applicationId: true, classification: true },
    }),
    db.job.count(),
    db.job.count({ where: { status: { notIn: ['FILTERED', 'REJECTED_RULE'] } } }),
    db.job.count({ where: { finalScore: { gte: threshold } } }),
    db.application.count({ where: { status: { in: ['INTERVIEW', 'OFFER'] } } }),
    db.application.count({ where: { status: 'OFFER' } }),
    db.application.count({ where: { status: 'REJECTED' } }),
    db.jobSourceLink.groupBy({ by: ['source'], _count: { _all: true } }),
  ])

  const rows: Sent[] = sentApps.filter((a) => a.sentAt).map((a) => ({ sentAt: a.sentAt!, via: viaOf(a.submittedVia) }))
  const days = perDay(rows, tz)
  const found = new Map(foundRows.map((r) => [r.day, r]))
  const daily: DayRow[] = lastDays(HISTORY_DAYS, today).map((day) => ({
    day,
    ...(days.get(day) ?? emptySplit()),
    found: Number(found.get(day)?.found ?? 0),
    fit: Number(found.get(day)?.fit ?? 0),
  }))

  // Replies: one count per application and kind.
  const replyCounts = new Map<string, number>()
  const personApps = new Set<string>()
  const nextStepApps = new Set<string>()
  for (const r of replyRows) {
    const kind = r.classification ?? 'OTHER'
    replyCounts.set(kind, (replyCounts.get(kind) ?? 0) + 1)
    if (r.applicationId && PERSON_KEYS.includes(kind)) personApps.add(r.applicationId)
    if (r.applicationId && NEXT_STEP_KEYS.includes(kind)) nextStepApps.add(r.applicationId)
  }

  // Where applications went: the country, and the route (email or the ATS family of the form).
  const countryCounts = new Map<string, number>()
  const routeCounts = new Map<string, number>()
  for (const a of sentApps) {
    const cc = a.job.countryCode ?? 'unknown'
    countryCounts.set(cc, (countryCounts.get(cc) ?? 0) + 1)
    const route = a.channel === 'email' && a.submittedVia !== 'agent' && a.submittedVia !== 'manual' ? 'email' : atsFamily(a.attempts[0]?.atsType, a.attempts[0]?.formUrl ?? a.job.url)
    routeCounts.set(route, (routeCounts.get(route) ?? 0) + 1)
  }

  const activeLast7 = lastDays(7, today).map((d) => days.get(d)?.total ?? 0)
  let bestDay: { day: string; count: number } | null = null
  for (const [day, s] of days) if (!bestDay || s.total > bestDay.count) bestDay = { day, count: s.total }
  const firstSent = rows.reduce<Date | null>((m, r) => (!m || r.sentAt < m ? r.sentAt : m), null)

  return {
    timezone: tz,
    today,
    generatedAt: now.toISOString(),
    firstSentAt: firstSent?.toISOString() ?? null,
    tiles: periodTiles(rows, tz, now),
    daily,
    weekly: perWeek(days, today, WEEKS),
    highlights: {
      avgPerDay7: Math.round((activeLast7.reduce((a, b) => a + b, 0) / 7) * 10) / 10,
      bestDay,
      streak: streaks(days, today),
      foundToday: daily.at(-1)?.found ?? 0,
      fitToday: daily.at(-1)?.fit ?? 0,
      personReplies: personApps.size,
      nextSteps: nextStepApps.size,
      interviews,
      offers,
      rejected,
      replyRate: rows.length ? Math.round((personApps.size / rows.length) * 1000) / 10 : null,
      nextStepRate: rows.length ? Math.round((nextStepApps.size / rows.length) * 1000) / 10 : null,
    },
    funnel: [
      { key: 'found', label: 'Jobs found', count: jobsTotal },
      { key: 'kept', label: 'Passed your rules', count: jobsKept },
      { key: 'fit', label: `Fit (score ${threshold}+)`, count: jobsFit },
      { key: 'applied', label: 'Applied', count: rows.length },
      { key: 'replied', label: 'A person replied', count: personApps.size },
      { key: 'nextStep', label: 'Next step offered', count: nextStepApps.size },
    ],
    replies: REPLY_KINDS.map((k) => ({ key: k.key, label: k.label, person: k.person, nextStep: k.nextStep, count: replyCounts.get(k.key) ?? 0 })),
    byCountry: topWithOther(
      [...countryCounts].map(([key, count]) => ({ key, count })),
      9,
      { key: 'other' },
    ),
    byRoute: topWithOther(
      [...routeCounts].map(([key, count]) => ({ key, count })),
      9,
      { key: 'rest' },
    ),
    bySource: topWithOther(
      bySource.map((r) => ({ key: r.source, count: r._count._all })),
      9,
      { key: 'other' },
    ),
    fitThreshold: threshold,
  }
}

export type StatsPayload = Awaited<ReturnType<typeof loadStats>>
