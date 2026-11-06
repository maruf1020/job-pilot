import { z } from 'zod'
import type { Prisma, PrismaClient } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { getTimezone, periodLabel, PERIODS, periodStart, type Period } from './tz'

/**
 * Read-only analytics: a whitelist of typed metric functions over Prisma. The model (or the /ask command)
 * only ever picks a metric NAME and validated parameters; there is no SQL and nothing here can write:
 * the database handle is typed to the four read methods and the tests run every metric against a handle
 * that throws on anything else.
 */

type Reads<T extends { count: unknown; findMany: unknown; groupBy: unknown; aggregate: unknown }> = Pick<T, 'count' | 'findMany' | 'groupBy' | 'aggregate'>
export interface ReadDb {
  application: Reads<PrismaClient['application']>
  job: Reads<PrismaClient['job']>
  emailMessage: Reads<PrismaClient['emailMessage']>
  company: Reads<PrismaClient['company']>
  searchRun: Reads<PrismaClient['searchRun']>
}

export interface MetricResult {
  /** The answer in one line, numbers first. */
  headline: string
  /** Extra lines (a breakdown, a list). */
  lines: string[]
}

const period = z.enum(PERIODS)
const topN = z.coerce.number().int().min(1).max(15)

const CHANNELS = ['all', 'email', 'browser', 'ats', 'portal'] as const
const STATUSES = ['sent', 'replied', 'interview', 'rejected', 'needs_human', 'queued', 'draft', 'review', 'held', 'any'] as const

const NOT_REAL_REPLY = ['BOUNCE', 'AUTO_REPLY']

function channelWhere(channel: (typeof CHANNELS)[number]): Prisma.ApplicationWhereInput {
  switch (channel) {
    case 'email':
      // `NOT: { portalStatus: 'SUBMITTED' }` would also drop every row whose portalStatus is NULL, i.e. all emails (SQL NULL logic).
      return { channel: 'email', OR: [{ portalStatus: null }, { portalStatus: { not: 'SUBMITTED' } }] }
    case 'browser':
      return { OR: [{ channel: { in: ['ats', 'portal'] } }, { portalStatus: 'SUBMITTED' }] }
    case 'ats':
      return { channel: 'ats' }
    case 'portal':
      return { channel: 'portal' }
    default:
      return {}
  }
}

const HELD_NOTES = ['block list', 'blocklist', 'bounce', 'guess', 'stack', 'cooldown', 'already sent', 'already applied']

function statusWhere(status: (typeof STATUSES)[number], from: Date | null): Prisma.ApplicationWhereInput {
  const active = from ? { lastActivityAt: { gte: from } } : {}
  switch (status) {
    case 'sent':
      return { sentAt: from ? { gte: from } : { not: null } }
    case 'replied':
      return { status: 'REPLIED', ...active }
    case 'interview':
      return { status: 'INTERVIEW', ...active }
    case 'rejected':
      return { status: 'REJECTED', ...active }
    case 'needs_human':
      return { OR: [{ status: 'NEEDS_HUMAN' }, { portalStatus: 'NEEDS_HUMAN' }], ...active }
    case 'queued':
      return { status: { in: ['QUEUED', 'APPROVED'] } }
    case 'draft':
      return { status: 'DRAFT', ...active }
    case 'review':
      return { status: 'REVIEW', ...active }
    case 'held':
      return { status: 'REVIEW', OR: HELD_NOTES.map((n) => ({ notes: { contains: n, mode: 'insensitive' as const } })), ...active }
    case 'any':
      return from ? { createdAt: { gte: from } } : {}
  }
}

export type AppChannel = (typeof CHANNELS)[number]
export type AppStatus = (typeof STATUSES)[number]

/** Count of applications by period, channel and status (the applications_count metric, also used by /stats and /status). */
export async function countApplications(d: Pick<ReadDb, 'application'>, o: { period: Period; channel: AppChannel; status: AppStatus }, now: Date, tz: string): Promise<number> {
  return d.application.count({ where: { AND: [channelWhere(o.channel), statusWhere(o.status, periodStart(o.period, now, tz))] } })
}

