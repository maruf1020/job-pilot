import { z } from 'zod'
import { ok, readJson, route } from '@/lib/api/response'
import { db } from '@/lib/db'
import { invalidateBannedPhrases } from '@/lib/pipeline/humanize/phrases'

const patchSchema = z.object({ severity: z.enum(['error', 'warn']).optional(), enabled: z.boolean().optional(), category: z.string().max(40).nullable().optional() })

export const PATCH = route(async (req, { params }) => {
  const { id } = await params
  const body = await readJson(req, patchSchema)
  const row = await db.bannedPhrase.update({ where: { id }, data: body })
  invalidateBannedPhrases()
  return ok(row)
})

export const DELETE = route(async (_req, { params }) => {
  const { id } = await params
  await db.bannedPhrase.delete({ where: { id } })
  invalidateBannedPhrases()
  return ok({ deleted: true })
})
