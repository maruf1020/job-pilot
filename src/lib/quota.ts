import { pacificDate } from '@/lib/ai/key-pool'
import { db } from '@/lib/db'

/**
 * Hard daily caps for third-party APIs, enforced in the database so every process
 * (web, worker, scripts) shares one counter.
 */

/** Google Programmable Search free tier: 100 queries a day, resetting at midnight Pacific. */
export const GOOGLE_CSE_DAILY_LIMIT = 100

export type QuotaProvider = 'google_cse'

const LIMITS: Record<QuotaProvider, number> = { google_cse: GOOGLE_CSE_DAILY_LIMIT }

function dayFor(provider: QuotaProvider): string {
  return provider === 'google_cse' ? pacificDate() : new Date().toISOString().slice(0, 10)
}

/**
 * Reserve one call. Returns false (and reserves nothing) when the day's cap is reached.
 * Atomic: the increment only happens while `used` is below the limit.
 */
export async function reserveApiCall(provider: QuotaProvider): Promise<boolean> {
  const limit = LIMITS[provider]
  const day = dayFor(provider)
  await db.apiQuota.upsert({ where: { provider_day: { provider, day } }, update: {}, create: { provider, day, used: 0 } })
  const r = await db.apiQuota.updateMany({ where: { provider, day, used: { lt: limit } }, data: { used: { increment: 1 } } })
  return r.count === 1
}

export async function apiQuotaUsage(provider: QuotaProvider): Promise<{ used: number; limit: number; day: string }> {
  const day = dayFor(provider)
  const row = await db.apiQuota.findUnique({ where: { provider_day: { provider, day } }, select: { used: true } })
  return { used: row?.used ?? 0, limit: LIMITS[provider], day }
}
