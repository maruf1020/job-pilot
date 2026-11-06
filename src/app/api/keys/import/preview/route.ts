import { z } from 'zod'
import { ok, readJson, route } from '@/lib/api/response'
import { previewImport } from '@/lib/keys/import'

const schema = z.object({ text: z.string().max(200_000) })

/** POST /api/keys/import/preview {text} -> what the pasted text holds (provider, how it was detected, test, duplicates). Stateless. */
export const POST = route(async (req) => {
  const { text } = await readJson(req, schema)
  return ok(await previewImport(text))
})
