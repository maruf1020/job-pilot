import { z } from 'zod'
import { ok, readJson, route } from '@/lib/api/response'
import { deleteAiKey, updateAiKey } from '@/lib/keys/ai-keys'
import { keyCall } from '@/lib/keys/http'

const patchSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  key: z.string().trim().max(500).optional(),
  baseUrl: z.url().max(300).nullable().optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(10_000).optional(),
  plan: z.enum(['free', 'paid']).optional(),
  dailyCallCap: z.number().int().min(0).max(1_000_000).nullable().optional(),
  primaryModel: z.string().trim().max(200).nullable().optional(),
  liteModel: z.string().trim().max(200).nullable().optional(),
})

/** PATCH /api/settings/ai-keys/:id -> edit a key (a non-empty `key` replaces the secret). */
export const PATCH = route(async (req, { params }) => {
  const { id } = await params
  const body = await readJson(req, patchSchema)
  return ok(await keyCall(() => updateAiKey(id, body)))
})

export const DELETE = route(async (_req, { params }) => {
  const { id } = await params
  await deleteAiKey(id)
  return ok({ deleted: true })
})
