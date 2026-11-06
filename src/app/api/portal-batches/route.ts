import { z } from 'zod'
import { badRequest, ok, readJson, route } from '@/lib/api/response'
import { cancelPortalBatch, latestPortalBatch, portalCandidates, startPortalBatch } from '@/lib/apply/portal-batch'
import { PORTAL_SITES } from '@/lib/settings/schema'

/** GET /api/portal-batches → latest browser auto-apply batch with its attempts. */
export const GET = route(async () => ok(await latestPortalBatch()))

const startSchema = z.object({
  mode: z.enum(['fill', 'submit']),
  target: z.number().int().min(1).max(1000),
  continuous: z.boolean().default(false),
  minScore: z.number().int().min(0).max(100),
  countries: z.array(z.string().length(2)).default([]),
  sites: z.array(z.enum(PORTAL_SITES)).default([]),
  /** The checkbox "I understand the agent submits applications for me" (submit mode). */
  confirm: z.boolean().optional(),
})

/** POST /api/portal-batches → start a batch. Submit mode needs the explicit confirmation. */
export const POST = route(async (req) => {
  const input = await readJson(req, startSchema)
  if (input.mode === 'submit' && !input.confirm) throw badRequest('Tick the confirmation to let the agent submit applications for you')
  try {
    const batch = await startPortalBatch(input)
    return ok(batch, { message: input.mode === 'submit' ? 'Browser auto-apply started' : 'Browser auto-fill started' })
  } catch (err) {
    throw badRequest(err instanceof Error ? err.message : String(err))
  }
})

/** DELETE /api/portal-batches → stop the running batch. */
export const DELETE = route(async () => ok(await cancelPortalBatch(), { message: 'Stopped' }))

/** PUT /api/portal-batches (preview) → which jobs the batch would take first. */
export const PUT = route(async (req) => {
  const input = await readJson(req, startSchema.pick({ minScore: true, countries: true, sites: true }))
  const list = await portalCandidates({ minScore: input.minScore, countries: input.countries, sites: input.sites }, 25)
  return ok(list.map((c) => ({ jobId: c.jobId, title: c.title, company: c.company, countryCode: c.countryCode, score: c.score, site: c.target.site })))
})
