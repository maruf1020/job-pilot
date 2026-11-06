import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings/service'
import type { AiConfig } from '@/lib/settings/schema'
import { estimateCostUsd } from './adapters/anthropic'
import { isDailyQuotaError } from './adapters/gemini'
import { isKeyDown, isModelExhausted, keyDailyCap, keyModelLimit, keyPoolStatus, loadPool, pacificDate, quotaDate, quotaDayStart, UNLIMITED, usageToday, type PooledKey } from './key-pool'
import { providerOrCustom } from './providers'
import { modelChain, type Tier } from './router'

type Limits = Pick<AiConfig, 'modelDailyLimits' | 'defaultDailyCallCap' | 'fallbackModels'>

function finite(n: number): number {
  return Number.isFinite(n) ? Math.max(0, n) : UNLIMITED
}

/** Models a key walks for a tier (its own model, then the provider's fallbacks), as the router does. */
function chainFor(k: PooledKey, tier: Tier, ai: Limits): string[] {
  return modelChain(k, { tier, images: false, webSearch: false }, ai.fallbackModels)
}

/**
 * Requests this key can still make today on any of `models`: the smaller of what is left under its
 * daily cap and what is left of the per-model free limits (0 when the key was rejected today).
 */
export async function keyRemaining(k: PooledKey, models: string[], ai: Limits): Promise<number> {
  if (isKeyDown(k.id, k.provider)) return 0
  const capLeft = keyDailyCap(k, ai) - k.usedToday
  let modelsLeft = 0
  for (const m of [...new Set(models)]) {
    if (isModelExhausted(k.id, m, k.provider)) continue
    const limit = keyModelLimit(k, m, ai)
    modelsLeft += Number.isFinite(limit) ? Math.max(0, limit - (await usageToday(k.id, m, k.provider))) : Number.POSITIVE_INFINITY
  }
  return finite(Math.min(capLeft, modelsLeft))
}

/** Today's AI usage summary for the dashboard quota widget and the run budget (all providers). */
export async function getAiUsageSummary() {
  const settings = await getSettings()
  const ai = settings.ai
  const [keys, pool] = await Promise.all([keyPoolStatus(ai), loadPool()])
  const providers = [...new Set(pool.map((k) => k.provider))]
  // The longest current quota day among the providers in use (UTC starts before Pacific).
  const starts = (providers.length ? providers : ['gemini']).map((p) => quotaDayStart(p).getTime())
  const startOfDay = new Date(Math.min(...starts))
  const [byTask, byModel, totals, errors, costRows] = await Promise.all([
    db.aiUsage.groupBy({ by: ['task'], where: { createdAt: { gte: startOfDay } }, _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true } }),
    db.aiUsage.groupBy({ by: ['model', 'keyId'], where: { createdAt: { gte: startOfDay } }, _count: { _all: true } }),
    db.aiUsage.aggregate({ where: { createdAt: { gte: startOfDay } }, _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true } }),
    db.aiUsage.count({ where: { createdAt: { gte: startOfDay }, ok: false } }),
    db.aiUsage.groupBy({ by: ['model'], where: { createdAt: { gte: startOfDay } }, _sum: { inputTokens: true, outputTokens: true } }),
  ])
  // The same chains the router walks: a lite request falls back to the provider's other lite models, so their
  // quota counts too (counting only the configured lite model once showed "lite left 0" with thousands left).
  let primaryRemaining = 0
  let liteRemaining = 0
  let remainingDaily = 0
  const byProvider = new Map<string, { provider: string; label: string; keys: number; primaryRemaining: number; liteRemaining: number }>()
  for (const k of pool) {
    const primary = chainFor(k, 'primary', ai)
    const lite = chainFor(k, 'lite', ai)
    const p = await keyRemaining(k, primary, ai)
    const l = await keyRemaining(k, lite, ai)
    const all = await keyRemaining(k, [...primary, ...lite], ai)
    primaryRemaining += p
    liteRemaining += l
    remainingDaily += all
    const row = byProvider.get(k.provider) ?? { provider: k.provider, label: providerOrCustom(k.provider).label, keys: 0, primaryRemaining: 0, liteRemaining: 0 }
    row.keys++
    row.primaryRemaining += p
    row.liteRemaining += l
    byProvider.set(k.provider, row)
  }
  const costUsd = costRows.reduce((a, t) => a + estimateCostUsd(t.model, t._sum.inputTokens ?? 0, t._sum.outputTokens ?? 0), 0)
  return {
    date: pool[0] ? quotaDate(pool[0].provider) : pacificDate(),
    /** Short description of what serves AI calls, e.g. "3 keys: gemini, anthropic". */
    provider: pool.length ? `${pool.length} key${pool.length === 1 ? '' : 's'}: ${providers.join(', ')}` : 'no AI key',
    /** Rough spend today in USD where prices are known (cache reads counted at full price, so an upper bound). */
    costUsd: Math.round(costUsd * 100) / 100,
    byProvider: [...byProvider.values()],
    keys,
    totalCalls: totals._count._all,
    totalErrors: errors,
    inputTokens: totals._sum.inputTokens ?? 0,
    outputTokens: totals._sum.outputTokens ?? 0,
    byTask: byTask.map((t) => ({ task: t.task, calls: t._count._all, inputTokens: t._sum.inputTokens ?? 0, outputTokens: t._sum.outputTokens ?? 0 })),
    byModel: byModel.map((m) => {
      const k = pool.find((x) => x.id === m.keyId)
      return { model: m.model, keyId: m.keyId, calls: m._count._all, limit: k ? finite(keyModelLimit(k, m.model, ai)) : UNLIMITED }
    }),
    /** Remaining primary-class (drafting/judging) requests today across keys and fallback models. */
    primaryRemaining,
    /** Remaining lite (enrich/rank/classify) requests today. */
    liteRemaining,
    /** Total remaining across both classes (a capped key counts once). */
    remainingDaily,
  }
}

