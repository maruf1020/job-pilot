import { AsyncLocalStorage } from 'node:async_hooks'
import { decryptSecret } from '@/lib/crypto'
import { db } from '@/lib/db'
import type { AiConfig } from '@/lib/settings/schema'
import { providerOrCustom, resolveCapabilities, type ProviderCapabilities } from './providers'

export { isDailyQuotaError } from './adapters/gemini'

/**
 * The pool of AI keys (any provider) stored encrypted in `AiKey`.
 *
 * Free tiers are limited per key AND per model (Gemini: about 20 requests/day on the Flash
 * models, far more on the lite ones) and reset at the provider's midnight (Pacific for Google,
 * UTC elsewhere). The pool tracks, per key and model, how many requests were attempted today
 * (from AiUsage) and which combinations the API reported as exhausted, so the router can move to
 * the next model or key instead of retrying. Paid keys (and providers without a free tier) are
 * capped by a daily call count instead.
 */

export interface PooledKey {
  id: string
  label: string
  provider: string
  apiKey: string
  baseUrl: string
  priority: number
  plan: 'free' | 'paid'
  dailyCallCap: number | null
  /** Resolved: the key's own model or the provider's default ('' when neither exists). */
  primaryModel: string
  liteModel: string
  models: string[]
  capabilities: ProviderCapabilities
  rpmLimit: number
  rpdLimit: number
  usedToday: number
}

export interface ModelLimits {
  /** model id -> requests/day/key on the free tier; `default` for unknown models */
  [model: string]: number
}

/** Gemini's free-tier table (kept for older callers; the provider registry holds the same numbers). */
export const DEFAULT_MODEL_LIMITS: ModelLimits = { ...(providerOrCustom('gemini').freeDaily ?? { default: 20 }) }

const CACHE_TTL_MS = 30_000
const COOLDOWN_MS = 60_000
/** Local servers have no quota; summaries count them as this many requests so the numbers stay finite. */
export const UNLIMITED = 10_000

let cache: { loadedAt: number; keys: PooledKey[]; cooldown: Map<string, number> } | null = null
let rrCounter = 0

/** Slot of the browser agent making the call: agent N tries key N first (one key per agent). */
const preferredSlot = new AsyncLocalStorage<number>()

/** Run `fn` as agent `slot`: its AI calls use key number `slot` first and the others only as a fallback. */
export function withPreferredKey<T>(slot: number, fn: () => Promise<T>): Promise<T> {
  return preferredSlot.run(slot, fn)
}

/** Rotation offset for the next call: the agent's slot when set, else a round-robin counter. */
export function nextRotation(): number {
  const slot = preferredSlot.getStore()
  if (slot !== undefined) return slot
  return rrCounter++
}

/** `${keyId}|${model}` -> quota date on which the daily quota was reported exhausted */
const exhausted = new Map<string, string>()
/** keyId -> quota date on which the key was rejected (bad key, no credit): skipped until the next day or an edit. */
const keyDown = new Map<string, string>()
/** `${keyId}|${model}` -> { date, count } attempts today (seeded from AiUsage, bumped locally) */
const modelUsage = new Map<string, { date: string; count: number; loadedAt: number }>()

export function dateIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** Start of the current day in `timeZone` as a Date (for AiUsage queries). */
export function dayStartIn(timeZone: string, now = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(now)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const secondsIntoDay = (get('hour') % 24) * 3600 + get('minute') * 60 + get('second')
  return new Date(Math.floor(now.getTime() / 1000) * 1000 - secondsIntoDay * 1000)
}

export function pacificDate(now = new Date()): string {
  return dateIn('America/Los_Angeles', now)
}

export function pacificDayStart(now = new Date()): Date {
  return dayStartIn('America/Los_Angeles', now)
}

/** The provider's quota day (Pacific for Gemini, UTC for the others). */
export function quotaDate(providerId: string, now = new Date()): string {
  return dateIn(providerOrCustom(providerId).quotaTz, now)
}

export function quotaDayStart(providerId: string, now = new Date()): Date {
  return dayStartIn(providerOrCustom(providerId).quotaTz, now)
}

export class NoKeyAvailableError extends Error {
  constructor(message = 'No AI key available (all disabled, exhausted or cooling down)') {
    super(message)
    this.name = 'NoKeyAvailableError'
  }
}

export function invalidateKeyCache() {
  cache = null
  modelUsage.clear()
  keyDown.clear()
}

interface AiKeyRowLike {
  id: string
  label: string
  provider: string
  baseUrl: string | null
  encryptedKey: string
  priority: number
  plan: string
  dailyCallCap: number | null
  primaryModel: string | null
  liteModel: string | null
  models: string[]
  capabilities: unknown
  rpmLimit: number
  rpdLimit: number
}

