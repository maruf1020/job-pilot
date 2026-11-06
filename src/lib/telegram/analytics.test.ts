import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { closestQuestions, METRIC_NAMES, METRICS, parseMetricCall, runMetricCalls, type ReadDb } from './analytics'
import { localDayStart, localStamp, periodLabel, periodStart } from './tz'

vi.mock('@/lib/ai/usage', () => ({ getAiUsageSummary: async () => ({ totalCalls: 5, totalErrors: 1, provider: 'gemini', liteRemaining: 100, primaryRemaining: 50 }) }))

const READ_METHODS = new Set(['count', 'findMany', 'groupBy', 'aggregate'])

/** A database handle that answers reads and throws on anything else: proves no metric writes. */
function readOnlyDb(): { db: ReadDb; calls: string[] } {
  const calls: string[] = []
  const delegate = (model: string) =>
    new Proxy(
      {},
      {
        get(_t, method: string) {
          if (!READ_METHODS.has(method)) throw new Error(`write or unknown call reached: ${model}.${method}`)
          return async (args: { by?: string[] }) => {
            calls.push(`${model}.${method}`)
            if (method === 'count') return 7
            if (method === 'aggregate') return { _avg: { finalScore: 62.5 }, _count: { _all: 10 } }
            if (method === 'groupBy') return [{ [args?.by?.[0] ?? 'status']: 'X', _count: { _all: 3 }, _sum: { totalNew: 4 } }]
            return [{ applicationId: 'a', companyName: 'Acme', title: 'Dev', finalScore: 90, application: { job: { companyName: 'Acme' } } }]
          }
        },
      },
    )
  const db = { application: delegate('application'), job: delegate('job'), emailMessage: delegate('emailMessage'), company: delegate('company'), searchRun: delegate('searchRun') } as unknown as ReadDb
  return { db, calls }
}

describe('local-day period boundaries (Settings.timezone)', () => {
  // A fixed zone with a fixed offset (UTC+6, no daylight saving) keeps the expected instants stable.
  const TZ = 'Asia/Bishkek'
  it('starts "today" at local midnight, not UTC midnight', () => {
    // 2026-11-05 03:00 UTC is 09:00 local, same day: day starts 2026-11-04 18:00 UTC.
    expect(localDayStart(new Date('2026-11-05T03:00:00Z'), TZ).toISOString()).toBe('2026-11-04T18:00:00.000Z')
    // 2026-11-04 19:00 UTC is already 01:00 on 5 Nov locally: the day started one hour earlier.
    expect(localDayStart(new Date('2026-11-04T19:00:00Z'), TZ).toISOString()).toBe('2026-11-04T18:00:00.000Z')
    // Exactly at local midnight a new day starts; one millisecond before still belongs to the old one.
    expect(localDayStart(new Date('2026-11-04T18:00:00.000Z'), TZ).toISOString()).toBe('2026-11-04T18:00:00.000Z')
    expect(localDayStart(new Date('2026-11-04T17:59:59.999Z'), TZ).toISOString()).toBe('2026-11-03T18:00:00.000Z')
  })
  it('follows daylight saving and falls back to UTC for an unknown zone', () => {
    // Lisbon is UTC+1 in summer and UTC+0 in winter.
    expect(localDayStart(new Date('2026-07-01T12:00:00Z'), 'Europe/Lisbon').toISOString()).toBe('2026-06-30T23:00:00.000Z')
    expect(localDayStart(new Date('2026-12-01T12:00:00Z'), 'Europe/Lisbon').toISOString()).toBe('2026-12-01T00:00:00.000Z')
    expect(localDayStart(new Date('2026-12-01T12:00:00Z'), 'Not/AZone').toISOString()).toBe('2026-12-01T00:00:00.000Z')
    expect(periodLabel('today', 'Europe/Lisbon')).toBe('today (Lisbon)')
    expect(localStamp(new Date('2026-07-01T12:00:00Z'), 'Europe/Lisbon')).toBe('2026-07-01 13:00')
  })
  it('computes the rolling periods and "all"', () => {
    const now = new Date('2026-11-05T12:00:00Z')
    expect(periodStart('24h', now, TZ)!.toISOString()).toBe('2026-11-04T12:00:00.000Z')
    expect(periodStart('7d', now, TZ)!.toISOString()).toBe('2026-10-29T12:00:00.000Z')
    expect(periodStart('30d', now, TZ)!.toISOString()).toBe('2026-10-06T12:00:00.000Z')
    expect(periodStart('all', now, TZ)).toBeNull()
    expect(periodStart('today', now, TZ)!.toISOString()).toBe('2026-11-04T18:00:00.000Z')
  })
})

