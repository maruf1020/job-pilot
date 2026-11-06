import { db } from '@/lib/db'
import { needsAction } from '@/lib/email/needs-action'
import { getSettings } from '@/lib/settings/service'

/**
 * Measures of the apply engine (plan-apply-all.md section 5): submissions per day, success per ATS
 * family and per lane, attempts wasted on reasons that have nothing to do with the form, how many
 * fit jobs were applied to within 7 days of being found, and a random sample of today's submissions
 * to spot-check.
 */

export const WASTE_CATEGORIES = [
  'captcha',
  'paused',
  'not-a-fit',
  'your-chrome',
  'worker',
  'network',
  'browser',
  'closed',
  'already-applied',
  'quota',
] as const
export type WasteCategory = (typeof WASTE_CATEGORIES)[number]

export const WASTE_LABEL: Record<WasteCategory, string> = {
  captcha: 'CAPTCHA',
  paused: 'Paused or held by you',
  'not-a-fit': 'Not a fit / not eligible',
  'your-chrome': 'Your Chrome (moved, not answering)',
  worker: 'Worker restarted or stuck',
  network: 'Network / DNS',
  browser: 'Browser closed',
  closed: 'Posting closed / no form',
  'already-applied': 'Already applied',
  quota: 'AI quota',
}

/** Order matters: "your chrome: not a software engineer" is a fit question, not a Chrome problem. */
const WASTE_RULES: Array<[WasteCategory, RegExp]> = [
  ['captcha', /captcha|verify you are human|turnstile|bot detection/i],
  ['paused', /paused|held because you|batch stopped|re-queued when you say/i],
  ['not-a-fit', /not a software engineer|not eligible|meet these requirements|knockout/i],
  ['already-applied', /already applied/i],
  ['quota', /quota/i],
  ['worker', /worker restarted|stuck for over/i],
  [
    'network',
    /err_name_not_resolved|err_connection|err_internet|err_network|timed_out|fetch failed|connectovercdp/i,
  ],
  ['browser', /browser has been closed|target page, context or browser|tabs can/i],
  ['your-chrome', /your chrome|not answering|did not allow the connection/i],
  ['closed', /closed or removed|no longer|posting looks closed|job-alert|talent.?community|expired/i],
]

/** Why an attempt that did not submit was spent on something other than the form itself, or null. */
export function wasteCategory(reason: string | null | undefined): WasteCategory | null {
  if (!reason) return null
  for (const [cat, re] of WASTE_RULES) if (re.test(reason)) return cat
  return null
}

const FAMILY_RE: Array<[string, RegExp]> = [
  ['greenhouse', /greenhouse\.io/],
  ['lever', /lever\.co/],
  ['ashby', /ashbyhq\.com/],
  ['workable', /workable\.com/],
  ['smartrecruiters', /smartrecruiters\.com/],
  ['recruitee', /recruitee\.com/],
  ['teamtailor', /teamtailor\.com/],
  ['personio', /personio\.(de|com)/],
  ['workday', /myworkday(jobs|site)\.com/],
  ['linkedin', /linkedin\.com/],
  ['join', /join\.com/],
  ['bamboohr', /bamboohr\.com/],
  ['jazzhr', /applytojob\.com|jazzhr\.com/],
  ['breezy', /breezy\.hr/],
  ['successfactors', /successfactors\.(eu|com)/],
  ['oracle', /oraclecloud\.com/],
  ['icims', /icims\.com/],
]

/** The ATS family of an attempt: the agent's own detection first, then the form or job URL. */
export function atsFamily(atsType: string | null | undefined, url: string | null | undefined): string {
  if (atsType) return atsType.toLowerCase()
  const u = (url ?? '').toLowerCase()
  for (const [family, re] of FAMILY_RE) if (re.test(u)) return family
  return 'other'
}

export interface AttemptLite {
  status: string
  atsType: string | null
  lane: string | null
  url: string | null
  reason: string | null
}

export interface RateRow {
  key: string
  attempts: number
  submitted: number
  needsHuman: number
  failed: number
  cancelled: number
  /** Submitted out of the attempts that ended submitted, needing you or failed (cancelled ones are counted as waste). */
  successPct: number | null
}

