import type { Prisma } from '@/generated/prisma/client'
import { listResponse } from '@/lib/api/list'
import { route } from '@/lib/api/response'
import { APPLICATIONS_TABLE } from '@/lib/api/tables'
import { db } from '@/lib/db'

export const GET = route(async (req) =>
  listResponse(req, APPLICATIONS_TABLE, async (args) => {
    const where = args.where as Prisma.ApplicationWhereInput
    const [rows, total] = await Promise.all([
      db.application.findMany({
        where,
        orderBy: args.orderBy as Prisma.ApplicationOrderByWithRelationInput[],
        skip: args.skip,
        take: args.take,
        select: {
          id: true,
          channel: true,
          status: true,
          toEmail: true,
          scheduledFor: true,
          sentAt: true,
          repliedAt: true,
          followUpSentAt: true,
          lastActivityAt: true,
          createdAt: true,
          job: { select: { id: true, title: true, companyName: true, countryCode: true, url: true, score: { select: { finalScore: true } } } },
          drafts: { where: { isSelected: true, kind: 'initial' }, take: 1, select: { id: true, subject: true, passed: true } },
          _count: { select: { messages: true } },
        },
      }),
      db.application.count({ where }),
    ])
    return [rows, total]
  }),
)
