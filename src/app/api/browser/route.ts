import { z } from 'zod'
import { ok, readJson, route } from '@/lib/api/response'
import { db } from '@/lib/db'
import { enqueueBrowserControl, enqueueInboxScan, enqueuePortalStatusCheck } from '@/lib/queue'

/** GET /api/browser → the apply browser as the worker last saw it, plus agent counters. */
export const GET = route(async () => {
  const [status, waiting, accounts, review] = await Promise.all([
    db.workerStatus.findUnique({ where: { id: 1 }, select: { browser: true, heartbeatAt: true, state: true } }),
    db.answerBank.count({ where: { answer: null, timesSeen: { gt: 0 } } }),
    db.portalAccount.count(),
    db.portalAttempt.count({ where: { status: { in: ['AWAITING_REVIEW', 'NEEDS_HUMAN'] } } }),
  ])
  return ok({ worker: status ? { state: status.state, heartbeatAt: status.heartbeatAt } : null, browser: status?.browser ?? null, waitingQuestions: waiting, accounts, needsYou: review })
})

const schema = z.object({
  action: z.enum(['open', 'scan-inbox', 'check-portals']),
  url: z.url().optional(),
})

/** POST /api/browser → ask the worker to open the apply browser (optionally on a page), scan the inbox, or check portals now. */
export const POST = route(async (req) => {
  const input = await readJson(req, schema)
  if (input.action === 'open') {
    await enqueueBrowserControl({ action: 'open', url: input.url })
    return ok({ queued: true }, { message: 'Opening the apply browser' })
  }
  if (input.action === 'scan-inbox') {
    await enqueueInboxScan()
    return ok({ queued: true }, { message: 'Inbox scan started' })
  }
  await enqueuePortalStatusCheck()
  return ok({ queued: true }, { message: 'Portal status check started' })
})
