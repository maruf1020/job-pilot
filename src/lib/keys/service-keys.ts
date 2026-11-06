import { decryptSecret, encryptSecret } from '@/lib/crypto'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { completeValues, getServiceDef, serviceHint, SERVICE_DEFS, type ServiceDef, type ServiceValues } from './service-keys-defs'

export * from './service-keys-defs'

/**
 * Credentials for the non-AI services (job sources, AI-text detector, web search, phone
 * notifications, SMTP). They are entered in Settings (stored encrypted in ServiceKey); `.env`
 * stays as a fallback for headless installs. Field names are the environment variable names, so
 * an imported `.env` maps one to one.
 */

const CACHE_TTL_MS = 30_000
const cache = new Map<string, { at: number; values: ServiceValues | null; source: 'db' | 'env' | null }>()

export function invalidateServiceCredentials(service?: string) {
  if (service) cache.delete(service)
  else cache.clear()
}

function fromEnv(def: ServiceDef): ServiceValues | null {
  const raw = env as unknown as Record<string, unknown>
  const values: Record<string, string | undefined> = {}
  for (const f of def.fields) {
    const v = raw[f.name] ?? process.env[f.name]
    values[f.name] = v === undefined || v === null || v === '' ? undefined : String(v)
  }
  return completeValues(def, values)
}

async function load(service: string): Promise<{ values: ServiceValues | null; source: 'db' | 'env' | null }> {
  const def = getServiceDef(service)
  if (!def) return { values: null, source: null }
  const hit = cache.get(service)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit
  let values: ServiceValues | null = null
  let source: 'db' | 'env' | null = null
  const row = await db.serviceKey.findUnique({ where: { service } }).catch(() => null)
  if (row?.enabled) {
    try {
      values = completeValues(def, JSON.parse(decryptSecret(row.encryptedValues)) as Record<string, string>)
      if (values) source = 'db'
    } catch {
      // Cannot decrypt (APP_ENCRYPTION_KEY changed): fall back to the environment.
    }
  }
  if (!values) {
    values = fromEnv(def)
    if (values) source = 'env'
  }
  const entry = { at: Date.now(), values, source }
  cache.set(service, entry)
  return entry
}

/** The service's credentials (field name -> value): Settings first, then .env; null when not configured. */
export async function getServiceCredential(service: string): Promise<ServiceValues | null> {
  return (await load(service)).values
}

export async function serviceCredentialSource(service: string): Promise<'db' | 'env' | null> {
  return (await load(service)).source
}

/** Job-source credentials in the shape SourceContext.env expects. */
export async function sourceCredentials() {
  const [adzuna, jooble, rapidapi, reed, ft] = await Promise.all(['adzuna', 'jooble', 'rapidapi', 'reed', 'francetravail'].map((s) => getServiceCredential(s)))
  return {
    ADZUNA_APP_ID: adzuna?.ADZUNA_APP_ID,
    ADZUNA_APP_KEY: adzuna?.ADZUNA_APP_KEY,
    JOOBLE_KEY: jooble?.JOOBLE_KEY,
    RAPIDAPI_KEY: rapidapi?.RAPIDAPI_KEY,
    REED_KEY: reed?.REED_KEY,
    FRANCETRAVAIL_CLIENT_ID: ft?.FRANCETRAVAIL_CLIENT_ID,
    FRANCETRAVAIL_CLIENT_SECRET: ft?.FRANCETRAVAIL_CLIENT_SECRET,
  }
}

export interface SmtpConfig {
  host: string
  port: number
  user: string
  pass: string
  from: string
}

export async function smtpConfig(): Promise<SmtpConfig | null> {
  const v = await getServiceCredential('smtp')
  if (!v) return null
  return { host: v.SMTP_HOST, port: Number(v.SMTP_PORT) || 587, user: v.SMTP_USER, pass: v.SMTP_PASS, from: v.SMTP_FROM }
}

/** Store (or replace) a service's credentials. Throws when a required field is missing. */
export async function saveServiceCredential(service: string, values: Record<string, string>, source: 'manual' | 'import' = 'manual'): Promise<void> {
  const def = getServiceDef(service)
  if (!def) throw new Error(`Unknown service: ${service}`)
  const allowed = Object.fromEntries(Object.entries(values).filter(([k]) => def.fields.some((f) => f.name === k)))
  const complete = completeValues(def, allowed)
  if (!complete) throw new Error(`${def.label}: ${def.fields.filter((f) => !f.optional && !allowed[f.name]?.trim()).map((f) => f.label).join(', ')} missing`)
  const data = { encryptedValues: encryptSecret(JSON.stringify(complete)), hint: serviceHint(def, complete), enabled: true, source, lastError: null }
  await db.serviceKey.upsert({ where: { service }, update: data, create: { service, ...data } })
  invalidateServiceCredentials(service)
}

