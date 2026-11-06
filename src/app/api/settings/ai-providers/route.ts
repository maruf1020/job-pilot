import { PROVIDERS, providerInfo } from '@/lib/ai/providers'
import { ok, route } from '@/lib/api/response'

/** GET /api/settings/ai-providers -> every provider the app can use (for the Add key dropdown). */
export const GET = route(async () => ok(PROVIDERS.map(providerInfo)))
