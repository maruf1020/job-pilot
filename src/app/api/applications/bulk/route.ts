import { z } from 'zod'
import { ok, readJson, route } from '@/lib/api/response'
import { db } from '@/lib/db'
import { evaluateAutoSend } from '@/lib/pipeline/decide'
import { getSettings } from '@/lib/settings/service'

const schema = z.object({
  ids: z.array(z.string()).max(500).optional(),
  action: z.enum(['approve', 'approve-all-passing', 'unqueue', 'skip']),
  /** Evaluate only: report what would be queued without changing anything (used by tests and previews). */
  dryRun: z.boolean().default(false),
})

/**
 * POST /api/applications/bulk
 * - approve: queue the selected reviewed applications whose draft passed
 * - approve-all-passing: queue every REVIEW application with a passing draft (the "apply a lot" button)
 * - unqueue / skip the selected ones
 */
export const POST = route(async (req) => {
  const { ids, action, dryRun } = await readJson(req, schema)
  if (action === 'approve-all-passing' || action === 'approve') {
    const settings = await getSettings()
    const where =
      action === 'approve-all-passing'
        ? { status: 'REVIEW', channel: 'email', drafts: { some: { isSelected: true, passed: true } } }
        : { id: { in: ids ?? [] }, status: { in: ['REVIEW', 'NEEDS_HUMAN', 'DRAFT'] } }
    const apps = await db.application.findMany({ where, select: { id: true }, orderBy: { lastActivityAt: 'asc' }, take: 500 })
    let queued = 0
    const reasons: Record<string, number> = {}
    for (const a of apps) {
      const r = await evaluateAutoSend(a.id, { force: true, requirePassed: true, dryRun })
      if (r.outcome === 'queued') queued++
      else if (r.reason) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1
    }
    const why = Object.entries(reasons)
      .map(([k, v]) => `${v}× ${k}`)
      .join('; ')
    const paused = !settings.email.sendingEnabled && queued > 0 && !dryRun ? '. Sending is paused, so they wait in the queue until you allow sending in Settings → Email' : ''
    return ok({ queued, considered: apps.length, reasons, dryRun }, { message: `${queued} of ${apps.length} ${dryRun ? 'would be queued' : 'queued'}${why ? ` (${why})` : ''}${paused}` })
  }
  const list = ids ?? []
  if (action === 'unqueue') {
    const r = await db.application.updateMany({ where: { id: { in: list }, status: 'QUEUED' }, data: { status: 'REVIEW', scheduledFor: null, lastActivityAt: new Date() } })
    return ok({ affected: r.count })
  }
  const r = await db.application.updateMany({ where: { id: { in: list }, sentAt: null }, data: { status: 'SKIPPED', scheduledFor: null, lastActivityAt: new Date() } })
  const jobs = await db.application.findMany({ where: { id: { in: list } }, select: { jobId: true } })
  await db.job.updateMany({ where: { id: { in: jobs.map((j) => j.jobId) } }, data: { status: 'SKIPPED' } })
  return ok({ affected: r.count })
})
