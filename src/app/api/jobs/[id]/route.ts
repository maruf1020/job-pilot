import { z } from 'zod'
import { notFound, ok, readJson, route } from '@/lib/api/response'
import { db } from '@/lib/db'
import { cooldownWarning } from '@/lib/pipeline/cooldown'

export const GET = route(async (_req, { params }) => {
  const { id } = await params
  const job = await db.job.findUnique({
    where: { id },
    include: {
      score: true,
      company: true,
      sourceLinks: { select: { source: true, externalId: true, url: true, firstSeenAt: true, lastSeenAt: true } },
      application: { include: { drafts: { orderBy: [{ kind: 'asc' }, { version: 'desc' }] }, messages: { orderBy: { createdAt: 'asc' } } } },
    },
  })
  if (!job) throw notFound('Job')
  const applied = job.application?.sentAt != null
  const cooldown = applied ? null : await cooldownWarning({ companyId: job.companyId, countryCode: job.countryCode, companyName: job.companyName, excludeApplicationId: job.application?.id, toEmail: job.contactEmail })
  return ok({ ...job, cooldown })
})

const patchSchema = z.object({
  status: z.enum(['SKIPPED', 'RANKED', 'NEW']).optional(),
  contactEmail: z.email().nullable().optional(),
  applyChannel: z.enum(['email', 'ats', 'portal', 'unknown']).optional(),
  sponsorship: z.enum(['yes', 'likely', 'unknown', 'no']).optional(),
  countryCode: z.string().length(2).nullable().optional(),
})

export const PATCH = route(async (req, { params }) => {
  const { id } = await params
  const body = await readJson(req, patchSchema)
  const job = await db.job.update({
    where: { id },
    data: {
      ...body,
      ...(body.status ? { filterReason: null } : {}),
      // A hand-entered address is trusted like one from the posting.
      ...(body.contactEmail !== undefined ? { contactEmailSource: body.contactEmail ? 'manual' : null, contactCandidates: [], applyChannel: body.contactEmail ? 'email' : undefined } : {}),
    },
  })
  return ok(job)
})