/** A pooled key from its row and the decrypted secret (pure; exported for tests). */
export function toPooledKey(r: AiKeyRowLike, apiKey: string, usedToday: number): PooledKey {
  const p = providerOrCustom(r.provider)
  return {
    id: r.id,
    label: r.label,
    provider: r.provider,
    apiKey,
    baseUrl: r.baseUrl || p.baseUrl,
    priority: r.priority,
    plan: r.plan === 'paid' ? 'paid' : 'free',
    dailyCallCap: r.dailyCallCap,
    primaryModel: r.primaryModel || p.defaultPrimary,
    liteModel: r.liteModel || p.defaultLite || r.primaryModel || p.defaultPrimary,
    models: r.models ?? [],
    capabilities: resolveCapabilities(p, r.capabilities),
    rpmLimit: r.rpmLimit,
    rpdLimit: r.rpdLimit,
    usedToday,
  }
}

/** Enabled keys in priority order (lower first, then oldest first). */
export async function loadPool(): Promise<PooledKey[]> {
  const now = Date.now()
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) return cache.keys
  const rows = await db.aiKey.findMany({ where: { enabled: true }, orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] })
  const keys: PooledKey[] = []
  for (const r of rows) {
    const today = quotaDate(r.provider)
    let usedToday = r.usedToday
    if (r.usedTodayDate !== today) {
      usedToday = 0
      await db.aiKey.update({ where: { id: r.id }, data: { usedToday: 0, usedTodayDate: today } }).catch(() => undefined)
    }
    let apiKey: string
    try {
      apiKey = decryptSecret(r.encryptedKey)
    } catch {
      await db.aiKey.update({ where: { id: r.id }, data: { lastError: 'Cannot decrypt key (APP_ENCRYPTION_KEY changed?)', enabled: false, status: 'failed' } }).catch(() => undefined)
      continue
    }
    const p = providerOrCustom(r.provider)
    if (!apiKey && !p.keyOptional) continue
    if (p.needsBaseUrl && !r.baseUrl) continue
    keys.push(toPooledKey(r, apiKey, usedToday))
  }
  const cooldown = cache?.cooldown ?? new Map<string, number>()
  cache = { loadedAt: now, keys, cooldown }
  return keys
}

/** Gemini-style lookup in a limits table (kept for older callers). */
export function modelLimit(model: string, limits: ModelLimits = DEFAULT_MODEL_LIMITS): number {
  return limits[model] ?? limits.default ?? 20
}

/** Free-tier requests/day for this key and model; Infinity when the key has no per-model limit (paid, or no free tier). */
export function keyModelLimit(key: Pick<PooledKey, 'provider' | 'plan'>, model: string, ai: Pick<AiConfig, 'modelDailyLimits'>): number {
  const p = providerOrCustom(key.provider)
  if (key.plan === 'paid' || !p.freeDaily) return Number.POSITIVE_INFINITY
  return ai.modelDailyLimits[model] ?? p.freeDaily[model] ?? ai.modelDailyLimits.default ?? p.freeDaily.default ?? Number.POSITIVE_INFINITY
}

/** Calls per day this key may make in total (Infinity = only the per-model free limits apply). */
export function keyDailyCap(key: Pick<PooledKey, 'provider' | 'plan' | 'dailyCallCap'>, ai: Pick<AiConfig, 'defaultDailyCallCap'>): number {
  if (key.dailyCallCap != null) return key.dailyCallCap
  const p = providerOrCustom(key.provider)
  if (p.id === 'ollama' || p.id === 'lmstudio') return Number.POSITIVE_INFINITY
  if (key.plan === 'free' && p.freeDaily) return Number.POSITIVE_INFINITY
  return ai.defaultDailyCallCap
}

