import { z } from 'zod'
import { ok, readJson, route } from '@/lib/api/response'
import { asHttp } from '@/lib/apply/http'
import { ensureApplicationForJob, queuePortalAttempt } from '@/lib/apply/service'

const schema = z.object({
  action: z.enum(['fill', 'submit']),
  ignoreCooldown: z.boolean().optional(),
})

/** POST /api/jobs/:id/portal { action } → apply through the job's website with the browser agent. */
export const POST = route(async (req, { params }) => {
  const { id } = await params
  const input = await readJson(req, schema)
  const app = await asHttp(ensureApplicationForJob(id))
  const attempt = await asHttp(queuePortalAttempt(app.id, input.action, { ignoreCooldown: input.ignoreCooldown, interactive: true }))
  return ok({ applicationId: app.id, attemptId: attempt.id }, { message: input.action === 'fill' ? 'The agent is filling the form in the apply browser' : 'The agent is applying in the apply browser' })
})
