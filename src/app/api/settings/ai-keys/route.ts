import { z } from 'zod'
import { ok, readJson, route } from '@/lib/api/response'
import { createAiKey, listKeyRows } from '@/lib/keys/ai-keys'
import { keyCall } from '@/lib/keys/http'

/** GET /api/settings/ai-keys -> every AI key (any provider); secrets reduced to their last 4 characters. */
export const GET = route(async () => ok(await listKeyRows()))

const createSchema = z.object({
  provider: z.string().trim().min(1).max(40),
  key: z.string().trim().max(500).default(''),
  label: z.string().trim().max(80).optional(),
  baseUrl: z.url().max(300).nullable().optional(),
  primaryModel: z.string().trim().max(200).nullable().optional(),
  liteModel: z.string().trim().max(200).nullable().optional(),
  plan: z.enum(['free', 'paid']).optional(),
  dailyCallCap: z.number().int().min(0).max(1_000_000).nullable().optional(),
  priority: z.number().int().min(0).max(10_000).optional(),
})

/** POST /api/settings/ai-keys -> add a key. It is tested first and stored even when the test fails (status 'failed'); 409 when already stored. */
export const POST = route(async (req) => {
  const body = await readJson(req, createSchema)
  const row = await keyCall(() => createAiKey({ ...body, source: 'manual' }))
  return ok(row, { status: 201, message: row.status === 'ok' ? 'Key added and working' : `Key added, but the test failed: ${row.lastError ?? 'unknown error'}` })
})
