import { ok, route } from '@/lib/api/response'
import { activeProcesses } from '@/lib/applications/hiring'

/** GET /api/inbox/processes → applications with a hiring process under way and the step you are on. */
export const GET = route(async () => ok(await activeProcesses()))
