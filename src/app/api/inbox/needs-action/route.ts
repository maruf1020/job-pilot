import { ok, route } from '@/lib/api/response'
import { leads, needsAction } from '@/lib/email/needs-action'

/**
 * GET /api/inbox/needs-action → replies waiting for you, threads where the other side went quiet,
 * the applications one step ahead (nextSteps) and the ones held back only by location (locationIssue).
 */
export const GET = route(async () => {
  const [actions, hot] = await Promise.all([needsAction(), leads()])
  return ok({ ...actions, ...hot })
})
