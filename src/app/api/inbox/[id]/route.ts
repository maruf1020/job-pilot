import { z } from 'zod'
import { notFound, ok, readJson, route } from '@/lib/api/response'
import { db } from '@/lib/db'
import { REPLY_CLASSIFICATIONS } from '@/lib/domain'
import { correctClassification, reclassifyInbound } from '@/lib/email/track'

export const GET = route(async (_req, { params }) => {
  const { id } = await params
  const m = await db.emailMessage.findUnique({ where: { id }, include: { application: { include: { job: { select: { id: true, title: true, companyName: true } } } } } })
  if (!m) throw notFound('Message')
  if (!m.isRead) await db.emailMessage.update({ where: { id }, data: { isRead: true } })
  return ok(m)
})

const patchSchema = z.object({
  isRead: z.boolean().optional(),
  classification: z.enum(REPLY_CLASSIFICATIONS).optional(),
  /** true = you dealt with this reply; false = put it back in "needs your action". */
  handled: z.boolean().optional(),
})

export const PATCH = route(async (req, { params }) => {
  const { id } = await params
  const body = await readJson(req, patchSchema)
  // A corrected class also moves the application (interview, rejected, back to sent).
  if (body.classification && !(await correctClassification(id, body.classification))) throw notFound('Message')
  const m = await db.emailMessage.update({
    where: { id },
    data: {
      ...(body.isRead !== undefined ? { isRead: body.isRead } : {}),
      ...(body.handled !== undefined ? { handledAt: body.handled ? new Date() : null, isRead: true } : {}),
    },
  })
  return ok(m, body.classification ? { message: 'Reply type changed' } : undefined)
})

/** POST /api/inbox/:id { action: "reclassify" } → run the classifier again (new reply classes, extracted links and contacts). */
export const POST = route(async (req, { params }) => {
  const { id } = await params
  const { action } = await readJson(req, z.object({ action: z.enum(['reclassify']) }))
  if (action === 'reclassify') {
    const m = await reclassifyInbound(id)
    if (!m) throw notFound('Message')
    return ok(m, { message: `Classified as ${m.classification}` })
  }
  return ok(null)
})
