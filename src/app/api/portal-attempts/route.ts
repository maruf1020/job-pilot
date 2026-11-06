import { ok, route } from '@/lib/api/response'
import { db } from '@/lib/db'

/**
 * GET /api/portal-attempts?status=AWAITING_REVIEW,NEEDS_HUMAN → the browser agent's attempts that
 * wait for you (filled forms to submit, forms that need a hand), newest first, one per application.
 */
export const GET = route(async (req) => {
  const url = new URL(req.url)
  const statuses = (url.searchParams.get('status') ?? 'AWAITING_REVIEW,NEEDS_HUMAN').split(',').filter(Boolean)
  const rows = await db.portalAttempt.findMany({
    where: { status: { in: statuses }, application: { sentAt: null } },
    orderBy: { finishedAt: 'desc' },
    take: 100,
    select: {
      id: true,
      status: true,
      mode: true,
      atsType: true,
      formUrl: true,
      finalUrl: true,
      tabId: true,
      screenshots: true,
      needsHumanReason: true,
      questions: true,
      fields: true,
      finishedAt: true,
      startedAt: true,
      application: { select: { id: true, status: true, job: { select: { id: true, title: true, companyName: true, countryCode: true, finalScore: true, url: true } } } },
    },
  })
  const seen = new Set<string>()
  const latest = rows.filter((r) => {
    if (seen.has(r.application.id)) return false
    seen.add(r.application.id)
    return true
  })
  return ok(latest.map((r) => ({ ...r, answers: Array.isArray(r.fields) ? (r.fields as unknown[]).length : 0, fields: undefined })))
})
