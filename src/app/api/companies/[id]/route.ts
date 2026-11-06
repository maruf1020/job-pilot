import { notFound, ok, readJson, route } from '@/lib/api/response'
import { db } from '@/lib/db'
import { companySchema } from '../schema'

export const GET = route(async (_req, { params }) => {
  const { id } = await params
  const company = await db.company.findUnique({
    where: { id },
    include: { jobs: { orderBy: { firstSeenAt: 'desc' }, take: 50, select: { id: true, title: true, countryCode: true, status: true, firstSeenAt: true, score: { select: { finalScore: true } } } }, _count: { select: { jobs: true } } },
  })
  if (!company) throw notFound('Company')
  return ok(company)
})

export const PATCH = route(async (req, { params }) => {
  const { id } = await params
  const body = await readJson(req, companySchema.partial())
  const current = await db.company.findUnique({ where: { id }, select: { contactEmail: true } })
  if (!current) throw notFound('Company')
  const emailChanged = body.contactEmail !== undefined && body.contactEmail !== current.contactEmail
  const company = await db.company.update({
    where: { id },
    data: { ...body, ...(emailChanged ? { contactEmailSource: body.contactEmail ? 'manual' : null, contactCandidates: [], contactCheckedAt: new Date(), contactNotes: null } : {}) },
  })
  return ok(company)
})
