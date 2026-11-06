import { ok, route } from '@/lib/api/response'
import { requestSync, syncStatus } from '@/lib/inbox/sync'

/** POST /api/inbox/sync → check Gmail now (reply poll + inbox scan in the worker); returns { queuedAt }. */
export const POST = route(async () => ok(await requestSync(), { status: 202, message: 'Checking Gmail' }))

/** GET /api/inbox/sync → { lastSyncAt, queuedAt, running, nextSteps: { count, open, items } }. */
export const GET = route(async () => ok(await syncStatus()))
