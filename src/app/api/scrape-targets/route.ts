import { ok, readJson, route } from '@/lib/api/response'
import { db } from '@/lib/db'
import { scrapeTargetSchema } from './schema'

export const GET = route(async () => ok(await db.scrapeTarget.findMany({ orderBy: { createdAt: 'asc' } })))

export const POST = route(async (req) => {
  const body = await readJson(req, scrapeTargetSchema)
  const row = await db.scrapeTarget.create({ data: { ...body, countryCode: body.countryCode?.toUpperCase() ?? null } })
  return ok(row, { status: 201, message: 'Target added' })
})