/**
 * Per key: tokens used today and in the last 7/30/365 days, and the requests left today on each of
 * its models. Free tiers cap requests per model per day (tokens only per minute), so "left" is in requests.
 */
export async function getKeyUsage() {
  const settings = await getSettings()
  const ai = settings.ai
  const [keys, pool] = await Promise.all([keyPoolStatus(ai), loadPool()])
  const weekAgo = new Date(Date.now() - 7 * 86_400_000)
  const monthAgo = new Date(Date.now() - 30 * 86_400_000)
  const yearAgo = new Date(Date.now() - 365 * 86_400_000)
  const earliestDay = new Date(Math.min(...[...new Set(keys.map((k) => k.provider)), 'gemini'].map((p) => quotaDayStart(p).getTime())))
  const perKeySince = (since: Date) => db.aiUsage.groupBy({ by: ['keyId'], where: { createdAt: { gte: since } }, _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true } })
  const [todayRows, weekRows, monthRows, yearRows] = await Promise.all([
    db.aiUsage.findMany({ where: { createdAt: { gte: earliestDay } }, select: { keyId: true, model: true, ok: true, error: true, inputTokens: true, outputTokens: true, createdAt: true } }),
    perKeySince(weekAgo),
    perKeySince(monthAgo),
    perKeySince(yearAgo),
  ])
  const tokensOf = (r: { _sum: { inputTokens: number | null; outputTokens: number | null } } | undefined) => (r?._sum.inputTokens ?? 0) + (r?._sum.outputTokens ?? 0)
  const allModels = new Set<string>()
  const out = []
  for (const k of keys) {
    const pooled = pool.find((x) => x.id === k.id)
    const dayStart = quotaDayStart(k.provider)
    const rows = todayRows.filter((r) => r.keyId === k.id && r.createdAt >= dayStart)
    const models = pooled ? [...new Set([...chainFor(pooled, 'primary', ai), ...chainFor(pooled, 'lite', ai)])] : [...new Set(rows.map((r) => r.model))]
    for (const m of models) allModels.add(m)
    const inputTokens = rows.reduce((a, r) => a + r.inputTokens, 0)
    const outputTokens = rows.reduce((a, r) => a + r.outputTokens, 0)
    const week = weekRows.find((r) => r.keyId === k.id)
    const modelRows = models.map((m) => {
      const used = rows.filter((r) => r.model === m).length
      const limit = pooled ? finite(keyModelLimit(pooled, m, ai)) : 0
      // The API said "per day" for this key and model today: nothing left until the provider's reset.
      const exhausted = (pooled ? isModelExhausted(pooled.id, m, pooled.provider) : false) || rows.some((r) => r.model === m && !r.ok && isDailyQuotaError(r.error ?? ''))
      return { model: m, used, limit, left: exhausted ? 0 : Math.max(0, limit - used), exhausted }
    })
    const left = pooled && k.enabled ? await keyRemaining(pooled, models, ai) : 0
    out.push({
      id: k.id,
      label: k.label,
      provider: k.provider,
      providerLabel: k.providerLabel,
      keyHint: k.keyHint,
      enabled: k.enabled,
      cooldownUntil: k.cooldownUntil,
      lastError: k.lastError,
      lastUsedAt: k.lastUsedAt,
      calls: rows.length,
      errors: rows.filter((r) => !r.ok).length,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      weekTokens: tokensOf(week),
      weekCalls: week?._count._all ?? 0,
      monthTokens: tokensOf(monthRows.find((r) => r.keyId === k.id)),
      monthCalls: monthRows.find((r) => r.keyId === k.id)?._count._all ?? 0,
      yearTokens: tokensOf(yearRows.find((r) => r.keyId === k.id)),
      yearCalls: yearRows.find((r) => r.keyId === k.id)?._count._all ?? 0,
      /** Requests left today on this key (its cap and per-model limits together). */
      left,
      /** Requests per day this key can make. */
      limit: k.rpdLimit,
      models: modelRows,
    })
  }
  return { date: pacificDate(), models: [...allModels], keys: out }
}
