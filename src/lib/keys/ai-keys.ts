import { adapterFor } from '@/lib/ai/adapters'
import { invalidateKeyCache, quotaDate } from '@/lib/ai/key-pool'
import { getProvider, providerOrCustom } from '@/lib/ai/providers'
import { decryptSecret, encryptSecret, sha256 } from '@/lib/crypto'
import { db } from '@/lib/db'

/** AI key rows for Settings > AI keys: create (tested), edit, test, list. Secrets never leave the server. */

/** A user-facing error with an HTTP status (routes turn it into the response; kept out of lib/api so tests stay light). */
export class KeyError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'KeyError'
  }
}

export interface KeyRow {
  id: string
  label: string
  provider: string
  providerLabel: string
  keyHint: string
  baseUrl: string | null
  enabled: boolean
  priority: number
  plan: 'free' | 'paid'
  dailyCallCap: number | null
  primaryModel: string | null
  liteModel: string | null
  models: string[]
  status: string
  lastError: string | null
  lastTestedAt: Date | null
  lastUsedAt: Date | null
  usedToday: number
  cooldownUntil: Date | null
}

interface AiKeyRecord {
  id: string
  label: string
  provider: string
  keyHint: string
  baseUrl: string | null
  enabled: boolean
  priority: number
  plan: string
  dailyCallCap: number | null
  primaryModel: string | null
  liteModel: string | null
  models: string[]
  status: string
  lastError: string | null
  lastTestedAt: Date | null
  lastUsedAt: Date | null
  usedToday: number
  usedTodayDate: string | null
  cooldownUntil: Date | null
}

/** Last 4 characters only (older rows stored a leading ellipsis). */
export function hintOf(key: string): string {
  if (!key) return ''
  return key.length <= 4 ? '****' : key.slice(-4)
}

/**
 * De-duplication hash: the key itself, so the same key is never stored twice under two providers.
 * Keyless local servers hash their provider and URL instead.
 */
export function keyHashOf(provider: string, key: string, baseUrl?: string | null): string {
  return key ? sha256(key) : sha256(`${provider}|${(baseUrl || providerOrCustom(provider).baseUrl).replace(/\/$/, '')}|`)
}

export function toKeyRow(r: AiKeyRecord): KeyRow {
  return {
    id: r.id,
    label: r.label,
    provider: r.provider,
    providerLabel: providerOrCustom(r.provider).label,
    keyHint: r.keyHint.replace(/^[^\w]+/, ''),
    baseUrl: r.baseUrl,
    enabled: r.enabled,
    priority: r.priority,
    plan: r.plan === 'paid' ? 'paid' : 'free',
    dailyCallCap: r.dailyCallCap,
    primaryModel: r.primaryModel,
    liteModel: r.liteModel,
    models: r.models,
    status: r.status,
    lastError: r.lastError,
    lastTestedAt: r.lastTestedAt,
    lastUsedAt: r.lastUsedAt,
    usedToday: r.usedTodayDate === quotaDate(r.provider) ? r.usedToday : 0,
    cooldownUntil: r.cooldownUntil && r.cooldownUntil > new Date() ? r.cooldownUntil : null,
  }
}

export async function listKeyRows(): Promise<KeyRow[]> {
  const rows = await db.aiKey.findMany({ orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] })
  return rows.map(toKeyRow)
}

export interface TestOutcome {
  ok: boolean
  error?: string
  models?: string[]
}

