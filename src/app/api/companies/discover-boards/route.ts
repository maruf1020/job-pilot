import { z } from 'zod'
import { HttpError, ok, readJson, route } from '@/lib/api/response'
import { MAX_COMPANIES_PER_RUN } from '@/lib/sponsors/board-progress'
import { BoardRunAlreadyRunningError, boardRunOverview, cancelBoardRun, createBoardRun } from '@/lib/sponsors/board-run'
import { enqueueBoardDiscovery } from '@/lib/queue'

/**
 * GET: the latest run, the last few runs, the live feed of the latest run (`logs`, default 50) and, with
 * `counts=true`, how many companies a run would cover. The Companies page polls this every few seconds.
 */
export const GET = route(async (req) => {
  const q = new URL(req.url).searchParams
  const data = await boardRunOverview({ counts: q.get('counts') === 'true', includeChecked: q.get('includeChecked') === 'true', logs: Number(q.get('logs')) || 50 })
  return ok(data)
})

const startSchema = z.object({
  /** How many companies without a board to try; omitted = all of them. */
  limit: z.number().int().min(1).max(MAX_COMPANIES_PER_RUN).optional(),
  /** Try companies again that were tried in the last 14 days. */
  includeChecked: z.boolean().default(false),
})
  // Unknown keys (the old "scope") are refused instead of silently starting a run.
  .strict()

/** POST: start a run in the worker (409 while another is going). Progress shows on the Companies page. */
export const POST = route(async (req) => {
  const { limit, includeChecked } = await readJson(req, startSchema)
  const run = await createBoardRun(limit ?? null, includeChecked).catch((err: unknown) => {
    if (err instanceof BoardRunAlreadyRunningError) throw new HttpError(409, err.message)
    throw err
  })
  await enqueueBoardDiscovery({ runId: run.id })
  return ok(run, { status: 202, message: run.total === 0 ? 'Nothing to do: every company was tried in the last 14 days' : `Looking for boards: ${run.total} companies` })
})

/** DELETE: ask the running search to stop (it finishes the companies in flight, a few seconds). */
export const DELETE = route(async () => {
  const n = await cancelBoardRun()
  return ok({ cancelled: n }, { message: n ? 'Stopping after the companies in flight' : 'Nothing is running' })
})
