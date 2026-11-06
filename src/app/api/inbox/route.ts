import type { Prisma } from '@/generated/prisma/client'
import { listResponse } from '@/lib/api/list'
import { ok, route } from '@/lib/api/response'
import { INBOX_TABLE } from '@/lib/api/tables'
import { db } from '@/lib/db'
import { enqueueMailPoll } from '@/lib/queue'

export const GET = route(async (req) =>
  listResponse(
    req,
    INBOX_TABLE,
    async (args) => {
      const where = args.where as Prisma.EmailMessageWhereInput
      const [rows, total] = await Promise.all([
        db.emailMessage.findMany({
          where,
          orderBy: args.orderBy as Prisma.EmailMessageOrderByWithRelationInput[],
          skip: args.skip,
          take: args.take,
          include: { application: { select: { id: true, status: true, job: { select: { id: true, title: true, companyName: true } } } } },
        }),
        db.emailMessage.count({ where }),
      ])
      return [rows, total]
    },
    { direction: 'INBOUND' },
  ),
)

/** POST /api/inbox → poll mailboxes now. */
export const POST = route(async () => {
  await enqueueMailPoll()
  return ok({ queued: true }, { status: 202, message: 'Reply check queued' })
})
