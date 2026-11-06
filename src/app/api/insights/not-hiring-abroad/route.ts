import { ok, route } from '@/lib/api/response'
import { notHiringAbroad } from '@/lib/insights/not-hiring-abroad'

/** GET /api/insights/not-hiring-abroad → { replies, companies, totals }: who cannot hire a candidate from abroad. */
export const GET = route(async () => ok(await notHiringAbroad()))
