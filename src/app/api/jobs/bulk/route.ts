import { z } from 'zod'
import { ok, readJson, route } from '@/lib/api/response'
import { db } from '@/lib/db'
import { enqueueDraft } from '@/lib/queue'

const schema = z.object({
  ids: z.array(z.string()).min(1).max(200),
  action: z.enum(['draft', 'draft-and-queue', 'skip', 'rescore']),
})

/**
 * POST /api/jobs/bulk
 * - draft: generate drafts for the selected jobs (they land in Review)
 * - draft-and-queue: generate drafts and queue every one that passes the checks for sending
 *   (respects the send window, daily cap and company cooldown; ATS/portal jobs stay in Review)
 * - skip / rescore
 */
export const POST = route(async (req) => {
  const { ids, action } = await readJson(req, schema)
  let affected = 0
  if (action === 'skip') {
    affected = (await db.job.updateMany({ where: { id: { in: ids } }, data: { status: 'SKIPPED' } })).count
  } else if (action === 'rescore') {
    affected = (await db.job.updateMany({ where: { id: { in: ids } }, data: { status: 'NEW', enrichedAt: null, filterReason: null } })).count
  } else {
    const eligible = await db.job.findMany({
      where: { id: { in: ids }, company: { blacklisted: false }, OR: [{ application: null }, { application: { status: { in: ['DRAFT', 'REVIEW', 'NEEDS_HUMAN', 'SKIPPED'] } } }] },
      select: { id: true },
    })
    for (const j of eligible) {
      await enqueueDraft({ jobId: j.id, force: true, autoQueue: action === 'draft-and-queue' })
      affected++
    }
    await db.job.updateMany({ where: { id: { in: eligible.map((j) => j.id) } }, data: { status: 'DRAFTING' } })
  }
  return ok({ affected }, { message: action === 'draft-and-queue' ? `${affected} draft(s) queued; passing ones will be scheduled for sending` : `${affected} job(s) updated` })
})
