import type { Prisma } from '@/generated/prisma/client'
import { listResponse } from '@/lib/api/list'
import { route } from '@/lib/api/response'
import { JOBS_TABLE } from '@/lib/api/tables'
import { db } from '@/lib/db'

const JOB_LIST_SELECT = {
  id: true,
  title: true,
  companyName: true,
  companyId: true,
  location: true,
  countryCode: true,
  remote: true,
  url: true,
  postedAt: true,
  firstSeenAt: true,
  primarySource: true,
  sponsorship: true,
  applyChannel: true,
  contactEmail: true,
  contactEmailSource: true,
  seniority: true,
  status: true,
  filterReason: true,
  salaryMin: true,
  salaryMax: true,
  currency: true,
  score: { select: { finalScore: true, ruleScore: true, llmScore: true, hook: true } },
  application: { select: { id: true, status: true } },
  company: { select: { knownSponsor: true, blacklisted: true } },
} satisfies Prisma.JobSelect

export const GET = route(async (req) => {
  const url = new URL(req.url)
  // Hide filtered/rejected by default unless the caller filters by status explicitly.
  const explicitStatus = [...url.searchParams.keys()].some((k) => k.startsWith('filter[status]'))
  const base: Prisma.JobWhereInput = explicitStatus ? {} : { status: { notIn: ['FILTERED', 'REJECTED_RULE'] } }
  return listResponse(
    req,
    JOBS_TABLE,
    async (args) => {
      const where = args.where as Prisma.JobWhereInput
      const [rows, total] = await Promise.all([
        db.job.findMany({ where, orderBy: args.orderBy as Prisma.JobOrderByWithRelationInput[], skip: args.skip, take: args.take, select: JOB_LIST_SELECT }),
        db.job.count({ where }),
      ])
      return [rows, total]
    },
    base,
  )
})