const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : 'n/a')
const num = (n: number) => n.toLocaleString('en-US')

export interface MetricDef<S extends z.ZodType = z.ZodType> {
  name: string
  /** One line for the prompt and /metrics. */
  description: string
  /** Parameters with their allowed values, for the prompt. */
  params: string
  /** Example questions, shown by /metrics. */
  examples: string[]
  schema: S
  /** `tz` is Settings.timezone: "today" is the person's own day. */
  run: (db: ReadDb, params: z.infer<S>, now: Date, tz: string) => Promise<MetricResult>
}

function metric<S extends z.ZodType>(def: MetricDef<S>): MetricDef {
  return def as unknown as MetricDef
}

const METRIC_LIST: MetricDef[] = [
  metric({
    name: 'applications_count',
    description: 'Applications by period, channel and status. "sent" counts by send time; other statuses count applications now in that status whose last activity is in the period; "queued" is the queue right now.',
    params: `period=${PERIODS.join('|')} (default today); channel=${CHANNELS.join('|')} (browser = ats + portal forms); status=${STATUSES.join('|')} (default sent)`,
    examples: ['how many applied today', 'applications sent this week by email', 'how many need a human', 'how many are queued'],
    schema: z.strictObject({ period: period.default('today'), channel: z.enum(CHANNELS).default('all'), status: z.enum(STATUSES).default('sent') }),
    async run(d, p, now, tz) {
      const n = await countApplications(d, p, now, tz)
      const when = p.status === 'queued' ? 'right now' : periodLabel(p.period, tz)
      const via = p.channel === 'all' ? '' : ` via ${p.channel}`
      return { headline: `${num(n)} application${n === 1 ? '' : 's'} ${p.status}${via}, ${when}`, lines: [] }
    },
  }),
  metric({
    name: 'jobs_found',
    description: 'Jobs found by the searches (first seen in the period), in total, by country or by source.',
    params: `period=${PERIODS.join('|')} (default all); by=total|country|source (default total); n=1-15 top rows (default 5)`,
    examples: ['how many jobs found in total', 'new jobs this week by country', 'which sources found the most jobs'],
    schema: z.strictObject({ period: period.default('all'), by: z.enum(['total', 'country', 'source']).default('total'), n: topN.default(5) }),
    async run(d, p, now, tz) {
      const from = periodStart(p.period, now, tz)
      const where: Prisma.JobWhereInput = from ? { firstSeenAt: { gte: from } } : {}
      const total = await d.job.count({ where })
      const head = `${num(total)} jobs found, ${periodLabel(p.period, tz)}`
      if (p.by === 'total') return { headline: head, lines: [] }
      const field = p.by === 'country' ? 'countryCode' : 'primarySource'
      const rows = (await d.job.groupBy({ by: [field], where, _count: { _all: true }, orderBy: { _count: { id: 'desc' } }, take: p.n } as never)) as unknown as Array<Record<string, unknown> & { _count: { _all: number } }>
      return { headline: head, lines: rows.map((r) => `${String(r[field] ?? 'unknown')}: ${num(r._count._all)}`) }
    },
  }),
  metric({
    name: 'score_stats',
    description: 'Job score statistics: average, how many reach a minimum score, the distribution in buckets, or the top N jobs.',
    params: 'kind=average|count_gte|distribution|top (default average); minScore=0-100 (default 60, for count_gte); n=1-10 (default 5, for top); period=today|24h|7d|30d|all by first seen (default all)',
    examples: ['what is the average score', 'how many jobs score 70 or more', 'top 5 scores', 'score distribution'],
    schema: z.strictObject({ kind: z.enum(['average', 'count_gte', 'distribution', 'top']).default('average'), minScore: z.coerce.number().int().min(0).max(100).default(60), n: z.coerce.number().int().min(1).max(10).default(5), period: period.default('all') }),
    async run(d, p, now, tz) {
      const from = periodStart(p.period, now, tz)
      const base: Prisma.JobWhereInput = { finalScore: { not: null }, ...(from ? { firstSeenAt: { gte: from } } : {}) }
      const when = periodLabel(p.period, tz)
      if (p.kind === 'average') {
        const a = await d.job.aggregate({ where: base, _avg: { finalScore: true }, _count: { _all: true } })
        return { headline: `Average score ${a._avg.finalScore?.toFixed(1) ?? 'n/a'} over ${num(a._count._all)} scored jobs, ${when}`, lines: [] }
      }
      if (p.kind === 'count_gte') {
        const n = await d.job.count({ where: { ...base, finalScore: { gte: p.minScore } } })
        return { headline: `${num(n)} jobs with score ${p.minScore} or more, ${when}`, lines: [] }
      }
      if (p.kind === 'distribution') {
        const edges = [0, 40, 50, 60, 70, 80, 101]
        const counts = await Promise.all(edges.slice(0, -1).map((lo, i) => d.job.count({ where: { ...base, finalScore: { gte: lo, lt: edges[i + 1] } } })))
        const total = counts.reduce((a, b) => a + b, 0)
        return { headline: `${num(total)} scored jobs, ${when}`, lines: counts.map((c, i) => `${edges[i]}${i === counts.length - 1 ? '+' : `-${edges[i + 1] - 1}`}: ${num(c)}`) }
      }
      const top = await d.job.findMany({ where: base, orderBy: [{ finalScore: 'desc' }, { id: 'asc' }], take: p.n, select: { companyName: true, title: true, finalScore: true } })
      return { headline: `Top ${top.length} scores, ${when}`, lines: top.map((j, i) => `${i + 1}. ${j.finalScore} - ${j.companyName}: ${j.title}`) }
    },
  }),
  metric({
    name: 'emails',
    description: 'Emails: sent, bounced, queued now, applications that got a reply, or the reply rate of applications sent in the period.',
    params: `kind=sent|bounced|queued|replied|reply_rate (default sent); period=${PERIODS.join('|')} (default today)`,
    examples: ['how many emails sent this week', 'how many bounced', 'what is the reply rate'],
    schema: z.strictObject({ kind: z.enum(['sent', 'bounced', 'queued', 'replied', 'reply_rate']).default('sent'), period: period.default('today') }),
    async run(d, p, now, tz) {
      const from = periodStart(p.period, now, tz)
      const since = from ? { createdAt: { gte: from } } : {}
      const when = periodLabel(p.period, tz)
      if (p.kind === 'sent') {
        const n = await d.emailMessage.count({ where: { direction: 'OUTBOUND', ...since } })
        return { headline: `${num(n)} emails sent, ${when}`, lines: [] }
      }
      if (p.kind === 'bounced') {
        const [n, out] = await Promise.all([d.emailMessage.count({ where: { direction: 'INBOUND', classification: 'BOUNCE', ...since } }), d.emailMessage.count({ where: { direction: 'OUTBOUND', ...since } })])
        return { headline: `${num(n)} bounces, ${when}`, lines: [`${pct(n, out)} of ${num(out)} emails sent in the same period`] }
      }
      if (p.kind === 'queued') {
        const n = await d.application.count({ where: { status: { in: ['QUEUED', 'APPROVED'] }, channel: 'email', sentAt: null } })
        return { headline: `${num(n)} emails queued right now`, lines: [] }
      }
      if (p.kind === 'replied') {
        const rows = await d.emailMessage.findMany({ where: { direction: 'INBOUND', classification: { notIn: NOT_REAL_REPLY }, ...since }, select: { applicationId: true }, distinct: ['applicationId'] })
        return { headline: `${num(rows.length)} applications got a reply, ${when}`, lines: [] }
      }
      const sentWhere: Prisma.ApplicationWhereInput = { channel: 'email', sentAt: from ? { gte: from } : { not: null } }
      const [sent, replied] = await Promise.all([d.application.count({ where: sentWhere }), d.application.count({ where: { ...sentWhere, messages: { some: { direction: 'INBOUND', classification: { notIn: NOT_REAL_REPLY } } } } })])
      return { headline: `Reply rate ${pct(replied, sent)} (${num(replied)} of ${num(sent)} emails sent, ${when})`, lines: [] }
    },
  }),
  metric({
    name: 'replies',
    description: 'Replies from companies by type (interview requests, positive, questions, rejections, location, apply on their site).',
    params: `classification=any|interview|positive|needs_info|rejection|location|apply_portal (default any); period=${PERIODS.join('|')} (default 7d)`,
    examples: ['how many interview requests', 'how many rejections this month', 'replies this week'],
    schema: z.strictObject({ classification: z.enum(['any', 'interview', 'positive', 'needs_info', 'rejection', 'location', 'apply_portal']).default('any'), period: period.default('7d') }),
    async run(d, p, now, tz) {
      const from = periodStart(p.period, now, tz)
      const map: Record<string, string> = { interview: 'INTERVIEW_REQUEST', positive: 'POSITIVE', needs_info: 'NEEDS_INFO', rejection: 'REJECTION', location: 'LOCATION_ISSUE', apply_portal: 'APPLY_VIA_PORTAL' }
      const cls = p.classification === 'any' ? { notIn: NOT_REAL_REPLY } : map[p.classification]
      const n = await d.emailMessage.count({ where: { direction: 'INBOUND', classification: cls, ...(from ? { createdAt: { gte: from } } : {}) } })
      return { headline: `${num(n)} ${p.classification === 'any' ? '' : `${p.classification} `}repl${n === 1 ? 'y' : 'ies'}, ${periodLabel(p.period, tz)}`.replace('  ', ' '), lines: [] }
    },
  }),
  metric({
    name: 'companies_replied',
    description: 'Which companies replied (names), most recent first.',
    params: `period=${PERIODS.join('|')} (default 30d); n=1-15 (default 10)`,
    examples: ['which companies replied', 'who answered this week'],
    schema: z.strictObject({ period: period.default('30d'), n: topN.default(10) }),
    async run(d, p, now, tz) {
      const from = periodStart(p.period, now, tz)
      const rows = await d.emailMessage.findMany({
        where: { direction: 'INBOUND', classification: { notIn: NOT_REAL_REPLY }, ...(from ? { createdAt: { gte: from } } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 300,
        select: { application: { select: { job: { select: { companyName: true } } } } },
      })
      const names = [...new Set(rows.map((r) => r.application.job.companyName))]
      return { headline: `${num(names.length)} companies replied, ${periodLabel(p.period, tz)}`, lines: names.slice(0, p.n).map((n, i) => `${i + 1}. ${n}`) }
    },
  }),
  metric({
    name: 'companies_count',
    description: 'How many companies are known: all, with an application, blacklisted, known visa sponsors.',
    params: 'kind=total|with_applications|blacklisted|known_sponsors (default total)',
    examples: ['how many companies', 'how many known sponsors'],
    schema: z.strictObject({ kind: z.enum(['total', 'with_applications', 'blacklisted', 'known_sponsors']).default('total') }),
    async run(d, p) {
      const where: Prisma.CompanyWhereInput = p.kind === 'with_applications' ? { jobs: { some: { application: { isNot: null } } } } : p.kind === 'blacklisted' ? { blacklisted: true } : p.kind === 'known_sponsors' ? { knownSponsor: true } : {}
      const n = await d.company.count({ where })
      return { headline: `${num(n)} companies (${p.kind.replace('_', ' ')})`, lines: [] }
    },
  }),
  metric({
    name: 'searches_run',
    description: 'Search runs in the period with their results.',
    params: `period=${PERIODS.join('|')} (default today)`,
    examples: ['how many searches ran today', 'new jobs from searches this week'],
    schema: z.strictObject({ period: period.default('today') }),
    async run(d, p, now, tz) {
      const from = periodStart(p.period, now, tz)
      const rows = (await d.searchRun.groupBy({ by: ['status'], where: from ? { startedAt: { gte: from } } : {}, _count: { _all: true }, _sum: { totalNew: true } } as never)) as unknown as Array<{ status: string; _count: { _all: number }; _sum: { totalNew: number | null } }>
      const total = rows.reduce((a, r) => a + r._count._all, 0)
      const fresh = rows.reduce((a, r) => a + (r._sum.totalNew ?? 0), 0)
      return { headline: `${num(total)} search runs, ${periodLabel(p.period, tz)}; ${num(fresh)} new jobs`, lines: rows.map((r) => `${r.status}: ${r._count._all}`) }
    },
  }),
  metric({
    name: 'gemini_usage',
    description: 'Gemini usage today: calls, errors and requests left.',
    params: 'none',
    examples: ['how much Gemini did we use today', 'gemini quota left'],
    schema: z.strictObject({}),
    async run() {
      const { getAiUsageSummary } = await import('@/lib/ai/usage')
      const u = await getAiUsageSummary()
      return { headline: `${num(u.totalCalls)} AI calls today, ${num(u.totalErrors)} errors`, lines: [`Provider: ${u.provider}`, `Left today: ${num(u.liteRemaining)} lite, ${num(u.primaryRemaining)} primary`] }
    },
  }),
]

export const METRICS: ReadonlyMap<string, MetricDef> = new Map(METRIC_LIST.map((m) => [m.name, m]))
export const METRIC_NAMES: string[] = METRIC_LIST.map((m) => m.name)

export interface MetricCall {
  metric: string
  params: Record<string, unknown>
}

export type ParsedMetricCall = { ok: true; def: MetricDef; params: unknown } | { ok: false; error: string }

/** Validates a metric name and its parameters. Empty values (null, "") count as "not given". */
export function parseMetricCall(name: string, raw: Record<string, unknown> | undefined): ParsedMetricCall {
  const def = METRICS.get(name)
  if (!def) return { ok: false, error: `Unknown metric "${name.slice(0, 40)}"` }
  const cleaned = Object.fromEntries(Object.entries(raw ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== ''))
  const parsed = def.schema.safeParse(cleaned)
  if (!parsed.success) return { ok: false, error: `Bad parameters for ${name}: ${parsed.error.issues[0]?.message ?? 'invalid'}` }
  return { ok: true, def, params: parsed.data }
}

export type MetricRun = { ok: true; name: string; result: MetricResult } | { ok: false; name: string; error: string }

/** Runs validated metric calls (read-only). Stops at the first invalid call. `tz` defaults to Settings.timezone. */
export async function runMetricCalls(calls: MetricCall[], reader: ReadDb = db, now = new Date(), tz?: string): Promise<MetricRun[]> {
  const parsed = calls.map((c) => ({ c, p: parseMetricCall(c.metric, c.params) }))
  const bad = parsed.find((x) => !x.p.ok)
  if (bad && !bad.p.ok) return [{ ok: false, name: bad.c.metric, error: bad.p.error }]
  const zone = tz ?? (await getTimezone())
  const out: MetricRun[] = []
  for (const { c, p } of parsed) {
    if (!p.ok) continue
    try {
      out.push({ ok: true, name: c.metric, result: await p.def.run(reader, p.params as never, now, zone) })
    } catch (err) {
      out.push({ ok: false, name: c.metric, error: err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : 'failed' })
    }
  }
  return out
}

/** Deterministic text for metric results: the headline first (numbers first), then the lines. */
export function formatMetricRuns(runs: MetricRun[]): string {
  return runs
    .map((r) => (r.ok ? [`**${r.result.headline}**`, ...r.result.lines].join('\n') : `${r.name}: ${r.error}`))
    .join('\n\n')
}

/** The metric catalog as the model sees it. */
export function metricCatalogText(): string {
  return METRIC_LIST.map((m) => `- ${m.name}: ${m.description} Params: ${m.params}.`).join('\n')
}

/** Example questions for /metrics. */
export function metricExamples(): Array<{ metric: string; description: string; examples: string[] }> {
  return METRIC_LIST.map((m) => ({ metric: m.name, description: m.description.split('. ')[0], examples: m.examples }))
}

/** The example questions that share the most words with the text (the "closest questions" fallback). */
export function closestQuestions(text: string, count = 3): string[] {
  const words = new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2),
  )
  const all = METRIC_LIST.flatMap((m) => m.examples)
  const scored = all.map((q) => ({ q, score: [...words].filter((w) => q.includes(w)).length }))
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, count).map((s) => s.q)
}
