import { describe, expect, it } from 'vitest'
import {
  bumpAtsCount,
  bumpMethod,
  companiesPerMinute,
  emptyMethodCounts,
  estimateRun,
  etaMs,
  formatEta,
  formatRunEstimate,
  formatSpeed,
  isWorkerSilent,
  normalizeBoardMode,
  progressPct,
  readAtsCounts,
  readMethodCounts,
} from './board-progress'

describe('progressPct', () => {
  it('rounds and clamps', () => {
    expect(progressPct(0, 100)).toBe(0)
    expect(progressPct(1, 3)).toBe(33)
    expect(progressPct(150, 150)).toBe(100)
    expect(progressPct(200, 150)).toBe(100)
  })
  it('is 0 with an unknown total', () => {
    expect(progressPct(5, 0)).toBe(0)
  })
})

describe('speed and ETA', () => {
  const start = new Date('2026-11-05T10:00:00Z')
  it('is unknown in the first seconds or before any company finished', () => {
    expect(companiesPerMinute(3, start, new Date('2026-11-05T10:00:03Z'))).toBeNull()
    expect(companiesPerMinute(0, start, new Date('2026-11-05T10:01:00Z'))).toBeNull()
  })
  it('companies per minute from the run start', () => {
    expect(companiesPerMinute(60, start, new Date('2026-11-05T10:02:00Z'))).toBeCloseTo(30)
    expect(companiesPerMinute(10, start.toISOString(), new Date('2026-11-05T10:00:30Z').getTime())).toBeCloseTo(20)
  })
  it('ETA is what is left at the current speed', () => {
    expect(etaMs(60, 360, 30)).toBe(10 * 60_000)
    expect(etaMs(10, 100, null)).toBeNull()
    expect(etaMs(10, 0, 30)).toBeNull()
    expect(etaMs(100, 100, 30)).toBe(0)
  })
  it('formats the ETA and the speed', () => {
    expect(formatEta(null)).toBe('calculating')
    expect(formatEta(0)).toBe('done')
    expect(formatEta(20_000)).toBe('under a minute')
    expect(formatEta(5 * 60_000)).toBe('about 5 min')
    expect(formatEta(80 * 60_000)).toBe('about 1 h 20 min')
    expect(formatEta(120 * 60_000)).toBe('about 2 h')
    expect(formatSpeed(null)).toBe('measuring')
    expect(formatSpeed(72.4)).toBe('72 per min')
    expect(formatSpeed(4.25)).toBe('4.3 per min')
  })
})

describe('run estimate', () => {
  it('is 10 to 40 requests and 20 to 60 companies a minute', () => {
    const e = estimateRun(600)
    expect(e.requests).toEqual({ min: 6000, max: 24_000 })
    expect(e.minutes.min).toBeCloseTo(10)
    expect(e.minutes.max).toBeCloseTo(30)
    expect(estimateRun(-5).requests).toEqual({ min: 0, max: 0 })
  })
  it('reads well for a long run', () => {
    expect(formatRunEstimate(22_000)).toBe('220,000 to 880,000 requests, roughly 6.1 h to 18 h')
    expect(formatRunEstimate(60)).toBe('600 to 2,400 requests, roughly 1 min to 3 min')
  })
})

describe('per-ATS and per-method counters', () => {
  it('bumps without mutating', () => {
    const a = { greenhouse: 2 }
    const b = bumpAtsCount(a, 'lever')
    expect(a).toEqual({ greenhouse: 2 })
    expect(bumpAtsCount(b, 'greenhouse')).toEqual({ greenhouse: 3, lever: 1 })
  })
  it('reads the stored Json defensively', () => {
    expect(readAtsCounts({ greenhouse: 3, lever: 0, ashby: 'x', workable: 2.7 })).toEqual({ greenhouse: 3, workable: 2 })
    expect(readAtsCounts(null)).toEqual({})
    expect(readAtsCounts([1, 2])).toEqual({})
  })
  it('counts boards found and saved per method', () => {
    const empty = emptyMethodCounts()
    const a = bumpMethod(empty, 'slug', true)
    const b = bumpMethod(a, 'slug', false)
    const c = bumpMethod(b, 'careers', true)
    expect(empty.slug).toEqual({ found: 0, saved: 0 })
    expect(c).toEqual({ slug: { found: 2, saved: 1 }, careers: { found: 1, saved: 1 }, gemini: { found: 0, saved: 0 } })
  })
  it('reads stored method counts defensively', () => {
    expect(readMethodCounts(null)).toEqual(emptyMethodCounts())
    expect(readMethodCounts({ slug: { found: 3, saved: 1 }, gemini: 'x', careers: { found: -2, saved: 'a' } })).toEqual({
      slug: { found: 3, saved: 1 },
      careers: { found: 0, saved: 0 },
      gemini: { found: 0, saved: 0 },
    })
  })
})

describe('modes and heartbeat', () => {
  it('accepts the old scope names', () => {
    expect(normalizeBoardMode('failing')).toBe('repair')
    expect(normalizeBoardMode('find')).toBe('find')
    expect(normalizeBoardMode('everything')).toBeNull()
  })
  it('flags a silent worker after 30 seconds', () => {
    const t = new Date('2026-11-05T10:00:00Z')
    expect(isWorkerSilent(t, new Date('2026-11-05T10:00:20Z'))).toBe(false)
    expect(isWorkerSilent(t, new Date('2026-11-05T10:00:45Z'))).toBe(true)
  })
})
