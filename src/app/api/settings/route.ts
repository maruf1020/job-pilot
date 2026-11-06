import { z } from 'zod'
import { ok, readJson, route } from '@/lib/api/response'
import { aiConfigSchema, emailConfigSchema, generalSettingsSchema, portalConfigSchema, rankingConfigSchema, searchConfigSchema } from '@/lib/settings/schema'
import { getSettings, updateSettings } from '@/lib/settings/service'

export const GET = route(async () => ok(await getSettings()))

const patchSchema = z.object({
  general: generalSettingsSchema.partial().optional(),
  search: searchConfigSchema.partial().optional(),
  ranking: rankingConfigSchema.partial().optional(),
  email: emailConfigSchema.partial().optional(),
  ai: aiConfigSchema.partial().optional(),
  portal: portalConfigSchema.partial().optional(),
})

/**
 * Only the keys the request sent: the schemas fill every missing key with its default, and merging
 * those would reset settings nobody touched (saving one cap once turned "use my Chrome" off).
 */
function sentOnly(parsed: Record<string, unknown> | undefined, raw: unknown): Record<string, unknown> | undefined {
  if (!parsed || !raw || typeof raw !== 'object') return undefined
  return Object.fromEntries(Object.keys(raw).filter((k) => k in parsed).map((k) => [k, parsed[k]]))
}

export const PATCH = route(async (req) => {
  const raw = (await req.clone().json().catch(() => null)) as Record<string, unknown> | null
  const body = await readJson(req, patchSchema)
  const patch = Object.fromEntries(Object.entries(body).map(([section, value]) => [section, sentOnly(value as Record<string, unknown>, raw?.[section])]))
  const settings = await updateSettings(patch as typeof body)
  return ok(settings, { message: 'Settings saved' })
})
