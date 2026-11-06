import { z } from 'zod'
import type { Prisma } from '@/generated/prisma/client'
import { listResponse } from '@/lib/api/list'
import { ok, readJson, route } from '@/lib/api/response'
import { RUNS_TABLE } from '@/lib/api/tables'
import { db } from '@/lib/db'
import { SOURCE_IDS } from '@/lib/domain'
import { enqueueSearchRun } from '@/lib/queue'

export const GET = route(async (req) =>
  listResponse(req, RUNS_TABLE, async (args) => {
    const where = args.where as Prisma.SearchRunWhereInput
    const [rows, total] = await Promise.all([
      db.searchRun.findMany({ where, orderBy: args.orderBy as Prisma.SearchRunOrderByWithRelationInput[], skip: args.skip, take: args.take, include: { _count: { select: { sources: true, logs: true } } } }),
      db.searchRun.count({ where }),
    ])
    return [rows, total]
  }),
)

const triggerSchema = z.object({
  sources: z.array(z.enum(SOURCE_IDS)).optional(),
  skipDiscovery: z.boolean().optional(),
  skipDrafts: z.boolean().optional(),
})

/** POST /api/runs → enqueue a manual run (202). */
export const POST = route(async (req) => {
  const body = req.headers.get('content-length') && req.headers.get('content-length') !== '0' ? await readJson(req, triggerSchema) : {}
  const active = await db.searchRun.findFirst({ where: { status: 'RUNNING' }, select: { id: true } })
  if (active) return ok({ runId: active.id, alreadyRunning: true }, { status: 202, message: 'A run is already in progress' })
  const jobId = await enqueueSearchRun({ trigger: 'MANUAL', ...body })
  return ok({ queued: Boolean(jobId) }, { status: 202, message: 'Search run queued. The worker will pick it up within a few seconds.' })
})
