import { z } from 'zod'
import { HttpError, ok, readJson, route } from '@/lib/api/response'
import { BATCH_SCOPES, BatchAlreadyRunningError, cancelContactBatch, createContactBatch, latestContactBatch, scopeCounts } from '@/lib/pipeline/contact-batch'
import { enqueueContactBatch } from '@/lib/queue'

/** GET /api/contacts/batch → latest run + how many companies each scope would cover. */
export const GET = route(async (req) => {
  const withCounts = new URL(req.url).searchParams.get('counts') === 'true'
  const [latest, counts] = await Promise.all([latestContactBatch(), withCounts ? scopeCounts() : Promise.resolve(null)])
  return ok({ latest, counts })
})

const startSchema = z.object({
  scope: z.enum(BATCH_SCOPES).default('above_threshold'),
  batchSize: z.number().int().min(1).max(50).default(10),
  includeChecked: z.boolean().default(false),
})

/** POST /api/contacts/batch → start a batch (409 if one is running). */
export const POST = route(async (req) => {
  const body = await readJson(req, startSchema)
  const run = await createContactBatch(body.scope, body.batchSize, body.includeChecked).catch((err: unknown) => {
    if (err instanceof BatchAlreadyRunningError) throw new HttpError(409, err.message)
    throw err
  })
  await enqueueContactBatch({ runId: run.id, includeChecked: body.includeChecked })
  return ok(run, { status: 202, message: run.total === 0 ? 'No companies need a lookup for that scope' : `Looking up ${run.total} companies, ${body.batchSize} at a time` })
})

/** DELETE /api/contacts/batch → ask the running batch to stop after the current batch. */
export const DELETE = route(async () => {
  const n = await cancelContactBatch()
  return ok({ cancelled: n }, { message: n ? 'Stopping after the current batch' : 'Nothing is running' })
})
