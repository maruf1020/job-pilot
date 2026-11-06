import { ok, route } from '@/lib/api/response'
import { loadNeedsYouQueue } from '@/lib/analytics/queue'

/** GET /api/queue → what only you can do: CAPTCHA forms, sign-in walls, open questions, forms waiting for you. */
export const GET = route(async () => ok(await loadNeedsYouQueue()))
