import { notFound, ok, route } from '@/lib/api/response'
import { companyHistory } from '@/lib/companies/history'
import { db } from '@/lib/db'

/** Every application to this company and when the company rule allows the next one (plan-ui-redesign.md 7.4). */
export const GET = route(async (_req, { params }) => {
  const { id } = await params
  const exists = await db.company.findUnique({ where: { id }, select: { id: true } })
  if (!exists) throw notFound('Company')
  return ok(await companyHistory(id))
})
