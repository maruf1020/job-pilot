import { loadScoreboard } from '@/lib/analytics/conversion'
import { ok, route } from '@/lib/api/response'

export const GET = route(async () => ok(await loadScoreboard()))