export function rateBy(rows: AttemptLite[], keyOf: (r: AttemptLite) => string): RateRow[] {
  const map = new Map<string, RateRow>()
  for (const r of rows) {
    const key = keyOf(r)
    const g = map.get(key) ?? {
      key,
      attempts: 0,
      submitted: 0,
      needsHuman: 0,
      failed: 0,
      cancelled: 0,
      successPct: null,
    }
    g.attempts++
    if (r.status === 'SUBMITTED') g.submitted++
    else if (r.status === 'NEEDS_HUMAN' || r.status === 'AWAITING_REVIEW') g.needsHuman++
    else if (r.status === 'FAILED') g.failed++
    else if (r.status === 'CANCELLED') g.cancelled++
    map.set(key, g)
  }
  return [...map.values()]
    .map((g) => {
      const decided = g.submitted + g.needsHuman + g.failed
      return { ...g, successPct: decided ? Math.round((g.submitted / decided) * 100) : null }
    })
    .sort((a, b) => b.attempts - a.attempts)
}

export interface WasteSummary {
  attempts: number
  wasted: number
  /** Share of all finished attempts, 0-100, or null when there were none. */
  share: number | null
  byCategory: Array<{ category: WasteCategory; label: string; count: number }>
}

export function wasteSummary(rows: AttemptLite[]): WasteSummary {
  const counts = new Map<WasteCategory, number>()
  let wasted = 0
  for (const r of rows) {
    if (r.status === 'SUBMITTED' || r.status === 'QUEUED' || r.status === 'RUNNING') continue
    const cat = wasteCategory(r.reason)
    if (!cat) continue
    wasted++
    counts.set(cat, (counts.get(cat) ?? 0) + 1)
  }
  const finished = rows.filter((r) => r.status !== 'QUEUED' && r.status !== 'RUNNING').length
  return {
    attempts: finished,
    wasted,
    share: finished ? Math.round((wasted / finished) * 100) : null,
    byCategory: [...counts.entries()]
      .map(([category, count]) => ({ category, label: WASTE_LABEL[category], count }))
      .sort((a, b) => b.count - a.count),
  }
}

export interface DaySubmissions {
  day: string
  email: number
  agent: number
  manual: number
}

/** Applications that went out per UTC day, by how: email, the browser agent, or you by hand. */
export function submissionsPerDay(
  apps: Array<{ sentAt: Date; submittedVia: string | null }>,
  days: number,
  now = new Date(),
): DaySubmissions[] {
  const out: DaySubmissions[] = []
  const index = new Map<string, DaySubmissions>()
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(today - i * 86_400_000).toISOString().slice(0, 10)
    const row = { day, email: 0, agent: 0, manual: 0 }
    out.push(row)
    index.set(day, row)
  }
  for (const a of apps) {
    const row = index.get(a.sentAt.toISOString().slice(0, 10))
    if (!row) continue
    if (a.submittedVia === 'agent') row.agent++
    else if (a.submittedVia === 'manual') row.manual++
    else row.email++
  }
  return out
}

export interface Coverage {
  fitJobs: number
  appliedWithin7d: number
  share: number | null
}

/** Of the fit jobs first seen 7 to 37 days ago (each had a full week), how many were applied to within 7 days. */
export function coverage7d(
  jobs: Array<{ firstSeenAt: Date; sentAt: Date | null }>,
  now = new Date(),
): Coverage {
  const from = now.getTime() - 37 * 86_400_000
  const to = now.getTime() - 7 * 86_400_000
  const cohort = jobs.filter((j) => j.firstSeenAt.getTime() >= from && j.firstSeenAt.getTime() <= to)
  const fast = cohort.filter(
    (j) => j.sentAt && j.sentAt.getTime() - j.firstSeenAt.getTime() <= 7 * 86_400_000,
  ).length
  return {
    fitJobs: cohort.length,
    appliedWithin7d: fast,
    share: cohort.length ? Math.round((fast / cohort.length) * 100) : null,
  }
}

