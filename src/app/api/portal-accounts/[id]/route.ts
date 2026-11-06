import { z } from 'zod'
import { notFound, ok, readJson, route } from '@/lib/api/response'
import { decryptSecret, encryptSecret } from '@/lib/crypto'
import { db } from '@/lib/db'

/** GET /api/portal-accounts/:id → the saved password, to sign in yourself. */
export const GET = route(async (_req, { params }) => {
  const { id } = await params
  const row = await db.portalAccount.findUnique({ where: { id } })
  if (!row) throw notFound('Account')
  return ok({ id: row.id, host: row.host, email: row.email, password: decryptSecret(row.encryptedPassword) })
})

const patchSchema = z.object({
  email: z.email().optional(),
  password: z.string().min(6).max(200).optional(),
  statusUrl: z.url().nullable().optional(),
})

/** PATCH /api/portal-accounts/:id → change the email/password (e.g. after you reset it on the site). */
export const PATCH = route(async (req, { params }) => {
  const { id } = await params
  const input = await readJson(req, patchSchema)
  const row = await db.portalAccount.update({
    where: { id },
    data: {
      ...(input.email ? { email: input.email } : {}),
      ...(input.password ? { encryptedPassword: encryptSecret(input.password), status: 'active', lastError: null } : {}),
      ...(input.statusUrl !== undefined ? { statusUrl: input.statusUrl } : {}),
    },
    select: { id: true, host: true, email: true, status: true, statusUrl: true },
  })
  return ok(row, { message: 'Saved' })
})

export const DELETE = route(async (_req, { params }) => {
  const { id } = await params
  await db.portalAccount.delete({ where: { id } })
  return ok({ deleted: true })
})
