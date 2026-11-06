import { ok, route } from '@/lib/api/response'
import { pushChannel, sendPush } from '@/lib/push'

/** GET /api/notifications/push → which phone channel .env sets up (ntfy, telegram or none). */
export const GET = route(async () => ok({ channel: await pushChannel() }))

/** POST /api/notifications/push → a test message to your phone (your click is the permission). */
export const POST = route(async () => {
  const r = await sendPush({ title: 'Job Pilot test', body: 'Phone notifications work. Interview requests and replies will arrive here.', link: '/mail', priority: 'default', tags: ['white_check_mark'] })
  if (!r.ok) throw new Error(r.error ?? 'Push failed')
  return ok(r, { message: `Test sent through ${r.channel}` })
})