/** n random items, without repeats (Fisher-Yates on a copy). */
export function pickSample<T>(rows: T[], n: number, rand: () => number = Math.random): T[] {
  const copy = [...rows]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, n)
}

const DAYS = 14

export async function loadApplyMeasures(now = new Date()) {
  const since = new Date(now.getTime() - DAYS * 86_400_000)
  const settings = await getSettings()
  const [attempts, sent, fit, actions] = await Promise.all([
    db.portalAttempt.findMany({
      where: { startedAt: { gte: since } },
      select: {
        status: true,
        atsType: true,
        lane: true,
        formUrl: true,
        startUrl: true,
        needsHumanReason: true,
        error: true,
        application: { select: { job: { select: { url: true } } } },
      },
    }),
    db.application.findMany({
      where: { sentAt: { gte: since } },
      select: { sentAt: true, submittedVia: true },
    }),
    db.job.findMany({
      where: {
        finalScore: { gte: settings.ranking.draftThreshold },
        firstSeenAt: {
          gte: new Date(now.getTime() - 37 * 86_400_000),
          lte: new Date(now.getTime() - 7 * 86_400_000),
        },
      },
      select: { firstSeenAt: true, application: { select: { sentAt: true } } },
    }),
    needsAction(now),
  ])
  const rows: AttemptLite[] = attempts.map((a) => ({
    status: a.status,
    atsType: a.atsType,
    lane: a.lane,
    url: a.formUrl ?? a.startUrl ?? a.application.job.url,
    reason: [a.needsHumanReason, a.error].filter(Boolean).join(' ') || null,
  }))
  const dayAgo = now.getTime() - 86_400_000
  return {
    days: DAYS,
    perDay: submissionsPerDay(
      sent.filter((s): s is { sentAt: Date; submittedVia: string | null } => s.sentAt !== null),
      DAYS,
      now,
    ),
    byFamily: rateBy(rows, (r) => atsFamily(r.atsType, r.url)),
    byLane: rateBy(rows, (r) => r.lane ?? 'before lanes'),
    waste: wasteSummary(rows),
    coverage: coverage7d(
      fit.map((j) => ({ firstSeenAt: j.firstSeenAt, sentAt: j.application?.sentAt ?? null })),
      now,
    ),
    repliesOver24h: actions.needsYou.filter((m) => new Date(m.receivedAt).getTime() < dayAgo).length,
    fitThreshold: settings.ranking.draftThreshold,
  }
}

export type ApplyMeasures = Awaited<ReturnType<typeof loadApplyMeasures>>

export interface SampleField {
  label: string
  value: string
  source: string | null
}

/** Ten random submissions of the last 24 hours, with the answers given, to spot-check. */
export async function loadTodaySample(now = new Date(), n = 10) {
  const rows = await db.portalAttempt.findMany({
    where: { status: 'SUBMITTED', finishedAt: { gte: new Date(now.getTime() - 86_400_000) } },
    orderBy: { finishedAt: 'desc' },
    take: 300,
    select: {
      id: true,
      atsType: true,
      formUrl: true,
      finishedAt: true,
      screenshots: true,
      fields: true,
      application: {
        select: {
          id: true,
          job: { select: { title: true, companyName: true, countryCode: true, url: true } },
        },
      },
    },
  })
  return {
    total: rows.length,
    items: pickSample(rows, n).map((r) => ({
      id: r.id,
      applicationId: r.application.id,
      title: r.application.job.title,
      company: r.application.job.companyName,
      countryCode: r.application.job.countryCode,
      family: atsFamily(r.atsType, r.formUrl ?? r.application.job.url),
      finishedAt: r.finishedAt,
      screenshots: r.screenshots.length,
      fields: sampleFields(r.fields),
    })),
  }
}

export type TodaySample = Awaited<ReturnType<typeof loadTodaySample>>

/** The answers as label: value pairs (files by name, long text shortened). */
export function sampleFields(raw: unknown): SampleField[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
    .map((f) => ({
      label: String(f.label ?? f.key ?? '').slice(0, 160),
      value: String(f.file ?? f.value ?? '').slice(0, 400),
      source: typeof f.source === 'string' ? f.source : null,
    }))
    .filter((f) => f.label || f.value)
}
