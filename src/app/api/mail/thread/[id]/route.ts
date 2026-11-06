import { notFound, ok, route } from '@/lib/api/response'
import { loadThread } from '@/lib/mail/loader'

/** GET /api/mail/thread/:applicationId -> the messages, draft and notes of one application (the reader pane). */
export const GET = route(async (_req, { params }) => {
  const { id } = await params
  const thread = await loadThread(id)
  if (!thread) throw notFound('Application')
  return ok(thread)
})
