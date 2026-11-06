import { notFound, ok, readJson, route } from '@/lib/api/response'
import { db } from '@/lib/db'
import { enqueueScrape } from '@/lib/queue'
import { scrapeTargetSchema } from '../schema'

export const GET = route(async (_req, { params }) => {
  const { id } = await params
  const row = await db.scrapeTarget.findUnique({ where: { id } })
  if (!row) throw notFound('Scrape target')
  return ok(row)
})

export const PATCH = route(async (req, { params }) => {
  const { id } = await params
  const body = await readJson(req, scrapeTargetSchema.partial())
  const row = await db.scrapeTarget.update({ where: { id }, data: { ...body, ...(body.countryCode !== undefined ? { countryCode: body.countryCode?.toUpperCase() ?? null } : {}) } })
  return ok(row)
})

export const DELETE = route(async (_req, { params }) => {
  const { id } = await params
  await db.scrapeTarget.delete({ where: { id } })
  return ok({ deleted: true })
})

/** POST /api/scrape-targets/:id → run this target now (worker). */
export const POST = route(async (_req, { params }) => {
  const { id } = await params
  const row = await db.scrapeTarget.findUnique({ where: { id } })
  if (!row) throw notFound('Scrape target')
  await enqueueScrape(id)
  return ok({ queued: true }, { status: 202, message: `Scrape of "${row.name}" queued; results appear in Jobs when done` })
})
