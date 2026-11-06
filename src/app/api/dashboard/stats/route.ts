import { ok, route } from '@/lib/api/response'
import { loadStats } from '@/lib/analytics/stats'

/** GET /api/dashboard/stats → submitted today / this week / this month / all time, series, funnel, replies and breakdowns. */
export const GET = route(async () => ok(await loadStats()))
