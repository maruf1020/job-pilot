import { describe, expect, it } from 'vitest'
import { DEFAULT_MODEL_LIMITS, isDailyQuotaError, modelLimit, pacificDate, pacificDayStart } from './key-pool'

describe('key pool helpers', () => {
  it('tells daily quota errors from per-minute ones', () => {
    expect(isDailyQuotaError('Quota exceeded for metric: generate_content_free_tier_requests, limit: 20 ... GenerateRequestsPerDayPerProjectPerModel-FreeTier')).toBe(true)
    expect(isDailyQuotaError('Resource has been exhausted (e.g. check quota). GenerateRequestsPerMinutePerProjectPerModel')).toBe(false)
  })
  it('uses per-model limits with a default', () => {
    expect(modelLimit('gemini-3.8-flash', DEFAULT_MODEL_LIMITS)).toBe(20)
    expect(modelLimit('gemini-3.5-flash-lite', DEFAULT_MODEL_LIMITS)).toBe(1000)
    expect(modelLimit('gemini-9-ultra', DEFAULT_MODEL_LIMITS)).toBe(20)
  })
  it('computes the Pacific day boundary consistently', () => {
    const now = new Date('2026-09-29T10:00:00Z') // 03:00 Pacific (PDT)
    expect(pacificDate(now)).toBe('2026-09-29')
    const start = pacificDayStart(now)
    expect(start.toISOString()).toBe('2026-09-29T07:00:00.000Z')
    expect(pacificDate(new Date('2026-09-29T05:00:00Z'))).toBe('2026-09-28')
  })
})
