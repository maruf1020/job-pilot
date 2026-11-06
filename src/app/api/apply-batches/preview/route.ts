import { ok, route } from '@/lib/api/response'
import { previewBatch } from '@/lib/pipeline/apply-batch'

/** GET /api/apply-batches/preview?minScore=80&includeGuessed=false&countries=IE,NL → how many jobs qualify. Changes nothing. */
export const GET = route(async (req) => {
  const sp = new URL(req.url).searchParams
  const minScore = Math.max(0, Math.min(100, Number(sp.get('minScore') ?? 80) || 0))
  const includeGuessed = sp.get('includeGuessed') === 'true'
  const countries = (sp.get('countries') ?? '').split(',').map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c))
  return ok(await previewBatch({ minScore, includeGuessed, countries }))
})
