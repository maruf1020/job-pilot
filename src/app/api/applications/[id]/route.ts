import { z } from 'zod'
import { notFound, ok, readJson, route } from '@/lib/api/response'
import { loadConversations } from '@/lib/applications/conversations'
import { loadHiring } from '@/lib/applications/hiring'
import { db } from '@/lib/db'
import { cooldownWarning } from '@/lib/pipeline/cooldown'
import { APPLICATION_STATUSES } from '@/lib/domain'

export const GET = route(async (_req, { params }) => {
  const { id } = await params
  const app = await db.application.findUnique({
    where: { id },
    include: {
      job: { include: { score: true, company: { select: { id: true, name: true, knownSponsor: true, blacklisted: true, domain: true } } } },
      drafts: { orderBy: [{ kind: 'asc' }, { version: 'desc' }] },
      messages: { orderBy: { createdAt: 'asc' } },
      events: { orderBy: { createdAt: 'desc' }, take: 30, select: { id: true, type: true, message: true, createdAt: true } },
    },
  })
  if (!app) throw notFound('Application')
  await db.emailMessage.updateMany({ where: { applicationId: id, isRead: false }, data: { isRead: true } })
  const cooldown = app.sentAt ? null : await cooldownWarning({ companyId: app.job.companyId, countryCode: app.job.countryCode, companyName: app.job.companyName, excludeApplicationId: app.id, toEmail: app.toEmail })
  const [hiring, conversations] = await Promise.all([loadHiring(app.id), loadConversations(app.id)])
  return ok({ ...app, cooldown, hiring, conversations })
})

const patchSchema = z.object({
  status: z.enum(APPLICATION_STATUSES).optional(),
  notes: z.string().max(5000).nullable().optional(),
  toEmail: z.email().nullable().optional(),
  coverLetter: z.string().max(10000).nullable().optional(),
  answers: z.record(z.string(), z.unknown()).optional(),
})

export const PATCH = route(async (req, { params }) => {
  const { id } = await params
  const body = await readJson(req, patchSchema)
  const app = await db.application.update({
    where: { id },
    data: {
      ...(body.status ? { status: body.status } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.toEmail !== undefined ? { toEmail: body.toEmail } : {}),
      ...(body.coverLetter !== undefined ? { coverLetter: body.coverLetter } : {}),
      ...(body.answers !== undefined ? { answers: body.answers as object } : {}),
      lastActivityAt: new Date(),
    },
  })
  return ok(app)
})
