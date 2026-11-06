import { ok, route } from '@/lib/api/response'
import { testStoredKey } from '@/lib/keys/ai-keys'
import { keyCall } from '@/lib/keys/http'

/** POST /api/settings/ai-keys/:id/test -> {ok, error?, models?}; also stores the model list and status on the key. */
export const POST = route(async (_req, { params }) => {
  const { id } = await params
  const r = await keyCall(() => testStoredKey(id))
  return ok({ ok: r.ok, ...(r.error ? { error: r.error } : {}), ...(r.models ? { models: r.models } : {}) }, { message: r.ok ? 'Key works' : `Test failed: ${r.error ?? 'unknown error'}` })
})
