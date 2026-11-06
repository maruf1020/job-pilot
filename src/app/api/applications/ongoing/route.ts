import { ok, route } from '@/lib/api/response'
import { ongoingApplications } from '@/lib/applications/ongoing'

/** GET /api/applications/ongoing[?limit=5] → in-progress applications with stage and next action, newest activity first. */
export const GET = route(async (req) => {
  const limit = Number(new URL(req.url).searchParams.get('limit') ?? '')
  return ok(await ongoingApplications(Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : 200))
})