/** Attempts today for a key+model (all attempts count against a free quota, not just successes). */
export async function usageToday(keyId: string, model: string, providerId = 'gemini'): Promise<number> {
  const k = `${keyId}|${model}`
  const today = quotaDate(providerId)
  const cached = modelUsage.get(k)
  if (cached && cached.date === today && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached.count
  const count = await db.aiUsage.count({ where: { keyId, model, createdAt: { gte: quotaDayStart(providerId) } } })
  modelUsage.set(k, { date: today, count, loadedAt: Date.now() })
  return count
}

function bumpUsage(keyId: string, model: string, providerId: string) {
  const k = `${keyId}|${model}`
  const today = quotaDate(providerId)
  const cur = modelUsage.get(k)
  modelUsage.set(k, { date: today, count: cur && cur.date === today ? cur.count + 1 : 1, loadedAt: cur?.loadedAt ?? Date.now() })
}

export function isModelExhausted(keyId: string, model: string, providerId = 'gemini'): boolean {
  return exhausted.get(`${keyId}|${model}`) === quotaDate(providerId)
}

export function markModelExhausted(keyId: string, model: string, providerId = 'gemini') {
  exhausted.set(`${keyId}|${model}`, quotaDate(providerId))
}

export function isKeyDown(keyId: string, providerId: string): boolean {
  return keyDown.get(keyId) === quotaDate(providerId)
}

export type BlockState = { blocked: false } | { blocked: true; reason: string; until?: number }

/** Whether this key may call `model` now (cooling down keys report when they free up). */
export async function blockState(key: PooledKey, model: string, ai: Pick<AiConfig, 'modelDailyLimits' | 'defaultDailyCallCap'>, now = Date.now()): Promise<BlockState> {
  if (isKeyDown(key.id, key.provider)) return { blocked: true, reason: `${key.label}: key rejected today` }
  if (isModelExhausted(key.id, model, key.provider)) return { blocked: true, reason: `${key.label}: ${model} daily quota used up` }
  if (key.usedToday >= keyDailyCap(key, ai)) return { blocked: true, reason: `${key.label}: daily call cap reached` }
  const limit = keyModelLimit(key, model, ai)
  if (Number.isFinite(limit) && (await usageToday(key.id, model, key.provider)) >= limit) return { blocked: true, reason: `${key.label}: free-tier quota for ${model} used up` }
  const until = cache?.cooldown.get(key.id) ?? 0
  if (until > now) return { blocked: true, reason: `${key.label}: cooling down`, until }
  return { blocked: false }
}

/** Count an attempt against the key+model before the call (failed attempts count too). */
export function reserveKey(key: PooledKey, model: string) {
  bumpUsage(key.id, model, key.provider)
}

export async function reportKeySuccess(id: string, providerId = 'gemini'): Promise<void> {
  const k = cache?.keys.find((x) => x.id === id)
  if (k) k.usedToday++
  await db.aiKey
    .update({ where: { id }, data: { usedToday: { increment: 1 }, usedTodayDate: quotaDate(providerId), lastUsedAt: new Date(), lastError: null, status: 'ok' } })
    .catch(() => undefined)
}

/** Per-minute limit hit: cool this key down briefly. */
export async function reportKeyRateLimited(id: string, message: string, retryAfterMs?: number): Promise<void> {
  const ms = Math.min(5 * 60_000, Math.max(COOLDOWN_MS, retryAfterMs ?? 0))
  cache?.cooldown.set(id, Date.now() + ms)
  await db.aiKey.update({ where: { id }, data: { cooldownUntil: new Date(Date.now() + ms), lastError: message.slice(0, 300) } }).catch(() => undefined)
}

/** Daily quota for this model is gone on this key until the provider's reset. */
export async function reportModelExhausted(id: string, model: string, message: string, providerId = 'gemini'): Promise<void> {
  markModelExhausted(id, model, providerId)
  await db.aiKey.update({ where: { id }, data: { lastError: `${model}: daily quota exhausted. ${message}`.slice(0, 300) } }).catch(() => undefined)
}

/** Bad key or no credit: skip the key for the rest of its quota day (an edit or a passing Test brings it back). */
export async function reportKeyDown(id: string, message: string, providerId: string): Promise<void> {
  keyDown.set(id, quotaDate(providerId))
  await db.aiKey.update({ where: { id }, data: { lastError: message.slice(0, 300), status: 'failed' } }).catch(() => undefined)
}

export async function reportKeyError(id: string, message: string): Promise<void> {
  await db.aiKey.update({ where: { id }, data: { lastError: message.slice(0, 300) } }).catch(() => undefined)
}

/** Every key (enabled or not) for summaries and the status chip. */
export async function keyPoolStatus(ai?: Pick<AiConfig, 'modelDailyLimits' | 'defaultDailyCallCap'>) {
  const rows = await db.aiKey.findMany({ orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] })
  const limits = ai ?? { modelDailyLimits: {}, defaultDailyCallCap: 600 }
  return rows.map((r) => {
    const p = providerOrCustom(r.provider)
    const plan: 'free' | 'paid' = r.plan === 'paid' ? 'paid' : 'free'
    const cap = keyDailyCap({ provider: r.provider, plan, dailyCallCap: r.dailyCallCap }, limits)
    const primary = r.primaryModel || p.defaultPrimary
    const lite = r.liteModel || p.defaultLite
    const perModel = [...new Set([primary, lite].filter(Boolean))].reduce((a, m) => a + keyModelLimit({ provider: r.provider, plan }, m, limits), 0)
    const effective = Number.isFinite(cap) ? cap : Number.isFinite(perModel) ? perModel : UNLIMITED
    return {
      id: r.id,
      label: r.label,
      provider: r.provider,
      providerLabel: p.label,
      keyHint: r.keyHint,
      projectNumber: r.projectNumber,
      enabled: r.enabled,
      priority: r.priority,
      plan,
      status: r.status,
      rpmLimit: r.rpmLimit,
      /** Requests per day this key can make (its cap, or its free-tier limits on the primary + lite models). */
      rpdLimit: effective,
      usedToday: r.usedTodayDate === quotaDate(r.provider) ? r.usedToday : 0,
      cooldownUntil: r.cooldownUntil && r.cooldownUntil > new Date() ? r.cooldownUntil : null,
      lastError: r.lastError,
      lastUsedAt: r.lastUsedAt,
    }
  })
}
