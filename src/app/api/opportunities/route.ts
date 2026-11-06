import { ok, route } from '@/lib/api/response'
import { opportunities } from '@/lib/applications/opportunities'

/** GET /api/opportunities → companies waiting for your answer (yourMove) and the hiring processes under way (inProgress). */
export const GET = route(async () => ok(await opportunities()))