/** Test a key against its provider (lists the models where the API allows). */
export async function testRawKey(provider: string, key: string, baseUrl?: string | null): Promise<TestOutcome> {
  const p = providerOrCustom(provider)
  const base = baseUrl || p.baseUrl
  if (!base) return { ok: false, error: 'A base URL is needed for this provider' }
  try {
    return await adapterFor(provider).testKey(key, base, provider)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export interface CreateKeyInput {
  provider: string
  key: string
  label?: string
  baseUrl?: string | null
  primaryModel?: string | null
  liteModel?: string | null
  plan?: 'free' | 'paid'
  dailyCallCap?: number | null
  priority?: number
  source?: 'manual' | 'import'
  /** Skip the live test (bulk import from .env). */
  skipTest?: boolean
}

export function validateKeyInput(provider: string, key: string, baseUrl?: string | null) {
  const p = getProvider(provider)
  if (!p) throw new KeyError(400, `Unknown provider: ${provider}`)
  if (!key && !p.keyOptional) throw new KeyError(400, `${p.label} needs an API key`)
  if (p.needsBaseUrl && !baseUrl) throw new KeyError(400, `${p.label} needs a base URL`)
  if (key.startsWith('sk-ant-oat')) throw new KeyError(400, 'This is a Claude subscription sign-in token (sk-ant-oat...), not an API key. Create an API key at console.anthropic.com.')
  return p
}

function defaultLabel(providerLabel: string, key: string, n: number): string {
  return `${providerLabel}${key ? ` ...${hintOf(key)}` : ''}${n > 0 ? ` (${n + 1})` : ''}`
}

/** Store a key (tested first; stored even when the test fails, with status 'failed'). 409 when the key is already stored. */
export async function createAiKey(input: CreateKeyInput): Promise<KeyRow> {
  const key = input.key.trim()
  const baseUrl = input.baseUrl?.trim() || null
  const p = validateKeyInput(input.provider, key, baseUrl)
  const keyHash = keyHashOf(p.id, key, baseUrl)
  if (await db.aiKey.findUnique({ where: { keyHash }, select: { id: true } })) throw new KeyError(409, 'This key is already stored')
  const test = input.skipTest ? null : await testRawKey(p.id, key, baseUrl)
  const sameProvider = await db.aiKey.count({ where: { provider: p.id } })
  const row = await db.aiKey.create({
    data: {
      label: input.label?.trim() || defaultLabel(p.label, key, sameProvider),
      provider: p.id,
      baseUrl,
      encryptedKey: encryptSecret(key),
      keyHint: hintOf(key),
      keyHash,
      source: input.source ?? 'manual',
      priority: input.priority ?? 100,
      plan: input.plan ?? 'free',
      dailyCallCap: input.dailyCallCap ?? null,
      primaryModel: input.primaryModel?.trim() || null,
      liteModel: input.liteModel?.trim() || null,
      models: test?.models ?? [],
      status: test ? (test.ok ? 'ok' : 'failed') : 'unknown',
      lastError: test && !test.ok ? (test.error ?? 'Test failed').slice(0, 300) : null,
      lastTestedAt: test ? new Date() : null,
    },
  })
  invalidateKeyCache()
  return toKeyRow(row)
}

export interface UpdateKeyInput {
  label?: string
  key?: string
  baseUrl?: string | null
  enabled?: boolean
  priority?: number
  plan?: 'free' | 'paid'
  dailyCallCap?: number | null
  primaryModel?: string | null
  liteModel?: string | null
}

export async function updateAiKey(id: string, patch: UpdateKeyInput): Promise<KeyRow> {
  const cur = await db.aiKey.findUnique({ where: { id } })
  if (!cur) throw new KeyError(404, 'Key not found')
  const data: Record<string, unknown> = {}
  if (patch.label !== undefined) data.label = patch.label.trim() || cur.label
  if (patch.enabled !== undefined) data.enabled = patch.enabled
  if (patch.priority !== undefined) data.priority = patch.priority
  if (patch.plan !== undefined) data.plan = patch.plan
  if (patch.dailyCallCap !== undefined) data.dailyCallCap = patch.dailyCallCap
  if (patch.primaryModel !== undefined) data.primaryModel = patch.primaryModel?.trim() || null
  if (patch.liteModel !== undefined) data.liteModel = patch.liteModel?.trim() || null
  if (patch.baseUrl !== undefined) data.baseUrl = patch.baseUrl?.trim() || null
  const newKey = patch.key?.trim()
  if (newKey !== undefined && newKey !== '') {
    validateKeyInput(cur.provider, newKey, (data.baseUrl as string | null | undefined) ?? cur.baseUrl)
    const keyHash = keyHashOf(cur.provider, newKey, (data.baseUrl as string | null | undefined) ?? cur.baseUrl)
    const dup = await db.aiKey.findUnique({ where: { keyHash }, select: { id: true } })
    if (dup && dup.id !== id) throw new KeyError(409, 'This key is already stored')
    Object.assign(data, { encryptedKey: encryptSecret(newKey), keyHint: hintOf(newKey), keyHash, lastError: null, cooldownUntil: null, status: 'unknown' })
  }
  const row = await db.aiKey.update({ where: { id }, data })
  invalidateKeyCache()
  return toKeyRow(row)
}

/** Test a stored key; stores the model list, status and error. */
export async function testStoredKey(id: string): Promise<TestOutcome> {
  const cur = await db.aiKey.findUnique({ where: { id } })
  if (!cur) throw new KeyError(404, 'Key not found')
  let key: string
  try {
    key = decryptSecret(cur.encryptedKey)
  } catch {
    return { ok: false, error: 'Cannot decrypt the key (APP_ENCRYPTION_KEY changed?). Paste it again.' }
  }
  const r = await testRawKey(cur.provider, key, cur.baseUrl)
  await db.aiKey.update({
    where: { id },
    data: {
      lastTestedAt: new Date(),
      status: r.ok ? 'ok' : 'failed',
      lastError: r.ok ? null : (r.error ?? 'Test failed').slice(0, 300),
      ...(r.ok ? { cooldownUntil: null } : {}),
      ...(r.models?.length ? { models: r.models } : {}),
    },
  })
  invalidateKeyCache()
  return r
}

export async function deleteAiKey(id: string): Promise<void> {
  await db.aiKey.delete({ where: { id } })
  invalidateKeyCache()
}
