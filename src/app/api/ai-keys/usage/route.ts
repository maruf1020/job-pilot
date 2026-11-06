import { getKeyUsage } from '@/lib/ai/usage'
import { ok, route } from '@/lib/api/response'

/** GET /api/ai-keys/usage -> per AI key: tokens used today and requests left per model. */
export const GET = route(async () => ok(await getKeyUsage()))
