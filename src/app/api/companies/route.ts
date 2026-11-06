import type { Prisma } from '@/generated/prisma/client'
import { listResponse } from '@/lib/api/list'
import { ok, readJson, route } from '@/lib/api/response'
import { COMPANIES_TABLE } from '@/lib/api/tables'
import { applicationStatsFor } from '@/lib/companies/history'
import { db } from '@/lib/db'
import { normalizeCompany } from '@/lib/text'
import { companySchema } from './schema'

export const GET = route(async (req) => {
  const url = new URL(req.url)
  const hasAts = url.searchParams.get('filter[hasAts]')
  const hasMatching = url.searchParams.get('filter[hasMatching]')
  const conditions: Prisma.CompanyWhereInput[] = []
  if (hasAts === 'true') conditions.push({ atsType: { not: null } })
  if (hasAts === 'false') conditions.push({ atsType: null })
  // Boards whose last count found at least one job matching the search rules (title, stack, location or remote).
  if (hasMatching === 'true') conditions.push({ atsType: { not: null }, boardMatchingJobs: { gt: 0 } })
  if (hasMatching === 'false') conditions.push({ atsType: { not: null }, boardMatchingJobs: 0 })
  const base: Prisma.CompanyWhereInput = conditions.length ? { AND: conditions } : {}
  // hasAts and hasMatching are virtual; strip them before the generic parser sees them.
  url.searchParams.delete('filter[hasAts]')
  url.searchParams.delete('filter[hasMatching]')
  const cleaned = new Request(url.toString(), { headers: req.headers })
  return listResponse(
    cleaned,
    COMPANIES_TABLE,
    async (args) => {
      const where = args.where as Prisma.CompanyWhereInput
      const [rows, total] = await Promise.all([
        db.company.findMany({ where, orderBy: args.orderBy as Prisma.CompanyOrderByWithRelationInput[], skip: args.skip, take: args.take, include: { _count: { select: { jobs: true } } } }),
        db.company.count({ where }),
      ])
      // Sent applications per company on this page (plan-ui-redesign.md 7.4).
      const stats = await applicationStatsFor(rows.map((r) => r.id))
      return [rows.map((r) => ({ ...r, applications: stats.get(r.id) ?? { count: 0, lastSentAt: null } })), total]
    },
    base,
  )
})

export const POST = route(async (req) => {
  const body = await readJson(req, companySchema)
  const normalizedName = normalizeCompany(body.name) || body.name.toLowerCase()
  const company = await db.company.upsert({
    where: { normalizedName },
    update: { ...body },
    create: { ...body, normalizedName },
  })
  return ok(company, { status: 201 })
})
