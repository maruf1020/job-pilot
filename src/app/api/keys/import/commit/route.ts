import { z } from 'zod'
import { ok, readJson, route } from '@/lib/api/response'
import { commitImport } from '@/lib/keys/import'

const schema = z.object({
  text: z.string().max(200_000),
  picks: z
    .array(z.object({ ref: z.string().min(1).max(100), provider: z.string().trim().min(1).max(40).optional(), label: z.string().trim().max(80).optional() }))
    .max(500),
})

/** POST /api/keys/import/commit {text, picks} -> {added, skipped, errors}. The text is parsed again on the server. */
export const POST = route(async (req) => {
  const { text, picks } = await readJson(req, schema)
  const r = await commitImport(text, picks)
  return ok(r, { message: `${r.added} added, ${r.skipped} skipped${r.errors.length ? `, ${r.errors.length} failed` : ''}` })
})