export async function deleteServiceCredential(service: string): Promise<void> {
  await db.serviceKey.deleteMany({ where: { service } })
  invalidateServiceCredentials(service)
}

export interface ServiceKeyInfo {
  service: string
  label: string
  description: string
  fields: Array<{ name: string; label: string; secret: boolean; optional: boolean }>
  configured: boolean
  source: 'db' | 'env' | null
  hint?: string
  docsUrl?: string
  testable: boolean
}

/** Every service with where its credentials come from (never the values). */
export async function listServiceKeys(): Promise<ServiceKeyInfo[]> {
  const rows = await db.serviceKey.findMany()
  const out: ServiceKeyInfo[] = []
  for (const def of SERVICE_DEFS) {
    const { values, source } = await load(def.service)
    const row = rows.find((r) => r.service === def.service)
    out.push({
      service: def.service,
      label: def.label,
      description: def.description,
      fields: def.fields.map((f) => ({ name: f.name, label: f.label, secret: f.secret, optional: Boolean(f.optional) })),
      configured: Boolean(values),
      source,
      ...(source === 'db' && row ? { hint: row.hint } : values ? { hint: serviceHint(def, values) } : {}),
      ...(def.docsUrl ? { docsUrl: def.docsUrl } : {}),
      testable: def.service in TESTS,
    })
  }
  return out
}

type Tester = (v: ServiceValues, fetchImpl: typeof fetch) => Promise<{ ok: boolean; error?: string }>

async function httpOk(res: Response, what: string): Promise<{ ok: boolean; error?: string }> {
  if (res.ok) return { ok: true }
  return { ok: false, error: `${what} answered HTTP ${res.status}` }
}

const timeout = () => AbortSignal.timeout(15_000)

/** Cheap checks only (no message is sent, no paid quota is spent beyond one search). */
const TESTS: Record<string, Tester> = {
  adzuna: async (v, f) => httpOk(await f(`https://api.adzuna.com/v1/api/jobs/gb/search/1?app_id=${encodeURIComponent(v.ADZUNA_APP_ID)}&app_key=${encodeURIComponent(v.ADZUNA_APP_KEY)}&results_per_page=1&what=developer`, { signal: timeout() }), 'Adzuna'),
  jooble: async (v, f) => httpOk(await f(`https://jooble.org/api/${encodeURIComponent(v.JOOBLE_KEY)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keywords: 'developer', page: '1' }), signal: timeout() }), 'Jooble'),
  reed: async (v, f) => httpOk(await f('https://www.reed.co.uk/api/1.0/search?keywords=developer&resultsToTake=1', { headers: { Authorization: `Basic ${Buffer.from(`${v.REED_KEY}:`).toString('base64')}` }, signal: timeout() }), 'Reed'),
  francetravail: async (v, f) => {
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: v.FRANCETRAVAIL_CLIENT_ID, client_secret: v.FRANCETRAVAIL_CLIENT_SECRET, scope: 'api_offresdemploiv2 o2dsoffre' })
    return httpOk(await f('https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: timeout() }), 'France Travail')
  },
  google_cse: async (v, f) => httpOk(await f(`https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(v.GOOGLE_CSE_KEY)}&cx=${encodeURIComponent(v.GOOGLE_CSE_CX)}&num=1&q=careers`, { signal: timeout() }), 'Google Custom Search'),
  telegram: async (v, f) => {
    const res = await f(`https://api.telegram.org/bot${v.TELEGRAM_BOT_TOKEN}/getMe`, { signal: timeout() })
    return res.ok ? { ok: true } : { ok: false, error: res.status === 401 || res.status === 404 ? 'Telegram rejected the bot token' : `Telegram answered HTTP ${res.status}` }
  },
  smtp: async (v) => {
    const nodemailer = (await import('nodemailer')).default
    const port = Number(v.SMTP_PORT) || 587
    try {
      await nodemailer.createTransport({ host: v.SMTP_HOST, port, secure: port === 465, auth: { user: v.SMTP_USER, pass: v.SMTP_PASS } }).verify()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  },
}

/** Test the stored (or .env) credentials of a service where a cheap test exists; records the result. */
export async function testServiceCredential(service: string, fetchImpl: typeof fetch = globalThis.fetch): Promise<{ ok: boolean; error?: string }> {
  const def = getServiceDef(service)
  if (!def) return { ok: false, error: `Unknown service: ${service}` }
  const values = await getServiceCredential(service)
  if (!values) return { ok: false, error: `${def.label} is not configured` }
  const test = TESTS[service]
  if (!test) return { ok: false, error: `No test available for ${def.label}` }
  let r: { ok: boolean; error?: string }
  try {
    r = await test(values, fetchImpl)
  } catch (err) {
    r = { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  await db.serviceKey.updateMany({ where: { service }, data: { lastTestedAt: new Date(), lastError: r.ok ? null : (r.error ?? 'failed').slice(0, 300) } }).catch(() => undefined)
  return r
}
