import { ok, route } from '@/lib/api/response'
import { importKeysFromEnv } from '@/lib/keys/import'

/** POST /api/settings/ai-keys/import-env -> import the AI keys and service credentials found in the server environment (.env). */
export const POST = route(async () => {
  const r = await importKeysFromEnv()
  return ok(r, { message: `${r.added} added, ${r.skipped} skipped` })
})
