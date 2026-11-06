import { exportOwnerData } from '@/lib/account/remove'
import { route } from '@/lib/api/response'

/** GET -> everything about the owner as a JSON download (profile, answers, applications, settings). */
export const GET = route(async () => {
  const data = await exportOwnerData()
  const day = new Date().toISOString().slice(0, 10)
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="job-pilot-my-data-${day}.json"`,
      'cache-control': 'no-store',
    },
  })
})
