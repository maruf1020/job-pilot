import { z } from 'zod'
import { ok, readJson, route } from '@/lib/api/response'
import { approveFollowUps, dueFollowUps, skipFollowUps } from '@/lib/email/follow-ups'

/** GET /api/follow-ups → follow-ups that are due and worth sending, waiting for your approval. */
export const GET = route(async () => ok(await dueFollowUps()))

const schema = z.object({
  applicationIds: z.array(z.string()).min(1).max(500),
  /** approve = your permission to send these; skip = no follow-up for these. */
  action: z.enum(['approve', 'skip']).default('approve'),
})

/** POST /api/follow-ups { applicationIds, action } */
export const POST = route(async (req) => {
  const { applicationIds, action } = await readJson(req, schema)
  if (action === 'skip') {
    const n = await skipFollowUps(applicationIds)
    return ok({ skipped: n }, { message: `${n} skipped` })
  }
  const n = await approveFollowUps(applicationIds)
  return ok({ approved: n }, { message: `${n} follow-up${n === 1 ? '' : 's'} approved; they go out with the normal gaps` })
})
