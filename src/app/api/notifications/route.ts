import { z } from 'zod'
import { ok, readJson, route } from '@/lib/api/response'
import { db } from '@/lib/db'

const ATTENTION_TYPES = ['review_needed', 'reply', 'interview', 'error', 'quota']
const APP_LINK = /^\/applications\/([^/?#]+)$/
const CLOSED_STATUS = ['REJECTED', 'SKIPPED']

/**
 * GET /api/notifications?limit=&unread=true&type= → newest first, plus unread counts (total and per type)
 * and `nextSteps`: every employer reply waiting for you (pinned in the bell, shown as a popup), whatever the filter.
 */
export const GET = route(async (req) => {
  const url = new URL(req.url)
  const take = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 20) || 20))
  const unreadOnly = url.searchParams.get('unread') === 'true'
  const type = url.searchParams.get('type')
  const [items, unread, byType, pending, pendingRead] = await Promise.all([
    db.notification.findMany({ where: { ...(unreadOnly ? { readAt: null } : {}), ...(type ? { type } : {}) }, orderBy: { createdAt: 'desc' }, take }),
    db.notification.count({ where: { readAt: null } }),
    db.notification.groupBy({ by: ['type'], where: { readAt: null }, _count: { _all: true } }),
    db.notification.findMany({ where: { nextStep: true, ackedAt: null }, orderBy: { createdAt: 'desc' }, take: 20 }),
    db.notification.count({ where: { nextStep: true, ackedAt: null, readAt: { not: null } } }),
  ])
  const unreadByType = Object.fromEntries(byType.map((g) => [g.type, g._count._all]))
  // The bell badge counts what asks for you; "sent" and "run finished" are news, not tasks.
  // A next step still counts after "Mark all read": only opening or dismissing it clears it.
  const attention = ATTENTION_TYPES.reduce((n, t) => n + (unreadByType[t] ?? 0), 0) + pendingRead

  // Company and job title from the application itself, so the popup never has to parse the title.
  const appIds = [...new Set(pending.map((n) => APP_LINK.exec(n.link ?? '')?.[1]).filter((id): id is string => Boolean(id)))]
  const apps = appIds.length
    ? await db.application.findMany({ where: { id: { in: appIds } }, select: { id: true, status: true, job: { select: { title: true, companyName: true, location: true } } } })
    : []
  const appById = new Map(apps.map((a) => [a.id, a]))
  const nextSteps = pending.flatMap((n) => {
    const app = appById.get(APP_LINK.exec(n.link ?? '')?.[1] ?? '')
    // The company said no after this reply (Toggl, Senterprise): nothing waits for you there any more.
    if (app && CLOSED_STATUS.includes(app.status)) return []
    return [{ ...n, company: app?.job.companyName ?? null, jobTitle: app?.job.title ?? null, location: app?.job.location ?? null, applicationStatus: app?.status ?? null }]
  })

  return ok({ items, unread, unreadByType, attention, nextSteps })
})

const schema = z.object({ ids: z.array(z.string()).optional(), all: z.boolean().optional() })

/**
 * POST /api/notifications → mark read. Marking specific ids (you opened or dismissed them) also
 * acknowledges their next steps; "all" only marks read, so next steps stay pinned until handled.
 */
export const POST = route(async (req) => {
  const body = await readJson(req, schema)
  const now = new Date()
  if (body.all) {
    const r = await db.notification.updateMany({ where: { readAt: null }, data: { readAt: now } })
    return ok({ updated: r.count })
  }
  const ids = body.ids ?? []
  const [r] = await db.$transaction([
    db.notification.updateMany({ where: { id: { in: ids } }, data: { readAt: now } }),
    db.notification.updateMany({ where: { id: { in: ids }, nextStep: true, ackedAt: null }, data: { ackedAt: now } }),
  ])
  return ok({ updated: r.count })
})
