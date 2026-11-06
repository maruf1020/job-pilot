import { ok, route } from '@/lib/api/response'
import { continuousStatus } from '@/lib/pipeline/continuous'

/** GET /api/runs/continuous → the continuous-search settings, today's loops and the run going now. */
export const GET = route(async () => ok(await continuousStatus()))