describe('metric parameter validation', () => {
  it('applies defaults and accepts valid values', () => {
    const r = parseMetricCall('applications_count', { period: '7d', channel: 'browser', status: 'needs_human' })
    expect(r).toMatchObject({ ok: true, params: { period: '7d', channel: 'browser', status: 'needs_human' } })
    expect(parseMetricCall('applications_count', {})).toMatchObject({ ok: true, params: { period: 'today', channel: 'all', status: 'sent' } })
    expect(parseMetricCall('score_stats', { kind: 'top', n: '5' })).toMatchObject({ ok: true, params: { kind: 'top', n: 5 } })
  })

  it('treats null and empty values as not given', () => {
    expect(parseMetricCall('emails', { kind: 'bounced', period: '', n: null })).toMatchObject({ ok: true, params: { kind: 'bounced', period: 'today' } })
  })

  it('rejects bad values, out of range numbers and unknown parameters', () => {
    expect(parseMetricCall('applications_count', { period: 'yesterday' }).ok).toBe(false)
    expect(parseMetricCall('applications_count', { channel: 'fax' }).ok).toBe(false)
    expect(parseMetricCall('score_stats', { kind: 'top', n: 500 }).ok).toBe(false)
    expect(parseMetricCall('score_stats', { minScore: 101 }).ok).toBe(false)
    expect(parseMetricCall('applications_count', { sql: 'drop table "Job"' }).ok).toBe(false)
  })

  it('rejects an unknown metric and runs nothing', async () => {
    expect(parseMetricCall('drop_everything', {})).toEqual({ ok: false, error: expect.stringContaining('Unknown metric') })
    const { db, calls } = readOnlyDb()
    const runs = await runMetricCalls([{ metric: 'applications_count', params: {} }, { metric: 'nope', params: {} }], db)
    expect(runs).toEqual([{ ok: false, name: 'nope', error: expect.stringContaining('Unknown metric') }])
    expect(calls).toEqual([])
  })
})

describe('metrics are read-only', () => {
  it('runs every metric against a handle that throws on any non-read call', async () => {
    const { db } = readOnlyDb()
    const calls = METRIC_NAMES.map((metric) => ({ metric, params: {} }))
    const runs = await runMetricCalls(calls, db, new Date('2026-11-05T12:00:00Z'), 'Europe/Lisbon')
    expect(runs).toHaveLength(METRIC_NAMES.length)
    for (const r of runs) expect(r, JSON.stringify(r)).toMatchObject({ ok: true })
    // exercise the other branches too
    const more = await runMetricCalls(
      [
        { metric: 'jobs_found', params: { by: 'country' } },
        { metric: 'jobs_found', params: { by: 'source', period: '7d' } },
        { metric: 'score_stats', params: { kind: 'top' } },
        { metric: 'score_stats', params: { kind: 'distribution' } },
        { metric: 'score_stats', params: { kind: 'count_gte', minScore: 70 } },
        { metric: 'emails', params: { kind: 'reply_rate', period: '7d' } },
        { metric: 'emails', params: { kind: 'replied' } },
        { metric: 'emails', params: { kind: 'queued' } },
        { metric: 'companies_count', params: { kind: 'with_applications' } },
        { metric: 'applications_count', params: { status: 'held', channel: 'ats' } },
      ],
      db,
      new Date(),
      'Europe/Lisbon',
    )
    for (const r of more) expect(r, JSON.stringify(r)).toMatchObject({ ok: true })
  })

  it('keeps the module free of any write API or raw SQL', () => {
    const source = fs.readFileSync(path.resolve(__dirname, 'analytics.ts'), 'utf8')
    expect(source).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/)
    expect(source).not.toMatch(/\$(executeRaw|queryRaw|transaction)/)
    expect(METRICS.size).toBe(METRIC_NAMES.length)
  })

  it('finds the closest example questions for the fallback', () => {
    expect(closestQuestions('how many bounced emails', 3)[0]).toMatch(/bounce|email/)
    expect(closestQuestions('zzz', 3)).toHaveLength(3)
  })
})
