import { badRequest, notFound, ok, route } from '@/lib/api/response'
import { db } from '@/lib/db'
import { isRunOrphaned } from '@/lib/pipeline/run'

/**
 * POST /api/runs/:id/cancel → ask the worker to stop this run after its current batch.
 * A run nobody is executing any more (no heartbeat for 2 minutes) is closed right away.
 */
export const POST = route(async (_req, { params }) => {
  const { id } = await params
  const run = await db.searchRun.findUnique({ where: { id }, select: { id: true, status: true, cancelRequested: true, startedAt: true, heartbeatAt: true } })
  if (!run) throw notFound('Run')
  if (run.status !== 'RUNNING') throw badRequest(`This run is not running (${run.status.toLowerCase().replace(/_/g, ' ')})`)

  if (isRunOrphaned(run)) {
    await db.searchRun.update({
      where: { id },
      data: { status: 'CANCELLED', cancelRequested: true, finishedAt: new Date(), durationMs: Date.now() - run.startedAt.getTime(), errorDetails: [{ step: 'run', message: 'Stopped by user; no worker was executing this run any more' }] },
    })
    return ok({ status: 'CANCELLED', immediate: true }, { message: 'Run stopped (no worker was executing it)' })
  }
  if (!run.cancelRequested) await db.searchRun.update({ where: { id }, data: { cancelRequested: true } })
  return ok({ status: 'RUNNING', immediate: false }, { message: 'Stopping after the current batch; everything done so far is kept' })
})
