import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { NOTIFICATION_TYPES } from '@/lib/domain'
import {
  aiConfigSchema,
  emailConfigSchema,
  portalConfigSchema,
  generalSettingsSchema,
  rankingConfigSchema,
  searchConfigSchema,
  DEFAULT_AI,
  DEFAULT_EMAIL,
  DEFAULT_PORTAL,
  DEFAULT_RANKING,
  DEFAULT_SEARCH,
  type AiConfig,
  type AppSettings,
  type EmailConfig,
  type GeneralSettings,
  type PortalConfig,
  type RankingConfig,
  type SearchConfig,
} from './schema'

const json = (v: unknown) => v as Prisma.InputJsonValue

function parseRow(row: {
  searchIntervalMinutes: number
  searchEnabled: boolean
  timezone: string
  digestEnabled: boolean
  digestHourLocal: number
  digestEmail: string | null
  pushEnabled: boolean
  pushTypes: string[]
  search: unknown
  ranking: unknown
  email: unknown
  ai: unknown
  portal: unknown
  updatedAt: Date
}): AppSettings {
  // Parse leniently: unknown/invalid JSON falls back to defaults so a bad edit never bricks the app.
  type Parsed<T> = { success: boolean; data?: T; error?: { issues: Array<{ path: PropertyKey[] }> } }
  const safe = <T>(schema: { safeParse: (v: unknown) => Parsed<T> }, v: unknown, fallback: T): T => {
    const r = schema.safeParse(v)
    if (r.success && r.data) return r.data
    // One out-of-range value (maxSubmissionsPerDay 500 over a max of 300) used to reset the whole
    // section, agents and title rules included. Drop only the bad fields so they take their defaults.
    const bad = new Set((r.error?.issues ?? []).map((i) => i.path[0]).filter((k) => k !== undefined))
    if (bad.size && v && typeof v === 'object') {
      const again = schema.safeParse(Object.fromEntries(Object.entries(v).filter(([k]) => !bad.has(k))))
      console.warn(`[settings] ignored invalid ${[...bad].map(String).join(', ')}; using the defaults for them`)
      if (again.success && again.data) return again.data
    }
    return fallback
  }
  return {
    searchIntervalMinutes: row.searchIntervalMinutes,
    searchEnabled: row.searchEnabled,
    timezone: row.timezone,
    digestEnabled: row.digestEnabled,
    digestHourLocal: row.digestHourLocal,
    digestEmail: row.digestEmail,
    pushEnabled: row.pushEnabled,
    // Unknown types (renamed or removed) are dropped rather than failing the whole settings read.
    pushTypes: row.pushTypes.filter((t): t is GeneralSettings['pushTypes'][number] => (NOTIFICATION_TYPES as readonly string[]).includes(t)),
    search: safe<SearchConfig>(searchConfigSchema, migrateSearch(row.search), DEFAULT_SEARCH),
    ranking: safe<RankingConfig>(rankingConfigSchema, row.ranking, DEFAULT_RANKING),
    email: safe<EmailConfig>(emailConfigSchema, row.email, DEFAULT_EMAIL),
    ai: safe<AiConfig>(aiConfigSchema, row.ai, DEFAULT_AI),
    portal: safe<PortalConfig>(portalConfigSchema, migratePortal(row.portal ?? {}), DEFAULT_PORTAL),
    updatedAt: row.updatedAt,
  }
}

/**
 * Settings saved before search had a profession field came from the software-only version of the
 * app: they keep working as a software search until onboarding derives new ones.
 */
export function migrateSearch(v: unknown): unknown {
  if (!isPlainObject(v) || 'profession' in v) return v
  const queries = Array.isArray(v.queries) ? v.queries : []
  return queries.length ? { ...v, profession: 'software' } : v
}

/**
 * The old title switches (Software Engineer titles only / developer titles only / lead titles too)
 * map to the generic target-title switch plus allowed levels, so old JSON still parses the same way.
 */
export function migratePortal(v: unknown): unknown {
  if (!isPlainObject(v)) return v
  const { onlySoftwareEngineerTitles, devTitlesOnly, allowLeadTitles, ...rest } = v
  if (onlySoftwareEngineerTitles === undefined && devTitlesOnly === undefined && allowLeadTitles === undefined) return v
  const out: Record<string, unknown> = { ...rest }
  const strict = onlySoftwareEngineerTitles === true || devTitlesOnly === true
  if (!('targetTitlesOnly' in rest)) out.targetTitlesOnly = strict
  if (!('seniority' in rest) && strict) out.seniority = allowLeadTitles === true && onlySoftwareEngineerTitles !== true ? ['mid', 'senior', 'lead', 'staff'] : ['mid', 'senior']
  return out
}

export async function ensureSettings() {
  return db.settings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      search: json(DEFAULT_SEARCH),
      ranking: json(DEFAULT_RANKING),
      email: json(DEFAULT_EMAIL),
      ai: json(DEFAULT_AI),
      portal: json(DEFAULT_PORTAL),
    },
  })
}

export async function getSettings(): Promise<AppSettings> {
  const row = (await db.settings.findUnique({ where: { id: 1 } })) ?? (await ensureSettings())
  return parseRow(row)
}

export interface SettingsPatch {
  general?: Partial<GeneralSettings>
  search?: Partial<SearchConfig>
  ranking?: Partial<RankingConfig>
  email?: Partial<EmailConfig>
  ai?: Partial<AiConfig>
  portal?: Partial<PortalConfig>
}

export async function updateSettings(patch: SettingsPatch): Promise<AppSettings> {
  const current = await getSettings()
  const general = generalSettingsSchema.parse({ ...stripGeneral(current), ...(patch.general ?? {}) })
  const search = searchConfigSchema.parse(deepMerge(current.search, patch.search))
  const ranking = rankingConfigSchema.parse(deepMerge(current.ranking, patch.ranking))
  const email = emailConfigSchema.parse(deepMerge(current.email, patch.email))
  const ai = aiConfigSchema.parse(deepMerge(current.ai, patch.ai))
  const portal = portalConfigSchema.parse(deepMerge(current.portal, patch.portal))

  const row = await db.settings.update({
    where: { id: 1 },
    data: {
      ...general,
      digestEmail: general.digestEmail ?? null,
      search: json(search),
      ranking: json(ranking),
      email: json(email),
      ai: json(ai),
      portal: json(portal),
    },
  })
  return parseRow(row)
}

function stripGeneral(s: AppSettings): GeneralSettings {
  return {
    searchIntervalMinutes: s.searchIntervalMinutes,
    searchEnabled: s.searchEnabled,
    timezone: s.timezone,
    digestEnabled: s.digestEnabled,
    digestHourLocal: s.digestHourLocal,
    digestEmail: s.digestEmail,
    pushEnabled: s.pushEnabled,
    pushTypes: s.pushTypes,
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)
}

/** Shallow-per-level merge; arrays are replaced, not concatenated. */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch)) return base
  if (!isPlainObject(base)) return patch as T
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v
  }
  return out as T
}
