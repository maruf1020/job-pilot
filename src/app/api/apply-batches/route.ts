import { z } from 'zod'
import { HttpError, ok, readJson, route } from '@/lib/api/response'
import { ApplyBatchError, BATCH_MAX, BATCH_MIN, cancelBatch, latestBatch, startBatch } from '@/lib/pipeline/apply-batch'
import { enqueueApplyBatchTick } from '@/lib/queue'

/** GET → the latest batch (running or finished) for the progress card. */
export const GET = route(async () => ok(await latestBatch()))

const startSchema = z.object({
  target: z.number().int().min(BATCH_MIN).max(BATCH_MAX),
  /** No end: keep applying to new good matches as they are found, until stopped. */
  continuous: z.boolean().default(false),
  minScore: z.number().int().min(0).max(100).default(80),
  includeGuessed: z.boolean().default(false),
  countries: z.array(z.string().length(2).toUpperCase()).max(40).default([]),
  /** Must be true: the user explicitly allows this batch's emails to be sent without further approval. */
  confirmSend: z.literal(true, { message: 'Confirm that these applications may be sent automatically' }),
})

/** POST → start a batch. The explicit confirmation is the permission for its applications only. */
export const POST = route(async (req) => {
  const body = await readJson(req, startSchema)
  const batch = await startBatch(body).catch((err: unknown) => {
    if (err instanceof ApplyBatchError) throw new HttpError(400, err.message)
    throw err
  })
  await enqueueApplyBatchTick()
  return ok(batch, { status: 201, message: batch.continuous ? `Continuous auto-apply started: every new match scoring ${batch.minScore}+ is prepared and sent if it passes the checks` : `Auto-apply started: up to ${batch.target} applications, score ${batch.minScore}+` })
})

/** DELETE → stop the running batch; everything not yet sent goes back to Review. */
export const DELETE = route(async () => {
  const r = await cancelBatch()
  return ok(r, { message: r.cancelled ? `Stopped. ${r.unqueued} queued application(s) moved back to Review` : 'No batch is running' })
})
