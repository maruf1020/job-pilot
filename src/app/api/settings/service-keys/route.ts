import { ok, route } from '@/lib/api/response'
import { listServiceKeys } from '@/lib/keys/service-keys'

/** GET /api/settings/service-keys -> every non-AI service, whether it is configured and where from (values never leave the server). */
export const GET = route(async () => ok(await listServiceKeys()))
