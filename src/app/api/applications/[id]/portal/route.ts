import { z } from 'zod'
import { badRequest, notFound, ok, readJson, route } from '@/lib/api/response'
import { openInCleanChrome } from '@/lib/browser/clean-chrome'
import { asHttp } from '@/lib/apply/http'
import { cancelPortalAttempt, markSubmittedByHand, queuePortalAttempt } from '@/lib/apply/service'
import { db } from '@/lib/db'
import { enqueueBrowserControl } from '@/lib/queue'

/** GET /api/applications/:id/portal → the browser agent's attempts for this application (newest first). */
export const GET = route(async (_req, { params }) => {
  const { id } = await params
  const attempts = await db.portalAttempt.findMany({ where: { applicationId: id }, orderBy: { startedAt: 'desc' }, take: 10 })
  return ok(attempts)
})

const schema = z.object({
  action: z.enum(['fill', 'submit', 'cancel', 'mark-submitted', 'focus', 'close-tab', 'open-clean']),
  attemptId: z.string().optional(),
  ignoreCooldown: z.boolean().optional(),
  note: z.string().max(2000).optional(),
})

/**
 * POST /api/applications/:id/portal
 *  fill            open the form in the apply browser and fill it (stops before Submit)
 *  submit          fill (or continue in the reviewed tab) and submit: your yes for this application
 *  cancel          stop a queued/running attempt
 *  mark-submitted  you finished it yourself
 *  focus / close-tab  show or close the attempt's tab in the apply browser
 */
export const POST = route(async (req, { params }) => {
  const { id } = await params
  const input = await readJson(req, schema)
  const app = await db.application.findUnique({ where: { id }, select: { id: true } })
  if (!app) throw notFound('Application')
  switch (input.action) {
    case 'fill':
    case 'submit': {
      const a = await asHttp(queuePortalAttempt(id, input.action, { ignoreCooldown: input.ignoreCooldown, interactive: true }))
      return ok(a, { message: input.action === 'fill' ? 'The agent is filling the form in the apply browser' : 'The agent is applying in the apply browser' })
    }
    case 'cancel': {
      const active = input.attemptId ?? (await db.portalAttempt.findFirst({ where: { applicationId: id, status: { in: ['QUEUED', 'RUNNING'] } }, orderBy: { startedAt: 'desc' } }))?.id
      if (!active) return ok(null, { message: 'Nothing is running' })
      return ok(await asHttp(cancelPortalAttempt(active)), { message: 'Stopping' })
    }
    case 'mark-submitted':
      return ok(await asHttp(markSubmittedByHand(id, input.note)), { message: 'Marked as applied' })
    case 'open-clean': {
      // A separate Chrome nothing controls, for forms whose bot check rejects the apply browser (Lever, Recruitee).
      const last = await db.portalAttempt.findFirst({ where: { applicationId: id }, orderBy: { startedAt: 'desc' }, select: { formUrl: true, finalUrl: true, startUrl: true } })
      const job = await db.application.findUnique({ where: { id }, select: { job: { select: { url: true } } } })
      const url = last?.formUrl ?? last?.startUrl ?? job?.job.url ?? last?.finalUrl
      if (!url) throw notFound('Form address')
      const r = await openInCleanChrome(url)
      if (!r.ok) throw badRequest(r.error)
      return ok({ opened: url }, { message: 'Opened in a clean Chrome. Fill it there, then press "I submitted it".' })
    }
    case 'focus':
    case 'close-tab': {
      const attemptId = input.attemptId ?? (await db.portalAttempt.findFirst({ where: { applicationId: id }, orderBy: { startedAt: 'desc' } }))?.id
      if (!attemptId) throw notFound('Attempt')
      await enqueueBrowserControl({ action: input.action, attemptId })
      return ok({ queued: true }, { message: input.action === 'focus' ? 'Showing the tab in the apply browser' : 'Closing the tab' })
    }
  }
})
