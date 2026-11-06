import { ok, route } from '@/lib/api/response'
import { loadGeminiStats } from '@/lib/analytics/gemini'

/** GET /api/dashboard/gemini → Gemini calls per day by task, today's quota, the screenshot driver's results and why forms stopped. */
export const GET = route(async () => ok(await loadGeminiStats()))
