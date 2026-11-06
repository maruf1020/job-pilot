import { z } from 'zod'
import { ok, readJson, route } from '@/lib/api/response'
import { db } from '@/lib/db'
import { invalidateBannedPhrases } from '@/lib/pipeline/humanize/phrases'

export const GET = route(async () => ok(await db.bannedPhrase.findMany({ orderBy: [{ category: 'asc' }, { phrase: 'asc' }] })))

const createSchema = z.object({
  phrase: z.string().trim().min(2).max(200),
  severity: z.enum(['error', 'warn']).default('error'),
  category: z.string().trim().max(40).nullable().optional(),
  isRegex: z.boolean().default(false),
})

export const POST = route(async (req) => {
  const body = await readJson(req, createSchema)
  if (body.isRegex) new RegExp(body.phrase) // throws on invalid regex → 500 → fine for a personal tool, but validate anyway
  const row = await db.bannedPhrase.upsert({ where: { phrase: body.phrase }, update: { severity: body.severity, category: body.category ?? undefined, isRegex: body.isRegex, enabled: true }, create: body })
  invalidateBannedPhrases()
  return ok(row, { status: 201 })
})
